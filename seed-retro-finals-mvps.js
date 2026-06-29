require("dotenv").config({ quiet: true, override: true });

const { disconnectPrisma, getPrismaClient } = require("./db");
const { calculateLegacyPoints } = require("./legacyPoints");
const { seasonEra } = require("./seasonEras");
const { normalizeTeamCodeForSeason } = require("./teamFranchises");

const RETRO_FINALS_MVP_FIELD = "estimated_finals_mvp_count";
const RETRO_FINALS_MVP_DESCRIPTION = "Estimated pre-1969 Finals MVP";

const RETRO_FINALS_MVPS = [
  { year: 1947, season: "1946-47", player: "Joe Fulks", team: "PHW", award: RETRO_FINALS_MVP_FIELD },
  { year: 1948, season: "1947-48", player: "Kleggie Hermsen", team: "BLB", award: RETRO_FINALS_MVP_FIELD },
  { year: 1949, season: "1948-49", player: "George Mikan", team: "MNL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1950, season: "1949-50", player: "George Mikan", team: "MNL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1951, season: "1950-51", player: "Arnie Risen", team: "ROC", award: RETRO_FINALS_MVP_FIELD },
  { year: 1952, season: "1951-52", player: "George Mikan", team: "MNL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1953, season: "1952-53", player: "George Mikan", team: "MNL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1954, season: "1953-54", player: "George Mikan", team: "MNL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1955, season: "1954-55", player: "Dolph Schayes", team: "SYR", award: RETRO_FINALS_MVP_FIELD },
  { year: 1956, season: "1955-56", player: "Paul Arizin", team: "PHW", award: RETRO_FINALS_MVP_FIELD },
  { year: 1957, season: "1956-57", player: "Tom Heinsohn", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1958, season: "1957-58", player: "Bob Pettit", team: "STL", award: RETRO_FINALS_MVP_FIELD },
  { year: 1959, season: "1958-59", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1960, season: "1959-60", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1961, season: "1960-61", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1962, season: "1961-62", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1963, season: "1962-63", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1964, season: "1963-64", player: "Bill Russell", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1965, season: "1964-65", player: "Sam Jones", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1966, season: "1965-66", player: "John Havlicek", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
  { year: 1967, season: "1966-67", player: "Wilt Chamberlain", team: "PHI", award: RETRO_FINALS_MVP_FIELD },
  { year: 1968, season: "1967-68", player: "John Havlicek", team: "BOS", award: RETRO_FINALS_MVP_FIELD },
];

const EXPECTED_RETRO_FINALS_MVP_TOTALS = {
  "Joe Fulks": 1,
  "Kleggie Hermsen": 1,
  "George Mikan": 5,
  "Arnie Risen": 1,
  "Dolph Schayes": 1,
  "Paul Arizin": 1,
  "Tom Heinsohn": 1,
  "Bob Pettit": 1,
  "Bill Russell": 6,
  "Sam Jones": 1,
  "John Havlicek": 2,
  "Wilt Chamberlain": 1,
};

const PLAYER_MATCHERS = {
  "Joe Fulks": { ids: ["bref:fulksjo01", "nba-76764"], brefId: "fulksjo01", nbaStatsId: 76764 },
  "George Mikan": { ids: ["bref:mikange01", "nba-600012"], brefId: "mikange01", nbaStatsId: 600012 },
  "Arnie Risen": { ids: ["bref:risenar01", "nba-77967"], brefId: "risenar01", nbaStatsId: 77967 },
  "Dolph Schayes": { ids: ["bref:schaydo01", "nba-78076"], brefId: "schaydo01", nbaStatsId: 78076 },
  "Paul Arizin": { ids: ["bref:arizipa01", "nba-76056"], brefId: "arizipa01", nbaStatsId: 76056 },
  "Tom Heinsohn": { ids: ["bref:heinsto01", "nba-76988"], brefId: "heinsto01", nbaStatsId: 76988 },
  "Bob Pettit": { ids: ["bref:pettibo01", "nba-77847"], brefId: "pettibo01", nbaStatsId: 77847 },
  "Bill Russell": { ids: ["bref:russebi01", "nba-78049"], brefId: "russebi01", nbaStatsId: 78049 },
  "Sam Jones": { ids: ["bref:jonessa01", "nba-77196"], brefId: "jonessa01", nbaStatsId: 77196 },
  "John Havlicek": { ids: ["bref:havlijo01", "nba-76970"], brefId: "havlijo01", nbaStatsId: 76970 },
  "Wilt Chamberlain": { ids: ["bref:chambwi01", "nba-76375"], brefId: "chambwi01", nbaStatsId: 76375 },
};

const PLAYER_SELECT = {
  id: true,
  name: true,
  brefId: true,
  nbaStatsId: true,
  accolades: true,
  awardsRaw: true,
  classicPointsByTeamEra: true,
  payload: true,
};

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

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function calculateRetroFinalsMvpTotals(records = RETRO_FINALS_MVPS) {
  const totals = new Map();

  for (const record of records) {
    totals.set(record.player, (totals.get(record.player) || 0) + 1);
  }

  return totals;
}

function retroRowsByPlayer(records = RETRO_FINALS_MVPS) {
  const rowsByPlayer = new Map();

  for (const record of records) {
    if (!rowsByPlayer.has(record.player)) {
      rowsByPlayer.set(record.player, []);
    }

    rowsByPlayer.get(record.player).push(record);
  }

  return rowsByPlayer;
}

function validateRetroFinalsMvpSource() {
  const totals = calculateRetroFinalsMvpTotals();

  for (const record of RETRO_FINALS_MVPS) {
    if (record.award !== RETRO_FINALS_MVP_FIELD) {
      throw new Error(`Unexpected Retro FMVP award key for ${record.player} ${record.season}: ${record.award}`);
    }

    if (Number(record.year) >= 1969) {
      throw new Error(`Retro FMVP source includes official-award-era season ${record.season}.`);
    }
  }

  for (const [player, expectedTotal] of Object.entries(EXPECTED_RETRO_FINALS_MVP_TOTALS)) {
    const total = totals.get(player) || 0;

    if (total !== expectedTotal) {
      throw new Error(`Retro FMVP total mismatch for ${player}: expected ${expectedTotal}, got ${total}.`);
    }
  }

  return totals;
}

function normalizeRetroDescription(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isRetroFinalsMvpAwardRow(row) {
  const description = normalizeRetroDescription(row?.description);

  return (
    (description.includes("estimated") || description.includes("retro")) &&
    description.includes("finals") &&
    (description.includes("mvp") || description.includes("most valuable player"))
  );
}

function canonicalRetroAwardRow(record) {
  return {
    season: record.season,
    team: record.team,
    description: RETRO_FINALS_MVP_DESCRIPTION,
    all_nba_team_number: null,
  };
}

function awardRowKey(row) {
  return [
    row?.season || "",
    row?.team || "",
    row?.description || "",
    row?.all_nba_team_number || "",
  ].join("|");
}

function uniqueAwardRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = awardRowKey(row);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function withCanonicalRetroAwardRows(existingRows, retroRecords) {
  return uniqueAwardRows([
    ...jsonArray(existingRows).filter((row) => !isRetroFinalsMvpAwardRow(row)),
    ...retroRecords.map(canonicalRetroAwardRow),
  ]);
}

function removeRetroAwardCounts(awardCounts) {
  const nextAwardCounts = {};

  for (const [description, count] of Object.entries(jsonObject(awardCounts))) {
    if (!isRetroFinalsMvpAwardRow({ description })) {
      nextAwardCounts[description] = count;
    }
  }

  return nextAwardCounts;
}

function withCanonicalRetroAccolade(accolades, count) {
  const nextAccolades = {
    ...jsonObject(accolades),
    [RETRO_FINALS_MVP_FIELD]: count,
  };
  const awardCounts = removeRetroAwardCounts(nextAccolades.award_counts);

  if (count > 0) {
    awardCounts[RETRO_FINALS_MVP_DESCRIPTION] = count;
  }

  nextAccolades.award_counts = awardCounts;

  return nextAccolades;
}

function retroBlockKey(record) {
  const team = normalizeTeamCodeForSeason(record.team, record.season);
  const era = seasonEra(record.season);

  return team && era ? `${team}:${era}` : null;
}

function classicBlockKey(block) {
  const team = String(block?.team || "").trim().toUpperCase();
  const era = block?.era;

  return team && era ? `${team}:${era}` : null;
}

function groupRetroRecordsByBlock(records) {
  const recordsByBlockKey = new Map();
  const recordsWithoutBlockKey = [];

  for (const record of records) {
    const key = retroBlockKey(record);

    if (!key) {
      recordsWithoutBlockKey.push(record);
      continue;
    }

    if (!recordsByBlockKey.has(key)) {
      recordsByBlockKey.set(key, []);
    }

    recordsByBlockKey.get(key).push(record);
  }

  return { recordsByBlockKey, recordsWithoutBlockKey };
}

function withCanonicalClassicBlocks(existingBlocks, retroRecords) {
  const blocks = jsonArray(existingBlocks);
  const { recordsByBlockKey, recordsWithoutBlockKey } = groupRetroRecordsByBlock(retroRecords);
  const matchedBlockKeys = new Set();
  const updatedBlocks = blocks.map((block) => {
    const key = classicBlockKey(block);
    const blockRetroRecords = key ? recordsByBlockKey.get(key) || [] : [];

    if (blockRetroRecords.length) {
      matchedBlockKeys.add(key);
    }

    return {
      ...block,
      accolades: withCanonicalRetroAccolade(block.accolades, blockRetroRecords.length),
      award_rows: withCanonicalRetroAwardRows(block.award_rows, blockRetroRecords),
    };
  });
  const unmatchedRecords = [
    ...recordsWithoutBlockKey,
    ...Array.from(recordsByBlockKey.entries())
      .filter(([key]) => !matchedBlockKeys.has(key))
      .flatMap(([, records]) => records),
  ];

  return { classicPointsByTeamEra: updatedBlocks, unmatchedRecords };
}

async function findPlayerRow(prisma, playerName) {
  const matcher = PLAYER_MATCHERS[playerName] || {};

  for (const id of matcher.ids || []) {
    const row = await prisma.player.findUnique({ where: { id }, select: PLAYER_SELECT });

    if (row) {
      return row;
    }
  }

  if (matcher.brefId) {
    const row = await prisma.player.findFirst({
      where: { brefId: matcher.brefId },
      select: PLAYER_SELECT,
    });

    if (row) {
      return row;
    }
  }

  if (matcher.nbaStatsId) {
    const row = await prisma.player.findFirst({
      where: { nbaStatsId: matcher.nbaStatsId },
      select: PLAYER_SELECT,
    });

    if (row) {
      return row;
    }
  }

  const nameMatches = await prisma.player.findMany({
    where: { name: playerName },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: PLAYER_SELECT,
  });

  if (nameMatches.length > 1) {
    console.warn(`Multiple exact-name matches for ${playerName}; using ${nameMatches[0].id}.`);
  }

  return nameMatches[0] || null;
}

function updatePayloadForRetroFinalsMvps(row, retroRecords) {
  const payload = jsonObject(row.payload);
  const accolades = withCanonicalRetroAccolade(payload.accolades || row.accolades, retroRecords.length);
  const awardsRaw = withCanonicalRetroAwardRows(payload.awards_raw || row.awardsRaw, retroRecords);
  const { classicPointsByTeamEra, unmatchedRecords } = withCanonicalClassicBlocks(
    payload.classic_points_by_team_era || row.classicPointsByTeamEra,
    retroRecords,
  );
  const legacyPoints = calculateLegacyPoints(accolades);

  return {
    data: {
      accolades,
      awardsRaw,
      classicPointsByTeamEra,
      legacyPoints,
      payload: {
        ...payload,
        accolades,
        awards_raw: awardsRaw,
        classic_points_by_team_era: classicPointsByTeamEra,
        legacy_points: legacyPoints,
      },
    },
    unmatchedRecords,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = flagEnabled(args.dryRun || args["dry-run"]);
  const verifyOnly = flagEnabled(args.verifyOnly || args["verify-only"]);
  const totals = validateRetroFinalsMvpSource();
  const rowsByPlayer = retroRowsByPlayer();

  console.log(`Retro FMVP source validation passed: ${RETRO_FINALS_MVPS.length} awards across ${totals.size} players.`);

  if (verifyOnly) {
    for (const [player, count] of totals) {
      console.log(`${player}: ${count}`);
    }
    return;
  }

  const prisma = getPrismaClient({ required: true });
  let updated = 0;
  const skipped = [];

  for (const [playerName, retroRecords] of rowsByPlayer) {
    const row = await findPlayerRow(prisma, playerName);

    if (!row) {
      skipped.push(playerName);
      console.warn(`Skipped ${playerName}: player not found.`);
      continue;
    }

    const { data, unmatchedRecords } = updatePayloadForRetroFinalsMvps(row, retroRecords);

    if (unmatchedRecords.length) {
      console.warn(
        `No matching team-era block for ${row.name}: ${unmatchedRecords
          .map((record) => `${record.season} ${record.team}`)
          .join(", ")}.`,
      );
    }

    if (!dryRun) {
      await prisma.player.update({
        where: { id: row.id },
        data,
      });
    }

    updated += 1;
    console.log(`${dryRun ? "Would seed" : "Seeded"} ${row.name}: ${retroRecords.length} Retro FMVP${retroRecords.length === 1 ? "" : "s"}.`);
  }

  console.log(
    dryRun
      ? `Seeded Retro FMVPs: ${updated} players matched, ${skipped.length} skipped. Dry run only.`
      : `Seeded Retro FMVPs: ${updated} players updated, ${skipped.length} skipped.`,
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}

module.exports = {
  EXPECTED_RETRO_FINALS_MVP_TOTALS,
  RETRO_FINALS_MVP_DESCRIPTION,
  RETRO_FINALS_MVP_FIELD,
  RETRO_FINALS_MVPS,
  calculateRetroFinalsMvpTotals,
  updatePayloadForRetroFinalsMvps,
  validateRetroFinalsMvpSource,
};
