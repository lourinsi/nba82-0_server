const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { applyGoatRankingsToPlayers, loadCachedGoatRankings } = require("./mediaGoatRankings");
const { normalizePlayerTeams } = require("./teamFranchises");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DATA_PATH = path.join(__dirname, "data", "players_accolades.json");
const DEFAULT_FRONTEND_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const allowedOrigins = (process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
  }),
);
app.use(express.json());

async function readPlayers() {
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const players = JSON.parse(raw);
  const goatRankings = await loadCachedGoatRankings();
  const normalizedPlayers = players.map(normalizePlayerTeams);

  return applyGoatRankingsToPlayers(normalizedPlayers, goatRankings);
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
