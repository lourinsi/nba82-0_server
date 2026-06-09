const { calculateLegacyPoints } = require("./legacyPoints");
const { normalizeTeamCode, normalizeTeamName } = require("./teamFranchises");
const { decadeLabelFromYear, eraSortValue, seasonEndYear, seasonEra } = require("./seasonEras");

const STAT_TITLE_DESCRIPTIONS = {
  scoring_titles: "NBA Scoring Title",
  assist_titles: "NBA Assist Title",
  rebound_titles: "NBA Rebound Title",
  steal_titles: "NBA Steal Title",
  block_titles: "NBA Block Title",
};

function createEmptyClassicAccolades() {
  return {
    mvp_count: 0,
    finals_mvp_count: 0,
    dpoy_count: 0,
    roy_won: false,
    championship_rings: 0,
    most_improved: 0,
    "6moy": 0,
    olympic_gold_medals: 0,
    olympic_silver_medals: 0,
    olympic_bronze_medals: 0,
    top_3_mvp: 0,
    top_10_mvp: 0,
    top_3_dpoy: 0,
    all_nba_1st: 0,
    all_nba_2nd: 0,
    all_nba_3rd: 0,
    all_def_1st: 0,
    all_def_2nd: 0,
    all_rookie_1st: 0,
    all_rookie_2nd: 0,
    all_star_selections: 0,
    all_star_mvp_count: 0,
    seasons_played: 0,
    scoring_titles: 0,
    assist_titles: 0,
    rebound_titles: 0,
    steal_titles: 0,
    block_titles: 0,
    award_counts: {},
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeTeamNumber(value) {
  const normalized = String(value || "").trim();
  return normalized ? Number(normalized) : null;
}

function isOfficialMvpDescription(description) {
  const normalized = normalizeText(description);

  return (
    normalized.includes("nba most valuable player") &&
    !normalized.includes("finals") &&
    !normalized.includes("all-star") &&
    !normalized.includes("cup") &&
    !normalized.includes("in-season tournament") &&
    !normalized.includes("sporting news") &&
    !normalized.includes("voting") &&
    !normalized.includes("ladder")
  );
}

function isOfficialMvpVotingDescription(description) {
  const normalized = normalizeText(description);

  return (
    normalized.includes("nba most valuable player") &&
    normalized.includes("voting") &&
    !normalized.includes("finals") &&
    !normalized.includes("all-star") &&
    !normalized.includes("cup") &&
    !normalized.includes("in-season tournament") &&
    !normalized.includes("sporting news") &&
    !normalized.includes("ladder")
  );
}

function isConferenceFinalsMvpDescription(description) {
  return /\b(eastern|western)\s+conference\s+finals\b/.test(normalizeText(description));
}

function isNbaFinalsMvpDescription(description) {
  const normalized = normalizeText(description);

  return (
    normalized.includes("most valuable player") &&
    !isConferenceFinalsMvpDescription(normalized) &&
    (/\bnba finals\b/.test(normalized) || normalized.includes("bill russell"))
  );
}

function addAwardCount(accolades, rawDescription) {
  if (!rawDescription) {
    return;
  }

  accolades.award_counts[rawDescription] = (accolades.award_counts[rawDescription] || 0) + 1;
}

function applyAwardToAccolades(accolades, award) {
  const description = normalizeText(award?.description);
  const rawDescription = award?.description || null;
  const teamNumber = normalizeTeamNumber(award?.all_nba_team_number);

  addAwardCount(accolades, rawDescription);

  if (!description) {
    return;
  }

  if (isNbaFinalsMvpDescription(description)) {
    accolades.finals_mvp_count += 1;
  } else if (description.includes("all-star") && description.includes("most valuable player")) {
    accolades.all_star_mvp_count += 1;
  } else if (isOfficialMvpDescription(description)) {
    accolades.mvp_count += 1;
    accolades.top_3_mvp += 1;
    accolades.top_10_mvp += 1;
  } else if (description.includes("defensive player of the year") && !description.includes("voting")) {
    accolades.dpoy_count += 1;
    accolades.top_3_dpoy += 1;
  } else if (description.includes("most improved player")) {
    accolades.most_improved += 1;
  } else if (description.includes("sixth man of the year")) {
    accolades["6moy"] += 1;
  } else if (description.includes("rookie of the year")) {
    accolades.roy_won = true;
  } else if (description.includes("nba champion")) {
    accolades.championship_rings += 1;
  } else if (description.includes("olympic gold medal")) {
    accolades.olympic_gold_medals += 1;
  } else if (description.includes("olympic silver medal")) {
    accolades.olympic_silver_medals += 1;
  } else if (description.includes("olympic bronze medal")) {
    accolades.olympic_bronze_medals += 1;
  } else if (description.includes("nba all-star")) {
    accolades.all_star_selections += 1;
  } else if (description.includes("all-nba")) {
    if (teamNumber === 1) accolades.all_nba_1st += 1;
    if (teamNumber === 2) accolades.all_nba_2nd += 1;
    if (teamNumber === 3) accolades.all_nba_3rd += 1;
  } else if (description.includes("all-defensive team")) {
    if (teamNumber === 1) accolades.all_def_1st += 1;
    if (teamNumber === 2) accolades.all_def_2nd += 1;
  } else if (description.includes("all-rookie team")) {
    if (teamNumber === 1) accolades.all_rookie_1st += 1;
    if (teamNumber === 2) accolades.all_rookie_2nd += 1;
  } else if (/(scoring title|scoring leader|points leader|points champion)/.test(description)) {
    accolades.scoring_titles += 1;
  } else if (/(assist title|assist leader|assists leader|assists champion)/.test(description)) {
    accolades.assist_titles += 1;
  } else if (/(rebound title|rebounding title|rebound leader|rebounds leader|rebounds champion)/.test(description)) {
    accolades.rebound_titles += 1;
  } else if (/(steal title|steals leader|steals champion)/.test(description)) {
    accolades.steal_titles += 1;
  } else if (/(block title|blocks leader|blocks champion)/.test(description)) {
    accolades.block_titles += 1;
  }

  if (isOfficialMvpVotingDescription(description)) {
    if (teamNumber && teamNumber <= 3) accolades.top_3_mvp += 1;
    if (teamNumber && teamNumber <= 10) accolades.top_10_mvp += 1;
  }

  if (description.includes("defensive player of the year") && description.includes("voting") && teamNumber && teamNumber <= 3) {
    accolades.top_3_dpoy += 1;
  }
}

function teamCodesFromAwardTeam(team) {
  const rawTeam = String(team || "").trim();
  const direct = normalizeTeamName(rawTeam);

  if (direct) {
    return [direct];
  }

  return Array.from(
    new Set(
      rawTeam
        .split(/\s*-\s*/)
        .map((part) => normalizeTeamName(part))
        .filter(Boolean),
    ),
  );
}

function scopedKey(team, era) {
  return `${team}:${era}`;
}

function getOrCreateScopedRecord(records, team, era) {
  const key = scopedKey(team, era);

  if (!records.has(key)) {
    records.set(key, {
      team,
      era,
      points: 0,
      accolades: createEmptyClassicAccolades(),
      award_rows: [],
      season_keys: new Set(),
    });
  }

  return records.get(key);
}

function addSeasonContext(records, season) {
  const team = normalizeTeamCode(season?.team);
  const era = seasonEra(season?.season) || season?.era;

  if (!team || !era) {
    return;
  }

  const record = getOrCreateScopedRecord(records, team, era);
  const key = `${season?.season || ""}:${team}`;
  record.season_keys.add(key);
}

function addAwardContext(records, award) {
  const era = seasonEra(award?.season);
  const teams = teamCodesFromAwardTeam(award?.team);

  if (!era || teams.length === 0) {
    return;
  }

  for (const team of teams) {
    const record = getOrCreateScopedRecord(records, team, era);
    record.award_rows.push(award);
    applyAwardToAccolades(record.accolades, award);
  }
}

function finalizeScopedRecord(record) {
  record.accolades.seasons_played = record.season_keys.size;
  record.points = calculateLegacyPoints(record.accolades);

  return {
    team: record.team,
    era: record.era,
    points: record.points,
    accolades: record.accolades,
    award_rows: record.award_rows,
  };
}

function buildClassicPointsByTeamEra(player) {
  const records = new Map();

  for (const season of player.career_seasons || []) {
    addSeasonContext(records, season);
  }

  for (const award of player.awards_raw || []) {
    addAwardContext(records, award);
  }

  return Array.from(records.values())
    .map(finalizeScopedRecord)
    .filter((record) => record.points > 0 || record.accolades.seasons_played > 0)
    .sort((a, b) => a.team.localeCompare(b.team) || eraSortValue(a.era) - eraSortValue(b.era));
}

function applyClassicPointsToPlayers(players) {
  return players.map((player) => ({
    ...player,
    classic_points_by_team_era: buildClassicPointsByTeamEra(player),
  }));
}

module.exports = {
  STAT_TITLE_DESCRIPTIONS,
  applyAwardToAccolades,
  applyClassicPointsToPlayers,
  buildClassicPointsByTeamEra,
  createEmptyClassicAccolades,
  decadeLabelFromYear,
  isOfficialMvpVotingDescription,
  isNbaFinalsMvpDescription,
  seasonEndYear,
  seasonEra,
};
