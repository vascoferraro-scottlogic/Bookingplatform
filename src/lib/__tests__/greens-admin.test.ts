// Greens admin: soft delete of rinks/greens, season overrides, MM-DD
// validation and season evaluation (FR-BOOK-002/005/006, D-05).
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request, readJson, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { POST as CREATE_GREEN } from "@/app/api/admin/greens/route";
import { PATCH as UPDATE_GREEN, DELETE as DELETE_GREEN } from "@/app/api/admin/greens/[id]/route";
import { DELETE as DELETE_RINK } from "@/app/api/admin/greens/[id]/rinks/[rinkId]/route";
import { POST as POST_SEASON } from "@/app/api/admin/greens/[id]/seasons/route";
import { isGreenOpenOn, type GreenSeasonInfo } from "@/lib/season";

const TENANT = "tenant-1";
const GREEN = "green-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const TENANT_ROW = { id: TENANT, name: "Lakeview BC", slug: "lakeview", timezone: "Europe/London" };

// ── A tiny Prisma `where` evaluator over in-memory rows ─────────
// Unknown fields throw, as Prisma's query validation does (so a filter on a
// field the model doesn't have fails the request instead of matching nothing).

type Row = Record<string, any>;
const isPlainObject = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v);
const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

function cmp(v: unknown, cond: Row): boolean {
  return Object.entries(cond).every(([op, x]) => {
    if (x === undefined) return true;
    const a = norm(v) as any;
    const b = norm(x) as any;
    switch (op) {
      case "equals": return a === b;
      case "in": return (x as unknown[]).map(norm).includes(a);
      case "notIn": return !(x as unknown[]).map(norm).includes(a);
      case "not": return isPlainObject(x) ? !cmp(v, x) : a !== b;
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
      case "mode": return true;
      default: throw new Error(`Unknown filter operator \`${op}\``);
    }
  });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (cond === undefined) return true;
    if (k === "AND") return [].concat(cond).every((w) => matches(row, w));
    if (k === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (k === "NOT") return ![].concat(cond).some((w) => matches(row, w));
    if (!(k in row)) throw new Error(`Invalid prisma query: Unknown argument \`${k}\``);
    const v = row[k];
    if (Array.isArray(v)) {
      if ("some" in cond) return v.some((r: Row) => matches(r, cond.some));
      if ("every" in cond) return v.every((r: Row) => matches(r, cond.every));
      if ("none" in cond) return !v.some((r: Row) => matches(r, cond.none));
      throw new Error(`Invalid to-many filter on \`${k}\``);
    }
    if (isPlainObject(v)) {
      if ("is" in cond) return cond.is === null ? false : matches(v, cond.is);
      if ("isNot" in cond) return !matches(v, cond.isNot);
      return matches(v, cond);
    }
    if (isPlainObject(cond)) return cmp(v, cond);
    return norm(v) === norm(cond);
  });
}

function bindModel(model: any, rows: () => Row[]) {
  model.findUnique.mockImplementation((async (a: Row = {}) => rows().find((r) => matches(r, a.where)) ?? null) as never);
  model.findFirst.mockImplementation((async (a: Row = {}) => rows().find((r) => matches(r, a.where)) ?? null) as never);
  model.findMany.mockImplementation((async (a: Row = {}) => rows().filter((r) => matches(r, a.where))) as never);
  model.count.mockImplementation((async (a: Row = {}) => rows().filter((r) => matches(r, a.where)).length) as never);
}

// ── Fixtures: one green with two rinks ──────────────────────────

type BookingFixture = { id: string; rinkId: string; date: string; status: string };

function arrangeGreen(bookings: BookingFixture[]) {
  const slotRows: Row[] = [];
  const bookingRows: Row[] = bookings.map((b) => ({
    id: b.id, tenantId: TENANT, userId: "member-1", date: b.date, status: b.status,
    createdAt: new Date(), updatedAt: new Date(), bookedByUserId: "member-1", adminOverride: false,
    overrideReason: null, bookedByTenantId: null, federationId: null, payment: null, slots: [] as Row[],
  }));
  bookings.forEach((b, i) => {
    const slot = { id: `slot-${b.id}`, bookingId: b.id, rinkId: b.rinkId, timeSlot: "10:00", playerName: null, greenName: "Main Green" };
    bookingRows[i].slots.push({ ...slot });
    slotRows.push({ ...slot, booking: bookingRows[i] });
  });

  const green: Row = {
    id: GREEN, name: "Main Green", tenantId: TENANT, allWeather: false, seasonStartMMDD: "04-01", seasonEndMMDD: "09-30",
    archivedAt: null, tenant: TENANT_ROW, seasons: [], rinks: [] as Row[],
  };
  const rinkRows: Row[] = ["rink-a", "rink-b"].map((id) => ({
    id, name: id.toUpperCase(), greenId: GREEN, archivedAt: null, green,
    bookingSlots: slotRows.filter((s) => s.rinkId === id),
  }));
  green.rinks = rinkRows.map(({ green: _g, ...r }) => r);
  slotRows.forEach((s) => (s.rink = rinkRows.find((r) => r.id === s.rinkId)));

  bindModel(prismaMock.bookingSlot, () => slotRows);
  bindModel(prismaMock.booking, () => bookingRows);
  bindModel(prismaMock.rink, () => rinkRows);
  bindModel(prismaMock.green, () => [green]);
  prismaMock.tenant.findUnique.mockResolvedValue(TENANT_ROW as never);
  prismaMock.rink.update.mockImplementation((async ({ where, data }: Row) => ({ ...rinkRows.find((r) => r.id === where.id), ...data })) as never);
  prismaMock.green.update.mockImplementation((async ({ data }: Row) => ({ ...green, ...data })) as never);
  prismaMock.rink.updateMany.mockResolvedValue({ count: 2 } as never);
  prismaMock.green.updateMany.mockResolvedValue({ count: 1 } as never);
}

const archiveWrites = (model: any): Row[] =>
  [...model.update.mock.calls, ...model.updateMany.mock.calls].map((c: any[]) => c[0]?.data ?? {}).filter((d: Row) => d.archivedAt);

/** An error the handler doesn't catch becomes a 500, as Next.js would return. */
const asServed = (p: Promise<Response>) => p.catch(() => new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }));

const deleteRink = () =>
  asServed(DELETE_RINK(request(`/api/admin/greens/${GREEN}/rinks/rink-a`, { method: "DELETE" }), routeParams({ id: GREEN, rinkId: "rink-a" })));
const deleteGreen = () =>
  asServed(DELETE_GREEN(request(`/api/admin/greens/${GREEN}`, { method: "DELETE" }), routeParams({ id: GREEN })));

const PAST = (rinkId: string): BookingFixture => ({ id: `past-${rinkId}`, rinkId, date: isoDateFromToday(-30), status: "CONFIRMED" });
const FUTURE = (rinkId: string): BookingFixture => ({ id: `future-${rinkId}`, rinkId, date: isoDateFromToday(14), status: "CONFIRMED" });

beforeEach(() => signInAs(ADMIN));

describe("DELETE /api/admin/greens/[id]/rinks/[rinkId]", () => {
  test("[B-49] FR-BOOK-002 – a rink with only past bookings is archived (archivedAt set), keeping its booking history", async () => {
    arrangeGreen([PAST("rink-a")]);

    const { status } = await readJson(await deleteRink());

    expect(status).toBe(200);
    expect(archiveWrites(prismaMock.rink)).toEqual([expect.objectContaining({ archivedAt: expect.any(Date) })]);
    expect(prismaMock.bookingSlot.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.booking.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.rink.delete).not.toHaveBeenCalled();
  });

  test("[B-49] FR-BOOK-002 – a rink with future active bookings is not deleted (409)", async () => {
    arrangeGreen([PAST("rink-a"), FUTURE("rink-a")]);

    const { status } = await readJson(await deleteRink());

    expect(status).toBe(409);
    expect(archiveWrites(prismaMock.rink)).toEqual([]);
    expect(prismaMock.rink.delete).not.toHaveBeenCalled();
    expect(prismaMock.bookingSlot.deleteMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/greens/[id]", () => {
  test("[B-49] FR-BOOK-002 – a green whose rinks have only past bookings is archived (archivedAt set), keeping history", async () => {
    arrangeGreen([PAST("rink-a"), PAST("rink-b")]);

    const { status } = await readJson(await deleteGreen());

    expect(status).toBe(200);
    expect(archiveWrites(prismaMock.green)).toEqual([expect.objectContaining({ archivedAt: expect.any(Date) })]);
    expect(prismaMock.green.delete).not.toHaveBeenCalled();
    expect(prismaMock.rink.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.bookingSlot.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.booking.deleteMany).not.toHaveBeenCalled();
  });

  test("[B-49] FR-BOOK-002 – a green with future active bookings on a rink is not deleted (409)", async () => {
    arrangeGreen([PAST("rink-a"), FUTURE("rink-b")]);

    const { status } = await readJson(await deleteGreen());

    expect(status).toBe(409);
    expect(archiveWrites(prismaMock.green)).toEqual([]);
    expect(prismaMock.green.delete).not.toHaveBeenCalled();
    expect(prismaMock.bookingSlot.deleteMany).not.toHaveBeenCalled();
  });
});

// ── Season overrides ────────────────────────────────────────────

/** The current year in the club's timezone (Europe/London, D-05). */
const CLUB_YEAR = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric" }).format(new Date()));

function arrangeSeasons(existing: Row | null) {
  arrangeGreen([]);
  prismaMock.greenSeason.findUnique.mockResolvedValue(existing as never);
  prismaMock.greenSeason.findFirst.mockResolvedValue(existing as never);
  const echo = (data: Row) => ({ id: "season-1", greenId: GREEN, note: null, createdAt: new Date(), updatedAt: new Date(), ...data });
  prismaMock.greenSeason.create.mockImplementation((async ({ data }: Row) => echo(data)) as never);
  prismaMock.greenSeason.update.mockImplementation((async ({ data }: Row) => echo({ ...existing, ...data })) as never);
  prismaMock.greenSeason.upsert.mockImplementation((async ({ create, update }: Row) =>
    echo(existing ? { ...existing, ...update } : create)) as never);
}

/** Every season row the route wrote (create, update or upsert). */
function seasonWrites(): Row[] {
  return [
    ...prismaMock.greenSeason.create.mock.calls.map((c: any[]) => c[0].data),
    ...prismaMock.greenSeason.update.mock.calls.map((c: any[]) => c[0].data),
    ...prismaMock.greenSeason.upsert.mock.calls.map((c: any[]) => ({ ...c[0].create, ...c[0].update })),
  ];
}

const postSeason = (body: Row) =>
  POST_SEASON(jsonRequest("POST", `/api/admin/greens/${GREEN}/seasons`, body), routeParams({ id: GREEN }));

describe("POST /api/admin/greens/[id]/seasons", () => {
  test("[B-51] FR-BOOK-005 – with no year given, the override is for the current year (club timezone)", async () => {
    arrangeSeasons(null);

    const { status } = await readJson(await postSeason({ startDate: `${CLUB_YEAR}-04-01`, endDate: `${CLUB_YEAR}-09-30` }));

    expect(String(status)).toMatch(/^20[01]$/);
    expect(seasonWrites()).toEqual([expect.objectContaining({ year: CLUB_YEAR })]);
  });

  test("[B-51] FR-BOOK-005 – an existing override for that year is not overwritten without overwrite: true (409)", async () => {
    arrangeSeasons({ id: "season-1", greenId: GREEN, year: CLUB_YEAR, startDate: `${CLUB_YEAR}-03-15`, endDate: `${CLUB_YEAR}-10-15`, note: null });

    const { status } = await readJson(
      await postSeason({ year: CLUB_YEAR, startDate: `${CLUB_YEAR}-04-01`, endDate: `${CLUB_YEAR}-09-30` }),
    );

    expect(status).toBe(409);
    expect(seasonWrites()).toEqual([]);
  });

  test("[B-51] FR-BOOK-005 – an existing override is replaced when overwrite: true is sent", async () => {
    arrangeSeasons({ id: "season-1", greenId: GREEN, year: CLUB_YEAR, startDate: `${CLUB_YEAR}-03-15`, endDate: `${CLUB_YEAR}-10-15`, note: null });

    const { status } = await readJson(
      await postSeason({ year: CLUB_YEAR, startDate: `${CLUB_YEAR}-04-01`, endDate: `${CLUB_YEAR}-09-30`, overwrite: true }),
    );

    expect(String(status)).toMatch(/^20[01]$/);
    expect(seasonWrites()).toEqual([
      expect.objectContaining({ startDate: `${CLUB_YEAR}-04-01`, endDate: `${CLUB_YEAR}-09-30` }),
    ]);
  });

  test("[B-51] FR-BOOK-005 – dates outside the given year are rejected (400)", async () => {
    arrangeSeasons(null);

    const { status } = await readJson(
      await postSeason({ year: CLUB_YEAR + 1, startDate: `${CLUB_YEAR}-04-01`, endDate: `${CLUB_YEAR}-09-30` }),
    );

    expect(status).toBe(400);
    expect(seasonWrites()).toEqual([]);
  });

  test("[B-51] FR-BOOK-005 – a one-day season (start = end) is accepted", async () => {
    arrangeSeasons(null);

    const { status } = await readJson(
      await postSeason({ year: CLUB_YEAR, startDate: `${CLUB_YEAR}-06-01`, endDate: `${CLUB_YEAR}-06-01` }),
    );

    expect(String(status)).toMatch(/^20[01]$/);
    expect(seasonWrites()).toEqual([
      expect.objectContaining({ year: CLUB_YEAR, startDate: `${CLUB_YEAR}-06-01`, endDate: `${CLUB_YEAR}-06-01` }),
    ]);
  });
});

// ── Recurring season MM-DD validation ───────────────────────────

describe("green create/update – season MM-DD validation", () => {
  beforeEach(() => {
    arrangeGreen([]);
    prismaMock.green.create.mockImplementation((async ({ data }: Row) => ({
      id: "green-new", ...data, rinks: [], seasons: [],
    })) as never);
  });

  const createGreen = (body: Row) => CREATE_GREEN(jsonRequest("POST", "/api/admin/greens", body));
  const updateGreen = (body: Row) =>
    UPDATE_GREEN(jsonRequest("PATCH", `/api/admin/greens/${GREEN}`, body), routeParams({ id: GREEN }));

  test("[B-52] FR-BOOK-005 – control: valid MM-DD values are accepted on create", async () => {
    const { status } = await readJson(await createGreen({ name: "North Green", seasonStartMMDD: "04-01", seasonEndMMDD: "09-30" }));

    expect(status).toBe(201);
  });

  test.each([
    ["13-45", "09-30"],
    ["4-1", "09-30"],
    ["04-01", "13-45"],
    ["04-01", "4-1"],
  ])("[B-52] FR-BOOK-005 – creating a green with season %s → %s is rejected (400)", async (start, end) => {
    const { status } = await readJson(await createGreen({ name: "North Green", seasonStartMMDD: start, seasonEndMMDD: end }));

    expect(status).toBe(400);
    expect(prismaMock.green.create).not.toHaveBeenCalled();
  });

  test.each([
    ["13-45", "09-30"],
    ["4-1", "09-30"],
    ["04-01", "13-45"],
    ["04-01", "4-1"],
  ])("[B-52] FR-BOOK-005 – updating a green to season %s → %s is rejected (400)", async (start, end) => {
    const { status } = await readJson(await updateGreen({ seasonStartMMDD: start, seasonEndMMDD: end }));

    expect(status).toBe(400);
    expect(prismaMock.green.update).not.toHaveBeenCalled();
  });
});

// ── isGreenOpenOn ───────────────────────────────────────────────

describe("isGreenOpenOn (src/lib/season.ts)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("[B-52] FR-BOOK-006 – a season ending 02-29 in a non-leap year is open on 28 Feb and closed on 1 Mar", () => {
    const winter: GreenSeasonInfo = { allWeather: false, seasonStartMMDD: "10-01", seasonEndMMDD: "02-29", seasons: [] };

    expect(isGreenOpenOn(winter, "2027-02-28")).toBe(true);
    expect(isGreenOpenOn(winter, "2027-03-01")).toBe(false);
    // Leap-year control: 29 Feb exists in 2028 and is the last open day.
    expect(isGreenOpenOn(winter, "2028-02-29")).toBe(true);
    expect(isGreenOpenOn(winter, "2028-03-01")).toBe(false);
  });

  /**
   * Jest can't change the process timezone in-process, so simulate a server
   * running in another zone by shifting the local-time Date getters. A result
   * computed in the club's timezone (Europe/London, D-05) is unaffected.
   */
  function simulateServerTimezone(offsetHours: number) {
    const shifted = (d: Date) => new Date(d.getTime() + offsetHours * 3_600_000);
    const P = Date.prototype as any;
    const local: Array<[string, string]> = [
      ["getFullYear", "getUTCFullYear"], ["getMonth", "getUTCMonth"], ["getDate", "getUTCDate"],
      ["getDay", "getUTCDay"], ["getHours", "getUTCHours"], ["getMinutes", "getUTCMinutes"],
    ];
    for (const [getter, utc] of local) {
      jest.spyOn(P, getter).mockImplementation(function (this: Date) {
        return (shifted(this) as any)[utc]();
      });
    }
    jest.spyOn(P, "getTimezoneOffset").mockImplementation(() => -offsetHours * 60);
  }

  const janToMar: GreenSeasonInfo = { allWeather: false, seasonStartMMDD: "01-01", seasonEndMMDD: "03-31", seasons: [] };
  const aprToDec: GreenSeasonInfo = { allWeather: false, seasonStartMMDD: "04-01", seasonEndMMDD: "12-31", seasons: [] };

  test.each([
    ["UTC", 0],
    ["America/New_York (UTC-5)", -5],
    ["Pacific/Auckland (UTC+13)", 13],
  ])("[B-52] D-05 – open/closed around 1 Jan midnight is decided in club time, whatever the server timezone (%s)", (_zone, offset) => {
    simulateServerTimezone(offset);

    const answers = {
      // 00:30 on 1 Jan 2027 in London (= 00:30Z): inside a season starting 01-01.
      jan1Date: isGreenOpenOn(janToMar, "2027-01-01"),
      jan1Instant: isGreenOpenOn(janToMar, "2027-01-01T00:30:00.000Z"),
      dec31BeforeJanSeason: isGreenOpenOn(janToMar, "2026-12-31"),
      // 31 Dec 2026 is the last day of a season ending 12-31.
      dec31Date: isGreenOpenOn(aprToDec, "2026-12-31"),
      jan1AfterDecSeason: isGreenOpenOn(aprToDec, "2027-01-01"),
    };

    expect(answers).toEqual({
      jan1Date: true,
      jan1Instant: true,
      dec31BeforeJanSeason: false,
      dec31Date: true,
      jan1AfterDecSeason: false,
    });
  });
});
