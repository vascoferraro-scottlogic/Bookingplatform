/**
 * FR-FLAG-002: a module's API is unreachable when that module's flag is off
 * for the caller's tenant (B-15). Each row turns off ONLY its module's flag;
 * every other flag is on, and the caller has a sufficient role, so the only
 * reason to refuse is the flag.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import type { NextRequest } from "next/server";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { POST as bookingsPOST } from "@/app/api/bookings/route";
import { GET as proposalsGET } from "@/app/api/agent/proposals/route";
import { GET as trackingStatsGET } from "@/app/api/tracking/stats/route";
import { GET as streamingGET, POST as streamingPOST } from "@/app/api/streaming/route";
import { GET as maintenanceGET } from "@/app/api/maintenance/route";

const TENANT = "tenant-1";

type Row = {
  module: string;
  /** Flag key that gates the module. "maintenance" does not exist yet (NOT-IMPL). */
  flag: string;
  call: () => Promise<Response>;
  /** Writes / reads that must not happen when the flag is off. */
  untouched: () => jest.Mock[];
};

const rows: Row[] = [
  {
    module: "bookings — POST /api/bookings",
    flag: "bookings",
    call: () =>
      bookingsPOST(jsonRequest("POST", "/api/bookings", { date: isoDateFromToday(7), slots: [{ rinkId: "rink-1", timeSlot: "10:00" }] })),
    untouched: () => [prismaMock.booking.create as unknown as jest.Mock],
  },
  {
    module: "agent — GET /api/agent/proposals",
    flag: "agent",
    call: () => proposalsGET(request("/api/agent/proposals")),
    untouched: () => [prismaMock.agentProposal.findMany as unknown as jest.Mock],
  },
  {
    module: "tracking — GET /api/tracking/stats",
    flag: "analytics",
    call: () => trackingStatsGET(request("/api/tracking/stats?period=7d")),
    untouched: () => [prismaMock.trackingEvent.count as unknown as jest.Mock],
  },
  {
    module: "streaming — GET /api/streaming",
    flag: "liveStreaming",
    call: () => streamingGET(request("/api/streaming") as NextRequest),
    untouched: () => [prismaMock.streamSession.findMany as unknown as jest.Mock],
  },
  {
    module: "streaming — POST /api/streaming",
    flag: "liveStreaming",
    call: () => streamingPOST(jsonRequest("POST", "/api/streaming", { title: "Finals", rinkId: "rink-1" })),
    untouched: () => [prismaMock.streamSession.create as unknown as jest.Mock],
  },
  {
    module: "maintenance — GET /api/maintenance",
    flag: "maintenance" as never,
    call: () => maintenanceGET(request("/api/maintenance")),
    untouched: () => [prismaMock.maintenanceTask.findMany as unknown as jest.Mock],
  },
];

describe("[B-15] module APIs are gated on the module flag", () => {
  test.each(rows)("[B-15] FR-FLAG-002 – $module with flag \"$flag\" OFF → 403", async ({ flag, call, untouched }) => {
    // Only this module's flag is off.
    prismaMock.featureFlag.findUnique.mockImplementation((async ({ where }: any) => ({
      tenantId: where.tenantId_key.tenantId,
      key: where.tenantId_key.key,
      enabled: where.tenantId_key.key !== flag,
    })) as never);
    prismaMock.featureFlag.findMany.mockResolvedValue([{ tenantId: TENANT, key: flag, enabled: false }] as never);

    // Enough fixture for each route to succeed if it ignored the flag.
    prismaMock.rink.findMany.mockResolvedValue([{ id: "rink-1", name: "Rink 1", greenId: "g1", green: { id: "g1", tenantId: TENANT, name: "Main", allWeather: true } }] as never);
    prismaMock.rink.findFirst.mockResolvedValue({ id: "rink-1", name: "Rink 1" } as never);
    prismaMock.tenant.findUnique.mockResolvedValue({ id: TENANT, status: "ACTIVE", active: true, openingTime: "08:00", closingTime: "20:00" } as never);
    prismaMock.tenantSubscription.findUnique.mockResolvedValue({ tenantId: TENANT, tier: "GOLD", status: "ACTIVE", maxConcurrentStreams: 999, archiveRetentionDays: 30 } as never);
    prismaMock.booking.findMany.mockResolvedValue([]);
    prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({ id: "booking-1", status: "REQUESTED", slots: [], ...data })) as never);
    prismaMock.agentProposal.findMany.mockResolvedValue([]);
    prismaMock.maintenanceTask.findMany.mockResolvedValue([]);
    prismaMock.streamSession.findMany.mockResolvedValue([]);
    prismaMock.streamSession.count.mockResolvedValue(0);
    prismaMock.trackingEvent.count.mockResolvedValue(0);
    (prismaMock.trackingEvent.groupBy as unknown as jest.Mock).mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([] as never);

    signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });

    // A route that ignores the flag may crash on missing fixture deeper in;
    // that still means it went past where the flag gate belongs.
    const status = await call().then((r) => r.status, (e: Error) => `threw: ${e.message}`);

    expect(status).toBe(403);
    for (const m of untouched()) expect(m).not.toHaveBeenCalled();
  });
});
