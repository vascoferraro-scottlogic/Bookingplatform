jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { POST } from "@/app/api/bookings/route";

const TENANT = "tenant-1";
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const RINK = "rink-a";

const book = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/bookings", body));

/** The club's configured opening hours (null = not configured). */
function givenHours(openingTime: string | null, closingTime: string | null) {
  const tenant = {
    id: TENANT,
    name: "Club",
    slug: "club",
    active: true,
    status: "ACTIVE",
    openingTime,
    closingTime,
    timezone: "Europe/London",
  };
  prismaMock.tenant.findUnique.mockResolvedValue(tenant as never);
  prismaMock.tenant.findFirst.mockResolvedValue(tenant as never);
  prismaMock.rink.findMany.mockResolvedValue([
    {
      id: RINK,
      greenId: "green-1",
      name: "Rink A",
      green: {
        name: "Test Green",
        allWeather: false,
        seasonStartMMDD: null,
        seasonEndMMDD: null,
        seasons: [],
        openingTime,
        closingTime,
        tenant,
      },
    },
  ] as never);
}

beforeEach(() => {
  givenHours("09:00", "21:00");
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null);
  prismaMock.bookingSlot.findMany.mockResolvedValue([] as never);
  prismaMock.booking.findMany.mockResolvedValue([] as never);
  prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({
    id: "new-booking",
    ...data,
    slots: data.slots?.create ?? [],
  })) as never);
});

describe("POST /api/bookings - opening hours", () => {
  test("[B-42] FR-BOOK-007 – timeSlot outside the club's opening hours (23:00) → 400", async () => {
    signInAs(USER);

    const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "23:00" }] }));

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-42] FR-BOOK-007 – non-HH:MM timeSlot (\"banana\") → 400", async () => {
    signInAs(USER);

    const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "banana" }] }));

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-42] FR-BOOK-007 – timeSlot inside opening hours is accepted (201)", async () => {
    signInAs(USER);

    const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "20:00" }] }));

    expect(status).toBe(201);
  });

  describe("with no hours configured, the schema defaults 08:00–20:00 apply", () => {
    beforeEach(() => givenHours(null, null));

    test("[B-42] FR-BOOK-007 – 19:00 is accepted (201)", async () => {
      signInAs(USER);

      const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "19:00" }] }));

      expect(status).toBe(201);
    });

    test("[B-42] FR-BOOK-007 – 20:00 (closing time) is rejected (400)", async () => {
      signInAs(USER);

      const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "20:00" }] }));

      expect(status).toBe(400);
      expect(prismaMock.booking.create).not.toHaveBeenCalled();
    });

    test("[B-42] FR-BOOK-007 – 07:00 (before opening) is rejected (400)", async () => {
      signInAs(USER);

      const { status } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "07:00" }] }));

      expect(status).toBe(400);
      expect(prismaMock.booking.create).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/bookings - date validation", () => {
  test("[B-44] FR-BOOK-004 – invalid date \"not-a-date\" → 400", async () => {
    signInAs(USER);

    const { status } = await readJson(await book({ date: "not-a-date", slots: [{ rinkId: RINK, timeSlot: "10:00" }] }));

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-44] FR-BOOK-004 – date in the past → 400", async () => {
    signInAs(USER);

    const { status } = await readJson(await book({ date: isoDateFromToday(-2), slots: [{ rinkId: RINK, timeSlot: "10:00" }] }));

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/bookings - intra-request dedupe", () => {
  test("[B-45] FR-BOOK-008 – same (rinkId, timeSlot) twice in one request → 400 with a clear message (not 404)", async () => {
    signInAs(USER);

    const { status, body } = await readJson(
      await book({
        date: isoDateFromToday(30),
        slots: [
          { rinkId: RINK, timeSlot: "10:00" },
          { rinkId: RINK, timeSlot: "10:00" },
        ],
      }),
    );

    expect(status).toBe(400);
    expect(body.error).toMatch(/duplicate|more than once|twice|same/i);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-45] FR-BOOK-008 – same rink at two different times → 201", async () => {
    signInAs(USER);

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(30),
        slots: [
          { rinkId: RINK, timeSlot: "10:00" },
          { rinkId: RINK, timeSlot: "11:00" },
        ],
      }),
    );

    expect(status).toBe(201);
    expect(prismaMock.booking.create).toHaveBeenCalledTimes(1);
  });
});
