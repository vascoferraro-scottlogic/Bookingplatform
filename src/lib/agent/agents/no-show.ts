import { prisma } from "@/lib/prisma";
import {
  AgentAction,
  AgentDefinition,
  AgentRun,
  BookingStatus,
} from "@prisma/client";
import { BaseAgent, RunSummary } from "@/lib/agent/base-agent";
import { predictNoShow, MlServiceError, type NoShowPredictRequest } from "@/lib/agent/ml-client";

export const BOOKING_NOSHOW_REMINDER_KIND = "BOOKING_NOSHOW_REMINDER";

export interface BookingNoShowReminderPayload {
  bookingId: string;
  userId: string;
  bookingDate: string;
  probability: number;
  modelVersion: string;
  /** Reason: "high_risk" if probability ≥ threshold, "batch_default" otherwise. */
  source: string;
}

interface NoShowConfig {
  riskThreshold: number;
  /** Only predict upcoming CONFIRMED/RESERVED bookings; skip past bookings. */
  predictionWindowDays: number;
  /** Max bookings per run. */
  maxBookingsPerRun: number;
}

const DEFAULTS: NoShowConfig = {
  riskThreshold: 0.4,
  predictionWindowDays: 30,
  maxBookingsPerRun: 50,
};

/**
 * NoShowRiskAgent — predicts no-show risk on upcoming confirmed/reserved
 * bookings using the Python ML sidecar. Emits BOOKING_NOSHOW_REMINDER
 * proposals at probability-based confidence.
 *
 * Integration:
 *  - Reads Booking(status ∈ {CONFIRMED, RESERVED}, date within window)
 *  - Fetches User.createdAt + prior NO_SHOW count (for feature engineering)
 *  - Calls ml-client.predictNoShow() with booking context
 *  - Emits BOOKING_NOSHOW_REMINDER proposals with confidence = probability
 *  - Committer (src/lib/agent/committers/booking-noshow-reminder.ts) sends reminder
 *
 * ML contract (features.py):
 *  - lead_time_days, day_of_week, month, hour_of_day, is_weekend,
 *    is_all_weather, tenure_days, prior_no_show_count
 *  - Probability output 0..1
 */
export class NoShowRiskAgent extends BaseAgent {
  readonly slug = "no-show";
  readonly displayName = "No-Show Risk Predictor";

  protected async process(
    tenantId: string,
    run: AgentRun,
    definition: AgentDefinition,
  ): Promise<RunSummary> {
    const config = await this.getConfig<NoShowConfig>(definition.id, tenantId, DEFAULTS);
    if (!config._enabled) {
      return { itemsProcessed: 0, tasksAffected: 0, decisionsRecorded: 0, extras: { skipped: "disabled" } };
    }

    // Upcoming bookings (next `predictionWindowDays` days)
    const now = new Date();
    const windowEnd = new Date(now.getTime() + config.predictionWindowDays * 24 * 60 * 60 * 1000);

    const bookings = await prisma.booking.findMany({
      where: {
        tenantId,
        status: { in: ["CONFIRMED", "RESERVED"] as BookingStatus[] },
        date: {
          gte: now.toISOString().slice(0, 10),
          lte: windowEnd.toISOString().slice(0, 10),
        },
      },
      include: {
        user: { select: { createdAt: true } },
        slots: { select: { timeSlot: true, rink: { select: { green: { select: { allWeather: true } } } } } },
      },
      orderBy: { date: "asc" },
      take: config.maxBookingsPerRun,
    });

    if (bookings.length === 0) {
      return { itemsProcessed: 0, tasksAffected: 0, decisionsRecorded: 0 };
    }

    // Pre-compute prior no-show counts for all users in this batch (avoid N+1)
    const userIds = [...new Set(bookings.map((b) => b.userId))];
    const priorNoShowCounts = new Map<string, number>();
    const noShowGroups = await prisma.booking.groupBy({
      by: ["userId"],
      where: {
        tenantId,
        userId: { in: userIds },
        status: "NO_SHOW",
      },
      _count: { _all: true },
    });
    for (const g of noShowGroups) {
      priorNoShowCounts.set(g.userId, g._count._all);
    }

    let proposalsEmitted = 0;
    let decisionsRecorded = 0;

    for (const booking of bookings) {
      const slot = booking.slots[0];
      if (!slot || !slot.timeSlot) {
        // Bookings should always have slots from our schema, but be defensive
        await this.recordDecision({
          agentId: definition.id,
          runId: run.id,
          tenantId,
          action: AgentAction.NO_ACTION,
          confidence: 0,
          reasoning: "booking has no slot",
          sourceMessageId: booking.id,
        });
        decisionsRecorded++;
        continue;
      }

      // Build prediction request: all fields required by features.py
      const req: NoShowPredictRequest = {
        date: booking.date,
        createdAt: booking.createdAt.toISOString(),
        userCreatedAt: booking.user.createdAt.toISOString(),
        timeSlot: slot.timeSlot,
        isAllWeather: slot.rink?.green?.allWeather ?? false,
        priorNoShowCount: priorNoShowCounts.get(booking.userId) ?? 0,
      };

      let probability = 0;
      let modelVersion = "unknown";

      try {
        const res = await predictNoShow(req);
        probability = res.probability;
        modelVersion = res.modelVersion;

        // Persist prediction for every scored booking (not just high-risk ones)
        // so eval-noshow.ts can compute a full confusion matrix against actuals.
        await prisma.bookingNoShowPrediction.upsert({
          where: { bookingId_modelVersion: { bookingId: booking.id, modelVersion } },
          create: { bookingId: booking.id, tenantId, modelVersion, probability },
          update: { probability, predictedAt: new Date() },
        });
      } catch (e) {
        const err = e as MlServiceError;
        const msg = `ML predict failed: ${err.message}${err.status ? ` (${err.status})` : ""}`;
        await this.recordDecision({
          agentId: definition.id,
          runId: run.id,
          tenantId,
          action: AgentAction.NO_ACTION,
          confidence: 0,
          reasoning: msg,
          sourceMessageId: booking.id,
        });
        decisionsRecorded++;
        continue;
      }

      // Emit if risk is high
      if (probability >= config.riskThreshold) {
        const payload: BookingNoShowReminderPayload = {
          bookingId: booking.id,
          userId: booking.userId,
          bookingDate: booking.date,
          probability,
          modelVersion,
          source: "high_risk",
        };

        await this.emitTenantProposal({
          agentId: definition.id,
          runId: run.id,
          tenantId,
          kind: BOOKING_NOSHOW_REMINDER_KIND,
          payload,
          confidence: probability, // Use the model's probability as proposal confidence
          reasoning: `No-show risk estimated at ${(probability * 100).toFixed(0)}% (threshold: ${(config.riskThreshold * 100).toFixed(0)}%)`,
        });
        proposalsEmitted++;
      }

      // Record a decision for every booking processed (train on both high + low)
      await this.recordDecision({
        agentId: definition.id,
        runId: run.id,
        tenantId,
        action: probability >= config.riskThreshold ? AgentAction.PREDICTED_TASK : AgentAction.NO_ACTION,
        confidence: probability,
        reasoning: `ML no-show prediction: ${(probability * 100).toFixed(1)}%`,
        sourceMessageId: booking.id,
      });
      decisionsRecorded++;
    }

    return {
      itemsProcessed: bookings.length,
      tasksAffected: proposalsEmitted,
      decisionsRecorded,
      extras: { proposalsEmitted },
    };
  }
}
