const {
  teamTranslationFields,
  translateTeamForSeason,
} = require("./teamFranchises");

const ABA_ACCOLADE_DEFAULTS = {
  aba_mvp_count: 0,
  aba_playoffs_mvp_count: 0,
  aba_all_league_1st: 0,
  aba_all_league_2nd: 0,
  aba_all_def_1st: 0,
  aba_all_def_2nd: 0,
  aba_all_star_selections: 0,
  aba_all_star_mvp_count: 0,
  aba_rookie_of_year_count: 0,
  aba_championship_rings: 0,
  aba_scoring_titles: 0,
  aba_assist_titles: 0,
  aba_rebound_titles: 0,
};

const ABA_ACCOLADE_KEYS = Object.keys(ABA_ACCOLADE_DEFAULTS);

const ABA_ACCOLADE_WEIGHTS = {
  aba_mvp_count: 7,
  aba_playoffs_mvp_count: 5,
  aba_all_league_1st: 6,
  aba_all_league_2nd: 4,
  aba_all_def_1st: 1.75,
  aba_all_def_2nd: 1.25,
  aba_all_star_selections: 0.8,
  aba_all_star_mvp_count: 1,
  aba_rookie_of_year_count: 1,
  aba_championship_rings: 2,
  aba_scoring_titles: 2.5,
  aba_assist_titles: 2.5,
  aba_rebound_titles: 1.75,
};

const ABA_ACCOLADE_DESCRIPTIONS = {
  aba_mvp_count: "ABA Most Valuable Player",
  aba_playoffs_mvp_count: "ABA Playoffs MVP",
  aba_all_league_1st: "All-ABA 1st Team",
  aba_all_league_2nd: "All-ABA 2nd Team",
  aba_all_def_1st: "ABA All-Defensive 1st Team",
  aba_all_def_2nd: "ABA All-Defensive 2nd Team",
  aba_all_star_selections: "ABA All-Star",
  aba_all_star_mvp_count: "ABA All-Star MVP",
  aba_rookie_of_year_count: "ABA Rookie of the Year",
  aba_championship_rings: "ABA Champion",
  aba_scoring_titles: "ABA Scoring Title",
  aba_assist_titles: "ABA Assist Title",
  aba_rebound_titles: "ABA Rebound Title",
};

const ABA_STAT_TITLE_DESCRIPTIONS = {
  aba_scoring_titles: ABA_ACCOLADE_DESCRIPTIONS.aba_scoring_titles,
  aba_assist_titles: ABA_ACCOLADE_DESCRIPTIONS.aba_assist_titles,
  aba_rebound_titles: ABA_ACCOLADE_DESCRIPTIONS.aba_rebound_titles,
};

const ABA_STAT_TITLE_CATEGORY_TO_ACCOLADE = {
  PTS: "aba_scoring_titles",
  AST: "aba_assist_titles",
  REB: "aba_rebound_titles",
};

const CANONICAL_ABA_GENERATED_ACCOLADE_KEYS = [
  "aba_mvp_count",
  "aba_playoffs_mvp_count",
  "aba_scoring_titles",
  "aba_assist_titles",
  "aba_rebound_titles",
];

const CANONICAL_ABA_GENERATED_DESCRIPTIONS = new Set(
  CANONICAL_ABA_GENERATED_ACCOLADE_KEYS.map((key) => normalizeAwardDescription(ABA_ACCOLADE_DESCRIPTIONS[key])),
);

const ABA_MVPS = [
  { season: "1967-68", player: "Connie Hawkins", bref_id: "hawkico01", team: "PTP", award: "aba_mvp_count" },
  { season: "1968-69", player: "Mel Daniels", bref_id: "danieme01", team: "INA", award: "aba_mvp_count" },
  { season: "1969-70", player: "Spencer Haywood", bref_id: "haywosp01", team: "DNR", award: "aba_mvp_count" },
  { season: "1970-71", player: "Mel Daniels", bref_id: "danieme01", team: "INA", award: "aba_mvp_count" },
  { season: "1971-72", player: "Artis Gilmore", bref_id: "gilmoar01", team: "KEN", award: "aba_mvp_count" },
  { season: "1972-73", player: "Billy Cunningham", bref_id: "cunnibi01", team: "CAR", award: "aba_mvp_count" },
  { season: "1973-74", player: "Julius Erving", bref_id: "ervinju01", team: "NYA", award: "aba_mvp_count" },
  { season: "1974-75", player: "Julius Erving", bref_id: "ervinju01", team: "NYA", award: "aba_mvp_count" },
  { season: "1974-75", player: "George McGinnis", bref_id: "mcginge01", team: "INA", award: "aba_mvp_count" },
  { season: "1975-76", player: "Julius Erving", bref_id: "ervinju01", team: "NYA", award: "aba_mvp_count" },
];

const ABA_PLAYOFFS_MVPS = [
  { season: "1967-68", year: 1968, player: "Connie Hawkins", bref_id: "hawkico01", team: "PTP", award: "aba_playoffs_mvp_count" },
  { season: "1968-69", year: 1969, player: "Warren Jabali", bref_id: "jabalwa01", team: "OAK", award: "aba_playoffs_mvp_count" },
  { season: "1969-70", year: 1970, player: "Roger Brown", bref_id: "brownro01", team: "INA", award: "aba_playoffs_mvp_count" },
  { season: "1970-71", year: 1971, player: "Zelmo Beaty", bref_id: "beatyze01", team: "UTS", award: "aba_playoffs_mvp_count" },
  { season: "1971-72", year: 1972, player: "Freddie Lewis", bref_id: "lewisfr02", team: "INA", award: "aba_playoffs_mvp_count" },
  { season: "1972-73", year: 1973, player: "George McGinnis", bref_id: "mcginge01", team: "INA", award: "aba_playoffs_mvp_count" },
  { season: "1973-74", year: 1974, player: "Julius Erving", bref_id: "ervinju01", team: "NYA", award: "aba_playoffs_mvp_count" },
  { season: "1974-75", year: 1975, player: "Artis Gilmore", bref_id: "gilmoar01", team: "KEN", award: "aba_playoffs_mvp_count" },
  { season: "1975-76", year: 1976, player: "Julius Erving", bref_id: "ervinju01", team: "NYA", award: "aba_playoffs_mvp_count" },
];

const ABA_AWARD_RECORDS = [...ABA_MVPS, ...ABA_PLAYOFFS_MVPS];

const EXPECTED_ABA_TOTALS = {
  aba_mvp_count: {
    "Julius Erving": 3,
    "Mel Daniels": 2,
    "Connie Hawkins": 1,
    "Spencer Haywood": 1,
    "Artis Gilmore": 1,
    "Billy Cunningham": 1,
    "George McGinnis": 1,
  },
  aba_playoffs_mvp_count: {
    "Julius Erving": 2,
    "Connie Hawkins": 1,
    "Warren Jabali": 1,
    "Roger Brown": 1,
    "Zelmo Beaty": 1,
    "Freddie Lewis": 1,
    "George McGinnis": 1,
    "Artis Gilmore": 1,
  },
};

function normalizeAwardDescription(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePlayerName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeTeamNumber(value) {
  const normalized = String(value || "").trim();
  return normalized ? Number(normalized) : null;
}

function applyAbaAwardToAccolades(accolades, rawDescription, rawTeamNumber = null) {
  const description = normalizeAwardDescription(rawDescription);
  const teamNumber = normalizeTeamNumber(rawTeamNumber);

  if (!description) {
    return false;
  }

  if (
    description.includes("aba playoffs mvp") ||
    description.includes("aba playoff mvp") ||
    (description.includes("aba playoffs") && description.includes("most valuable player"))
  ) {
    accolades.aba_playoffs_mvp_count += 1;
    return true;
  }

  if (
    description.includes("aba most valuable player") &&
    !description.includes("all-star") &&
    !description.includes("playoff")
  ) {
    accolades.aba_mvp_count += 1;
    return true;
  }

  if (description.includes("aba all-star") && description.includes("mvp")) {
    accolades.aba_all_star_mvp_count += 1;
    return true;
  }

  if (description.includes("aba all-star")) {
    accolades.aba_all_star_selections += 1;
    return true;
  }

  if (description.includes("aba rookie of the year")) {
    accolades.aba_rookie_of_year_count += 1;
    return true;
  }

  if (description.includes("aba champion")) {
    accolades.aba_championship_rings += 1;
    return true;
  }

  if (description.includes("aba scoring title")) {
    accolades.aba_scoring_titles += 1;
    return true;
  }

  if (description.includes("aba assist title")) {
    accolades.aba_assist_titles += 1;
    return true;
  }

  if (description.includes("aba rebound title") || description.includes("aba rebounding title")) {
    accolades.aba_rebound_titles += 1;
    return true;
  }

  if (description.includes("aba all-defensive") || description.includes("aba all-defense")) {
    if (teamNumber === 1 || description.includes("1st")) accolades.aba_all_def_1st += 1;
    if (teamNumber === 2 || description.includes("2nd")) accolades.aba_all_def_2nd += 1;
    return true;
  }

  if (description.includes("all-aba") || description.includes("aba all-league")) {
    if (teamNumber === 1 || description.includes("1st")) accolades.aba_all_league_1st += 1;
    if (teamNumber === 2 || description.includes("2nd")) accolades.aba_all_league_2nd += 1;
    return true;
  }

  return false;
}

function isCanonicalAbaGeneratedAwardRow(row) {
  return CANONICAL_ABA_GENERATED_DESCRIPTIONS.has(normalizeAwardDescription(row?.description));
}

function canonicalAbaAwardRow(record) {
  const translation = translateTeamForSeason(record.team, record.season, { sourceLeague: "ABA" });

  if (!translation.team) {
    return null;
  }

  return {
    season: record.season,
    team: translation.team,
    ...teamTranslationFields(translation, {
      original_team: record.team,
      source_league: "ABA",
    }),
    description: ABA_ACCOLADE_DESCRIPTIONS[record.award],
    all_nba_team_number: null,
  };
}

function canonicalAbaStatTitleAwardRow(row, season, accoladeKey) {
  const originalTeam = row?.original_team || row?.source_team || row?.bref_team || row?.raw_team || row?.team;
  const translation = translateTeamForSeason(originalTeam, season, { sourceLeague: "ABA" });

  if (!translation.team) {
    return null;
  }

  return {
    season,
    team: translation.team,
    ...teamTranslationFields(translation, {
      original_team: originalTeam,
      source_league: "ABA",
    }),
    description: ABA_STAT_TITLE_DESCRIPTIONS[accoladeKey],
    all_nba_team_number: null,
    player: row?.player || row?.name || null,
    bref_id: row?.bref_id || null,
  };
}

function playerKeysFromAbaRecord(record) {
  return [
    record.bref_id ? `bref:${record.bref_id}` : null,
    record.player ? `name:${normalizePlayerName(record.player)}` : null,
  ].filter(Boolean);
}

function buildCanonicalAbaAwardRowsByPlayerKey(records = ABA_AWARD_RECORDS) {
  const rowsByPlayerKey = new Map();

  for (const record of records) {
    const row = canonicalAbaAwardRow(record);

    if (!row) {
      continue;
    }

    for (const key of playerKeysFromAbaRecord(record)) {
      if (!rowsByPlayerKey.has(key)) {
        rowsByPlayerKey.set(key, []);
      }

      rowsByPlayerKey.get(key).push(row);
    }
  }

  return rowsByPlayerKey;
}

function expectedCanonicalAbaTotals(records = ABA_AWARD_RECORDS) {
  const totals = new Map();

  for (const record of records) {
    const key = `${record.award}:${record.player}`;
    totals.set(key, (totals.get(key) || 0) + 1);
  }

  return totals;
}

function validateAbaAccoladeSource(records = ABA_AWARD_RECORDS) {
  const totals = expectedCanonicalAbaTotals(records);
  const unknownTeamCodes = new Set();

  for (const record of records) {
    if (!ABA_ACCOLADE_DESCRIPTIONS[record.award]) {
      throw new Error(`Unexpected ABA accolade key for ${record.player} ${record.season}: ${record.award}`);
    }

    const translation = translateTeamForSeason(record.team, record.season, { sourceLeague: "ABA" });

    if (!translation.team) {
      unknownTeamCodes.add(record.team);
    }
  }

  for (const [award, expectedByPlayer] of Object.entries(EXPECTED_ABA_TOTALS)) {
    for (const [player, expectedTotal] of Object.entries(expectedByPlayer)) {
      const actualTotal = totals.get(`${award}:${player}`) || 0;

      if (actualTotal !== expectedTotal) {
        throw new Error(`ABA source total mismatch for ${player} ${award}: expected ${expectedTotal}, got ${actualTotal}.`);
      }
    }
  }

  return {
    awardCount: records.length,
    unknownTeamCodes: Array.from(unknownTeamCodes).sort(),
  };
}

module.exports = {
  ABA_ACCOLADE_DEFAULTS,
  ABA_ACCOLADE_DESCRIPTIONS,
  ABA_ACCOLADE_KEYS,
  ABA_ACCOLADE_WEIGHTS,
  ABA_AWARD_RECORDS,
  ABA_MVPS,
  ABA_PLAYOFFS_MVPS,
  ABA_STAT_TITLE_CATEGORY_TO_ACCOLADE,
  ABA_STAT_TITLE_DESCRIPTIONS,
  CANONICAL_ABA_GENERATED_ACCOLADE_KEYS,
  EXPECTED_ABA_TOTALS,
  applyAbaAwardToAccolades,
  buildCanonicalAbaAwardRowsByPlayerKey,
  canonicalAbaAwardRow,
  canonicalAbaStatTitleAwardRow,
  isCanonicalAbaGeneratedAwardRow,
  normalizeAwardDescription,
  normalizePlayerName,
  validateAbaAccoladeSource,
};
