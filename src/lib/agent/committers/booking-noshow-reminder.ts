/**
 * Committer for proposal kind `BOOKING_NOSHOW_REMINDER`.
 *
 * When approved, creates an OutboundMessage reminder to the booker.
 * The message is initially STUBBED (email provider is stubbed); upgrade to
 * real provider (Resend, etc.) in Phase 5b (decisions log 2026-05-05).
 */

import { prisma } from "@/lib/prisma";
import { OutboundChannel, OutboundStatus } from "@prisma/client";
import { registerCommitter, type CommitResult } from "./index";
import { BOOKING_NOSHOW_REMINDER_KIND, type BookingNoShowReminderPayload } from "@/lib/agent/agents/no-show";

registerCommitter<BookingNoShowReminderPayload>(
  BOOKING_NOSHOW_REMINDER_KIND,
  async ({ proposal, payload, approverId }): Promise<CommitResult> => {
    // Fetch booking + booker to get email address
    const booking = await prisma.booking.findUnique({
      where: { id: payload.bookingId },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!booking) {
      throw new Error(`Booking ${payload.bookingId} not found`);
    }

    // Create a reminder OutboundMessage
    const message = await prisma.outboundMessage.create({
      data: {
        channel: OutboundChannel.EMAIL,
        status: OutboundStatus.STUBBED,
        toAddress: booking.user.email,
        subject: "Friendly reminder: Your upcoming booking",
        bodyText: buildReminderText(booking.user.name ?? "Member", payload),
        tenantId: proposal.targetTenantId ?? proposal.tenantId ?? undefined,
        relatedEntity: "Booking",
        relatedEntityId: payload.bookingId,
      },
    });

    return { entityType: "OutboundMessage", entityId: message.id };
  },
);

function buildReminderText(name: string, payload: BookingNoShowReminderPayload): string {
  const dateStr = new Date(payload.bookingDate).toLocaleDateString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return [
    `Hi ${name},`,
    ``,
    `Just a friendly reminder about your upcoming booking on ${dateStr}.`,
    ``,
    `If you're not able to make it, please let us know so someone else can use the slot.`,
    ``,
    `See you there!`,
    `The Bowling Club Team`,
  ].join("\n");
}
