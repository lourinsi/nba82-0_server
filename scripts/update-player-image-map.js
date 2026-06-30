const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_ROOT_DIR = path.resolve(ROOT_DIR, "..", "nba_82-0");
const GOAT_RANKINGS_PATH = path.resolve(ROOT_DIR, "data", "br_goat_rankings.json");
const PLAYER_IMAGE_MAP_PATH = path.resolve(ROOT_DIR, "data", "player_image_map.json");
const FRONTEND_PLAYER_IMAGE_MAP_PATH = path.resolve(FRONTEND_ROOT_DIR, "data", "player_image_map.json");

const PLAYER_DATA_SOURCES = [
  {
    label: "players_accolades_bref",
    path: path.resolve(ROOT_DIR, "data", "players_accolades_bref.json"),
  },
  {
    label: "players_accolades",
    path: path.resolve(ROOT_DIR, "data", "players_accolades.json"),
  },
];

const NBA_ID_FIELDS = [
  "nba_stats_id",
  "nbaStatsId",
  "nba_id",
  "nbaId",
  "stats_id",
  "playerId",
  "nbaPlayerId",
];

function parseArgs(argv) {
  const options = {
    check: true,
    strict: false,
    write: false,
  };

  for (const arg of argv) {
    if (arg === "--write") {
      options.write = true;
      options.check = false;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--strict") {
      options.strict = true;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return readJson(filePath);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function stringOrNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();

  return text || null;
}

function numberOrNull(value) {
  const numeric = Number(value);

  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function finiteNumberOrNull(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePlayerImageSlug(playerName) {
  return String(playerName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019`]/g, "")
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function playerNameFromRecord(record) {
  const name = stringOrNull(record?.name) || stringOrNull(record?.player);

  if (name) {
    return name;
  }

  return stringOrNull([record?.first_name, record?.last_name].filter(Boolean).join(" "));
}

function nbaStatsIdFromRecord(record) {
  for (const field of NBA_ID_FIELDS) {
    const id = numberOrNull(record?.[field]);

    if (id) {
      return id;
    }
  }

  const rawId = stringOrNull(record?.id);
  const nbaIdMatch = rawId?.match(/^nba-(\d+)$/i);

  return nbaIdMatch ? numberOrNull(nbaIdMatch[1]) : null;
}

function createCandidate(record, sourceLabel) {
  const player = playerNameFromRecord(record);
  const slug = normalizePlayerImageSlug(player);

  if (!player || !slug) {
    return null;
  }

  return {
    active: Boolean(record?.active),
    bref_id: stringOrNull(record?.bref_id || record?.brefId)?.toLowerCase() || null,
    league: leagueFromRecord(record),
    nba_stats_id: nbaStatsIdFromRecord(record),
    player,
    positions: Array.isArray(record?.positions) ? record.positions.filter(Boolean).map(String) : [],
    seasons: Array.isArray(record?.career_seasons) ? record.career_seasons.length : null,
    slug,
    sourceIds: [stringOrNull(record?.id)].filter(Boolean),
    sources: [sourceLabel],
  };
}

function leagueFromRecord(record) {
  if (stringOrNull(record?.league)) {
    return stringOrNull(record.league);
  }

  const rawAwards = Array.isArray(record?.awards_raw) ? record.awards_raw : [];
  const hasAbaAward = rawAwards.some((award) => stringOrNull(award?.source_league)?.toUpperCase() === "ABA");

  return hasAbaAward ? "ABA/NBA" : null;
}

function mergeCandidate(target, incoming) {
  target.active = target.active || incoming.active;
  target.bref_id = target.bref_id || incoming.bref_id;
  target.league = target.league || incoming.league;
  target.nba_stats_id = target.nba_stats_id || incoming.nba_stats_id;
  target.positions = Array.from(new Set([...target.positions, ...incoming.positions]));
  target.seasons = Math.max(target.seasons || 0, incoming.seasons || 0) || null;
  target.sourceIds = Array.from(new Set([...target.sourceIds, ...incoming.sourceIds]));
  target.sources = Array.from(new Set([...target.sources, ...incoming.sources]));

  if (!target.player || target.sources[0] !== "players_accolades_bref") {
    target.player = incoming.player || target.player;
    target.slug = incoming.slug || target.slug;
  }

  return target;
}

function loadProjectPlayers() {
  const withBref = [];
  const withoutBref = [];
  const skippedSources = [];

  for (const source of PLAYER_DATA_SOURCES) {
    const payload = readJsonIfExists(source.path);

    if (!Array.isArray(payload)) {
      skippedSources.push(source.path);
      continue;
    }

    for (const record of payload) {
      const candidate = createCandidate(record, source.label);

      if (!candidate) {
        continue;
      }

      if (candidate.bref_id) {
        withBref.push(candidate);
      } else {
        withoutBref.push(candidate);
      }
    }
  }

  const candidatesByKey = new Map();

  for (const candidate of withBref) {
    const key = candidate.bref_id;
    const existing = candidatesByKey.get(key);

    if (existing) {
      mergeCandidate(existing, candidate);
    } else {
      candidatesByKey.set(key, { ...candidate });
    }
  }

  const candidatesByNbaStatsId = new Map();

  for (const candidate of candidatesByKey.values()) {
    if (!candidate.nba_stats_id) {
      continue;
    }

    const group = candidatesByNbaStatsId.get(candidate.nba_stats_id) || [];
    group.push(candidate);
    candidatesByNbaStatsId.set(candidate.nba_stats_id, group);
  }

  const fallbackCandidates = [];
  const ambiguousNbaIdMatches = [];

  for (const candidate of withoutBref) {
    const nbaMatches = candidate.nba_stats_id ? candidatesByNbaStatsId.get(candidate.nba_stats_id) || [] : [];

    if (nbaMatches.length === 1) {
      mergeCandidate(nbaMatches[0], candidate);
      continue;
    }

    if (nbaMatches.length > 1) {
      ambiguousNbaIdMatches.push({
        candidates: nbaMatches.map((match) => `${match.player} (${match.bref_id})`),
        nba_stats_id: candidate.nba_stats_id,
        player: candidate.player,
      });
      continue;
    }

    fallbackCandidates.push(candidate);
  }

  const fallbackGroups = new Map();

  for (const candidate of fallbackCandidates) {
    const group = fallbackGroups.get(candidate.slug) || [];
    group.push(candidate);
    fallbackGroups.set(candidate.slug, group);
  }

  const ambiguousSlugGroups = [];

  for (const [slug, group] of fallbackGroups.entries()) {
    if (group.length > 1) {
      ambiguousSlugGroups.push({
        players: group.map((candidate) => ({
          nba_stats_id: candidate.nba_stats_id,
          player: candidate.player,
          sourceIds: candidate.sourceIds,
        })),
        slug,
      });
    }

    for (const candidate of group) {
      const key = group.length === 1 ? slug : fallbackCollisionKey(candidate);
      const existing = candidatesByKey.get(key);

      if (existing) {
        mergeCandidate(existing, candidate);
      } else {
        candidatesByKey.set(key, { ...candidate });
      }
    }
  }

  return {
    ambiguousNbaIdMatches,
    ambiguousSlugGroups,
    players: Array.from(candidatesByKey.entries()).map(([key, candidate]) => ({ ...candidate, key })),
    skippedSources,
    sourceRows: {
      withBref: withBref.length,
      withoutBref: withoutBref.length,
    },
  };
}

function fallbackCollisionKey(candidate) {
  if (candidate.nba_stats_id) {
    return `${candidate.slug}-nba-${candidate.nba_stats_id}`;
  }

  const sourceId = normalizePlayerImageSlug(candidate.sourceIds[0]);

  return sourceId ? `${candidate.slug}-${sourceId}` : candidate.slug;
}

function goatRankingsFromSource(payload) {
  if (!payload || !Array.isArray(payload.rankings)) {
    return new Map();
  }

  return new Map(
    payload.rankings
      .map((ranking) => {
        const brefId = stringOrNull(ranking?.bref_id)?.toLowerCase();
        const rank = numberOrNull(ranking?.rank);
        const mediaScore = finiteNumberOrNull(ranking?.media_score);
        const player = stringOrNull(ranking?.player);

        if (!brefId || !player || !rank || mediaScore === null) {
          return null;
        }

        return [
          brefId,
          {
            media_score: mediaScore,
            player,
            rank,
          },
        ];
      })
      .filter(Boolean),
  );
}

function imageUrlOverrideFromEntry(entry) {
  return stringOrNull(entry?.imageUrlOverride) || stringOrNull(entry?.imageUrl);
}

function imageProviderFromEntry(entry) {
  return stringOrNull(entry?.imageProvider);
}

function nbaStatsIdFromEntry(entry) {
  return numberOrNull(entry?.nba_stats_id ?? entry?.nbaStatsId);
}

function sourceFromEntry(entry) {
  return stringOrNull(entry?.source);
}

function mergeEntryPreservingMappings(base = {}, incoming = {}) {
  const merged = { ...base, ...incoming };
  const baseOverride = imageUrlOverrideFromEntry(base);
  const incomingOverride = imageUrlOverrideFromEntry(incoming);
  const baseNbaStatsId = nbaStatsIdFromEntry(base);
  const incomingNbaStatsId = nbaStatsIdFromEntry(incoming);
  const baseProvider = imageProviderFromEntry(base);
  const incomingProvider = imageProviderFromEntry(incoming);
  const baseSource = sourceFromEntry(base);
  const incomingSource = sourceFromEntry(incoming);

  if (!incomingOverride && baseOverride) {
    merged.imageUrlOverride = baseOverride;
  }

  if (!incomingNbaStatsId && baseNbaStatsId) {
    merged.nba_stats_id = baseNbaStatsId;
  }

  if (!incomingProvider && baseProvider) {
    merged.imageProvider = baseProvider;
  }

  if (!incomingSource && baseSource) {
    merged.source = baseSource;
  }

  return merged;
}

function mergeExistingMaps(primaryMap = {}, mirrorMap = {}) {
  const merged = {};

  for (const [key, entry] of Object.entries(mirrorMap)) {
    merged[key.toLowerCase()] = entry;
  }

  for (const [key, entry] of Object.entries(primaryMap)) {
    const normalizedKey = key.toLowerCase();
    merged[normalizedKey] = mergeEntryPreservingMappings(merged[normalizedKey], entry);
  }

  return merged;
}

function buildExistingIndexes(existingMap) {
  const byBrefId = new Map();
  const byNbaStatsId = new Map();
  const slugGroups = new Map();

  for (const [key, entry] of Object.entries(existingMap)) {
    const normalizedKey = key.toLowerCase();
    const brefId = stringOrNull(entry?.bref_id)?.toLowerCase();
    const nbaStatsId = nbaStatsIdFromEntry(entry);
    const slug = stringOrNull(entry?.slug);

    if (brefId && !byBrefId.has(brefId)) {
      byBrefId.set(brefId, { entry, key: normalizedKey });
    }

    if (nbaStatsId) {
      const group = byNbaStatsId.get(nbaStatsId) || [];
      group.push({ entry, key: normalizedKey });
      byNbaStatsId.set(nbaStatsId, group);
    }

    if (slug) {
      const group = slugGroups.get(slug) || [];
      group.push({ entry, key: normalizedKey });
      slugGroups.set(slug, group);
    }
  }

  return {
    byBrefId,
    byNbaStatsId: uniqueIndex(byNbaStatsId),
    bySlug: uniqueIndex(slugGroups),
  };
}

function uniqueIndex(groupedIndex) {
  const index = new Map();

  for (const [key, group] of groupedIndex.entries()) {
    if (group.length === 1) {
      index.set(key, group[0]);
    }
  }

  return index;
}

function findExistingEntry(candidate, existingMap, indexes, ambiguousProjectSlugs) {
  const direct = existingMap[candidate.key.toLowerCase()];

  if (direct) {
    return {
      entry: direct,
      key: candidate.key.toLowerCase(),
    };
  }

  if (candidate.bref_id && indexes.byBrefId.has(candidate.bref_id)) {
    return indexes.byBrefId.get(candidate.bref_id);
  }

  if (candidate.nba_stats_id && indexes.byNbaStatsId.has(candidate.nba_stats_id)) {
    return indexes.byNbaStatsId.get(candidate.nba_stats_id);
  }

  if (ambiguousProjectSlugs.has(candidate.slug)) {
    return null;
  }

  return indexes.bySlug.get(candidate.slug) || null;
}

function createImageMapEntry(candidate, existingEntry, goatRanking) {
  const imageUrlOverride = imageUrlOverrideFromEntry(existingEntry);
  const existingNbaStatsId = nbaStatsIdFromEntry(existingEntry);
  const nbaStatsId = existingNbaStatsId || candidate.nba_stats_id || null;
  const imageProvider = imageProviderFromEntry(existingEntry) || (nbaStatsId ? "nba-cdn" : null);
  const hasImageMapping = Boolean(imageUrlOverride || (imageProvider === "nba-cdn" && nbaStatsId));
  const source = sourceFromEntry(existingEntry) || (hasImageMapping ? candidate.sources[0] : "unmapped");
  const entry = {
    ...extraEntryFields(existingEntry),
    player: candidate.player,
    slug: candidate.slug,
    bref_id: candidate.bref_id,
    nba_stats_id: nbaStatsId,
    imageProvider,
    imageUrlOverride,
    source,
  };

  const existingRank = numberOrNull(existingEntry?.rank);
  const existingMediaScore = finiteNumberOrNull(existingEntry?.media_score);

  if (goatRanking) {
    entry.rank = goatRanking.rank;
    entry.media_score = goatRanking.media_score;
  } else {
    if (existingRank) {
      entry.rank = existingRank;
    }

    if (existingMediaScore !== null) {
      entry.media_score = existingMediaScore;
    }
  }

  return entry;
}

function extraEntryFields(entry = {}) {
  const knownFields = new Set([
    "bref_id",
    "imageProvider",
    "imageUrl",
    "imageUrlOverride",
    "media_score",
    "nbaStatsId",
    "nba_stats_id",
    "player",
    "rank",
    "slug",
    "source",
  ]);
  const extras = {};

  for (const [key, value] of Object.entries(entry)) {
    if (!knownFields.has(key)) {
      extras[key] = value;
    }
  }

  return extras;
}

function normalizeOrphanEntry(entry = {}) {
  const player = stringOrNull(entry.player) || stringOrNull(entry.name) || "Unknown Player";
  const slug = stringOrNull(entry.slug) || normalizePlayerImageSlug(player);
  const nbaStatsId = nbaStatsIdFromEntry(entry);
  const imageProvider = imageProviderFromEntry(entry) || (nbaStatsId ? "nba-cdn" : null);

  return {
    ...extraEntryFields(entry),
    player,
    slug,
    bref_id: stringOrNull(entry.bref_id)?.toLowerCase() || null,
    nba_stats_id: nbaStatsId,
    imageProvider,
    imageUrlOverride: imageUrlOverrideFromEntry(entry),
    source: sourceFromEntry(entry) || "manual",
    ...(numberOrNull(entry.rank) ? { rank: numberOrNull(entry.rank) } : {}),
    ...(finiteNumberOrNull(entry.media_score) !== null ? { media_score: finiteNumberOrNull(entry.media_score) } : {}),
  };
}

function buildUpdatedImageMap({ existingMap, goatRankings, players }) {
  const indexes = buildExistingIndexes(existingMap);
  const ambiguousProjectSlugs = projectSlugsUsedMoreThanOnce(players);
  const map = {};
  const stats = {
    existingMappingsPreserved: 0,
    newEntriesAdded: 0,
    orphanExistingEntriesPreserved: 0,
    top100Enriched: 0,
    usedExistingKeys: new Set(),
  };

  for (const candidate of players) {
    const existingMatch = findExistingEntry(candidate, existingMap, indexes, ambiguousProjectSlugs);
    const existingEntry = existingMatch?.entry || {};
    const key = candidate.key.toLowerCase();
    const goatRanking = candidate.bref_id ? goatRankings.get(candidate.bref_id) : null;

    map[key] = createImageMapEntry(candidate, existingEntry, goatRanking);

    if (existingMatch) {
      stats.existingMappingsPreserved += 1;
      stats.usedExistingKeys.add(existingMatch.key);
    } else {
      stats.newEntriesAdded += 1;
    }

    if (goatRanking) {
      stats.top100Enriched += 1;
    }
  }

  for (const [key, entry] of Object.entries(existingMap)) {
    const normalizedKey = key.toLowerCase();

    if (map[normalizedKey] || stats.usedExistingKeys.has(normalizedKey)) {
      continue;
    }

    map[normalizedKey] = normalizeOrphanEntry(entry);
    stats.orphanExistingEntriesPreserved += 1;
  }

  return {
    imageMap: sortImageMap(map),
    stats,
  };
}

function projectSlugsUsedMoreThanOnce(players) {
  const counts = new Map();

  for (const player of players) {
    counts.set(player.slug, (counts.get(player.slug) || 0) + 1);
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug),
  );
}

function sortImageMap(map) {
  const entries = Object.entries(map);

  entries.sort(([firstKey, firstEntry], [secondKey, secondEntry]) => {
    const firstRank = numberOrNull(firstEntry.rank);
    const secondRank = numberOrNull(secondEntry.rank);

    if (firstRank && secondRank && firstRank !== secondRank) {
      return firstRank - secondRank;
    }

    if (firstRank && !secondRank) {
      return -1;
    }

    if (!firstRank && secondRank) {
      return 1;
    }

    return `${firstEntry.player} ${firstKey}`.localeCompare(`${secondEntry.player} ${secondKey}`);
  });

  return Object.fromEntries(entries);
}

function countMapStats(imageMap, ambiguousSlugGroups, ambiguousNbaIdMatches) {
  const entries = Object.values(imageMap);
  const nbaCdnMapped = entries.filter(
    (entry) => entry?.imageProvider === "nba-cdn" && nbaStatsIdFromEntry(entry),
  ).length;
  const imageOverrideMapped = entries.filter((entry) => Boolean(imageUrlOverrideFromEntry(entry))).length;
  const unmappedFallbackPlayers = entries.filter(
    (entry) => !imageUrlOverrideFromEntry(entry) && !(entry?.imageProvider === "nba-cdn" && nbaStatsIdFromEntry(entry)),
  ).length;
  const missingBrefId = entries.filter((entry) => !stringOrNull(entry?.bref_id)).length;
  const missingNbaStatsId = entries.filter((entry) => !nbaStatsIdFromEntry(entry)).length;

  return {
    ambiguousMatches: ambiguousSlugGroups.length + ambiguousNbaIdMatches.length,
    imageOverrideMapped,
    missingBrefId,
    missingNbaStatsId,
    nbaCdnMapped,
    totalMapEntries: entries.length,
    unmappedFallbackPlayers,
  };
}

function stringifyMap(imageMap) {
  return `${JSON.stringify(imageMap, null, 2)}\n`;
}

function isMapUpToDate(filePath, imageMap) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  return fs.readFileSync(filePath, "utf8") === stringifyMap(imageMap);
}

function printSummary(summary) {
  console.log("Player image map updated.");
  console.log(`Total players found: ${summary.totalPlayersFound}`);
  console.log(`Total map entries: ${summary.totalMapEntries}`);
  console.log(`Existing mappings preserved: ${summary.existingMappingsPreserved}`);
  console.log(`New entries added: ${summary.newEntriesAdded}`);
  console.log(`Orphan existing entries preserved: ${summary.orphanExistingEntriesPreserved}`);
  console.log(`Top 100 enriched: ${summary.top100Enriched}`);
  console.log(`NBA CDN mapped: ${summary.nbaCdnMapped}`);
  console.log(`Image overrides mapped: ${summary.imageOverrideMapped}`);
  console.log(`Unmapped fallback players: ${summary.unmappedFallbackPlayers}`);
  console.log(`Missing NBA Stats IDs: ${summary.missingNbaStatsId}`);
  console.log(`Missing bref_id: ${summary.missingBrefId}`);
  console.log(`Ambiguous matches: ${summary.ambiguousMatches}`);

  if (summary.ambiguousSlugGroups.length) {
    console.log("Ambiguous name-only slug groups:");
    for (const group of summary.ambiguousSlugGroups.slice(0, 10)) {
      console.log(`- ${group.slug}: ${group.players.map((player) => player.nba_stats_id || "?").join(", ")}`);
    }
  }

  if (summary.ambiguousNbaIdMatches.length) {
    console.log("Ambiguous NBA Stats ID matches skipped:");
    for (const match of summary.ambiguousNbaIdMatches.slice(0, 10)) {
      console.log(`- ${match.player} (${match.nba_stats_id}): ${match.candidates.join("; ")}`);
    }
  }

  if (summary.skippedSources.length) {
    console.log("Skipped missing/non-array player sources:");
    for (const filePath of summary.skippedSources) {
      console.log(`- ${filePath}`);
    }
  }
}

function buildAllPlayerImageMap() {
  const playerLoad = loadProjectPlayers();
  const goatRankings = goatRankingsFromSource(readJsonIfExists(GOAT_RANKINGS_PATH));
  const existingMap = mergeExistingMaps(
    readJsonIfExists(PLAYER_IMAGE_MAP_PATH) || {},
    readJsonIfExists(FRONTEND_PLAYER_IMAGE_MAP_PATH) || {},
  );
  const { imageMap, stats } = buildUpdatedImageMap({
    existingMap,
    goatRankings,
    players: playerLoad.players,
  });
  const mapStats = countMapStats(imageMap, playerLoad.ambiguousSlugGroups, playerLoad.ambiguousNbaIdMatches);

  return {
    imageMap,
    summary: {
      ...mapStats,
      ambiguousNbaIdMatches: playerLoad.ambiguousNbaIdMatches,
      ambiguousSlugGroups: playerLoad.ambiguousSlugGroups,
      existingMappingsPreserved: stats.existingMappingsPreserved,
      newEntriesAdded: stats.newEntriesAdded,
      orphanExistingEntriesPreserved: stats.orphanExistingEntriesPreserved,
      skippedSources: playerLoad.skippedSources,
      sourceRows: playerLoad.sourceRows,
      top100Enriched: stats.top100Enriched,
      totalPlayersFound: playerLoad.players.length,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { imageMap, summary } = buildAllPlayerImageMap();

  if (options.write) {
    writeJson(PLAYER_IMAGE_MAP_PATH, imageMap);
    console.log(`Wrote ${summary.totalMapEntries} player image entries to ${PLAYER_IMAGE_MAP_PATH}`);

    if (fs.existsSync(FRONTEND_ROOT_DIR)) {
      writeJson(FRONTEND_PLAYER_IMAGE_MAP_PATH, imageMap);
      console.log(`Mirrored player image entries to ${FRONTEND_PLAYER_IMAGE_MAP_PATH}`);
    }
  }

  const serverUpToDate = isMapUpToDate(PLAYER_IMAGE_MAP_PATH, imageMap);
  const frontendUpToDate = !fs.existsSync(FRONTEND_ROOT_DIR) || isMapUpToDate(FRONTEND_PLAYER_IMAGE_MAP_PATH, imageMap);

  printSummary(summary);

  if (serverUpToDate && frontendUpToDate) {
    console.log("Player image map files are up to date.");
  } else if (!options.write) {
    console.log("Player image map files need updates. Run this script with --write.");

    if (options.strict) {
      process.exitCode = 1;
    }
  }

  return { imageMap, summary };
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAllPlayerImageMap,
  main,
  normalizePlayerImageSlug,
};
