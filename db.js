let prisma;
let warnedAboutClient = false;

function databaseUrlConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

function adapterConnectionString() {
  const url = new URL(process.env.DATABASE_URL);

  if (url.searchParams.get("sslmode") === "require" && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

function loadPrismaClient() {
  try {
    const { PrismaClient } = require("@prisma/client");
    const { PrismaPg } = require("@prisma/adapter-pg");

    return { PrismaClient, PrismaPg };
  } catch (error) {
    error.message =
      "Unable to load Prisma Client. Run `npm run db:generate` after installing dependencies. " +
      error.message;
    throw error;
  }
}

function getPrismaClient({ required = false } = {}) {
  if (!databaseUrlConfigured()) {
    if (required) {
      throw new Error("DATABASE_URL is required for Prisma database operations.");
    }

    return null;
  }

  if (!prisma) {
    try {
      const { PrismaClient, PrismaPg } = loadPrismaClient();
      const log = process.env.PRISMA_QUERY_LOG === "true" ? ["query", "warn", "error"] : ["warn", "error"];
      const adapter = new PrismaPg({ connectionString: adapterConnectionString() });
      prisma = new PrismaClient({ adapter, log });
    } catch (error) {
      if (required) {
        throw error;
      }

      if (!warnedAboutClient) {
        warnedAboutClient = true;
        console.warn(error.message);
      }

      return null;
    }
  }

  return prisma;
}

async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

module.exports = {
  databaseUrlConfigured,
  disconnectPrisma,
  getPrismaClient,
};
