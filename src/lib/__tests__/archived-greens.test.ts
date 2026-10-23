/**
 * Archived greens and rinks (archivedAt set) can't be booked and aren't shown as
 * available, and season checks use the club's timezone (B-48).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { POST as bookingsPOST } from "@/app/api/bookings/route";
import { GET as memberAvailability } from "@/app/api/bookings/availability/route";
import { GET as publicAvailability } from "@/app/api/public/club/[slug]/availability/route";

const TENANT = "tenant-1";
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const DATE = isoDateFromToday(10);

beforeEach(() => {
  prismaMock.tenant.findUnique.mockResolvedValue({
    id: TENANT, slug: "club", active: true, status: "ACTIVE", openingTime: "08:00", closingTime: "20:00", timezone: "Pacific/Auckland",
  } as never);
  prismaMock.green.findMany.mockResolvedValue([] as never);
  prismaMock.rink.findMany.mockResolvedValue([] as never);
});

describe("archived greens and rinks", () => {
  test("[B-48] booking an archived rink/green is refused (the rink lookup excludes archived ones → 404)", async () => {
    signInAs(USER);

    const { status } = await readJson(
      await bookingsPOST(jsonRequest("POST", "/api/bookings", { date: DATE, slots: [{ rinkId: "rink-archived", timeSlot: "10:00" }] })),
    );

    expect(status).toBe(404);
    expect(prismaMock.rink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ archivedAt: null, green: { tenantId: TENANT, archivedAt: null } }) }),
    );
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-48] member availability omits archived greens and rinks, using the club's timezone", async () => {
    signInAs(USER);

    await memberAvailability(request(`/api/bookings/availability?date=${DATE}`));

    const args = prismaMock.green.findMany.mock.calls[0][0] as any;
    expect(args.where).toEqual({ tenantId: TENANT, archivedAt: null });
    expect(args.include.rinks.where).toEqual({ archivedAt: null });
  });

  test("[B-48] public availability omits archived greens and rinks", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);

    await publicAvailability(request(`/api/public/club/club/availability?date=${DATE}`), routeParams({ slug: "club" }));

    const args = prismaMock.green.findMany.mock.calls[0][0] as any;
    expect(args.where).toEqual({ tenantId: TENANT, archivedAt: null });
    expect(args.include.rinks.where).toEqual({ archivedAt: null });
  });
});
