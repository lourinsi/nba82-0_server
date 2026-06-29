const assert = require("assert/strict");
const { buildClassicPointsByTeamEra } = require("../classicPoints");
const { buildTeamPaceLookup, parsePerGameRows, parseTeamAdvancedRows } = require("../seed-bref");
const {
  ABA_TEAM_CODE,
  normalizePlayerTeams,
  normalizeTeamCodeForSeason,
  normalizeTeamName,
  summarizeAbaTranslationsFromPlayers,
  translateTeamForSeason,
} = require("../teamFranchises");

function assertTranslation(rawTeam, season, expectedTeam, options = {}) {
  const translation = translateTeamForSeason(rawTeam, season, options);

  assert.equal(translation.team, expectedTeam, `${rawTeam} ${season || ""} should map to ${expectedTeam}`);
  return translation;
}

function assertHasTeamEra(player, team, era) {
  assert.ok(
    player.team_eras.some((teamEra) => teamEra.team === team && teamEra.era === era),
    `${player.name} should have ${team} ${era}`,
  );
}

function assertNoTeam(player, team) {
  assert.ok(!player.teams.includes(team), `${player.name} should not include ${team}`);
}

function playerFixture(name, careerSeasons, awardsRaw = []) {
  return normalizePlayerTeams({
    id: `test:${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    current_team: null,
    teams: [],
    eras: [],
    team_eras: [],
    career_seasons: careerSeasons,
    awards_raw: awardsRaw,
    classic_points_by_team_era: [],
  });
}

assertTranslation("NYA", "1973-74", "BKN");
assertTranslation("NJA", "1967-68", "BKN");
assertTranslation("DNR", "1969-70", "DEN");
assertTranslation("DEN", "1975-76", "DEN");
assertTranslation("INA", "1971-72", "IND");
assertTranslation("IND", "1975-76", "IND");
assertTranslation("DLC", "1967-68", "SAS");
assertTranslation("TEX", "1970-71", "SAS");
assertTranslation("SAA", "1973-74", "SAS");
assertTranslation("SAS", "1975-76", "SAS");

for (const code of ["VIR", "KEN", "UTS", "HSM", "CAR", "SSL", "MMP", "MMT", "MMS", "SDA"]) {
  const translation = assertTranslation(code, "1974-75", ABA_TEAM_CODE);
  assert.equal(translation.isAbaOnlyTeam, true, `${code} should be flagged as ABA-only`);
}

assert.equal(normalizeTeamName("Utah Stars", "1974-75"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Houston Mavericks", "1968-69"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Carolina Cougars", "1973-74"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Spirits of St. Louis", "1975-76"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Memphis Pros", "1971-72"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Memphis Tams", "1972-73"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Memphis Sounds", "1974-75"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("Kentucky Colonels", "1974-75"), ABA_TEAM_CODE);
assert.equal(normalizeTeamName("New York Nets", "1973-74"), "BKN");
assert.notEqual(normalizeTeamName("New York Nets", "1973-74"), "NYK");
assert.notEqual(normalizeTeamName("Utah Stars", "1974-75"), "UTA");
assert.notEqual(normalizeTeamName("Houston Mavericks", "1968-69"), "HOU");
assert.notEqual(normalizeTeamName("Carolina Cougars", "1973-74"), "CHA");
assert.notEqual(normalizeTeamName("Spirits of St. Louis", "1975-76"), "ATL");
assert.equal(normalizeTeamCodeForSeason("NOJ", "1975-76"), "UTA");
assert.equal(normalizeTeamCodeForSeason("SDC", "1978-79"), "LAC");

const julius = playerFixture(
  "Julius Erving",
  [
    {
      season: "1971-72",
      team: "VIR",
      source_league: "ABA",
      games_played: 84,
      games_started: 84,
      minutes: 3531,
      mpg: 42,
      ppg: 27.3,
      rpg: 15.7,
      apg: 4,
      per100_pts: 31.2,
      per100_reb: 17.9,
      per100_ast: 4.6,
      team_pace: 103.2,
      ts_pct: 0.558,
      ts_plus: 108,
      ows: 8.1,
      dws: 5.2,
      ws_per_48: 0.21,
    },
    {
      season: "1973-74",
      team: "NYA",
      source_league: "ABA",
      games_played: 84,
      games_started: 84,
      ppg: 27.4,
      rpg: 10.7,
      apg: 5.2,
      per100_pts: 34.1,
      team_pace: 105.4,
      ts_pct: 0.552,
      ows: 7.3,
      dws: 4.8,
      ws_per_48: 0.19,
    },
    {
      season: "1976-77",
      team: "PHI",
      games_played: 82,
      games_started: 77,
      ppg: 21.6,
      rpg: 8.5,
      apg: 3.7,
      ts_pct: 0.553,
      ws_per_48: 0.188,
    },
  ],
  [
    { season: "1971-72", team: "Virginia Squires", description: "ABA All-Star", all_nba_team_number: null },
    { season: "1973-74", team: "New York Nets", description: "ABA Champion", all_nba_team_number: null },
  ],
);

assert.deepEqual(julius.teams, [ABA_TEAM_CODE, "BKN", "PHI"]);
assertHasTeamEra(julius, ABA_TEAM_CODE, "70's");
assertHasTeamEra(julius, "BKN", "70's");
assertHasTeamEra(julius, "PHI", "70's");
assertNoTeam(julius, "NYK");

const virginiaSeason = julius.career_seasons.find((season) => season.season === "1971-72");
assert.equal(virginiaSeason.team, ABA_TEAM_CODE);
assert.equal(virginiaSeason.original_team, "VIR");
assert.equal(virginiaSeason.source_league, "ABA");
assert.equal(virginiaSeason.team_name, "ABA Team");
assert.equal(virginiaSeason.franchise_group, "ABA");
assert.equal(virginiaSeason.is_aba_only_team, true);
assert.equal(virginiaSeason.per100_pts, 31.2);
assert.equal(virginiaSeason.team_pace, 103.2);
assert.equal(virginiaSeason.ts_pct, 0.558);
assert.equal(virginiaSeason.ts_plus, 108);
assert.equal(virginiaSeason.ows, 8.1);
assert.equal(virginiaSeason.dws, 5.2);
assert.equal(virginiaSeason.ws_per_48, 0.21);

const netsSeason = julius.career_seasons.find((season) => season.season === "1973-74");
assert.equal(netsSeason.team, "BKN");
assert.equal(netsSeason.original_team, "NYA");
assert.equal(netsSeason.source_league, "ABA");
assert.equal(netsSeason.franchise_group, "NETS");
assert.equal(netsSeason.is_aba_only_team, undefined);

const classicBlocks = buildClassicPointsByTeamEra(julius);
assert.ok(classicBlocks.some((block) => block.team === ABA_TEAM_CODE && block.era === "70's"));
assert.ok(classicBlocks.some((block) => block.team === "BKN" && block.era === "70's"));
assert.ok(!classicBlocks.some((block) => block.team === "NYK"));

const george = playerFixture("George Gervin", [
  { season: "1973-74", team: "VIR", source_league: "ABA", games_played: 30 },
  { season: "1974-75", team: "SAA", source_league: "ABA", games_played: 84 },
  { season: "1976-77", team: "SAS", games_played: 82 },
]);
assert.deepEqual(george.teams, [ABA_TEAM_CODE, "SAS"]);

const artis = playerFixture("Artis Gilmore", [
  { season: "1971-72", team: "KEN", source_league: "ABA", games_played: 84 },
  { season: "1976-77", team: "CHI", games_played: 82 },
  { season: "1982-83", team: "SAS", games_played: 82 },
]);
assert.deepEqual(artis.teams, [ABA_TEAM_CODE, "CHI", "SAS"]);

const danIssel = playerFixture("Dan Issel", [
  { season: "1971-72", team: "KEN", source_league: "ABA", games_played: 84 },
  { season: "1975-76", team: "DEN", source_league: "ABA", games_played: 84 },
]);
assert.deepEqual(danIssel.teams, [ABA_TEAM_CODE, "DEN"]);

const moses = playerFixture("Moses Malone", [
  { season: "1974-75", team: "UTS", source_league: "ABA", games_played: 83 },
  { season: "1975-76", team: "SSL", source_league: "ABA", games_played: 43 },
  { season: "1976-77", team: "HOU", games_played: 80 },
]);
assert.deepEqual(moses.teams, [ABA_TEAM_CODE, "HOU"]);

const summary = summarizeAbaTranslationsFromPlayers([julius, george, artis, danIssel, moses]);
assert.equal(summary.nbaFranchiseSeasons, 3);
assert.equal(summary.abaTeamSeasons, 6);
assert.deepEqual(summary.unknownAbaTeamCodes, []);

const perGameRows = parsePerGameRows(
  `
  <table id="per_game_stats">
    <tr>
      <td data-stat="player"><a href="/players/e/ervinju01.html">Julius Erving</a></td>
      <td data-stat="team_id">VIR</td>
      <td data-stat="g">84</td>
      <td data-stat="gs">84</td>
      <td data-stat="mp_per_g">42.0</td>
      <td data-stat="pts_per_g">27.3</td>
      <td data-stat="trb_per_g">15.7</td>
      <td data-stat="ast_per_g">4.0</td>
      <td data-stat="stl_per_g">1.0</td>
      <td data-stat="blk_per_g">1.0</td>
    </tr>
    <tr>
      <td data-stat="player"><a href="/players/e/ervinju01.html">Julius Erving</a></td>
      <td data-stat="team_id">NYA</td>
      <td data-stat="g">84</td>
      <td data-stat="gs">84</td>
      <td data-stat="mp_per_g">40.5</td>
      <td data-stat="pts_per_g">27.4</td>
      <td data-stat="trb_per_g">10.7</td>
      <td data-stat="ast_per_g">5.2</td>
    </tr>
  </table>
  `,
  "1973-74",
  "ABA",
);
assert.equal(perGameRows.length, 2);
assert.equal(perGameRows[0].team, ABA_TEAM_CODE);
assert.equal(perGameRows[0].original_team, "VIR");
assert.equal(perGameRows[0].source_league, "ABA");
assert.equal(perGameRows[0].minutes, 3528);
assert.equal(perGameRows[1].team, "BKN");
assert.equal(perGameRows[1].original_team, "NYA");
assert.equal(perGameRows[1].source_league, "ABA");

const teamPaceRows = parseTeamAdvancedRows(
  `
  <table id="advanced-team">
    <tr>
      <td data-stat="team"><a href="/teams/VIR/1975.html">Virginia Squires</a></td>
      <td data-stat="pace">105.1</td>
    </tr>
    <tr>
      <td data-stat="team"><a href="/teams/KEN/1975.html">Kentucky Colonels</a></td>
      <td data-stat="pace">101.2</td>
    </tr>
  </table>
  `,
  "1974-75",
  "ABA",
);
const paceLookup = buildTeamPaceLookup(teamPaceRows);
assert.equal(paceLookup.get("1974-75:source:ABA:VIR"), 105.1);
assert.equal(paceLookup.get("1974-75:source:ABA:KEN"), 101.2);

console.log("ABA team translation verification passed.");
