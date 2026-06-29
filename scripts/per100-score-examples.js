"use strict";

const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const { parseAdvancedRows } = require("../seed-advanced-stats");
const { parsePerGameRows, parsePer100Rows, parseTeamAdvancedRows } = require("../seed-bref");
const {
  calculateWeightedPer100SeasonScore,
  estimateStatPer100FromPerGame,
} = require("../per100Scoring");
const { seasonEndYear } = require("../seasonEras");

const ROOT = path.resolve(__dirname, "..");
const LEAGUE_AVERAGES_PATH = path.join(ROOT, "data", "historical_league_averages.json");
const REQUEST_DELAY_MS = Number(process.env.BREF_EXAMPLE_DELAY_MS || 4000);
const BREF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
};
const EXAMPLES = [
  { player: "Stephen Curry", season: "2015-16", team: "GSW" },
  { player: "Wilt Chamberlain", season: "1961-62", team: "GSW" },
  { player: "Bill Russell", season: "1961-62", team: "BOS" },
  { player: "Tim Duncan", season: "2002-03", team: "SAS" },
  { player: "Draymond Green", season: "2015-16", team: "GSW" },
];

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seasonUrl(season, suffix) {
  return `https://www.basketball-reference.com/leagues/NBA_${seasonEndYear(season)}${suffix}`;
}

async function fetchHtml(url) {
  const response = await axios.get(url, { headers: BREF_HEADERS, timeout: 30000 });

  return response.data;
}

async function fetchSeasonRows(season) {
  const pages = [
    ["perGameRows", seasonUrl(season, "_per_game.html"), parsePerGameRows],
    ["per100Rows", seasonUrl(season, "_per_poss.html"), parsePer100Rows],
    ["advancedRows", seasonUrl(season, "_advanced.html"), parseAdvancedRows],
    ["teamAdvancedRows", seasonUrl(season, ".html"), parseTeamAdvancedRows],
  ];
  const result = {};

  for (const [key, url, parseRows] of pages) {
    try {
      const html = await fetchHtml(url);
      result[key] = parseRows(html, season);
    } catch (error) {
      if (error?.response?.status !== 404) {
        throw error;
      }

      result[key] = [];
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return result;
}

function rowFor(rows, example) {
  return rows.find(
    (row) =>
      row.season === example.season &&
      row.team === example.team &&
      normalizeName(row.player) === normalizeName(example.player),
  );
}

function teamPaceFor(rows, example) {
  return rows.find((row) => row.season === example.season && row.team === example.team)?.pace ?? null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

function leagueTsForSeason(leagueAverages, season) {
  const leagueAverage = leagueAverages[season] || {};
  const tsPct = numberOrNull(leagueAverage.TS_PCT ?? leagueAverage.ts_pct ?? leagueAverage.league_ts_pct);

  return tsPct && tsPct > 1 ? tsPct / 100 : tsPct;
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function per100Value(per100Row, perGameRow, teamPace, key, perGameKey) {
  const direct = numberOrNull(per100Row?.[key]);

  if (direct !== null) {
    return { source: "B-Ref per-100", value: direct };
  }

  const perGame = numberOrNull(perGameRow?.[perGameKey]);
  const mpg = numberOrNull(perGameRow?.mpg);

  if (perGame !== null && mpg !== null && teamPace) {
    return {
      source: "estimated from team pace",
      value: estimateStatPer100FromPerGame(perGame, mpg, teamPace),
    };
  }

  return { source: "missing", value: null };
}

function buildScoreInput(example, rows, leagueAverages) {
  const perGameRow = rowFor(rows.perGameRows, example);
  const per100Row = rowFor(rows.per100Rows, example);
  const advancedRow = rowFor(rows.advancedRows, example);
  const teamPace = teamPaceFor(rows.teamAdvancedRows, example);
  const per100PTS = per100Value(per100Row, perGameRow, teamPace, "per100_pts", "ppg");
  const per100REB = per100Value(per100Row, perGameRow, teamPace, "per100_reb", "rpg");
  const per100AST = per100Value(per100Row, perGameRow, teamPace, "per100_ast", "apg");
  const tsPct = numberOrNull(advancedRow?.ts_pct);
  const leagueTs = leagueTsForSeason(leagueAverages, example.season);
  const tsPlus = tsPct && leagueTs ? (tsPct / leagueTs) * 100 : null;
  const minutes = numberOrNull(advancedRow?.minutes) ?? numberOrNull(perGameRow?.minutes);
  const mpg = numberOrNull(perGameRow?.mpg) ?? (minutes && perGameRow?.games_played ? minutes / perGameRow.games_played : null);
  const missing = [];

  for (const [name, value] of Object.entries({
    per100PTS: per100PTS.value,
    per100REB: per100REB.value,
    per100AST: per100AST.value,
    tsPct,
    tsPlus,
    OWS: advancedRow?.ows,
    DWS: advancedRow?.dws,
    minutes,
    mpg,
  })) {
    if (numberOrNull(value) === null) {
      missing.push(name);
    }
  }

  if (missing.length) {
    throw new Error(`${example.player} ${example.season} missing ${missing.join(", ")}`);
  }

  return {
    input: {
      per100PTS: per100PTS.value,
      per100REB: per100REB.value,
      per100AST: per100AST.value,
      tsPct,
      tsPlus,
      OWS: advancedRow.ows,
      DWS: advancedRow.dws,
      minutes,
      mpg,
    },
    sources: {
      per100PTS: per100PTS.source,
      per100REB: per100REB.source,
      per100AST: per100AST.source,
      tsPlus: "derived from B-Ref TS% and league TS%",
    },
  };
}

async function main() {
  const leagueAverages = JSON.parse(await fs.readFile(LEAGUE_AVERAGES_PATH, "utf8"));
  const rowsBySeason = new Map();
  const outputs = [];

  for (const example of EXAMPLES) {
    if (!rowsBySeason.has(example.season)) {
      rowsBySeason.set(example.season, await fetchSeasonRows(example.season));
    }

    const { input, sources } = buildScoreInput(example, rowsBySeason.get(example.season), leagueAverages);
    const score = calculateWeightedPer100SeasonScore(input);

    outputs.push({
      player: example.player,
      season: example.season,
      team: example.team,
      score: round(score.totalScore, 2),
      per100PTS: round(input.per100PTS),
      per100REB: round(input.per100REB),
      per100AST: round(input.per100AST),
      tsPct: round(input.tsPct, 3),
      tsPlus: Math.round(input.tsPlus),
      OWS: round(input.OWS),
      DWS: round(input.DWS),
      mpg: round(input.mpg),
      sources,
    });
  }

  console.table(
    outputs.map(({ sources: _sources, ...output }) => output),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
