const express = require("express");
const cors = require("cors");
const path = require("path");
const { ACCOLADE_WEIGHTS, LEGACY_ENGINE_FACTORS } = require("./legacyPoints");
const {
  resolveTsWeights,
  STINT_SCALING_FACTOR,
  WEIGHTS: CLASSIC_STAT_WEIGHTS,
} = require("./eraRelativeClassicPoints");
require("dotenv").config({ quiet: true });
const { playerCacheStatus, readJson, readPlayers } = require("./playerRepository");

const app = express();
const PORT = Number(process.env.PORT || 4000);
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

async function readStatsEngineConfig() {
  const leagueAverages = await readJson(LEAGUE_AVERAGES_PATH);
  const tsWeights = resolveTsWeights(CLASSIC_STAT_WEIGHTS);

  return {
    leagueAverages,
    scalingFactor: STINT_SCALING_FACTOR,
    statWeights: {
      asts: CLASSIC_STAT_WEIGHTS.apg,
      pts: CLASSIC_STAT_WEIGHTS.ppg,
      rebs: CLASSIC_STAT_WEIGHTS.rpg,
      stocks: CLASSIC_STAT_WEIGHTS.spg,
      tsImpact: CLASSIC_STAT_WEIGHTS.ts_impact,
      tsPeerWeight: tsWeights.peer,
      tsSkillWeight: tsWeights.skill,
      wsImpact: CLASSIC_STAT_WEIGHTS.ws_impact,
    },
    ws48Baseline: 0.1,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nba_82-0_server" });
});

app.get("/api/player-cache", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(playerCacheStatus());
});

app.get("/api/players", async (_req, res, next) => {
  const startedAt = Date.now();
  try {
    const players = await readPlayers();
    const durationMs = Date.now() - startedAt;
    console.log(`/api/players served ${players.length} players in ${durationMs}ms`);
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
  if (process.env.PLAYER_CACHE_WARM_ON_START !== "false") {
    const startedAt = Date.now();
    console.log("Warming player cache...");
    readPlayers()
      .then((players) => {
        console.log(`Player cache warmed with ${players.length} players in ${Date.now() - startedAt}ms.`);
      })
      .catch((error) => {
        console.warn(`Player cache warm failed: ${error.message}`);
      });
  }
});
