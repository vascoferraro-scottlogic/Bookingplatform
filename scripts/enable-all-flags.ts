import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const p = new PrismaClient({ adapter });

async function main() {
  const tenants = await p.tenant.findMany({ select: { id: true, name: true, slug: true } });
  console.log("Tenants:", JSON.stringify(tenants, null, 2));

  const existing = await p.featureFlag.findMany();
  console.log("Existing flags:", existing.length);

  const allFlags = [
    "federation", "publicContent", "publicEvents", "publicAvailability",
    "events", "eventsShowExternal", "liveStreaming", "weather", "helpOverrides",
    "funding", "businessInsights", "messaging", "agent", "charity",
    "bookings", "noShowPrediction", "modelOps",
  ];

  for (const tenant of tenants) {
    for (const key of allFlags) {
      await p.featureFlag.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key } },
        update: { enabled: true },
        create: { tenantId: tenant.id, key, enabled: true },
      });
    }
    console.log(`Enabled ${allFlags.length} flags for ${tenant.name} (${tenant.slug})`);
  }

  await p.$disconnect();
}

main();
