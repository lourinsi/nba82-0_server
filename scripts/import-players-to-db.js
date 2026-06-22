const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config({ quiet: true, override: true });

const { disconnectPrisma, getPrismaClient } = require("../db");
const { getPlayerDataPath, playerToDatabaseRecord } = require("../playerRepository");

function parseArgs(argv) {
  const args = {};

  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value === undefined ? true : value;
  }

  return args;
}

function flagEnabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);

  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function assertUniquePlayerIds(records) {
  const seen = new Set();

  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate player id in import source: ${record.id}`);
    }

    seen.add(record.id);
  }
}

function updateDataForRecord(record) {
  const { id, ...updateData } = record;

  return updateData;
}

async function readImportSource(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const players = JSON.parse(raw);

  if (!Array.isArray(players)) {
    throw new Error(`Expected ${filePath} to contain an array of players.`);
  }

  return {
    checksum: crypto.createHash("sha256").update(raw).digest("hex"),
    players,
  };
}

async function upsertPlayers(prisma, records, batchSize) {
  let imported = 0;

  for (const recordsBatch of chunk(records, batchSize)) {
    await prisma.$transaction(
      recordsBatch.map((record) =>
        prisma.player.upsert({
          where: { id: record.id },
          create: record,
          update: updateDataForRecord(record),
        }),
      ),
      { timeout: 120000 },
    );
    imported += recordsBatch.length;
    console.log(`Imported ${imported}/${records.length} players...`);
  }
}

async function replacePlayers(prisma, records, batchSize) {
  await prisma.player.deleteMany();

  let imported = 0;
  for (const recordsBatch of chunk(records, batchSize)) {
    await prisma.player.createMany({ data: recordsBatch });
    imported += recordsBatch.length;
    console.log(`Imported ${imported}/${records.length} players...`);
  }
}

async function deleteMissingPlayers(prisma, sourceIds, batchSize) {
  const existingRows = await prisma.player.findMany({ select: { id: true } });
  const sourceIdSet = new Set(sourceIds);
  const staleIds = existingRows.map((row) => row.id).filter((id) => !sourceIdSet.has(id));

  for (const staleBatch of chunk(staleIds, batchSize)) {
    await prisma.player.deleteMany({ where: { id: { in: staleBatch } } });
  }

  return staleIds.length;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = flagEnabled(args.dryRun);
  const deleteMissing = flagEnabled(args.deleteMissing);
  const batchSize = positiveInteger(args.batchSize || process.env.DB_IMPORT_BATCH_SIZE, 100);
  const sourcePath = path.resolve(process.cwd(), args.file || getPlayerDataPath());
  const { checksum, players } = await readImportSource(sourcePath);
  const records = players.map((player, index) => playerToDatabaseRecord(player, index));

  assertUniquePlayerIds(records);

  console.log(`Loaded ${records.length} players from ${sourcePath}.`);
  console.log(`Source checksum: ${checksum}`);

  if (dryRun) {
    console.log("Dry run complete. No database writes were made.");
    return;
  }

  const prisma = getPrismaClient({ required: true });

  let deletedCount = 0;
  if (deleteMissing) {
    const beforeCount = await prisma.player.count();
    await replacePlayers(prisma, records, batchSize);
    deletedCount = Math.max(0, beforeCount - records.length);
  }
  else {
    await upsertPlayers(prisma, records, batchSize);
  }

  await prisma.dataImport.create({
    data: {
      source: "players_json",
      sourcePath,
      checksum,
      playerCount: records.length,
    },
  });

  console.log(
    deleteMissing
      ? `Sync complete: replaced player table with ${records.length} players${deletedCount ? `, removed ${deletedCount} stale rows` : ""}.`
      : `Import complete: upserted ${records.length} players.`,
  );
}

main()
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
