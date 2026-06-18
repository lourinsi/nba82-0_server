const { eraSortValue, seasonEndYear, seasonEra } = require("./seasonEras");

const CURRENT_NBA_TEAMS = [
  "ATL",
  "BKN",
  "BOS",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHX",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
];

const CURRENT_TEAM_SET = new Set(CURRENT_NBA_TEAMS);

const HISTORICAL_TEAM_TO_CURRENT = {
  BAL: "WAS",
  BLT: "WAS",
  BRK: "BKN",
  BUF: "LAC",
  CAP: "WAS",
  CHH: "CHA",
  CHP: "WAS",
  CHZ: "WAS",
  CIN: "SAC",
  DN: "DEN",
  FTW: "DET",
  GOS: "GSW",
  KCK: "SAC",
  KCO: "SAC",
  KCS: "SAC",
  MIH: "ATL",
  MLH: "ATL",
  MNL: "LAL",
  NJN: "BKN",
  NO: "NOP",
  NOH: "NOP",
  NOJ: "UTA",
  NOK: "NOP",
  NYN: "BKN",
  PHL: "PHI",
  PHO: "PHX",
  PHW: "GSW",
  ROC: "SAC",
  SAN: "SAS",
  SDC: "LAC",
  SDR: "HOU",
  SEA: "OKC",
  SFW: "GSW",
  STL: "ATL",
  SYR: "PHI",
  TCB: "ATL",
  UTH: "UTA",
  VAN: "MEM",
  WSB: "WAS",
};

const TEAM_NAME_TO_ABBREVIATION = {
  "Anderson Packers": "AND",
  "Atlanta Hawks": "ATL",
  "Baltimore Bullets": "BAL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Buffalo Braves": "BUF",
  "Capital Bullets": "CAP",
  "Charlotte Bobcats": "CHA",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Chicago Stags": "CHS",
  "Cincinnati Royals": "CIN",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Fort Wayne Pistons": "FTW",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Indianapolis Olympians": "INO",
  "Kansas City Kings": "KCK",
  "Kansas City-Omaha Kings": "KCO",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Hawks": "MIH",
  "Milwaukee Bucks": "MIL",
  "Minneapolis Lakers": "MNL",
  "Minnesota Timberwolves": "MIN",
  "New Jersey Nets": "NJN",
  "New Orleans Hornets": "NOH",
  "New Orleans Jazz": "NOJ",
  "New Orleans Pelicans": "NOP",
  "New Orleans/Oklahoma City Hornets": "NOK",
  "New Orleans/Okla. City Hornets": "NOK",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Philadelphia Warriors": "PHW",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Rochester Royals": "ROC",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "San Diego Clippers": "SDC",
  "San Diego Rockets": "SDR",
  "San Francisco Warriors": "SFW",
  "Seattle SuperSonics": "SEA",
  "St. Louis Bombers": "SLB",
  "St. Louis Hawks": "STL",
  "Syracuse Nationals": "SYR",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Vancouver Grizzlies": "VAN",
  "Washington Bullets": "WSB",
  "Washington Capitols": "CHZ",
  "Washington Wizards": "WAS",
};

const MIAMI_HEAT_FIRST_SEASON_END_YEAR = 1989;
const SAN_DIEGO_CLIPPERS_FIRST_SEASON_END_YEAR = 1979;

function normalizedRawTeamCode(team) {
  return String(team || "").trim().toUpperCase();
}

function eraStartYear(era) {
  const decade = Number(String(era || "").slice(0, 2));

  if (Number.isNaN(decade)) {
    return null;
  }

  return decade >= 40 ? 1900 + decade : 2000 + decade;
}

function normalizeTeamCode(team) {
  const rawTeam = normalizedRawTeamCode(team);

  if (CURRENT_TEAM_SET.has(rawTeam)) {
    return rawTeam;
  }

  return HISTORICAL_TEAM_TO_CURRENT[rawTeam] || null;
}

function normalizeTeamCodeForSeason(team, season) {
  const rawTeam = normalizedRawTeamCode(team);
  const endYear = seasonEndYear(season);

  if (rawTeam === "MIA" && endYear && endYear < MIAMI_HEAT_FIRST_SEASON_END_YEAR) {
    return "ATL";
  }

  if (rawTeam === "SDC" && endYear && endYear < SAN_DIEGO_CLIPPERS_FIRST_SEASON_END_YEAR) {
    return "HOU";
  }

  return normalizeTeamCode(rawTeam);
}

function normalizeTeamCodeForEra(team, era) {
  const rawTeam = normalizedRawTeamCode(team);
  const startYear = eraStartYear(era);

  if (rawTeam === "MIA" && startYear && startYear < 1980) {
    return "ATL";
  }

  if (rawTeam === "SDC" && startYear && startYear < 1970) {
    return "HOU";
  }

  return normalizeTeamCode(rawTeam);
}

function normalizeTeamName(teamName, season) {
  const direct = normalizeTeamCodeForSeason(teamName, season);

  if (direct) {
    return direct;
  }

  return normalizeTeamCodeForSeason(TEAM_NAME_TO_ABBREVIATION[String(teamName || "").trim()], season);
}

function normalizeTeamList(teams = []) {
  return Array.from(new Set(teams.map(normalizeTeamCode).filter(Boolean))).sort();
}

function normalizeTeamEras(teamEras = []) {
  const seen = new Set();
  const normalized = [];

  for (const teamEra of teamEras) {
    const team = normalizeTeamCodeForEra(teamEra?.team, teamEra?.era);
    const era = teamEra?.era;

    if (!team || !era) {
      continue;
    }

    const key = `${team}:${era}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ ...teamEra, team, era });
  }

  return normalized.sort((a, b) => `${a.team}:${a.era}`.localeCompare(`${b.team}:${b.era}`));
}

function normalizeCareerSeasons(careerSeasons = []) {
  return careerSeasons
    .map((season) => {
      const team = normalizeTeamCodeForSeason(season?.team, season?.season);
      const era = seasonEra(season?.season) || season?.era;

      return team ? { ...season, team, era } : null;
    })
    .filter(Boolean);
}

function teamErasFromCareerSeasons(careerSeasons = []) {
  return normalizeTeamEras(
    careerSeasons
      .map((season) => ({ team: season?.team, era: season?.era }))
      .filter((season) => season.team && season.era),
  );
}

function teamErasFromAwards(awardsRaw = []) {
  return normalizeTeamEras(
    awardsRaw
      .map((award) => ({
        team: normalizeTeamName(award?.team, award?.season),
        era: seasonEra(award?.season),
      }))
      .filter((award) => award.team && award.era),
  );
}

function normalizeEraList(eras = [], careerSeasons = [], awardsRaw = []) {
  const careerEras = careerSeasons.map((season) => season?.era).filter(Boolean);
  const awardEras = awardsRaw.map((award) => seasonEra(award?.season)).filter(Boolean);
  const sourceEras = careerEras.length ? careerEras : awardEras.length ? awardEras : eras;

  return Array.from(new Set(sourceEras.filter(Boolean))).sort((a, b) => eraSortValue(a) - eraSortValue(b));
}

function mergeAwardCounts(first = {}, second = {}) {
  const merged = { ...first };

  for (const [key, value] of Object.entries(second || {})) {
    merged[key] = Number(merged[key] || 0) + Number(value || 0);
  }

  return merged;
}

function mergeClassicAccolades(first = {}, second = {}) {
  const merged = { ...first };

  for (const [key, value] of Object.entries(second || {})) {
    if (key === "award_counts") {
      merged.award_counts = mergeAwardCounts(merged.award_counts, value);
    } else if (typeof value === "boolean") {
      merged[key] = Boolean(merged[key] || value);
    } else if (typeof value === "number") {
      merged[key] = Number(merged[key] || 0) + value;
    } else if (merged[key] === undefined || merged[key] === null) {
      merged[key] = value;
    }
  }

  return merged;
}

function normalizeClassicPointsByTeamEra(classicPointsByTeamEra = []) {
  const blocksByKey = new Map();

  for (const block of classicPointsByTeamEra || []) {
    const awardTeams = Array.from(
      new Set(
        (block?.award_rows || [])
          .map((award) => normalizeTeamName(award?.team, award?.season))
          .filter(Boolean),
      ),
    );
    const team = awardTeams.length === 1 ? awardTeams[0] : normalizeTeamCodeForEra(block?.team, block?.era);
    const era = block?.era;

    if (!team || !era) {
      continue;
    }

    const key = `${team}:${era}`;
    const normalizedBlock = { ...block, team, era };
    const existingBlock = blocksByKey.get(key);

    if (!existingBlock) {
      blocksByKey.set(key, normalizedBlock);
      continue;
    }

    blocksByKey.set(key, {
      ...existingBlock,
      points: Number(existingBlock.points || 0) + Number(normalizedBlock.points || 0),
      accolades: mergeClassicAccolades(existingBlock.accolades, normalizedBlock.accolades),
      award_rows: [
        ...(existingBlock.award_rows || []),
        ...(normalizedBlock.award_rows || []),
      ],
    });
  }

  return Array.from(blocksByKey.values()).sort(
    (a, b) => a.team.localeCompare(b.team) || eraSortValue(a.era) - eraSortValue(b.era),
  );
}

function normalizePlayerTeams(player) {
  const careerSeasons = normalizeCareerSeasons(player.career_seasons);
  const careerTeamEras = teamErasFromCareerSeasons(careerSeasons);
  const awardTeamEras = teamErasFromAwards(player.awards_raw);
  const teamEras = careerTeamEras.length ? careerTeamEras : awardTeamEras.length ? awardTeamEras : normalizeTeamEras(player.team_eras);
  const teamSource = teamEras.length ? teamEras.map((teamEra) => teamEra.team) : player.teams;

  return {
    ...player,
    current_team: normalizeTeamCode(player.current_team),
    teams: normalizeTeamList(teamSource),
    eras: normalizeEraList(player.eras, careerSeasons, player.awards_raw),
    team_eras: teamEras,
    career_seasons: careerSeasons,
    classic_points_by_team_era: Array.isArray(player.classic_points_by_team_era)
      ? normalizeClassicPointsByTeamEra(player.classic_points_by_team_era)
      : player.classic_points_by_team_era,
  };
}

module.exports = {
  CURRENT_NBA_TEAMS,
  TEAM_NAME_TO_ABBREVIATION,
  normalizeTeamCodeForEra,
  normalizeTeamCodeForSeason,
  normalizeClassicPointsByTeamEra,
  normalizePlayerTeams,
  normalizeTeamCode,
  normalizeTeamEras,
  normalizeTeamName,
  normalizeTeamList,
};
