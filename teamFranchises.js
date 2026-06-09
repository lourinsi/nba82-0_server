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
  MIH: "MIA",
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

function normalizeTeamCode(team) {
  const rawTeam = String(team || "").trim().toUpperCase();

  if (CURRENT_TEAM_SET.has(rawTeam)) {
    return rawTeam;
  }

  return HISTORICAL_TEAM_TO_CURRENT[rawTeam] || null;
}

function normalizeTeamList(teams = []) {
  return Array.from(new Set(teams.map(normalizeTeamCode).filter(Boolean))).sort();
}

function normalizeTeamEras(teamEras = []) {
  const seen = new Set();
  const normalized = [];

  for (const teamEra of teamEras) {
    const team = normalizeTeamCode(teamEra?.team);
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
      const team = normalizeTeamCode(season?.team);

      return team ? { ...season, team } : null;
    })
    .filter(Boolean);
}

function normalizePlayerTeams(player) {
  return {
    ...player,
    current_team: normalizeTeamCode(player.current_team),
    teams: normalizeTeamList(player.teams),
    team_eras: normalizeTeamEras(player.team_eras),
    career_seasons: normalizeCareerSeasons(player.career_seasons),
  };
}

module.exports = {
  CURRENT_NBA_TEAMS,
  normalizePlayerTeams,
  normalizeTeamCode,
  normalizeTeamEras,
  normalizeTeamList,
};
