const { eraSortValue, seasonEra } = require("./seasonEras");

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

function normalizeTeamCode(team) {
  const rawTeam = String(team || "").trim().toUpperCase();

  if (CURRENT_TEAM_SET.has(rawTeam)) {
    return rawTeam;
  }

  return HISTORICAL_TEAM_TO_CURRENT[rawTeam] || null;
}

function normalizeTeamName(teamName) {
  const direct = normalizeTeamCode(teamName);

  if (direct) {
    return direct;
  }

  return normalizeTeamCode(TEAM_NAME_TO_ABBREVIATION[String(teamName || "").trim()]);
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
        team: normalizeTeamName(award?.team),
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

function normalizePlayerTeams(player) {
  const careerSeasons = normalizeCareerSeasons(player.career_seasons);
  const careerTeamEras = teamErasFromCareerSeasons(careerSeasons);
  const awardTeamEras = teamErasFromAwards(player.awards_raw);

  return {
    ...player,
    current_team: normalizeTeamCode(player.current_team),
    teams: normalizeTeamList(player.teams),
    eras: normalizeEraList(player.eras, careerSeasons, player.awards_raw),
    team_eras: careerTeamEras.length ? careerTeamEras : awardTeamEras.length ? awardTeamEras : normalizeTeamEras(player.team_eras),
    career_seasons: careerSeasons,
  };
}

module.exports = {
  CURRENT_NBA_TEAMS,
  TEAM_NAME_TO_ABBREVIATION,
  normalizePlayerTeams,
  normalizeTeamCode,
  normalizeTeamEras,
  normalizeTeamName,
  normalizeTeamList,
};
