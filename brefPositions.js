const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];
const VALID_POSITIONS = new Set(POSITION_ORDER);
const lookupCache = new WeakMap();

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function normalizeBrefRecord(rawRecord) {
  if (Array.isArray(rawRecord)) {
    const positions = uniquePositions(rawRecord);
    return {
      primaryPosition: positions[0] || null,
      positions,
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
      primaryPosition: primaryPosition || positions[0] || null,
      positions,
    };
  }

  const positions = positionsFromString(rawRecord);

  return {
    primaryPosition: positions[0] || null,
    positions,
  };
}

function buildBrefPositionLookup(brefPositions) {
  const lookup = new Map();

  for (const [name, rawRecord] of Object.entries(brefPositions || {})) {
    const key = normalizeName(name);
    const record = normalizeBrefRecord(rawRecord);

    if (key && record.primaryPosition && !lookup.has(key)) {
      lookup.set(key, record);
    }
  }

  return lookup;
}

function lookupForBrefPositions(brefPositions) {
  if (!brefPositions || typeof brefPositions !== "object") {
    return new Map();
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

function brefRecordForPlayer(player, lookup) {
  for (const key of nameCandidatesForPlayer(player)) {
    if (lookup.has(key)) {
      return lookup.get(key);
    }
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

module.exports = {
  applyBrefPrimaryPositions,
  mergeBrefPrimaryPosition,
};
