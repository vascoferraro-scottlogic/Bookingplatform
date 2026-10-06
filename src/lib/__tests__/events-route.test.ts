import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// Mock getSessionOrFail and resolveTenantId at module level
let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

// Import route handlers AFTER mocks are set up
import { GET, POST } from "@/app/api/events/route";
import { GET as GET_ONE, PATCH, DELETE } from "@/app/api/events/[id]/route";
import { setFeatureFlag } from "@/lib/features";

let tenantId: string;
let adminId: string;
let userId: string;

function adminSession() {
  return {
    session: {
      user: { id: adminId, email: "admin@test.com", name: "Admin", role: "TENANT_ADMIN", tenantId },
    },
  };
}

function userSession() {
  return {
    session: {
      user: { id: userId, email: "user@test.com", name: "User", role: "USER", tenantId },
    },
  };
}

function makeRequest(url = "http://localhost/api/events", opts?: RequestInit): NextRequest {
  return new NextRequest(url, opts);
}

function makeJsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Events Test Club", slug: "events-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const admin = await prisma.user.create({
    data: { email: `ev-admin-${Date.now()}@test.com`, name: "Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;

  const user = await prisma.user.create({
    data: { email: `ev-user-${Date.now()}@test.com`, name: "User", passwordHash: "x", role: "USER", tenantId },
  });
  userId = user.id;

  // Enable events feature flag
  await setFeatureFlag(tenantId, "events", true);
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.featureFlag.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const validEvent = {
  title: "Summer Open Day",
  description: "Come and try bowling!",
  date: "2026-07-15",
  startTime: "10:00",
  category: "OPEN_DAY",
};

// ── GET /api/events ───────────────────────────────────────

describe("GET /api/events", () => {
  test("returns empty array when events feature is disabled", async () => {
    await setFeatureFlag(tenantId, "events", false);
    mockSessionReturn = adminSession();
    const req = makeRequest(`http://localhost/api/events?tenantId=${tenantId}`);
    const res = await GET(req);
    const body = await res.json();
    expect(body).toEqual([]);
    // Re-enable for subsequent tests
    await setFeatureFlag(tenantId, "events", true);
  });

  test("user sees only PUBLISHED events", async () => {
    mockSessionReturn = adminSession();
    // Create one DRAFT and one PUBLISHED event
    const draftReq = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, validEvent);
    const draftRes = await POST(draftReq);
    const draftEvent = await draftRes.json();

    const publishedReq = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Published Event",
    });
    const publishedRes = await POST(publishedReq);
    const pubEvent = await publishedRes.json();

    // Publish one
    const patchReq = makePatchRequest(`http://localhost/api/events/${pubEvent.id}?tenantId=${tenantId}`, { status: "PUBLISHED" });
    await PATCH(patchReq, { params: Promise.resolve({ id: pubEvent.id }) });

    // Now query as regular user
    mockSessionReturn = userSession();
    const getReq = makeRequest(`http://localhost/api/events?tenantId=${tenantId}`);
    const getRes = await GET(getReq);
    const body = await getRes.json();

    const ownEvents = body.events.filter((e: any) => e.tenantId === tenantId);
    expect(ownEvents.every((e: any) => e.status === "PUBLISHED")).toBe(true);
  });

  test("admin sees DRAFT and PUBLISHED events", async () => {
    mockSessionReturn = adminSession();
    const req = makeRequest(`http://localhost/api/events?tenantId=${tenantId}`);
    const res = await GET(req);
    const body = await res.json();
    const statuses = body.events.map((e: any) => e.status);
    expect(statuses).toContain("DRAFT");
    expect(statuses).toContain("PUBLISHED");
  });
});

// ── POST /api/events ──────────────────────────────────────

describe("POST /api/events", () => {
  test("admin creates event in DRAFT status", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "New Draft Event",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("New Draft Event");
    expect(body.status).toBe("DRAFT");
    expect(body.tenantId).toBe(tenantId);
  });

  test("regular user gets 403 Forbidden", async () => {
    mockSessionReturn = userSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, validEvent);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("rejects event with missing required fields", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      title: "Incomplete",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("rejects invalid category", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      category: "INVALID",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid category");
  });

  test("accepts optional tournament fields", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Tournament Event",
      category: "TOURNAMENT",
      format: "KNOCKOUT",
      playerCount: "PAIRS",
      visibility: "PUBLIC",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe("KNOCKOUT");
    expect(body.playerCount).toBe("PAIRS");
    expect(body.visibility).toBe("PUBLIC");
  });

  test("rejects endTime before startTime", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      startTime: "14:00",
      endTime: "10:00",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("End time must be after start time");
  });

  test("rejects endTime equal to startTime", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      startTime: "10:00",
      endTime: "10:00",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("accepts valid endTime after startTime", async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Valid Times Event",
      startTime: "10:00",
      endTime: "12:00",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.endTime).toBe("12:00");
  });
});

// ── PATCH /api/events/[id] ────────────────────────────────

describe("PATCH /api/events/[id]", () => {
  let draftEventId: string;

  beforeAll(async () => {
    mockSessionReturn = adminSession();
    const req = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Patch Test Draft",
    });
    const res = await POST(req);
    const body = await res.json();
    draftEventId = body.id;
  });

  test("publishes a DRAFT event", async () => {
    mockSessionReturn = adminSession();
    const req = makePatchRequest(
      `http://localhost/api/events/${draftEventId}?tenantId=${tenantId}`,
      { status: "PUBLISHED" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: draftEventId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PUBLISHED");
  });

  test("unpublishes back to DRAFT", async () => {
    mockSessionReturn = adminSession();
    const req = makePatchRequest(
      `http://localhost/api/events/${draftEventId}?tenantId=${tenantId}`,
      { status: "DRAFT" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: draftEventId }) });
    const body = await res.json();
    expect(body.status).toBe("DRAFT");
  });

  test("rejects invalid status transition", async () => {
    // First create a new draft event
    mockSessionReturn = adminSession();
    const createReq = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Invalid Transition Test",
    });
    const createRes = await POST(createReq);
    const created = await createRes.json();

    // Try to transition DRAFT → DRAFT (not in STATUS_TRANSITIONS)
    // Actually DRAFT can only go to PUBLISHED.
    // Let's try something truly invalid — we need to somehow attempt a nonexistent transition.
    // DRAFT → anything other than PUBLISHED should fail.
    const req = makePatchRequest(
      `http://localhost/api/events/${created.id}?tenantId=${tenantId}`,
      { status: "ARCHIVED" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot transition");
  });

  test("updates event fields without status change", async () => {
    mockSessionReturn = adminSession();
    const req = makePatchRequest(
      `http://localhost/api/events/${draftEventId}?tenantId=${tenantId}`,
      { title: "Updated Title", location: "Green 1" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: draftEventId }) });
    const body = await res.json();
    expect(body.title).toBe("Updated Title");
    expect(body.location).toBe("Green 1");
  });

  test("returns 404 for nonexistent event", async () => {
    mockSessionReturn = adminSession();
    const req = makePatchRequest(
      `http://localhost/api/events/nonexistent-id?tenantId=${tenantId}`,
      { title: "x" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent-id" }) });
    expect(res.status).toBe(404);
  });

  test("rejects updating endTime to before startTime", async () => {
    mockSessionReturn = adminSession();
    const req = makePatchRequest(
      `http://localhost/api/events/${draftEventId}?tenantId=${tenantId}`,
      { endTime: "08:00" },
    );
    const res = await PATCH(req, { params: Promise.resolve({ id: draftEventId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("End time must be after start time");
  });
});

// ── DELETE /api/events/[id] ───────────────────────────────

describe("DELETE /api/events/[id]", () => {
  test("hard-deletes a DRAFT event", async () => {
    mockSessionReturn = adminSession();
    const createReq = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Delete DRAFT Test",
    });
    const createRes = await POST(createReq);
    const created = await createRes.json();

    const deleteReq = makeRequest(
      `http://localhost/api/events/${created.id}?tenantId=${tenantId}`,
      { method: "DELETE" },
    );
    const res = await DELETE(deleteReq, { params: Promise.resolve({ id: created.id }) });
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // Verify it's actually deleted from DB
    const check = await prisma.event.findUnique({ where: { id: created.id } });
    expect(check).toBeNull();
  });

  test("soft-deletes (unpublishes) a PUBLISHED event", async () => {
    mockSessionReturn = adminSession();
    // Create + publish
    const createReq = makeJsonRequest(`http://localhost/api/events?tenantId=${tenantId}`, {
      ...validEvent,
      title: "Delete Published Test",
    });
    const createRes = await POST(createReq);
    const created = await createRes.json();

    const publishReq = makePatchRequest(
      `http://localhost/api/events/${created.id}?tenantId=${tenantId}`,
      { status: "PUBLISHED" },
    );
    await PATCH(publishReq, { params: Promise.resolve({ id: created.id }) });

    // Now delete — should unpublish, not hard-delete
    const deleteReq = makeRequest(
      `http://localhost/api/events/${created.id}?tenantId=${tenantId}`,
      { method: "DELETE" },
    );
    const res = await DELETE(deleteReq, { params: Promise.resolve({ id: created.id }) });
    const body = await res.json();
    expect(body.status).toBe("DRAFT"); // unpublished, not deleted

    // Verify it still exists in DB
    const check = await prisma.event.findUnique({ where: { id: created.id } });
    expect(check).not.toBeNull();
    expect(check!.status).toBe("DRAFT");
  });

  test("returns 404 for nonexistent event", async () => {
    mockSessionReturn = adminSession();
    const deleteReq = makeRequest(
      `http://localhost/api/events/nonexistent-id?tenantId=${tenantId}`,
      { method: "DELETE" },
    );
    const res = await DELETE(deleteReq, { params: Promise.resolve({ id: "nonexistent-id" }) });
    expect(res.status).toBe(404);
  });
});
