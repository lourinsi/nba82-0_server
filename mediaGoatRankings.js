const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");

const GOAT_RANKING_SOURCE_TITLE = "B/R's Top 100 NBA Players of All Time, Ranked";
const GOAT_RANKING_SOURCE_URL =
  "https://bleacherreport.com/articles/25223594-brs-top-100-nba-players-all-time-ranked";
const GOAT_RANKINGS_PATH = path.join(__dirname, "data", "br_goat_rankings.json");

const GOAT_NAME_ALIASES = {
  "magic johnson": ["earvin johnson", "earvin magic johnson"],
  "penny hardaway": ["anfernee hardaway"],
  "nate tiny archibald": ["nate archibald", "tiny archibald"],
  "world b free": ["lloyd free"],
  "stephen curry": ["steph curry", "wardell curry"],
  "bob mcadoo": ["robert mcadoo"],
  "bill walton": ["william walton"],
  "walt frazier": ["walter frazier"],
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function mediaScoreForRank(rank) {
  const numericRank = Number(rank);

  if (!Number.isInteger(numericRank) || numericRank < 1 || numericRank > 100) {
    return 0;
  }

  return 101 - numericRank;
}

function parseBleacherReportGoatRankings(html) {
  const rankingsByRank = new Map();
  const headingPattern = /<h2[^>]*>(\d{1,3})\.\s*([^<]+)<\/h2>/g;

  for (const match of html.matchAll(headingPattern)) {
    const rank = Number(match[1]);
    const player = decodeHtml(match[2]);

    if (rank < 1 || rank > 100 || !player) {
      continue;
    }

    rankingsByRank.set(rank, {
      rank,
      player,
      media_score: mediaScoreForRank(rank),
    });
  }

  const rankings = Array.from(rankingsByRank.values()).sort((a, b) => a.rank - b.rank);

  if (rankings.length !== 100) {
    throw new Error(`Expected 100 GOAT rankings from Bleacher Report; parsed ${rankings.length}.`);
  }

  return rankings;
}

async function fetchBleacherReportGoatRankings() {
  const response = await axios.get(GOAT_RANKING_SOURCE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 30000,
  });

  return parseBleacherReportGoatRankings(response.data);
}

async function saveCachedGoatRankings(rankings) {
  const payload = {
    source: {
      title: GOAT_RANKING_SOURCE_TITLE,
      url: GOAT_RANKING_SOURCE_URL,
      scoring: "Rank 1 = 100 points; each following rank subtracts 1 point; rank 100 = 1 point.",
      fetched_at: new Date().toISOString(),
    },
    rankings,
  };

  await fs.mkdir(path.dirname(GOAT_RANKINGS_PATH), { recursive: true });
  await fs.writeFile(GOAT_RANKINGS_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  return payload;
}

async function loadCachedGoatRankings() {
  try {
    const cached = JSON.parse(await fs.readFile(GOAT_RANKINGS_PATH, "utf8"));
    return Array.isArray(cached) ? cached : cached.rankings || [];
  } catch {
    return [];
  }
}

function createGoatRankingLookup(rankings) {
  const lookup = new Map();

  for (const ranking of rankings) {
    const normalizedName = normalizeName(ranking.player);
    lookup.set(normalizedName, ranking);

    for (const alias of GOAT_NAME_ALIASES[normalizedName] || []) {
      lookup.set(normalizeName(alias), ranking);
    }
  }

  return lookup;
}

function finalLegacyPoints(player, goatScore = 0) {
  const baseLegacyPoints = Number(player.legacy_points || 0);
  const score = Number(goatScore || 0);

  return Number((baseLegacyPoints + score).toFixed(2));
}

function applyGoatRankingsToPlayers(players, rankings = []) {
  const rankingLookup = createGoatRankingLookup(rankings);

  return players.map((player) => {
    const ranking = rankingLookup.get(normalizeName(player.name));
    const goatScore = ranking?.media_score || 0;

    return {
      ...player,
      goat_rank: ranking?.rank || 0,
      goat_score: goatScore,
      final_legacy_points: finalLegacyPoints(player, goatScore),
    };
  });
}

function countMatchedGoatRankings(players) {
  return players.filter((player) => Number(player.goat_rank || 0) > 0).length;
}

module.exports = {
  GOAT_RANKINGS_PATH,
  GOAT_RANKING_SOURCE_TITLE,
  GOAT_RANKING_SOURCE_URL,
  applyGoatRankingsToPlayers,
  countMatchedGoatRankings,
  finalLegacyPoints,
  fetchBleacherReportGoatRankings,
  loadCachedGoatRankings,
  mediaScoreForRank,
  parseBleacherReportGoatRankings,
  saveCachedGoatRankings,
};
