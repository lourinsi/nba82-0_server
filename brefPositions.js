const { normalizeSourceLeague, normalizeTeamCodeForSeason } = require("./teamFranchises");

const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];
const VALID_POSITIONS = new Set(POSITION_ORDER);
const lookupCache = new WeakMap();

function fixPossiblyMojibake(value) {
  const text = String(value || "");

  if (!/[\u00c2\u00c3\u00c4\u00c5]/.test(text)) {
    return text;
  }

  const fixed = Buffer.from(text, "latin1").toString("utf8");
  return fixed.includes("\uFFFD") ? text : fixed;
}

function normalizeName(value) {
  return fixPossiblyMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function nameWithoutSuffix(normalizedName) {
  const alias = String(normalizedName || "").replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
  return alias && alias !== normalizedName ? alias : "";
}

function nameWithoutMiddleInitials(normalizedName) {
  const parts = String(normalizedName || "").split(" ").filter(Boolean);

  if (parts.length < 3) {
    return "";
  }

  const alias = parts
    .filter((part, index) => index === 0 || index === parts.length - 1 || part.length !== 1)
    .join(" ");

  return alias && alias !== normalizedName ? alias : "";
}

function nameWithCompactedLeadingInitials(normalizedName) {
  const parts = String(normalizedName || "").split(" ").filter(Boolean);
  let index = 0;
  let compacted = "";

  while (index < parts.length - 1 && parts[index].length === 1) {
    compacted += parts[index];
    index += 1;
  }

  if (compacted.length < 2) {
    return "";
  }

  const alias = [compacted, ...parts.slice(index)].join(" ");
  return alias && alias !== normalizedName ? alias : "";
}

function lastNameKeyFromNormalizedName(normalizedName) {
  const withoutSuffix = nameWithoutSuffix(normalizedName) || normalizedName;
  const parts = String(withoutSuffix || "").split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function normalizePosition(value) {
  const position = String(value || "").match(/\b(PG|SG|SF|PF|C)\b/i)?.[1]?.toUpperCase();
  return VALID_POSITIONS.has(position) ? position : null;
}

function positionsFromString(value) {
  return uniquePositions(String(value || "").match(/\b(PG|SG|SF|PF|C)\b/gi) || []);
}

function uniquePositions(values) {
  const positions = [];

  for (const value of values || []) {
    const position = normalizePosition(value);

    if (position && !positions.includes(position)) {
      positions.push(position);
    }
  }

  return positions;
}

function normalizeBrefSeason(rawSeason) {
  if (!rawSeason || typeof rawSeason !== "object") {
    return null;
  }

  const season = String(rawSeason.season || "").trim();
  const team = String(rawSeason.team || "").trim().toUpperCase();
  const sourceLeague = normalizeSourceLeague(rawSeason.source_league || rawSeason.sourceLeague || rawSeason.league);

  if (!season || !team || team === "TOT") {
    return null;
  }

  return {
    season,
    team,
    sourceLeague,
    gamesPlayed: Number(rawSeason.games_played ?? rawSeason.gamesPlayed ?? rawSeason.games ?? 0) || 0,
  };
}

function normalizeBrefSeasons(rawSeasons) {
  if (!Array.isArray(rawSeasons)) {
    return [];
  }

  const seen = new Set();
  const seasons = [];

  for (const rawSeason of rawSeasons) {
    const season = normalizeBrefSeason(rawSeason);

    if (!season) {
      continue;
    }

    const key = `${season.season}:${season.team}`;

    if (!seen.has(key)) {
      seen.add(key);
      seasons.push(season);
    }
  }

  return seasons;
}

function normalizeBrefRecord(rawRecord) {
  if (Array.isArray(rawRecord)) {
    const positions = uniquePositions(rawRecord);
    return {
      name: "",
      brefId: null,
      primaryPosition: positions[0] || null,
      positions,
      seasons: [],
    };
  }

  if (rawRecord && typeof rawRecord === "object") {
    const primaryPosition = normalizePosition(
      rawRecord.primary_position || rawRecord.primaryPosition || rawRecord.position,
    );
    const positions = uniquePositions([
      ...(primaryPosition ? [primaryPosition] : []),
      ...(Array.isArray(rawRecord.positions) ? rawRecord.positions : positionsFromString(rawRecord.positions)),
    ]);

    return {
      name: fixPossiblyMojibake(rawRecord.name || rawRecord.player || rawRecord.display_name || ""),
      brefId: rawRecord.bref_id || rawRecord.brefId || rawRecord.player_id || rawRecord.playerId || null,
      primaryPosition: primaryPosition || positions[0] || null,
      positions,
      seasons: normalizeBrefSeasons(rawRecord.seasons || rawRecord.career_seasons),
    };
  }

  const positions = positionsFromString(rawRecord);

  return {
    name: "",
    brefId: null,
    primaryPosition: positions[0] || null,
    positions,
    seasons: [],
  };
}

function normalizeBrefRecordWithName(rawRecord, fallbackName) {
  const record = normalizeBrefRecord(rawRecord);

  return {
    ...record,
    name: record.name || fixPossiblyMojibake(fallbackName),
  };
}

function brefRecordEntries(brefPositions) {
  if (Array.isArray(brefPositions)) {
    return brefPositions.map((rawRecord) => [rawRecord?.name || rawRecord?.player || "", rawRecord]);
  }

  if (Array.isArray(brefPositions?.players)) {
    return brefPositions.players.map((rawRecord) => [rawRecord?.name || rawRecord?.player || "", rawRecord]);
  }

  return Object.entries(brefPositions || {}).filter(([name]) => !String(name).startsWith("_"));
}

function recordIdentity(record) {
  return record.brefId || normalizeName(record.name);
}

function addLookupRecord(lookup, key, record) {
  if (!key || !record?.primaryPosition) {
    return;
  }

  const records = lookup.get(key) || [];
  const identity = recordIdentity(record);

  if (identity && !records.some((existingRecord) => recordIdentity(existingRecord) === identity)) {
    records.push(record);
    lookup.set(key, records);
  }
}

function brefNameAliases(key) {
  return Array.from(
    new Set(
      [
        nameWithoutSuffix(key),
        nameWithoutMiddleInitials(key),
        nameWithCompactedLeadingInitials(key),
      ].filter(Boolean),
    ),
  );
}

function buildBrefPositionLookup(brefPositions) {
  const exact = new Map();
  const aliases = new Map();
  const lastNames = new Map();

  for (const [name, rawRecord] of brefRecordEntries(brefPositions)) {
    const record = normalizeBrefRecordWithName(rawRecord, name);
    const key = normalizeName(record.name);

    if (!key || !record.primaryPosition) {
      continue;
    }

    addLookupRecord(exact, key, record);
    addLookupRecord(lastNames, lastNameKeyFromNormalizedName(key), record);

    for (const alias of brefNameAliases(key)) {
      addLookupRecord(aliases, alias, record);
    }
  }

  return { aliases, exact, lastNames };
}

function lookupForBrefPositions(brefPositions) {
  if (!brefPositions || typeof brefPositions !== "object") {
    return { aliases: new Map(), exact: new Map(), lastNames: new Map() };
  }

  if (!lookupCache.has(brefPositions)) {
    lookupCache.set(brefPositions, buildBrefPositionLookup(brefPositions));
  }

  return lookupCache.get(brefPositions);
}

function nameCandidatesForPlayer(player) {
  const names = [
    player?.name,
    `${player?.first_name || ""} ${player?.last_name || ""}`.trim(),
  ];

  return Array.from(new Set(names.map(normalizeName).filter(Boolean)));
}

function playerLooseNameCandidates(player) {
  const candidates = [];

  for (const key of nameCandidatesForPlayer(player)) {
    candidates.push(nameWithoutSuffix(key));
    candidates.push(nameWithoutMiddleInitials(key));
    candidates.push(nameWithCompactedLeadingInitials(key));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function playerLastNameKeys(player) {
  const keys = [
    normalizeName(player?.last_name),
    ...nameCandidatesForPlayer(player).map(lastNameKeyFromNormalizedName),
  ];

  return Array.from(new Set(keys.filter(Boolean)));
}

function playerSeasonTeamKeys(player) {
  const keys = new Set();

  for (const rawSeason of player?.career_seasons || []) {
    const season = String(rawSeason?.season || "").trim();
    const sourceLeague = normalizeSourceLeague(rawSeason?.source_league || rawSeason?.sourceLeague || rawSeason?.league);
    const team = normalizeTeamCodeForSeason(rawSeason?.team, season, { sourceLeague });

    if (season && team) {
      keys.add(`${season}:${team}`);
    }
  }

  return keys;
}

function brefSeasonTeamKeys(record) {
  const keys = new Set();

  for (const rawSeason of record?.seasons || []) {
    const season = String(rawSeason?.season || "").trim();
    const sourceLeague = normalizeSourceLeague(rawSeason?.sourceLeague || rawSeason?.source_league || rawSeason?.league);
    const team = normalizeTeamCodeForSeason(rawSeason?.team, season, { sourceLeague });

    if (season && team) {
      keys.add(`${season}:${team}`);
    }
  }

  return keys;
}

function careerSignatureScore(player, record) {
  const playerKeys = playerSeasonTeamKeys(player);
  const brefKeys = brefSeasonTeamKeys(record);

  if (!playerKeys.size || !brefKeys.size) {
    return { strong: false, overlap: 0, ratio: 0 };
  }

  let overlap = 0;

  for (const key of brefKeys) {
    if (playerKeys.has(key)) {
      overlap += 1;
    }
  }

  const ratio = overlap / Math.min(playerKeys.size, brefKeys.size);

  return {
    strong: overlap > 0 && (overlap >= 2 || ratio >= 0.75),
    overlap,
    ratio,
  };
}

function uniqueRecords(records = []) {
  const seen = new Set();
  const unique = [];

  for (const record of records) {
    const key = recordIdentity(record);

    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(record);
    }
  }

  return unique;
}

function lookupRecordsByKeys(map, keys) {
  return keys.flatMap((key) => map.get(key) || []);
}

function bestCareerSignatureRecord(player, records = []) {
  const scored = uniqueRecords(records)
    .map((record) => ({
      record,
      score: careerSignatureScore(player, record),
    }))
    .filter(({ score }) => score.strong)
    .sort((left, right) => right.score.overlap - left.score.overlap || right.score.ratio - left.score.ratio);

  if (!scored.length) {
    return null;
  }

  const [best, second] = scored;

  if (second && best.score.overlap === second.score.overlap && best.score.ratio === second.score.ratio) {
    return null;
  }

  return best.record;
}

function resolveRecordsForPlayer(player, records, options = {}) {
  const candidates = uniqueRecords(records);

  if (!candidates.length) {
    return null;
  }

  if (candidates.length === 1 && !options.requireCareerSignature) {
    return candidates[0];
  }

  return bestCareerSignatureRecord(player, candidates);
}

function brefRecordForPlayer(player, lookup) {
  const exactNameKeys = nameCandidatesForPlayer(player);
  const exactMatch = resolveRecordsForPlayer(player, lookupRecordsByKeys(lookup.exact, exactNameKeys));

  if (exactMatch) {
    return exactMatch;
  }

  const exactAliasMatch = resolveRecordsForPlayer(player, lookupRecordsByKeys(lookup.aliases, exactNameKeys));

  if (exactAliasMatch) {
    return exactAliasMatch;
  }

  const looseNameKeys = playerLooseNameCandidates(player);
  const looseExactMatch = resolveRecordsForPlayer(player, lookupRecordsByKeys(lookup.exact, looseNameKeys), {
    requireCareerSignature: true,
  });

  if (looseExactMatch) {
    return looseExactMatch;
  }

  const looseAliasMatch = resolveRecordsForPlayer(player, lookupRecordsByKeys(lookup.aliases, looseNameKeys), {
    requireCareerSignature: true,
  });

  if (looseAliasMatch) {
    return looseAliasMatch;
  }

  const lastNameMatch = resolveRecordsForPlayer(player, lookupRecordsByKeys(lookup.lastNames, playerLastNameKeys(player)), {
    requireCareerSignature: true,
  });

  if (lastNameMatch) {
    return lastNameMatch;
  }

  return null;
}

function brefPrimaryPositionForPlayer(player, lookup) {
  return brefRecordForPlayer(player, lookup)?.primaryPosition || null;
}

function mergePositionsWithBrefRecord(fallbackPositions, brefRecord) {
  const fallback = uniquePositions(fallbackPositions);

  if (!brefRecord?.primaryPosition) {
    return fallback;
  }

  return uniquePositions([
    brefRecord.primaryPosition,
    ...fallback,
    ...brefRecord.positions,
  ]);
}

function positionsMatch(left = [], right = []) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((position, index) => position === right[index])
  );
}

function overwritePositionsWithBrefRecord(player, brefRecord) {
  if (!brefRecord?.primaryPosition || !brefRecord.positions.length) {
    return player;
  }

  const positions = uniquePositions([brefRecord.primaryPosition, ...brefRecord.positions]);

  if (positionsMatch(player.positions, positions) && player.primary_position === positions[0]) {
    return player;
  }

  return {
    ...player,
    positions,
    primary_position: positions[0],
  };
}

function mergeBrefPrimaryPosition(player, fallbackPositions, brefPositions) {
  const brefRecord = brefRecordForPlayer(player, lookupForBrefPositions(brefPositions));
  return mergePositionsWithBrefRecord(fallbackPositions, brefRecord);
}

function applyBrefPrimaryPositions(players, brefPositions) {
  const lookup = lookupForBrefPositions(brefPositions);

  return players.map((player) => {
    const positions = mergePositionsWithBrefRecord(player.positions, brefRecordForPlayer(player, lookup));

    if (!positions.length) {
      return player;
    }

    return {
      ...player,
      positions,
      primary_position: positions[0],
    };
  });
}

function applyBrefPositionOverrides(players, brefPositions) {
  const lookup = lookupForBrefPositions(brefPositions);

  return players.map((player) => overwritePositionsWithBrefRecord(player, brefRecordForPlayer(player, lookup)));
}

function summarizeBrefPositionMatches(players, brefPositions) {
  const lookup = lookupForBrefPositions(brefPositions);
  let matched = 0;
  let missing = 0;

  for (const player of players || []) {
    if (brefRecordForPlayer(player, lookup)) {
      matched += 1;
    } else {
      missing += 1;
    }
  }

  return { matched, missing };
}

module.exports = {
  applyBrefPrimaryPositions,
  applyBrefPositionOverrides,
  buildBrefPositionLookup,
  mergeBrefPrimaryPosition,
  normalizeBrefRecord,
  summarizeBrefPositionMatches,
};
