// Seed synthetic *labelled* booking history for the no-show ML model.
//
// The no-show prediction model (ml/) needs historical bookings whose terminal
// status is either CONFIRMED (turned up) or NO_SHOW (didn't) to train and
// evaluate against. Production data accrues this naturally over time; for
// development, demos, and QE training we generate it here.
//
// The generator embeds a *latent, learnable* no-show signal: each booking's
// probability of being a no-show is a logistic function of realistic drivers
// (lead time, day-of-week, time-of-day, a weather proxy, member tenure, and
// the member's prior no-show history) plus noise, so the model has genuine
// structure to discover without the classes being trivially separable.
//
// Usage:
//   npx tsx scripts/seed-noshow-history.ts --tenant lakeview-bowls
//   npx tsx scripts/seed-noshow-history.ts --tenant lakeview-bowls --count 600
//   npx tsx scripts/seed-noshow-history.ts --tenant lakeview-bowls --clean
//
// Flags:
//   --tenant <slug|id>   target tenant (required)
//   --count <n>          number of historical bookings to generate (default 400)
//   --clean              delete previously-seeded synthetic history first
//   --seed <n>           RNG seed for reproducibility (default 42)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { BookingStatus } from "@prisma/client";

// Synthetic bookings are tagged via overrideReason so --clean can find them
// again without touching real bookings.
const SYNTHETIC_TAG = "synthetic:noshow-history";

interface Args {
  tenant: string;
  count: number;
  clean: boolean;
  seed: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tenant = get("--tenant");
  if (!tenant) {
    console.error("ERROR: --tenant <slug|id> is required.");
    process.exit(1);
  }
  return {
    tenant,
    count: Number(get("--count") ?? 400),
    clean: argv.includes("--clean"),
    seed: Number(get("--seed") ?? 42),
  };
}

/** Tiny deterministic PRNG (mulberry32) so seeded runs are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** YYYY-MM-DD for a date `daysAgo` before today (local). */
function dateNDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const TIME_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

async function resolveTenantId(arg: string): Promise<string> {
  const bySlug = await prisma.tenant.findUnique({ where: { slug: arg }, select: { id: true } });
  if (bySlug) return bySlug.id;
  const byId = await prisma.tenant.findUnique({ where: { id: arg }, select: { id: true } });
  if (byId) return byId.id;
  console.error(`ERROR: no tenant found for "${arg}" (tried slug then id).`);
  process.exit(1);
}

async function main() {
  const args = parseArgs();
  const rng = makeRng(args.seed);
  const tenantId = await resolveTenantId(args.tenant);

  if (args.clean) {
    // Delete slots + payments + predictions for synthetic bookings, then the
    // bookings themselves. Predictions cascade, but slots/payments do not.
    const synthetic = await prisma.booking.findMany({
      where: { tenantId, overrideReason: SYNTHETIC_TAG },
      select: { id: true },
    });
    const ids = synthetic.map((b) => b.id);
    if (ids.length > 0) {
      await prisma.bookingSlot.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.bookingPayment.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.bookingNoShowPrediction.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.booking.deleteMany({ where: { id: { in: ids } } });
    }
    console.log(`Cleaned ${ids.length} synthetic bookings for tenant ${tenantId}.`);
  }

  // Pull the tenant's rinks (with green) and members to attach bookings to.
  const rinks = await prisma.rink.findMany({
    where: { green: { tenantId } },
    select: { id: true, name: true, green: { select: { name: true, allWeather: true } } },
  });
  if (rinks.length === 0) {
    console.error("ERROR: tenant has no rinks. Seed greens/rinks first (npm run db:seed).");
    process.exit(1);
  }

  const members = await prisma.user.findMany({
    where: { tenantId, role: { in: ["USER", "MAINTENANCE", "TENANT_ADMIN"] } },
    select: { id: true, createdAt: true },
  });
  if (members.length === 0) {
    console.error("ERROR: tenant has no members to book for.");
    process.exit(1);
  }

  // Track per-member running no-show history so the signal compounds (a member
  // with past no-shows is modestly more likely to no-show again).
  const priorNoShows = new Map<string, number>();

  let confirmed = 0;
  let noShow = 0;

  for (let i = 0; i < args.count; i++) {
    // Spread bookings across the last ~120 days of play.
    const daysAgo = 1 + Math.floor(rng() * 120);
    const dateStr = dateNDaysAgo(daysAgo);
    const playDate = new Date(dateStr);
    const dow = playDate.getUTCDay(); // 0 = Sun ... 6 = Sat
    const isWeekend = dow === 0 || dow === 6;

    const member = members[Math.floor(rng() * members.length)];
    const rink = rinks[Math.floor(rng() * rinks.length)];
    const timeSlot = TIME_SLOTS[Math.floor(rng() * TIME_SLOTS.length)];
    const hour = parseInt(timeSlot.slice(0, 2), 10);

    // Lead time: how many days ahead the booking was made (1..28).
    const leadTimeDays = 1 + Math.floor(rng() * 28);
    // Weather proxy: a per-booking "poor conditions" roll, worse for outdoor greens.
    const poorWeatherRoll = rng() < (rink.green.allWeather ? 0.15 : 0.3);
    // Member tenure in days at time of play.
    const tenureDays = Math.max(
      0,
      Math.floor((playDate.getTime() - new Date(member.createdAt).getTime()) / 86_400_000),
    );

    const past = priorNoShows.get(member.id) ?? 0;

    // ── Latent no-show propensity (logistic) ──
    // Tuned so the overall no-show rate lands ~15-22% (realistic, and keeps the
    // positive class a minority for a meaningful precision/recall test). The
    // coefficients are individually weak but jointly informative; the noise
    // term keeps the classes overlapping so the model can't perfectly separate.
    const logit =
      -3.0 + // base (~5% before signals)
      0.025 * leadTimeDays + // booking far ahead → flakier
      (isWeekend ? -0.35 : 0.2) + // weekends stickier, weekday play looser
      (hour <= 10 ? 0.35 : 0) + // early-morning slots more often skipped
      (poorWeatherRoll ? 0.7 : 0) + // poor weather → more no-shows
      (tenureDays < 30 ? 0.5 : tenureDays > 365 ? -0.35 : 0) + // new joiners flakier
      0.35 * Math.min(past, 2) + // prior no-shows compound (capped to avoid runaway)
      (rng() - 0.5) * 1.0; // noise

    const isNoShow = rng() < sigmoid(logit);

    const createdAt = new Date(playDate.getTime() - leadTimeDays * 86_400_000);
    const status: BookingStatus = isNoShow ? "NO_SHOW" : "CONFIRMED";

    const booking = await prisma.booking.create({
      data: {
        tenantId,
        userId: member.id,
        date: dateStr,
        status,
        createdAt,
        // Tag for --clean; not a real admin override.
        overrideReason: SYNTHETIC_TAG,
        slots: {
          create: {
            rinkId: rink.id,
            timeSlot,
            greenName: rink.green.name,
          },
        },
      },
      select: { id: true },
    });

    // A confirmed booking has a paid payment; a no-show keeps the payment (the
    // slot was consumed, no refund) — both reflect a real "money changed hands"
    // booking, distinguishing them from cancellations.
    await prisma.bookingPayment.create({
      data: { bookingId: booking.id, amount: 1000, status: "PAID" },
    });

    if (isNoShow) {
      priorNoShows.set(member.id, past + 1);
      noShow++;
    } else {
      confirmed++;
    }
  }

  const total = confirmed + noShow;
  const rate = total > 0 ? ((noShow / total) * 100).toFixed(1) : "0.0";
  console.log(
    `Seeded ${total} synthetic bookings for tenant ${tenantId}: ` +
      `${confirmed} CONFIRMED, ${noShow} NO_SHOW (${rate}% no-show rate).`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
