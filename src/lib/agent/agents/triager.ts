import { prisma } from "@/lib/prisma";
import {
  AgentAction,
  AgentDefinition,
  AgentRun,
  InteractionType,
  Role,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { BaseAgent, RunSummary } from "@/lib/agent/base-agent";
import { knowledgeToPromptText, regionForCoords, resolveKnowledge } from "@/lib/agent/knowledge";
import { fetchWeatherForecast, forecastToPromptText } from "@/lib/agent/weather";

interface TriageConfig {
  autoAssign: boolean;
  autoPrioritise: boolean;
  workloadBalancing: boolean;
  useWeatherContext: boolean;
  maxAssignmentsPerRun: number;
}

const DEFAULTS: TriageConfig = {
  autoAssign: true,
  autoPrioritise: true,
  workloadBalancing: true,
  useWeatherContext: true,
  maxAssignmentsPerRun: 10,
};

interface LLMTriageDecision {
  taskId: string;
  suggestedPriority?: string;
  suggestedAssigneeId?: string | null;
  confidence?: number;
  reasoning?: string;
  weatherInfluenced?: boolean;
}

interface LLMResponse {
  decisions: LLMTriageDecision[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          suggestedPriority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          suggestedAssigneeId: { type: "string", nullable: true },
          confidence: { type: "number" },
          reasoning: { type: "string" },
          weatherInfluenced: { type: "boolean" },
        },
        required: ["taskId"],
      },
    },
  },
  required: ["decisions"],
};

export class TriageAgent extends BaseAgent {
  readonly slug = "triager";
  readonly displayName = "Triage Agent";

  protected async process(
    tenantId: string,
    run: AgentRun,
    definition: AgentDefinition,
  ): Promise<RunSummary> {
    const config = await this.getConfig<TriageConfig>(definition.id, tenantId, DEFAULTS);
    if (!config._enabled) {
      return { itemsProcessed: 0, tasksAffected: 0, decisionsRecorded: 0, extras: { skipped: "disabled" } };
    }

    // Find tasks needing triage: SUBMITTED status, no assignee yet
    const tasks = await prisma.maintenanceTask.findMany({
      where: { tenantId, status: TaskStatus.SUBMITTED, assignedToId: null },
      orderBy: { createdAt: "asc" },
      take: config.maxAssignmentsPerRun,
    });

    if (tasks.length === 0) {
      return { itemsProcessed: 0, tasksAffected: 0, decisionsRecorded: 0 };
    }

    // Maintenance staff + their current load
    const staff = await prisma.user.findMany({
      where: { tenantId, role: { in: [Role.MAINTENANCE, Role.TENANT_ADMIN] }, suspended: false },
      select: { id: true, name: true, email: true, role: true },
    });
    const workload = await prisma.maintenanceTask.groupBy({
      by: ["assignedToId"],
      where: {
        tenantId,
        assignedToId: { in: staff.map((s) => s.id) },
        status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] },
      },
      _count: { _all: true },
    });
    const loadByUser = new Map<string, number>(
      workload.map((w) => [w.assignedToId!, w._count._all]),
    );

    // Tenant + region + weather + knowledge + recent maintenance history
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, latitude: true, longitude: true },
    });
    const region = regionForCoords(tenant?.latitude ?? null, tenant?.longitude ?? null);
    const knowledge = await resolveKnowledge({
      tenantId, agentSlug: this.slug, region, limit: 25,
    });
    const weather = config.useWeatherContext
      ? await fetchWeatherForecast(tenant?.latitude ?? null, tenant?.longitude ?? null)
      : { available: false, reason: "disabled by config", days: [] as never[] };
    const recentHistory = await prisma.maintenanceHistory.findMany({
      where: { tenantId, performedAt: { gt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      orderBy: { performedAt: "desc" },
      take: 10,
    });

    const systemPrompt = [
      `You are the Maintenance Triage Agent for a bowling club platform.`,
      `For each pending maintenance task, decide a priority and an assignee.`,
      `Factor in: domain knowledge, recent maintenance history, weather forecast (especially for grounds tasks), and staff workload.`,
      ``,
      `Domain knowledge:`,
      knowledgeToPromptText(knowledge),
      ``,
      `Weather forecast (next 7 days):`,
      forecastToPromptText(weather),
      ``,
      `Recent maintenance activities at this club (last 90 days):`,
      recentHistory.length > 0
        ? recentHistory.map((h) => `  ${h.performedAt.toISOString().slice(0, 10)}: ${h.activityType}${h.description ? " — " + h.description : ""}`).join("\n")
        : "  (no history recorded)",
      ``,
      `Available staff (id, name, current open task count):`,
      staff.map((s) => `  ${s.id}: ${s.name ?? s.email} [${s.role}] (load=${loadByUser.get(s.id) ?? 0})`).join("\n") || "  (none)",
      ``,
      `For each task return: suggestedPriority, suggestedAssigneeId (must be one of the staff ids above, or null if no assignment recommended), confidence (0-1), reasoning, weatherInfluenced (true if weather affected priority).`,
    ].join("\n");

    const userPrompt = [
      `Tenant: ${tenant?.name ?? "Unknown"}`,
      `Tasks to triage:`,
      ...tasks.map(
        (t) => `[${t.id}] [${t.category}/current=${t.priority}] ${t.title} — ${truncate(t.description, 200)}`,
      ),
    ].join("\n");

    let llmResponse: LLMResponse;
    try {
      const result = await this.provider.call({
        systemPrompt, userPrompt,
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      });
      llmResponse = (result.content as LLMResponse) ?? { decisions: [] };
    } catch (e) {
      llmResponse = { decisions: [] };
      // eslint-disable-next-line no-console
      console.warn(`[triager] LLM call failed for tenant ${tenantId}:`, (e as Error).message);
    }

    let tasksAffected = 0;
    let decisionsRecorded = 0;

    for (const d of llmResponse.decisions ?? []) {
      const task = tasks.find((t) => t.id === d.taskId);
      if (!task) continue;

      const wantPriority = parsePriority(d.suggestedPriority);
      const wantAssigneeId = d.suggestedAssigneeId && staff.some((s) => s.id === d.suggestedAssigneeId)
        ? d.suggestedAssigneeId
        : null;

      const updates: { priority?: TaskPriority; assignedToId?: string; status?: TaskStatus } = {};
      if (config.autoPrioritise && wantPriority && wantPriority !== task.priority) {
        updates.priority = wantPriority;
      }
      if (config.autoAssign && wantAssigneeId) {
        updates.assignedToId = wantAssigneeId;
        updates.status = TaskStatus.ASSIGNED;
      }

      if (Object.keys(updates).length === 0) {
        await this.recordDecision({
          agentId: definition.id, runId: run.id, tenantId,
          action: AgentAction.NO_ACTION,
          confidence: d.confidence ?? 0,
          reasoning: d.reasoning ?? "No change recommended",
          taskId: task.id,
        });
        decisionsRecorded++;
        continue;
      }

      await prisma.maintenanceTask.update({ where: { id: task.id }, data: updates });
      tasksAffected++;

      if (updates.priority) {
        await this.recordDecision({
          agentId: definition.id, runId: run.id, tenantId,
          action: AgentAction.PRIORITY_CHANGED,
          confidence: d.confidence ?? 0.5,
          reasoning: d.reasoning ?? "Triage priority adjustment",
          taskId: task.id,
          previousPriority: task.priority,
          newPriority: updates.priority,
          interaction: InteractionType.PRIORITY_CHANGED,
        });
        decisionsRecorded++;
      }

      if (updates.assignedToId) {
        await this.recordDecision({
          agentId: definition.id, runId: run.id, tenantId,
          action: AgentAction.ASSIGNED_TASK,
          confidence: d.confidence ?? 0.5,
          reasoning: d.reasoning ?? "Triage assignment",
          taskId: task.id,
          assignedToId: updates.assignedToId,
          interaction: InteractionType.ASSIGNED,
        });
        // Notify the assignee (re-uses existing notification type)
        await prisma.notification.create({
          data: {
            tenantId,
            userId: updates.assignedToId,
            type: "TASK_ASSIGNED",
            title: "Task assigned by Triage Agent",
            body: `${task.title} (priority: ${updates.priority ?? task.priority})`,
          },
        });
        decisionsRecorded++;
      }
    }

    return {
      itemsProcessed: tasks.length,
      tasksAffected,
      decisionsRecorded,
      extras: { weatherUsed: weather.available, staffCount: staff.length },
    };
  }
}

function parsePriority(s: string | undefined): TaskPriority | undefined {
  if (!s) return undefined;
  return Object.values(TaskPriority).includes(s as TaskPriority)
    ? (s as TaskPriority)
    : undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
