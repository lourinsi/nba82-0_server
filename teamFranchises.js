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
const ABA_TEAM_CODE = "ABA";
const ABA_TEAM_NAME = "ABA Team";
const ABA_START_END_YEAR = 1968;
const ABA_LAST_END_YEAR = 1976;

const ABA_DIRECT_TEAM_TO_CURRENT = {
  // Nets franchise
  NJA: "BKN",
  NYA: "BKN",

  // Nuggets franchise
  DNR: "DEN",
  DNA: "DEN",
  DEN: "DEN",

  // Pacers franchise
  INA: "IND",
  IND: "IND",

  // Spurs franchise
  DLC: "SAS",
  DLA: "SAS",
  DAL: "SAS",
  TEX: "SAS",
  SAA: "SAS",
  SAS: "SAS",
};

const ABA_DIRECT_UNAMBIGUOUS_CODES = new Set([
  "NJA",
  "NYA",
  "DNR",
  "DNA",
  "INA",
  "DLC",
  "DLA",
  "TEX",
  "SAA",
]);

const ABA_DIRECT_CURRENT_CODES = new Set(["DEN", "IND", "SAS"]);

const ABA_ONLY_TEAM_CODES = new Set([
  "VIR",
  "WSA",
  "OAK",
  "KEN",
  "ANA",
  "LAS",
  "UTS",
  "HSM",
  "CAR",
  "SSL",
  "NOB",
  "MMP",
  "MMT",
  "MMS",
  "PTP",
  "MNP",
  "PTC",
  "MNM",
  "MMF",
  "FLO",
  "MFL",
  "SDA",
  "SDQ",
]);

const ABA_ONLY_SOURCE_CODES = new Set([
  ...ABA_ONLY_TEAM_CODES,
  "BAL",
  "HOU",
  "MIA",
  "SDC",
  "STL",
  "UTA",
]);

const TEAM_DISPLAY_NAMES = {
  [ABA_TEAM_CODE]: ABA_TEAM_NAME,
  BKN: "Nets",
  DEN: "Nuggets",
  IND: "Pacers",
  SAS: "Spurs",
};

const HISTORICAL_TEAM_TO_CURRENT = {
  BAL: "WAS",
  BLT: "WAS",
  BRK: "BKN",
  BUF: "LAC",
  CAP: "WAS",
  CHO: "CHA",
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
  "Anaheim Amigos": "ANA",
  "Atlanta Hawks": "ATL",
  "Baltimore Bullets": "BAL",
  "Baltimore Claws": "BAL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Buffalo Braves": "BUF",
  "Capital Bullets": "CAP",
  "Carolina Cougars": "CAR",
  "Charlotte Bobcats": "CHA",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Chicago Stags": "CHS",
  "Cincinnati Royals": "CIN",
  "Cleveland Cavaliers": "CLE",
  "Dallas Chaparrals": "DLC",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Denver Rockets": "DNR",
  "Detroit Pistons": "DET",
  "Fort Wayne Pistons": "FTW",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Houston Mavericks": "HSM",
  "Indiana Pacers": "IND",
  "Indianapolis Olympians": "INO",
  "Kansas City Kings": "KCK",
  "Kansas City-Omaha Kings": "KCO",
  "Kentucky Colonels": "KEN",
  "LA Clippers": "LAC",
  "Los Angeles Stars": "LAS",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Memphis Pros": "MMP",
  "Memphis Sounds": "MMS",
  "Memphis Tams": "MMT",
  "Miami Heat": "MIA",
  "Miami Floridians": "FLO",
  "Milwaukee Hawks": "MIH",
  "Milwaukee Bucks": "MIL",
  "Minneapolis Lakers": "MNL",
  "Minnesota Muskies": "MNM",
  "Minnesota Pipers": "MNP",
  "Minnesota Timberwolves": "MIN",
  "New Jersey Americans": "NJA",
  "New Jersey Nets": "NJN",
  "New Orleans Buccaneers": "NOB",
  "New Orleans Hornets": "NOH",
  "New Orleans Jazz": "NOJ",
  "New Orleans Pelicans": "NOP",
  "New Orleans/Oklahoma City Hornets": "NOK",
  "New Orleans/Okla. City Hornets": "NOK",
  "New York Knicks": "NYK",
  "New York Nets": "NYA",
  "Oakland Oaks": "OAK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Philadelphia Warriors": "PHW",
  "Phoenix Suns": "PHX",
  "Pittsburgh Condors": "PTC",
  "Pittsburgh Pipers": "PTP",
  "Portland Trail Blazers": "POR",
  "Rochester Royals": "ROC",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "San Diego Clippers": "SDC",
  "San Diego Conquistadors": "SDA",
  "San Diego Rockets": "SDR",
  "San Diego Sails": "SDA",
  "San Francisco Warriors": "SFW",
  "Seattle SuperSonics": "SEA",
  "St. Louis Bombers": "SLB",
  "St. Louis Hawks": "STL",
  "Spirits of St. Louis": "SSL",
  "Syracuse Nationals": "SYR",
  "Texas Chaparrals": "TEX",
  "The Floridians": "FLO",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Utah Stars": "UTS",
  "Virginia Squires": "VIR",
  "Washington Caps": "WSA",
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

function normalizeSourceLeague(value) {
  const normalized = normalizedRawTeamCode(value);

  if (normalized === "ABA" || normalized === "NBA") {
    return normalized;
  }

  return null;
}

function isAbaSeason(season) {
  const endYear = seasonEndYear(season);

  return Boolean(endYear && endYear >= ABA_START_END_YEAR && endYear <= ABA_LAST_END_YEAR);
}

function franchiseGroupForTeam(team) {
  return team === "BKN" ? "NETS" : team;
}

function displayNameForTeam(team) {
  return TEAM_DISPLAY_NAMES[team] || team;
}

function eraStartYear(era) {
  const decade = Number(String(era || "").slice(0, 2));

  if (Number.isNaN(decade)) {
    return null;
  }

  return decade >= 40 ? 1900 + decade : 2000 + decade;
}

function shouldUseAbaDirectMapping(rawTeam, season, sourceLeague) {
  if (sourceLeague === "ABA") {
    return Boolean(ABA_DIRECT_TEAM_TO_CURRENT[rawTeam]);
  }

  if (ABA_DIRECT_UNAMBIGUOUS_CODES.has(rawTeam)) {
    return true;
  }

  return ABA_DIRECT_CURRENT_CODES.has(rawTeam) && isAbaSeason(season);
}

function shouldUseAbaOnlyMapping(rawTeam, sourceLeague) {
  if (sourceLeague === "ABA") {
    return ABA_ONLY_SOURCE_CODES.has(rawTeam);
  }

  return ABA_ONLY_TEAM_CODES.has(rawTeam);
}

function translateTeamForSeason(team, season, options = {}) {
  const rawTeam = normalizedRawTeamCode(team);
  const endYear = seasonEndYear(season);
  const sourceLeague = normalizeSourceLeague(options.sourceLeague || options.source_league);

  if (!rawTeam) {
    return {
      originalTeam: null,
      sourceLeague,
      team: null,
      teamName: null,
      franchiseGroup: null,
      isAbaOnlyTeam: false,
    };
  }

  if (rawTeam === ABA_TEAM_CODE) {
    return {
      originalTeam: normalizedRawTeamCode(options.originalTeam || options.original_team) || ABA_TEAM_CODE,
      sourceLeague: sourceLeague || "ABA",
      team: ABA_TEAM_CODE,
      teamName: ABA_TEAM_NAME,
      franchiseGroup: ABA_TEAM_CODE,
      isAbaOnlyTeam: true,
    };
  }

  if (shouldUseAbaDirectMapping(rawTeam, season, sourceLeague)) {
    const translatedTeam = ABA_DIRECT_TEAM_TO_CURRENT[rawTeam];

    return {
      originalTeam: rawTeam,
      sourceLeague: "ABA",
      team: translatedTeam,
      teamName: displayNameForTeam(translatedTeam),
      franchiseGroup: franchiseGroupForTeam(translatedTeam),
      isAbaOnlyTeam: false,
    };
  }

  if (shouldUseAbaOnlyMapping(rawTeam, sourceLeague)) {
    return {
      originalTeam: rawTeam,
      sourceLeague: "ABA",
      team: ABA_TEAM_CODE,
      teamName: ABA_TEAM_NAME,
      franchiseGroup: ABA_TEAM_CODE,
      isAbaOnlyTeam: true,
    };
  }

  if (rawTeam === "MIA" && endYear && endYear < MIAMI_HEAT_FIRST_SEASON_END_YEAR) {
    return {
      originalTeam: rawTeam,
      sourceLeague,
      team: null,
      teamName: null,
      franchiseGroup: null,
      isAbaOnlyTeam: false,
    };
  }

  if (rawTeam === "SDC" && endYear && endYear < SAN_DIEGO_CLIPPERS_FIRST_SEASON_END_YEAR) {
    return {
      originalTeam: rawTeam,
      sourceLeague,
      team: null,
      teamName: null,
      franchiseGroup: null,
      isAbaOnlyTeam: false,
    };
  }

  if (CURRENT_TEAM_SET.has(rawTeam)) {
    return {
      originalTeam: rawTeam,
      sourceLeague,
      team: rawTeam,
      teamName: displayNameForTeam(rawTeam),
      franchiseGroup: franchiseGroupForTeam(rawTeam),
      isAbaOnlyTeam: false,
    };
  }

  const historicalTeam = HISTORICAL_TEAM_TO_CURRENT[rawTeam] || null;

  return {
    originalTeam: rawTeam,
    sourceLeague,
    team: historicalTeam,
    teamName: historicalTeam ? displayNameForTeam(historicalTeam) : null,
    franchiseGroup: historicalTeam ? franchiseGroupForTeam(historicalTeam) : null,
    isAbaOnlyTeam: false,
  };
}

function normalizeTeamCode(team) {
  return translateTeamForSeason(team, null).team;
}

function normalizeTeamCodeForSeason(team, season, options = {}) {
  const rawTeam = normalizedRawTeamCode(team);
  const translation = translateTeamForSeason(rawTeam, season, options);

  if (translation.team) {
    return translation.team;
  }

  return translation.team;
}

function normalizeTeamCodeForEra(team, era, options = {}) {
  const rawTeam = normalizedRawTeamCode(team);
  const startYear = eraStartYear(era);
  const translation = translateTeamForSeason(rawTeam, null, options);

  if (translation.sourceLeague !== "ABA" && rawTeam === "MIA" && startYear && startYear < 1980) {
    return null;
  }

  if (translation.sourceLeague !== "ABA" && rawTeam === "SDC" && startYear && startYear < 1970) {
    return null;
  }

  if (translation.team) {
    return translation.team;
  }

  return translation.team;
}

function normalizeTeamName(teamName, season, options = {}) {
  const direct = normalizeTeamCodeForSeason(teamName, season, options);

  if (direct) {
    return direct;
  }

  return normalizeTeamCodeForSeason(TEAM_NAME_TO_ABBREVIATION[String(teamName || "").trim()], season, options);
}

function normalizeTeamList(teams = []) {
  return Array.from(new Set(teams.map(normalizeTeamCode).filter(Boolean))).sort();
}

function normalizeTeamEras(teamEras = []) {
  const seen = new Set();
  const normalized = [];

  for (const teamEra of teamEras) {
    const rawTeam = teamEra?.original_team || teamEra?.team;
    const team = normalizeTeamCodeForEra(rawTeam, teamEra?.era, { sourceLeague: teamEra?.source_league });
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

function originalTeamForRow(row) {
  return row?.original_team || row?.source_team || row?.bref_team || row?.raw_team || row?.team;
}

function teamTranslationFields(translation, existing = {}) {
  if (!translation?.team) {
    return {};
  }

  const originalTeam =
    existing.original_team ||
    existing.source_team ||
    existing.bref_team ||
    existing.raw_team ||
    translation.originalTeam;
  const fields = {};
  const hasExistingOriginalTeam =
    Boolean(existing.original_team) ||
    Boolean(existing.source_team) ||
    Boolean(existing.bref_team) ||
    Boolean(existing.raw_team);
  const shouldPreserveOriginal =
    translation.sourceLeague === "ABA" ||
    translation.isAbaOnlyTeam ||
    hasExistingOriginalTeam;

  if (shouldPreserveOriginal && originalTeam) {
    fields.original_team = normalizedRawTeamCode(originalTeam);
  }

  if (translation.sourceLeague === "ABA") {
    fields.source_league = translation.sourceLeague;
  }

  if (translation.sourceLeague === "ABA" || translation.isAbaOnlyTeam) {
    fields.team_name = translation.teamName;
    fields.franchise_group = translation.franchiseGroup;
  }

  if (translation.isAbaOnlyTeam) {
    fields.is_aba_only_team = true;
  }

  return fields;
}

function normalizeCareerSeasons(careerSeasons = []) {
  return careerSeasons
    .map((season) => {
      const rawTeam = originalTeamForRow(season);
      const translation = translateTeamForSeason(rawTeam, season?.season, {
        sourceLeague: season?.source_league,
      });
      const team = translation.team;
      const era = seasonEra(season?.season) || season?.era;

      if (!team) {
        return null;
      }

      const { source_team, bref_team, raw_team, ...baseSeason } = season || {};

      return {
        ...baseSeason,
        ...teamTranslationFields(translation, season),
        team,
        era,
      };
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
        team: normalizeTeamName(originalTeamForRow(award), award?.season, {
          sourceLeague: award?.source_league,
        }),
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
          .map((award) =>
            normalizeTeamName(originalTeamForRow(award), award?.season, {
              sourceLeague: award?.source_league,
            }),
          )
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

function summarizeAbaTranslationsFromPlayers(players = []) {
  const summary = {
    nbaFranchiseSeasons: 0,
    abaTeamSeasons: 0,
    unknownAbaTeamCodes: [],
  };
  const unknownCodes = new Set();

  for (const player of players || []) {
    for (const season of player?.career_seasons || []) {
      const rawTeam = originalTeamForRow(season);
      const translation = translateTeamForSeason(rawTeam, season?.season, {
        sourceLeague: season?.source_league,
      });

      if (translation.sourceLeague === "ABA" && translation.team && translation.team !== ABA_TEAM_CODE) {
        summary.nbaFranchiseSeasons += 1;
      } else if (translation.sourceLeague === "ABA" && translation.team === ABA_TEAM_CODE) {
        summary.abaTeamSeasons += 1;
      } else if (isAbaSeason(season?.season) && rawTeam && !translation.team) {
        unknownCodes.add(normalizedRawTeamCode(rawTeam));
      }
    }
  }

  summary.unknownAbaTeamCodes = Array.from(unknownCodes).sort();
  return summary;
}

module.exports = {
  ABA_TEAM_CODE,
  ABA_TEAM_NAME,
  ABA_DIRECT_TEAM_TO_CURRENT,
  ABA_ONLY_TEAM_CODES,
  CURRENT_NBA_TEAMS,
  TEAM_NAME_TO_ABBREVIATION,
  isAbaSeason,
  normalizeSourceLeague,
  normalizedRawTeamCode,
  summarizeAbaTranslationsFromPlayers,
  teamTranslationFields,
  translateTeamForSeason,
  normalizeTeamCodeForEra,
  normalizeTeamCodeForSeason,
  normalizeClassicPointsByTeamEra,
  normalizePlayerTeams,
  normalizeTeamCode,
  normalizeTeamEras,
  normalizeTeamName,
  normalizeTeamList,
};
