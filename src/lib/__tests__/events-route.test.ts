jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { GET, POST } from "@/app/api/events/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/route";

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

  test("soft-deletes (unpublishes) a PUBLISHED event", async () => {
    signInAs(ADMIN);
    prismaMock.event.findFirst.mockResolvedValue(eventRow({ status: "PUBLISHED" }) as never);

    const { body } = await readJson(await del());

    expect(body.status).toBe("DRAFT"); // unpublished, not deleted
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
    expect(prismaMock.event.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { status: "DRAFT", updatedById: ADMIN.id },
    });
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
