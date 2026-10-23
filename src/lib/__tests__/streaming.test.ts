/**
 * Streaming API and lib (B-09, B-10, B-11, B-14, B-71).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { hoursFromNow } from "@/test-utils/dates";
import { POST as createPOST } from "@/app/api/streaming/route";
import { POST as startPOST } from "@/app/api/streaming/[id]/start/route";
import { POST as tokensPOST } from "@/app/api/streaming/[id]/tokens/route";
import { GET as watchGET } from "@/app/api/streaming/[id]/watch/route";
import { GET as signalGET, POST as signalPOST } from "@/app/api/streaming/[id]/signal/route";
import { POST as leavePOST } from "@/app/api/streaming/[id]/leave/route";

const TENANT = "tenant-1";
const STREAM_KEY = "secret-stream-key-123";

function stream(overrides: Record<string, unknown> = {}) {
  return {
    id: "stream-B",
    tenantId: TENANT,
    rinkId: "rink-1",
    eventId: null,
    title: "Finals",
    status: "LIVE",
    visibility: "MEMBERS_ONLY",
    streamKey: STREAM_KEY,
    archiveUrl: null,
    thumbnailUrl: null,
    createdById: "admin-1",
    startedAt: new Date(),
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    rink: { id: "rink-1", name: "Rink 1", green: { name: "Main" } },
    event: null,
    tenant: { id: TENANT, name: "Lakeview", slug: "lakeview" },
    ...overrides,
  };
}

function givenStream(overrides: Record<string, unknown> = {}) {
  const s = stream(overrides);
  prismaMock.streamSession.findUnique.mockImplementation((async ({ where }: any) => (where.id === s.id ? s : null)) as never);
  prismaMock.streamSession.findFirst.mockImplementation((async ({ where }: any) =>
    where.id === s.id && (!where.tenantId || where.tenantId === s.tenantId) ? s : null) as never);
  return s;
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    streamSessionId: "stream-A",
    tenantId: TENANT,
    token: "share-token",
    expiresAt: hoursFromNow(24),
    maxUses: null as number | null,
    useCount: 0,
    createdById: "admin-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function givenToken(overrides: Record<string, unknown> = {}) {
  const t = tokenRow(overrides);
  const find = async ({ where }: any) => (where.token === t.token || where.id === t.id ? t : null);
  prismaMock.streamToken.findUnique.mockImplementation(find as never);
  prismaMock.streamToken.findFirst.mockImplementation((async ({ where }: any) =>
    (where.token === t.token || where.id === t.id) && (!where.streamSessionId || where.streamSessionId === t.streamSessionId) ? t : null) as never);
  return t;
}

const asAdmin = () => signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
const ctx = (id = "stream-B") => routeParams({ id });

beforeEach(() => {
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
  prismaMock.streamViewer.count.mockResolvedValue(0);
  prismaMock.streamToken.create.mockImplementation((async ({ data }: any) => ({ id: "tok-new", useCount: 0, ...data })) as never);
});

describe("[B-09] share tokens are bound to their stream", () => {
  test("[B-09] FR-STR-005 – a token issued for stream A cannot unlock stream B (403)", async () => {
    givenStream(); // stream-B, MEMBERS_ONLY
    givenToken({ streamSessionId: "stream-A" });

    const res = await watchGET(request("/api/streaming/stream-B/watch?token=share-token"), ctx());

    expect(res.status).toBe(403);
  });

  test("[B-09] FR-STR-005 – the viewer response never contains the streamKey", async () => {
    givenStream();
    signInAs({ id: "member-1", role: "USER", tenantId: TENANT });

    const { status, body } = await readJson(await watchGET(request("/api/streaming/stream-B/watch"), ctx()));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(STREAM_KEY);
  });

  test("[B-09] FR-STR-005 – a token viewer's response never contains the streamKey", async () => {
    givenStream();
    givenToken({ streamSessionId: "stream-B" });
    prismaMock.streamToken.update.mockResolvedValue(tokenRow({ streamSessionId: "stream-B", useCount: 1 }) as never);
    prismaMock.streamToken.updateMany.mockResolvedValue({ count: 1 } as never);

    const { status, body } = await readJson(await watchGET(request("/api/streaming/stream-B/watch?token=share-token"), ctx()));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(STREAM_KEY);
  });
});

describe("[B-10] POST /api/streaming/[id]/tokens — input validation", () => {
  const createToken = (body: unknown) => tokensPOST(jsonRequest("POST", "/api/streaming/stream-B/tokens", body), ctx());

  beforeEach(() => {
    givenStream();
    asAdmin();
  });

  test("[B-10] FR-STR-005 – maxUses 0 is rejected with 400", async () => {
    const res = await createToken({ expiresInHours: 24, maxUses: 0 });

    expect(res.status).toBe(400);
    expect(prismaMock.streamToken.create).not.toHaveBeenCalled();
  });

  test.each([
    ["negative", -5],
    ["non-numeric (NaN)", "soon"],
  ])("[B-10] FR-STR-005 – a %s expiresInHours is rejected with 400", async (_label, value) => {
    const res = await createToken({ expiresInHours: value, maxUses: 5 });

    expect(res.status).toBe(400);
    expect(prismaMock.streamToken.create).not.toHaveBeenCalled();
  });
});

describe("[B-10] token use counting", () => {
  /** Every write that increments useCount, from update or updateMany. */
  const incrementWrites = () =>
    [...prismaMock.streamToken.update.mock.calls, ...prismaMock.streamToken.updateMany.mock.calls]
      .map(([a]: any) => a)
      .filter((a) => a?.data?.useCount?.increment === 1);

  test("[B-10] FR-STR-005 – watching with a token increments its use count", async () => {
    givenStream();
    givenToken({ streamSessionId: "stream-B", maxUses: 3, useCount: 0 });
    prismaMock.streamToken.update.mockResolvedValue(tokenRow({ streamSessionId: "stream-B", maxUses: 3, useCount: 1 }) as never);
    prismaMock.streamToken.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await watchGET(request("/api/streaming/stream-B/watch?token=share-token"), ctx());

    expect(res.status).toBe(200);
    expect(incrementWrites()).toHaveLength(1);
  });

  test("[B-10] FR-STR-005 – the increment is atomic: a token whose last use was taken concurrently is refused", async () => {
    givenStream();
    // The read says 2 of 3 uses are gone, but another viewer took the last one
    // in the meantime: a conditional (atomic) increment matches no row.
    givenToken({ streamSessionId: "stream-B", maxUses: 3, useCount: 2 });
    prismaMock.streamToken.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.streamToken.update.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
    prismaMock.$executeRawUnsafe.mockResolvedValue(0 as never);

    const res = await watchGET(request("/api/streaming/stream-B/watch?token=share-token"), ctx());

    expect(res.status).toBe(403);
  });

  test("[B-10] FR-STR-005 – a token at maxUses is refused", async () => {
    givenStream();
    givenToken({ streamSessionId: "stream-B", maxUses: 3, useCount: 3 });
    prismaMock.streamToken.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await watchGET(request("/api/streaming/stream-B/watch?token=share-token"), ctx());

    expect(res.status).toBe(403);
  });
});

describe("[B-11] signalling and leave require authentication", () => {
  beforeEach(() => {
    givenStream();
    prismaMock.streamViewer.findFirst.mockResolvedValue({ id: "viewer-1", streamSessionId: "stream-B", joinedAt: new Date(Date.now() - 60_000), leftAt: null } as never);
    // No session (signed out by default) and no token.
  });

  test("[B-11] NFR-02 – GET signal with no session or token returns 401", async () => {
    const res = await signalGET(request("/api/streaming/stream-B/signal?since=0"), ctx());
    expect(res.status).toBe(401);
  });

  test("[B-11] NFR-02 – POST signal with no session or token returns 401", async () => {
    const res = await signalPOST(
      jsonRequest("POST", "/api/streaming/stream-B/signal", { type: "offer", from: "x", payload: { sdp: "v=0" } }),
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  test("[B-11] NFR-02 – POST leave with no session or token returns 401", async () => {
    const res = await leavePOST(jsonRequest("POST", "/api/streaming/stream-B/leave", { viewerId: "viewer-1" }), ctx());
    expect(res.status).toBe(401);
    expect(prismaMock.streamViewer.update).not.toHaveBeenCalled();
  });
});

describe("[B-14] who may broadcast", () => {
  const impersonating = () =>
    signInAs({
      id: "platform-1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: { tenantId: TENANT, role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
    });
  const maintenance = () => signInAs({ id: "maint-1", role: "MAINTENANCE", tenantId: TENANT });

  beforeEach(() => {
    prismaMock.tenantSubscription.findUnique.mockResolvedValue({
      tenantId: TENANT, tier: "SILVER", status: "ACTIVE", maxConcurrentStreams: 3, archiveRetentionDays: 7,
    } as never);
    prismaMock.streamSession.count.mockResolvedValue(0);
    prismaMock.streamSession.update.mockImplementation((async ({ data }: any) => ({ ...stream({ status: "IDLE" }), ...data })) as never);
    prismaMock.streamSession.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.streamSession.create.mockImplementation((async ({ data }: any) => ({ ...stream({ status: "IDLE" }), ...data, id: "stream-new" })) as never);
    prismaMock.rink.findFirst.mockResolvedValue({ id: "rink-1", name: "Rink 1" } as never);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  test.each([
    { fr: "FR-SEC-005", label: "an impersonating admin", signIn: impersonating },
    { fr: "FR-STR-001", label: "a MAINTENANCE user", signIn: maintenance },
  ])("[B-14] $fr – $label can start a stream", async ({ signIn }) => {
    givenStream({ status: "IDLE" });
    signIn();

    const res = await startPOST(jsonRequest("POST", "/api/streaming/stream-B/start", {}), ctx());

    expect(res.status).toBe(200);
  });

  test.each([
    { fr: "FR-SEC-005", label: "an impersonating admin", signIn: impersonating },
    { fr: "FR-STR-001", label: "a MAINTENANCE user", signIn: maintenance },
  ])("[B-14] $fr – $label can create a stream", async ({ signIn }) => {
    signIn();

    const res = await createPOST(jsonRequest("POST", "/api/streaming", { title: "Practice", rinkId: "rink-1" }));

    expect(res.status).toBe(201);
    expect(prismaMock.streamSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT }) }),
    );
  });
});

describe("[B-71] archive retention", () => {
  // NOT-IMPL: no archiving function exists yet. The fix is expected to add an
  // exported sweep in @/lib/streaming (named archiveEndedStreams here).
  test("[B-71] FR-STR-002 – ENDED streams older than archiveRetentionDays become ARCHIVED; newer ones stay ENDED", async () => {
    const streaming = require("@/lib/streaming");
    expect(typeof streaming.archiveEndedStreams).toBe("function");

    const old = { ...stream({ id: "s-old", status: "ENDED", endedAt: hoursFromNow(-24 * 10) }) };
    const recent = { ...stream({ id: "s-new", status: "ENDED", endedAt: hoursFromNow(-24 * 2) }) };
    const sub = { tenantId: TENANT, tier: "SILVER", status: "ACTIVE", maxConcurrentStreams: 3, archiveRetentionDays: 7 };
    prismaMock.streamSession.findMany.mockResolvedValue([
      { ...old, tenant: { ...old.tenant, subscription: sub } },
      { ...recent, tenant: { ...recent.tenant, subscription: sub } },
    ] as never);
    prismaMock.tenantSubscription.findUnique.mockResolvedValue(sub as never);
    prismaMock.tenantSubscription.findMany.mockResolvedValue([sub] as never);
    prismaMock.streamSession.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
    prismaMock.streamSession.updateMany.mockResolvedValue({ count: 1 } as never);

    await streaming.archiveEndedStreams(TENANT);

    // Which stream ids were moved to ARCHIVED, by update or by updateMany.
    const archived = new Set<string>();
    for (const [a] of prismaMock.streamSession.update.mock.calls as any[]) {
      if (a.data?.status === "ARCHIVED") archived.add(a.where.id);
    }
    for (const [a] of prismaMock.streamSession.updateMany.mock.calls as any[]) {
      if (a.data?.status !== "ARCHIVED") continue;
      const w = a.where ?? {};
      if (w.id?.in) w.id.in.forEach((id: string) => archived.add(id));
      else if (typeof w.id === "string") archived.add(w.id);
      else {
        // A predicate update: evaluate it against both streams.
        const cutoff = w.endedAt?.lt ?? w.endedAt?.lte;
        for (const s of [old, recent]) {
          if ((!w.status || w.status === "ENDED") && cutoff && s.endedAt! < cutoff) archived.add(s.id);
        }
      }
    }
    expect([...archived]).toEqual(["s-old"]);
  });
});
