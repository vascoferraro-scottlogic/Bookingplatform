jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { GET, POST } from "@/app/api/events/route";
import { GET as GET_ONE, PATCH, DELETE } from "@/app/api/events/[id]/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const EVENT_ID = "event-1";

const validEvent = {
  title: "Summer Open Day",
  description: "Come and try bowling!",
  date: isoDateFromToday(60),
  startTime: "10:00",
  category: "OPEN_DAY",
};

/** An existing event row in TENANT. */
const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  tenantId: TENANT,
  ...validEvent,
  endTime: null,
  status: "DRAFT",
  ...overrides,
});

const create = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/events", body));
const patch = (body: Record<string, unknown>, id = EVENT_ID) =>
  PATCH(jsonRequest("PATCH", `/api/events/${id}`, body), routeParams({ id }));
const getOne = (id = EVENT_ID) => GET_ONE(request(`/api/events/${id}`), routeParams({ id }));
const del = (id = EVENT_ID) => DELETE(request(`/api/events/${id}`, { method: "DELETE" }), routeParams({ id }));

/** Turns the given tenant flags on; everything else reads as off. */
function enableFlags(...keys: string[]) {
  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
    const { tenantId, key } = args.where.tenantId_key;
    return tenantId === TENANT && keys.includes(key) ? { tenantId, key, enabled: true } : null;
  }) as never);
}

beforeEach(() => {
  enableFlags("events");
  prismaMock.event.create.mockImplementation((async ({ data }: any) => ({ id: "new-event", status: "DRAFT", ...data })) as never);
  prismaMock.event.update.mockImplementation((async ({ where, data }: any) => ({ ...eventRow(), id: where.id, ...data })) as never);
});

// ── GET /api/events ───────────────────────────────────────

describe("GET /api/events", () => {
  test("returns empty array when events feature is disabled", async () => {
    signInAs(ADMIN);
    enableFlags();

    const { body } = await readJson(await GET(request("/api/events")));

    expect(body).toEqual([]);
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
  });

  test("user sees only PUBLISHED events", async () => {
    signInAs(USER);
    prismaMock.event.findMany.mockResolvedValue([eventRow({ status: "PUBLISHED" })] as never);

    const { status, body } = await readJson(await GET(request("/api/events")));

    expect(status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, status: "PUBLISHED" } }),
    );
  });

  test("admin sees DRAFT and PUBLISHED events", async () => {
    signInAs(ADMIN);
    prismaMock.event.findMany.mockResolvedValue([
      eventRow({ id: "e-draft", status: "DRAFT" }),
      eventRow({ id: "e-pub", status: "PUBLISHED" }),
    ] as never);

    const { body } = await readJson(await GET(request("/api/events")));

    expect(body.events.map((e: any) => e.status)).toEqual(["DRAFT", "PUBLISHED"]);
    expect(body.externalEvents).toEqual([]);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT } }));
  });
});

// ── POST /api/events ──────────────────────────────────────

describe("POST /api/events", () => {
  test("admin creates event in DRAFT status", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await create({ ...validEvent, title: "New Draft Event" }));

    expect(status).toBe(201);
    expect(body.title).toBe("New Draft Event");
    expect(body.status).toBe("DRAFT");
    expect(body.tenantId).toBe(TENANT);
    expect(prismaMock.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT, title: "New Draft Event", createdById: ADMIN.id }),
    });
    // Status is left to the schema default (DRAFT), never taken from the body.
    expect((prismaMock.event.create.mock.calls[0][0] as any).data).not.toHaveProperty("status");
  });

  test("regular user gets 403 Forbidden", async () => {
    signInAs(USER);

    const { status } = await readJson(await create(validEvent));

    expect(status).toBe(403);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  test("rejects event with missing required fields", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(await create({ title: "Incomplete" }));

    expect(status).toBe(400);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  test("rejects invalid category", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await create({ ...validEvent, category: "INVALID" }));

    expect(status).toBe(400);
    expect(body.error).toContain("Invalid category");
  });

  test("accepts optional tournament fields", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(
      await create({
        ...validEvent,
        title: "Tournament Event",
        category: "TOURNAMENT",
        format: "KNOCKOUT",
        playerCount: "PAIRS",
        visibility: "PUBLIC",
      }),
    );

    expect(status).toBe(201);
    expect(body.format).toBe("KNOCKOUT");
    expect(body.playerCount).toBe("PAIRS");
    expect(body.visibility).toBe("PUBLIC");
  });

  test("rejects endTime before startTime", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await create({ ...validEvent, startTime: "14:00", endTime: "10:00" }));

    expect(status).toBe(400);
    expect(body.error).toContain("End time must be after start time");
  });

  test("rejects endTime equal to startTime", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(await create({ ...validEvent, startTime: "10:00", endTime: "10:00" }));

    expect(status).toBe(400);
  });

  test("accepts valid endTime after startTime", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(
      await create({ ...validEvent, title: "Valid Times Event", startTime: "10:00", endTime: "12:00" }),
    );

    expect(status).toBe(201);
    expect(body.endTime).toBe("12:00");
  });
});

// ── PATCH /api/events/[id] ────────────────────────────────

describe("PATCH /api/events/[id]", () => {
  test("publishes a DRAFT event", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "DRAFT" }) as never);

    const { status, body } = await readJson(await patch({ status: "PUBLISHED" }));

    expect(status).toBe(200);
    expect(body.status).toBe("PUBLISHED");
    expect(prismaMock.event.findFirst).toHaveBeenCalledWith({ where: { id: EVENT_ID, tenantId: TENANT } });
    expect(prismaMock.event.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { status: "PUBLISHED", updatedById: ADMIN.id },
    });
  });

  test("unpublishes back to DRAFT", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "PUBLISHED" }) as never);

    const { body } = await readJson(await patch({ status: "DRAFT" }));

    expect(body.status).toBe("DRAFT");
  });

  test("rejects invalid status transition", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "DRAFT" }) as never);

    const { status, body } = await readJson(await patch({ status: "ARCHIVED" }));

    expect(status).toBe(400);
    expect(body.error).toContain("Cannot transition");
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  test("updates event fields without status change", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow() as never);

    const { body } = await readJson(await patch({ title: "Updated Title", location: "Green 1" }));

    expect(body.title).toBe("Updated Title");
    expect(body.location).toBe("Green 1");
    expect(prismaMock.event.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { title: "Updated Title", location: "Green 1", updatedById: ADMIN.id },
    });
  });

  test("returns 404 for nonexistent event", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(null);

    const { status } = await readJson(await patch({ title: "x" }, "nonexistent-id"));

    expect(status).toBe(404);
    expect(prismaMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "nonexistent-id", tenantId: TENANT } });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  test("rejects updating endTime to before startTime", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ startTime: "10:00" }) as never);

    const { status, body } = await readJson(await patch({ endTime: "08:00" }));

    expect(status).toBe(400);
    expect(body.error).toContain("End time must be after start time");
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/events/[id] ───────────────────────────────

describe("DELETE /api/events/[id]", () => {
  test("hard-deletes a DRAFT event", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "DRAFT" }) as never);

    const { body } = await readJson(await del());

    expect(body.deleted).toBe(true);
    expect(prismaMock.event.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
  });

  test("[B-67] D-12 – DELETE of a PUBLISHED event returns 409 and changes nothing", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "PUBLISHED" }) as never);

    const { status } = await readJson(await del());

    expect(status).toBe(409);
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
    expect(prismaMock.event.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  test("[B-67] D-12 – DELETE of a DRAFT event deletes it", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "DRAFT" }) as never);

    const { status } = await readJson(await del());

    expect(status).toBe(200);
    expect(prismaMock.event.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  test("returns 404 for nonexistent event", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(null);

    const { status } = await readJson(await del("nonexistent-id"));

    expect(status).toBe(404);
    expect(prismaMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "nonexistent-id", tenantId: TENANT } });
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
  });
});

// ── In-memory where evaluation (for the tests below) ─────

/** Evaluates the subset of Prisma `where` syntax used here against an in-memory row. */
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") return ([] as any[]).concat(cond).every((c) => matchesWhere(row, c));
    if (key === "OR") return (cond as any[]).some((c) => matchesWhere(row, c));
    if (key === "NOT") return !([] as any[]).concat(cond).some((c) => matchesWhere(row, c));
    if (row?.[key] === undefined && key.includes("_") && cond && typeof cond === "object") return matchesWhere(row, cond);
    return matchesValue(row?.[key], cond);
  });
}
const OPS = new Set(["equals", "in", "notIn", "not", "lt", "lte", "gt", "gte", "contains", "startsWith", "mode", "is", "isNot", "has"]);
function matchesValue(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== "object") return v === cond;
  if (Array.isArray(v)) {
    if ("some" in cond) return v.some((x) => matchesWhere(x, cond.some));
    if ("every" in cond) return v.every((x) => matchesWhere(x, cond.every));
    if ("none" in cond) return !v.some((x) => matchesWhere(x, cond.none));
  }
  const keys = Object.keys(cond);
  if (keys.length > 0 && keys.every((k) => OPS.has(k))) {
    return keys.every((op) => {
      const x = cond[op];
      switch (op) {
        case "equals": return matchesValue(v, x);
        case "in": return (x as any[]).includes(v);
        case "notIn": return !(x as any[]).includes(v);
        case "not": return !matchesValue(v, x);
        case "lt": return v != null && v < x;
        case "lte": return v != null && v <= x;
        case "gt": return v != null && v > x;
        case "gte": return v != null && v >= x;
        case "contains": return typeof v === "string" && v.includes(x);
        case "startsWith": return typeof v === "string" && v.startsWith(x);
        case "has": return Array.isArray(v) && v.includes(x);
        case "is": return x === null ? v == null : v != null && matchesWhere(v, x);
        case "isNot": return x === null ? v != null : v == null || !matchesWhere(v, x);
        default: return true;
      }
    });
  }
  if (v === null || v === undefined) return false;
  return matchesWhere(v, cond);
}

// ── GET /api/events/[id] ──────────────────────────────────

describe("GET /api/events/[id]", () => {
  beforeEach(() => {
    const rows = [eventRow({ id: "e-draft", status: "DRAFT" }), eventRow({ id: "e-pub", status: "PUBLISHED" })];
    const find = (async (a: any = {}) => rows.find((r) => matchesWhere(r, a.where)) ?? null) as never;
    prismaMock.event.findFirst.mockImplementation(find);
    prismaMock.event.findUnique.mockImplementation(find);
  });

  test("[B-67] FR-EVT-002 – a member can read a PUBLISHED event", async () => {
    signInAs(USER);

    const { status, body } = await readJson(await getOne("e-pub"));

    expect(status).toBe(200);
    expect(body.id).toBe("e-pub");
  });

  test("[B-67] FR-EVT-002 – a member GET of a DRAFT event returns 404", async () => {
    signInAs(USER);

    const { status } = await readJson(await getOne("e-draft"));

    expect(status).toBe(404);
  });

  test("[B-67] FR-EVT-002 – an admin can still read a DRAFT event", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(await getOne("e-draft"));

    expect(status).toBe(200);
  });

  test("[B-67] FR-EVT-002 – GET by id with the events flag off returns 403", async () => {
    signInAs(USER);
    enableFlags();

    const { status } = await readJson(await getOne("e-pub"));

    expect(status).toBe(403);
  });
});

// ── POST /api/events — numeric validation ─────────────────

describe("POST /api/events — capacity and entry fee", () => {
  test.each([
    ["a negative capacity", { capacity: -5 }],
    ["a NaN capacity", { capacity: "lots" }],
    ["a negative entry fee", { entryFee: -100 }],
  ])("[B-68] FR-EVT-001 – rejects %s with 400", async (_label, extra) => {
    signInAs(ADMIN);

    const { status } = await readJson(await create({ ...validEvent, ...extra }));

    expect(status).toBe(400);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  test("[B-68] FR-EVT-001 – accepts a positive capacity and a zero entry fee", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await create({ ...validEvent, capacity: 24, entryFee: 0 }));

    expect(status).toBe(201);
    expect(body.capacity).toBe(24);
    expect(body.entryFee).toBe(0);
  });
});

// ── GET /api/events — partner sharing (D-07) ──────────────

describe("GET /api/events — external events come from federation partners only", () => {
  const PARTNER = "tenant-partner";
  const STRANGER = "tenant-stranger";
  const EX_PARTNER = "tenant-ex-partner";
  const tenantInfo = (id: string) => ({ id, name: id, slug: id });

  // The viewer and PARTNER share an ACTIVE federation; EX_PARTNER has left it;
  // STRANGER shares events outbound but is in no federation with the viewer.
  const FLAGS = [
    { tenantId: TENANT, key: "events", enabled: true },
    { tenantId: TENANT, key: "eventsShowExternal", enabled: true },
    { tenantId: PARTNER, key: "eventsShareExternal", enabled: true },
    { tenantId: STRANGER, key: "eventsShareExternal", enabled: true },
    { tenantId: EX_PARTNER, key: "eventsShareExternal", enabled: true },
  ].map((f, i) => ({ id: `ff-${i}`, ...f, tenant: tenantInfo(f.tenantId) }));

  const FEDERATION: any = { id: "fed-1", name: "Fed", status: "ACTIVE", maxClubs: 10 };
  const FED_MEMBERSHIPS: any[] = [
    { id: "fm-viewer", federationId: "fed-1", tenantId: TENANT, leftAt: null, joinedAt: new Date() },
    { id: "fm-partner", federationId: "fed-1", tenantId: PARTNER, leftAt: null, joinedAt: new Date() },
    { id: "fm-ex", federationId: "fed-1", tenantId: EX_PARTNER, leftAt: new Date(Date.now() - 86_400_000), joinedAt: new Date() },
  ];
  FEDERATION.memberships = FED_MEMBERSHIPS;
  for (const m of FED_MEMBERSHIPS) {
    m.federation = FEDERATION;
    m.tenant = tenantInfo(m.tenantId);
  }

  const externalEvent = (tenantId: string) => ({
    ...eventRow({ id: `ev-${tenantId}`, tenantId, status: "PUBLISHED", visibility: "PUBLIC" }),
    tenant: tenantInfo(tenantId),
  });
  const EVENTS = [
    { ...eventRow({ status: "PUBLISHED", visibility: "PUBLIC" }), tenant: tenantInfo(TENANT) },
    externalEvent(PARTNER),
    externalEvent(STRANGER),
    externalEvent(EX_PARTNER),
  ];

  beforeEach(() => {
    const findFlag = (async (a: any = {}) => FLAGS.find((f) => matchesWhere(f, a.where)) ?? null) as never;
    prismaMock.featureFlag.findUnique.mockImplementation(findFlag);
    prismaMock.featureFlag.findFirst.mockImplementation(findFlag);
    prismaMock.featureFlag.findMany.mockImplementation((async (a: any = {}) => FLAGS.filter((f) => matchesWhere(f, a.where))) as never);
    prismaMock.event.findMany.mockImplementation((async (a: any = {}) => EVENTS.filter((e) => matchesWhere(e, a.where))) as never);
    prismaMock.federationMembership.findMany.mockImplementation((async (a: any = {}) =>
      FED_MEMBERSHIPS.filter((m) => matchesWhere(m, a.where))) as never);
    prismaMock.federationMembership.findFirst.mockImplementation((async (a: any = {}) =>
      FED_MEMBERSHIPS.find((m) => matchesWhere(m, a.where)) ?? null) as never);
    prismaMock.federation.findMany.mockImplementation((async (a: any = {}) => [FEDERATION].filter((f) => matchesWhere(f, a.where))) as never);
  });

  const externalTenantIds = async () => {
    signInAs(USER);
    const { status, body } = await readJson(await GET(request("/api/events")));
    expect(status).toBe(200);
    return (body.externalEvents as any[]).map((e) => e.tenantId);
  };

  test("[B-69] D-07 – shows PUBLIC events from a partner sharing an ACTIVE federation", async () => {
    expect(await externalTenantIds()).toContain(PARTNER);
  });

  test("[B-69] D-07 – excludes a club that shares outbound but is not a federation partner", async () => {
    expect(await externalTenantIds()).not.toContain(STRANGER);
  });

  test("[B-69] D-07 – excludes a club that has left the shared federation", async () => {
    expect(await externalTenantIds()).not.toContain(EX_PARTNER);
  });
});
