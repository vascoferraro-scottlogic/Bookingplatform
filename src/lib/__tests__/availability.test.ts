jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import fs from "fs";
import path from "path";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { GET as memberAvailability } from "@/app/api/bookings/availability/route";
import { GET as publicAvailability } from "@/app/api/public/club/[slug]/availability/route";

const TENANT = "tenant-1";
const SLUG = "test-club";
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const DATE = isoDateFromToday(30);

/** Slots on the rink, each with the status of its booking. */
const SLOTS = [
  { timeSlot: "10:00", playerName: "A", bookingId: "b-approved", booking: { id: "b-approved", date: DATE, status: "APPROVED" } },
  { timeSlot: "11:00", playerName: "B", bookingId: "b-confirmed", booking: { id: "b-confirmed", date: DATE, status: "CONFIRMED" } },
  { timeSlot: "12:00", playerName: "C", bookingId: "b-reserved", booking: { id: "b-reserved", date: DATE, status: "RESERVED" } },
];

/** Applies whatever booking-status filter the route asks Prisma for (if any). */
function statusFilterFrom(args: unknown): string[] | null {
  const m = JSON.stringify(args ?? {}).match(/"status":\{"in":\[([^\]]*)\]\}/);
  return m ? (JSON.parse(`[${m[1]}]`) as string[]) : null;
}

beforeEach(() => {
  const tenant = {
    id: TENANT,
    slug: SLUG,
    name: "Test Club",
    active: true,
    status: "ACTIVE",
    openingTime: "08:00",
    closingTime: "20:00",
    timezone: "Europe/London",
  };
  prismaMock.tenant.findUnique.mockResolvedValue(tenant as never);
  prismaMock.tenant.findFirst.mockResolvedValue(tenant as never);
  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => ({
    ...args.where.tenantId_key,
    enabled: true,
  })) as never);
  prismaMock.green.findMany.mockImplementation((async (args: any) => {
    const allowed = statusFilterFrom(args);
    const bookingSlots = SLOTS.filter((s) => !allowed || allowed.includes(s.booking.status));
    return [
      {
        id: "green-1",
        tenantId: TENANT,
        name: "Main Green",
        allWeather: false,
        seasonStartMMDD: null,
        seasonEndMMDD: null,
        seasons: [],
        rinks: [{ id: "rink-a", name: "Rink A", greenId: "green-1", bookingSlots }],
      },
    ];
  }) as never);
});

describe("GET /api/bookings/availability", () => {
  test("[B-41] D-02 – an APPROVED booking doesn't mark the slot unavailable; RESERVED/CONFIRMED do", async () => {
    signInAs(USER);

    const { status, body } = await readJson(await memberAvailability(request(`/api/bookings/availability?date=${DATE}`)));

    expect(status).toBe(200);
    const taken = body.greens[0].rinks[0].bookingSlots.map((s: any) => s.timeSlot).sort();
    expect(taken).toEqual(["11:00", "12:00"]);
  });
});

describe("GET /api/public/club/[slug]/availability", () => {
  test("[B-41] D-02 – an APPROVED booking doesn't mark the slot booked; RESERVED/CONFIRMED do", async () => {
    const { status, body } = await readJson(
      await publicAvailability(request(`/api/public/club/${SLUG}/availability?date=${DATE}`), routeParams({ slug: SLUG })),
    );

    expect(status).toBe(200);
    expect([...body.greens[0].rinks[0].bookedSlots].sort()).toEqual(["11:00", "12:00"]);
  });
});

describe("Shared slot generator (grid and booking modal)", () => {
  const SHARED_MODULE = "@/lib/time-slots";

  test("[B-43] FR-BOOK-007 – an 08:30 opening offers 08:30, 09:30, … up to closing", () => {
    // Required inside the test so the suite loads before the module exists.
    const { generateTimeSlots } = require(SHARED_MODULE) as {
      generateTimeSlots: (open: string, close: string) => string[];
    };

    expect(generateTimeSlots("08:30", "12:00")).toEqual(["08:30", "09:30", "10:30", "11:30"]);
    expect(generateTimeSlots("08:00", "11:00")).toEqual(["08:00", "09:00", "10:00"]);
  });

  test.each([
    "src/components/booking/AvailabilityGrid.tsx",
    "src/app/dashboard/bookings/page.tsx",
  ])("[B-43] FR-BOOK-007 – %s uses the shared generator, not its own copy", (file) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");

    expect(src).toContain(SHARED_MODULE);
    expect(src).not.toMatch(/function\s+generateTimeSlots\s*\(/);
  });
});
