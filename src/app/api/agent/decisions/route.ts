import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * GET /api/agent/decisions
 *
 * List recent agent decisions for the current tenant. Admins / maintenance
 * staff can view; regular members cannot.
 *
 * Query: ?agentSlug=detector&taskId=...&limit=50
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const role = session.user.actingAs?.role ?? session.user.role;
  if (!["TENANT_ADMIN", "MAINTENANCE", "PLATFORM_ADMIN"].includes(role)) {
    return jsonError("Forbidden", 403);
  }

  const sp = req.nextUrl.searchParams;
  const agentSlug = sp.get("agentSlug");
  const taskId = sp.get("taskId");
  const limit = Math.min(Number(sp.get("limit") ?? 50), 200);

  const decisions = await prisma.agentDecision.findMany({
    where: {
      tenantId,
      ...(taskId ? { taskId } : {}),
      ...(agentSlug ? { agent: { slug: agentSlug } } : {}),
    },
    include: {
      agent: { select: { slug: true, name: true } },
      feedback: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Hydrate referenced messages / tasks in batch (avoid N+1)
  const messageIds = decisions.map((d) => d.sourceMessageId).filter((x): x is string => !!x);
  const taskIds = decisions.map((d) => d.taskId).filter((x): x is string => !!x);
  const [messages, tasks] = await Promise.all([
    messageIds.length
      ? prisma.message.findMany({
          where: { id: { in: messageIds } },
          select: { id: true, body: true, channelId: true, user: { select: { name: true, email: true } } },
        })
      : [],
    taskIds.length
      ? prisma.maintenanceTask.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true, category: true, priority: true, status: true },
        })
      : [],
  ]);
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return NextResponse.json(
    decisions.map((d) => ({
      ...d,
      sourceMessage: d.sourceMessageId ? msgById.get(d.sourceMessageId) ?? null : null,
      task: d.taskId ? taskById.get(d.taskId) ?? null : null,
    })),
  );
}
