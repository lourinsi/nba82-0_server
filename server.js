const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { ACCOLADE_WEIGHTS, LEGACY_ENGINE_FACTORS } = require("./legacyPoints");
const {
  ALL_TIME_TS_BASELINE,
  STINT_SCALING_FACTOR,
  TS_BLEND_WEIGHTS,
  WEIGHTS: CLASSIC_STAT_WEIGHTS,
} = require("./eraRelativeClassicPoints");
const { applyGoatRankingsToPlayers, loadCachedGoatRankings } = require("./mediaGoatRankings");
const { normalizePlayerAccoladeRecords } = require("./playerAccoladeRecords");
const { normalizePlayerTeams } = require("./teamFranchises");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DATA_PATH = process.env.PLAYER_DATA_PATH
  ? path.resolve(__dirname, process.env.PLAYER_DATA_PATH)
  : path.join(__dirname, "data", "players_accolades_bref.json");
const LEAGUE_AVERAGES_PATH = path.join(__dirname, "data", "historical_league_averages.json");
const DEFAULT_FRONTEND_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const LOCAL_DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isLocalDevOrigin(origin) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    return (
      (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") &&
      LOCAL_DEV_HOSTNAMES.has(parsedOrigin.hostname)
    );
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  return allowedOrigins.includes(origin) || isLocalDevOrigin(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
  }),
);
app.use(express.json());

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readPlayers() {
  const players = await readJson(DATA_PATH);
  const goatRankings = await loadCachedGoatRankings();
  const normalizedPlayers = normalizePlayerAccoladeRecords(players).map(normalizePlayerTeams);

  return applyGoatRankingsToPlayers(normalizedPlayers, goatRankings);
}

async function readStatsEngineConfig() {
  const leagueAverages = await readJson(LEAGUE_AVERAGES_PATH);

  return {
    allTimeTsBaseline: ALL_TIME_TS_BASELINE,
    leagueAverages,
    scalingFactor: STINT_SCALING_FACTOR,
    statWeights: {
      asts: CLASSIC_STAT_WEIGHTS.apg,
      pts: CLASSIC_STAT_WEIGHTS.ppg,
      rebs: CLASSIC_STAT_WEIGHTS.rpg,
      stocks: CLASSIC_STAT_WEIGHTS.spg,
      tsAbsoluteImpact: CLASSIC_STAT_WEIGHTS.ts_impact * TS_BLEND_WEIGHTS.absolute,
      tsEraImpact: CLASSIC_STAT_WEIGHTS.ts_impact * TS_BLEND_WEIGHTS.era,
      wsImpact: CLASSIC_STAT_WEIGHTS.ws_impact,
    },
    tsBlendWeights: TS_BLEND_WEIGHTS,
    ws48Baseline: 0.1,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nba_82-0_server" });
});

app.get("/api/players", async (_req, res, next) => {
  try {
    const players = await readPlayers();
    res.set("Cache-Control", "no-store");
    res.json(players);
  } catch (error) {
    next(error);
  }
});

app.get("/api/legacy-engine-config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    accoladeWeights: ACCOLADE_WEIGHTS,
    legacyEngineFactors: LEGACY_ENGINE_FACTORS,
  });
});

app.get("/api/stats-engine-config", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await readStatsEngineConfig());
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Unable to load player accolade data.",
    details: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

app.listen(PORT, () => {
  console.log(`NBA 82-0 API listening on http://localhost:${PORT}`);
});
