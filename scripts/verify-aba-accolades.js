const assert = require("assert/strict");
const path = require("path");
const players = require(path.join("..", "data", "players_accolades_bref.json"));

function player(name) {
  const match = players.find((candidate) => candidate.name === name);

  assert.ok(match, `${name} should exist`);
  return match;
}

function accoladeTotal(name, key, expected) {
  const match = player(name);

  assert.equal(Number(match.accolades?.[key] || 0), expected, `${name} ${key}`);
  return match;
}

function block(playerRecord, team, era) {
  const match = (playerRecord.classic_points_by_team_era || []).find(
    (candidate) => candidate.team === team && candidate.era === era,
  );

  assert.ok(match, `${playerRecord.name} should have ${team} ${era} block`);
  return match;
}

function blockAccolade(playerRecord, team, era, key, expected) {
  assert.equal(
    Number(block(playerRecord, team, era).accolades?.[key] || 0),
    expected,
    `${playerRecord.name} ${team} ${era} ${key}`,
  );
}

const julius = accoladeTotal("Julius Erving", "aba_mvp_count", 3);
accoladeTotal("Julius Erving", "aba_playoffs_mvp_count", 2);
assert.ok(julius.teams.includes("BKN"), "Julius Erving should include Nets franchise team");
assert.ok(!julius.teams.includes("NYK"), "Julius Erving ABA Nets accolades should not create NYK team");
blockAccolade(julius, "BKN", "70's", "aba_mvp_count", 3);
blockAccolade(julius, "BKN", "70's", "aba_playoffs_mvp_count", 2);
blockAccolade(julius, "PHI", "70's", "aba_mvp_count", 0);

const mel = accoladeTotal("Mel Daniels", "aba_mvp_count", 2);
blockAccolade(mel, "IND", "60's", "aba_mvp_count", 1);
blockAccolade(mel, "IND", "70's", "aba_mvp_count", 1);

const artis = accoladeTotal("Artis Gilmore", "aba_mvp_count", 1);
accoladeTotal("Artis Gilmore", "aba_playoffs_mvp_count", 1);
blockAccolade(artis, "ABA", "70's", "aba_mvp_count", 1);
blockAccolade(artis, "ABA", "70's", "aba_playoffs_mvp_count", 1);

const spencer = accoladeTotal("Spencer Haywood", "aba_mvp_count", 1);
blockAccolade(spencer, "DEN", "70's", "aba_mvp_count", 1);

const george = accoladeTotal("George McGinnis", "aba_mvp_count", 1);
accoladeTotal("George McGinnis", "aba_playoffs_mvp_count", 1);
blockAccolade(george, "IND", "70's", "aba_mvp_count", 1);
blockAccolade(george, "IND", "70's", "aba_playoffs_mvp_count", 1);

const connie = accoladeTotal("Connie Hawkins", "aba_mvp_count", 1);
accoladeTotal("Connie Hawkins", "aba_playoffs_mvp_count", 1);
blockAccolade(connie, "ABA", "60's", "aba_mvp_count", 1);
blockAccolade(connie, "ABA", "60's", "aba_playoffs_mvp_count", 1);

const billy = accoladeTotal("Billy Cunningham", "aba_mvp_count", 1);
blockAccolade(billy, "ABA", "70's", "aba_mvp_count", 1);

const zelmo = accoladeTotal("Zelmo Beaty", "aba_playoffs_mvp_count", 1);
blockAccolade(zelmo, "ABA", "70's", "aba_playoffs_mvp_count", 1);

const warren = accoladeTotal("Warren Jabali", "aba_playoffs_mvp_count", 1);
blockAccolade(warren, "ABA", "60's", "aba_playoffs_mvp_count", 1);

assert.ok(
  players.some((candidate) => Number(candidate.accolades?.aba_scoring_titles || 0) > 0),
  "At least one ABA scoring title should be derived",
);
assert.ok(
  players.some((candidate) => Number(candidate.accolades?.aba_assist_titles || 0) > 0),
  "At least one ABA assist title should be derived",
);
assert.ok(
  players.some((candidate) => Number(candidate.accolades?.aba_rebound_titles || 0) > 0),
  "At least one ABA rebound title should be derived",
);

console.log("ABA accolade verification passed.");
