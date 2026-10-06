import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
	// Use the Postgres driver adapter for all environments so Prisma v7
	// has a valid driver adapter when constructing the client.
	const adapter = new PrismaPg({ connectionString });
	return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
