"use strict";

const path = require("path");
const { getPrismaClient } = require("./db");
const { readJson, readPlayers } = require("./playerRepository");
const { seasonEndYear, seasonEra } = require("./seasonEras");
const { LOBBY_STATUSES, normalizeLobbyCode } = require("./multiplayerLobbyRepository");
const {
  STAT_MODE_LABELS,
  calculatePlayerSeasonScore,
  normalizeStatMode,
  playerAccoladeScoreForSelection,
  rounded,
} = require("./multiplayerGameScoring");

const LEAGUE_AVERAGES_PATH = path.join(__dirname, "data", "historical_league_averages.json");
const GAME_STATUSES = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
});
const ROUND_STATUSES = Object.freeze({
  BIDDING: "bidding",
  COMPLETED: "completed",
  REVEALED: "revealed",
});
const POOL_SOURCES = Object.freeze(["top100", "award", "activeStar", "wildcard"]);
const NBA_CDN_HEADSHOT_BASE_URL = "https://cdn.nba.com/headshots/nba/latest/260x190";

let leagueAveragesPromise = null;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
}

function getPrismaForMultiplayerGame() {
  try {
    return getPrismaClient({ required: true });
  } catch {
    throw httpError(503, "Database is required for multiplayer games.");
  }
}

function numericValue(value, fallback = null) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveInteger(value, fallback, { min = 1, max = 1000 } = {}) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function bool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeGameSettings(settings) {
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const multiplayer = source.multiplayer && typeof source.multiplayer === "object" ? source.multiplayer : {};
  const bidTimerSeconds = positiveInteger(
    source.bidTimerSeconds ?? multiplayer.bidTimerSeconds,
    20,
    { min: 3, max: 120 },
  );
  const revealDurationSeconds = positiveInteger(
    source.revealDurationSeconds ?? multiplayer.revealDurationSeconds,
    4,
    { min: 1, max: 30 },
  );
  const minimumBid = positiveInteger(source.minimumBid ?? source.minimumOffer, 1, { min: 1, max: 10000 });
  const bidIncrement = positiveInteger(source.bidIncrement ?? source.offerIncrement, 1, { min: 1, max: 10000 });

  return {
    ...source,
    bidIncrement,
    bidTimerSeconds,
    gameMode: "multiplayer",
    highestBidWins: true,
    minimumBid,
    multiplayer: {
      ...multiplayer,
      bidTimerSeconds,
      highestBidWins: true,
      noMarketRange: true,
      revealAllBidsAfterRound: bool(source.revealAllBidsAfterRound ?? multiplayer.revealAllBidsAfterRound),
      revealDurationSeconds,
    },
    noMarketRange: true,
    poolSize: positiveInteger(source.poolSize, 30, { min: 5, max: 250 }),
    revealDurationSeconds,
    revealAllBidsAfterRound: bool(source.revealAllBidsAfterRound ?? multiplayer.revealAllBidsAfterRound),
    revealTruePrice: bool(source.revealTruePrice),
    revealTrueSeason: bool(source.revealTrueSeason),
    rosterSize: positiveInteger(source.rosterSize, 5, { min: 1, max: 15 }),
    salaryCap: positiveInteger(source.salaryCap, 1000, { min: 1, max: 100000 }),
    scoreToPriceMultiplier: numericValue(source.scoreToPriceMultiplier, 1) || 1,
    seasonPool: normalizeSeasonPool(source.seasonPool),
    statMode: normalizeStatMode(source.statMode),
  };
}

function normalizeSeasonPool(value) {
  const seasonPool = String(value || "");
  const allowed = new Set([
    "all-time",
    "current",
    "2020s",
    "2010s",
    "2000s",
    "1990s",
    "1980s",
    "1970s",
    "1960s",
    "1950s",
    "custom",
  ]);

  return allowed.has(seasonPool) ? seasonPool : "all-time";
}

function mysterySeasonPoolRange(settings) {
  if (settings.seasonPool === "all-time") {
    return null;
  }

  if (settings.seasonPool === "current") {
    return { endYear: 2026, startYear: 2026 };
  }

  if (settings.seasonPool === "custom") {
    return {
      endYear: positiveInteger(settings.customEndYear, 2009, { min: 1949, max: 2026 }),
      startYear: positiveInteger(settings.customStartYear, 2000, { min: 1949, max: 2026 }),
    };
  }

  const startYear = Number(settings.seasonPool.slice(0, 4));

  return {
    endYear: Math.min(startYear + 9, 2026),
    startYear,
  };
}

function careerSeasonInMysteryPool(season, settings) {
  const range = mysterySeasonPoolRange(settings);

  if (!range) {
    return true;
  }

  const endYear = seasonEndYear(season?.season);

  return typeof endYear === "number" && endYear >= range.startYear && endYear <= range.endYear;
}

function canonicalEra(era) {
  return era === "40's" || era === "50's" ? "60's" : era;
}

function eraForCareerSeason(season) {
  return canonicalEra(seasonEra(season?.season) || String(season?.era || ""));
}

function seasonLabel(season) {
  return String(season?.season || "").trim() || "Unknown season";
}

function cardSeasonLabel(season) {
  return String(seasonEndYear(season?.season) ?? seasonLabel(season));
}

function fullEraLabel(era) {
  const canonical = canonicalEra(era);
  const decade = Number(String(canonical).slice(0, 2));

  if (Number.isNaN(decade)) {
    return canonical;
  }

  return `${decade >= 40 ? 1900 + decade : 2000 + decade}s`;
}

function seasonIdentity(player, selection, season, index) {
  return [
    player.id,
    selection.team,
    canonicalEra(selection.era),
    String(season?.season ?? "season"),
    String(index),
  ].join(":");
}

function teamEraStintKey(playerId, team, era) {
  return `${playerId}:${team}:${canonicalEra(era)}`;
}

function possibleYearRange(seasons) {
  const years = seasons
    .map((season) => season.seasonEndYear)
    .filter((year) => typeof year === "number" && Number.isFinite(year));

  if (!years.length) {
    return "Unknown";
  }

  const min = Math.min(...years);
  const max = Math.max(...years);

  return min === max ? String(min) : `${min}-${max}`;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function positionInfoForPlayer(player, season) {
  const seasonPositions = Array.isArray(season?.positions) ? season.positions : [];
  const playerPositions = Array.isArray(player?.positions) ? player.positions : [];
  const primaryPosition = String(season?.primary_position || player?.primary_position || playerPositions[0] || "").trim() || null;
  const eligiblePositions = uniqueValues([...seasonPositions, ...playerPositions, primaryPosition]).map(String);

  return {
    eligiblePositions: eligiblePositions.length ? eligiblePositions : ["PG", "SG", "SF", "PF", "C"],
    primaryPosition,
  };
}

function getPlayerImageUrl(player) {
  const id = String(player?.nba_stats_id || "").trim();

  return id ? `${NBA_CDN_HEADSHOT_BASE_URL}/${encodeURIComponent(id)}.png` : null;
}

function calculateSeasonReservePrice(score, settings) {
  return Math.max(0, Math.round(score * settings.scoreToPriceMultiplier));
}

async function readLeagueAverages() {
  if (!leagueAveragesPromise) {
    leagueAveragesPromise = readJson(LEAGUE_AVERAGES_PATH).catch((error) => {
      leagueAveragesPromise = null;
      throw error;
    });
  }

  return leagueAveragesPromise;
}

function scoreCandidateSeason({ index, player, season, selection, settings, statsEngineConfig }) {
  const statScore = calculatePlayerSeasonScore({
    playerSeason: season,
    statMode: settings.statMode,
    statsEngineConfig,
  });

  if (statScore.score === null) {
    return null;
  }

  const accoladeScore = playerAccoladeScoreForSelection(player, selection);
  const statScoreOnly = statScore.totalScore;
  const score = rounded(statScoreOnly + accoladeScore, 2);
  const positionInfo = positionInfoForPlayer(player, season);

  return {
    accoladeScore,
    cardSeasonLabel: cardSeasonLabel(season),
    eligiblePositions: positionInfo.eligiblePositions,
    primaryPosition: positionInfo.primaryPosition,
    rawStats: {
      apg: statScore.displayStats.assists,
      mpg: statScore.displayStats.mpg,
      ppg: statScore.displayStats.points,
      rpg: statScore.displayStats.rebounds,
      tsStarPct: statScore.displayStats.tsHybrid,
      weightedWs48: statScore.displayStats.ws48,
    },
    reservePrice: calculateSeasonReservePrice(score, settings),
    score,
    seasonEndYear: seasonEndYear(season?.season),
    seasonId: seasonIdentity(player, selection, season, index),
    seasonLabel: seasonLabel(season),
    sourceSeason: season,
    statScore,
    statScoreOnly,
  };
}

function playerIsTop100(player) {
  const rank = Number(player?.goat_rank || 0);
  const goatScore = Number(player?.goat_score || 0);

  return (rank >= 1 && rank <= 100) || goatScore > 0;
}

function playerIsCurrentlyActive(player) {
  if (typeof player?.is_active === "boolean") {
    return player.is_active;
  }

  if (typeof player?.active === "boolean") {
    return player.active;
  }

  const currentTeam = String(player?.current_team || "").trim().toLowerCase();

  return Boolean(currentTeam && currentTeam !== "retired" && currentTeam !== "none" && currentTeam !== "n/a");
}

function buildCandidateStints(players, settings, statsEngineConfig) {
  const candidates = [];

  for (const player of players) {
    if (!player?.id || !player?.name || !Array.isArray(player.career_seasons)) {
      continue;
    }

    const groupedSelections = new Map();

    for (const season of player.career_seasons) {
      const team = String(season?.team || "").trim();
      const era = eraForCareerSeason(season);

      if (!team || !era || !careerSeasonInMysteryPool(season, settings)) {
        continue;
      }

      groupedSelections.set(teamEraStintKey(player.id, team, era), { team, era });
    }

    for (const [stintKey, selection] of groupedSelections.entries()) {
      const eligibleSeasons = player.career_seasons
        .filter(
          (season) =>
            season?.team === selection.team &&
            eraForCareerSeason(season) === canonicalEra(selection.era) &&
            careerSeasonInMysteryPool(season, settings),
        )
        .map((season, index) =>
          scoreCandidateSeason({
            index,
            player,
            season,
            selection,
            settings,
            statsEngineConfig,
          }),
        )
        .filter(Boolean)
        .sort((first, second) => {
          const firstYear = first.seasonEndYear ?? 0;
          const secondYear = second.seasonEndYear ?? 0;

          return firstYear - secondYear || first.seasonLabel.localeCompare(second.seasonLabel);
        });

      if (!eligibleSeasons.length) {
        continue;
      }

      const hiddenSeason = weightedRandomItem(eligibleSeasons, (season) => Math.max(1, season.score));
      const eligiblePositions = uniqueValues(eligibleSeasons.flatMap((season) => season.eligiblePositions));
      const primaryPosition = eligibleSeasons.find((season) => season.primaryPosition)?.primaryPosition ?? null;
      const sourceTags = {
        activeStar: playerIsCurrentlyActive(player),
        award: eligibleSeasons.some((season) => season.accoladeScore > 0),
        top100: playerIsTop100(player),
        wildcard: true,
      };

      candidates.push({
        active: sourceTags.activeStar,
        accoladeScore: Math.max(...eligibleSeasons.map((season) => season.accoladeScore)),
        averageScore: eligibleSeasons.reduce((sum, season) => sum + season.score, 0) / eligibleSeasons.length,
        cardSeasonLabel: hiddenSeason.cardSeasonLabel,
        eligiblePositions,
        era: selection.era,
        eraLabel: fullEraLabel(selection.era),
        hiddenSeason,
        playerId: player.id,
        playerImageUrl: getPlayerImageUrl(player),
        playerName: player.name,
        possibleSeasonLabels: eligibleSeasons.map((season) => season.seasonLabel),
        possibleYearRange: possibleYearRange(eligibleSeasons),
        primaryPosition,
        score: hiddenSeason.score,
        sourceTags,
        statMode: settings.statMode,
        statModeLabel: STAT_MODE_LABELS[settings.statMode],
        stintKey,
        team: selection.team,
      });
    }
  }

  return candidates;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function weightedRandomItem(items, weightForItem) {
  const weights = items.map((item) => Math.max(0, Number(weightForItem(item) || 0)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) {
    return randomItem(items);
  }

  let cursor = Math.random() * total;

  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];

    if (cursor <= 0) {
      return items[index];
    }
  }

  return items[items.length - 1];
}

function weightedRandomPoolSource(settings, availableCandidates) {
  const sources = POOL_SOURCES.filter((source) =>
    availableCandidates.some((candidate) => candidate.sourceTags[source]),
  );
  const weights = sources.map((source) => Math.max(0, Number(settings[source] || 0)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (!sources.length) {
    return "wildcard";
  }

  if (total <= 0) {
    return "wildcard";
  }

  let cursor = Math.random() * total;

  for (let index = 0; index < sources.length; index += 1) {
    cursor -= weights[index];

    if (cursor <= 0) {
      return sources[index];
    }
  }

  return sources[sources.length - 1];
}

function poolItemFromCandidate(candidate, poolIndex) {
  const hiddenSeason = candidate.hiddenSeason;

  return {
    accoladeScore: hiddenSeason.accoladeScore,
    baseScore: hiddenSeason.score,
    cardSeasonLabel: hiddenSeason.cardSeasonLabel,
    eligiblePositions: candidate.eligiblePositions,
    era: candidate.era,
    eraLabel: candidate.eraLabel,
    finalScore: hiddenSeason.score,
    hiddenSeasonId: hiddenSeason.seasonId,
    playerId: candidate.playerId,
    playerImageUrl: candidate.playerImageUrl,
    playerName: candidate.playerName,
    playerSeasonId: hiddenSeason.seasonId,
    poolIndex,
    possibleSeasonLabels: candidate.possibleSeasonLabels,
    possibleYearRange: candidate.possibleYearRange,
    primaryPosition: candidate.primaryPosition,
    rawStats: hiddenSeason.rawStats,
    seasonEndYear: hiddenSeason.seasonEndYear,
    seasonId: hiddenSeason.seasonId,
    seasonLabel: hiddenSeason.seasonLabel,
    statMode: candidate.statMode,
    statModeLabel: candidate.statModeLabel,
    statScore: hiddenSeason.statScore,
    statScoreOnly: hiddenSeason.statScoreOnly,
    stintKey: candidate.stintKey,
    team: candidate.team,
    truePrice: hiddenSeason.reservePrice,
  };
}

async function generateMultiplayerDraftPool(settings) {
  const [players, leagueAverages] = await Promise.all([readPlayers(), readLeagueAverages().catch(() => ({}))]);
  const statsEngineConfig = { leagueAverages };
  const candidates = buildCandidateStints(players, settings, statsEngineConfig);
  const selected = [];
  const usedPlayerIds = new Set();
  const usedStintKeys = new Set();

  while (selected.length < settings.poolSize) {
    const availableCandidates = candidates.filter(
      (candidate) =>
        !usedStintKeys.has(candidate.stintKey) &&
        (settings.allowDuplicatePlayers || !usedPlayerIds.has(candidate.playerId)),
    );

    if (!availableCandidates.length) {
      break;
    }

    const source = weightedRandomPoolSource(settings, availableCandidates);
    const sourceCandidates = availableCandidates.filter((candidate) => candidate.sourceTags[source]);
    const candidate = weightedRandomItem(
      sourceCandidates.length ? sourceCandidates : availableCandidates,
      (item) => Math.max(1, item.score),
    );

    selected.push(candidate);
    usedPlayerIds.add(candidate.playerId);
    usedStintKeys.add(candidate.stintKey);
  }

  return selected.map(poolItemFromCandidate);
}

const lobbyParticipantInclude = {
  participants: {
    orderBy: { joinedAt: "asc" },
  },
};

function lobbyGameInclude() {
  return {
    ...lobbyParticipantInclude,
    game: true,
  };
}

function serializeParticipant(participant) {
  return {
    clientId: participant.clientId,
    id: participant.id,
    isHost: participant.isHost,
    joinedAt: participant.joinedAt,
    lobbyId: participant.lobbyId,
    name: participant.name,
    userId: participant.userId,
  };
}

function serializeLobby(lobby) {
  return {
    code: lobby.code,
    createdAt: lobby.createdAt,
    hostUserId: lobby.hostUserId,
    id: lobby.id,
    settings: lobby.settings,
    status: lobby.status,
    updatedAt: lobby.updatedAt,
  };
}

function serializeRound(round) {
  if (!round) {
    return null;
  }

  return {
    bidEndsAt: round.bidEndsAt,
    bidStartedAt: round.bidStartedAt,
    gameId: round.gameId,
    id: round.id,
    noBid: round.noBid,
    playerSeasonId: round.playerSeasonId,
    revealEndsAt: round.revealEndsAt,
    resolvedAt: round.resolvedAt,
    roundIndex: round.roundIndex,
    status: round.status,
    winnerParticipantId: round.winnerParticipantId,
    winningBid: round.winningBid,
  };
}

function serializeBid(bid, participantById, { revealAmount = false, viewerParticipantId = null } = {}) {
  const participant = participantById.get(bid.participantId);
  const isOwnSubmission = Boolean(viewerParticipantId && bid.participantId === viewerParticipantId);
  const canShowAmount = revealAmount || isOwnSubmission;

  return {
    amount: canShowAmount ? bid.amount : null,
    createdAt: bid.createdAt,
    id: bid.id,
    isOwnSubmission,
    isPass: canShowAmount ? bid.amount <= 0 : null,
    participantId: bid.participantId,
    participantName: participant?.name ?? "Player",
    roundId: bid.roundId,
  };
}

function serializeGame(game, pool) {
  if (!game) {
    return null;
  }

  return {
    createdAt: game.createdAt,
    currentRoundIndex: game.currentRoundIndex,
    id: game.id,
    lobbyId: game.lobbyId,
    poolSize: pool.length,
    settings: game.settings,
    status: game.status,
    updatedAt: game.updatedAt,
  };
}

async function findLobbyByCodeOrId(tx, codeOrId, include = lobbyGameInclude()) {
  const normalizedCode = normalizeLobbyCode(codeOrId);
  const trimmed = String(codeOrId || "").trim();

  if (!normalizedCode && !trimmed) {
    return null;
  }

  return tx.multiplayerLobby.findFirst({
    include,
    where: {
      OR: [
        { code: normalizedCode },
        { id: trimmed },
      ],
    },
  });
}

function parsePool(game) {
  return Array.isArray(game?.pool) ? game.pool : [];
}

function poolItemForRound(game, round) {
  const pool = parsePool(game);

  return pool.find((item) => item.playerSeasonId === round?.playerSeasonId) ?? pool[round?.roundIndex] ?? null;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function bidOrder(first, second) {
  return second.amount - first.amount || new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
}

async function createRoundForIndex(tx, game, roundIndex, now = new Date()) {
  const settings = normalizeGameSettings(game.settings);
  const pool = parsePool(game);
  const player = pool[roundIndex];

  if (!player) {
    return null;
  }

  return tx.multiplayerRound.upsert({
    create: {
      bidEndsAt: addSeconds(now, settings.bidTimerSeconds),
      bidStartedAt: now,
      gameId: game.id,
      playerSeasonId: player.playerSeasonId,
      roundIndex,
      status: ROUND_STATUSES.BIDDING,
    },
    update: {},
    where: {
      gameId_roundIndex: {
        gameId: game.id,
        roundIndex,
      },
    },
  });
}

async function startMultiplayerGame({ lobbyId, participantId }) {
  const prisma = getPrismaForMultiplayerGame();
  const lobby = await prisma.multiplayerLobby.findUnique({
    include: lobbyGameInclude(),
    where: { id: String(lobbyId || "") },
  });

  if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
    throw httpError(404, "Lobby not found.");
  }

  const participant = lobby.participants.find((candidate) => candidate.id === participantId);

  if (!participant?.isHost) {
    throw httpError(403, "Only the host can start this lobby.");
  }

  if (lobby.game) {
    return getMultiplayerGameState(lobby.code, { participantId });
  }

  if (![LOBBY_STATUSES.WAITING, LOBBY_STATUSES.STARTED].includes(lobby.status)) {
    throw httpError(409, "This lobby cannot be started.");
  }

  const settings = normalizeGameSettings(lobby.settings);
  const pool = await generateMultiplayerDraftPool(settings);

  if (!pool.length) {
    throw httpError(422, "Unable to generate a multiplayer draft pool with the selected settings.");
  }

  await prisma.$transaction(async (tx) => {
    const freshLobby = await tx.multiplayerLobby.findUnique({
      include: lobbyGameInclude(),
      where: { id: lobby.id },
    });

    if (!freshLobby || freshLobby.status === LOBBY_STATUSES.ABANDONED) {
      throw httpError(404, "Lobby not found.");
    }

    if (freshLobby.game) {
      return;
    }

    const freshParticipant = freshLobby.participants.find((candidate) => candidate.id === participantId);

    if (!freshParticipant?.isHost) {
      throw httpError(403, "Only the host can start this lobby.");
    }

    const game = await tx.multiplayerGame.create({
      data: {
        currentRoundIndex: 0,
        lobbyId: freshLobby.id,
        pool,
        settings,
        status: GAME_STATUSES.ACTIVE,
      },
    });

    await createRoundForIndex(tx, game, 0);
    await tx.multiplayerLobby.update({
      data: {
        settings,
        status: LOBBY_STATUSES.STARTED,
      },
      where: { id: freshLobby.id },
    });
  });

  return getMultiplayerGameState(lobby.code, { participantId });
}

async function getCurrentRound(tx, game) {
  if (!game) {
    return null;
  }

  return tx.multiplayerRound.findFirst({
    include: {
      bids: {
        orderBy: { createdAt: "asc" },
      },
    },
    where: {
      gameId: game.id,
      roundIndex: game.currentRoundIndex,
    },
  });
}

async function internalResolveMultiplayerRound(tx, game, round, now = new Date()) {
  if (!round || round.status !== ROUND_STATUSES.BIDDING || round.resolvedAt) {
    return round;
  }

  const settings = normalizeGameSettings(game.settings);
  const roundWithBids = await tx.multiplayerRound.findUnique({
    include: {
      bids: {
        orderBy: [{ amount: "desc" }, { createdAt: "asc" }],
      },
    },
    where: { id: round.id },
  });

  if (!roundWithBids || roundWithBids.status !== ROUND_STATUSES.BIDDING || roundWithBids.resolvedAt) {
    return roundWithBids;
  }

  const revealEndsAt = addSeconds(now, settings.revealDurationSeconds);
  const winningBid = [...roundWithBids.bids].filter((bid) => bid.amount > 0).sort(bidOrder)[0] ?? null;

  if (!winningBid) {
    return tx.multiplayerRound.update({
      data: {
        noBid: true,
        resolvedAt: now,
        revealEndsAt,
        status: ROUND_STATUSES.REVEALED,
      },
      where: { id: roundWithBids.id },
    });
  }

  const player = poolItemForRound(game, roundWithBids);

  await tx.multiplayerRosterPick.upsert({
    create: {
      baseScore: Number(player?.baseScore || 0),
      finalScore: Number(player?.finalScore ?? player?.baseScore ?? 0),
      gameId: game.id,
      paidAmount: winningBid.amount,
      participantId: winningBid.participantId,
      playerSeasonId: roundWithBids.playerSeasonId,
      roundId: roundWithBids.id,
    },
    update: {},
    where: { roundId: roundWithBids.id },
  });

  return tx.multiplayerRound.update({
    data: {
      noBid: false,
      resolvedAt: now,
      revealEndsAt,
      status: ROUND_STATUSES.REVEALED,
      winnerParticipantId: winningBid.participantId,
      winningBid: winningBid.amount,
    },
    where: { id: roundWithBids.id },
  });
}

async function resolveMultiplayerRound(gameId, roundId) {
  const prisma = getPrismaForMultiplayerGame();

  return prisma.$transaction(async (tx) => {
    const game = await tx.multiplayerGame.findUnique({ where: { id: String(gameId || "") } });
    const round = await tx.multiplayerRound.findUnique({
      include: {
        bids: {
          orderBy: [{ amount: "desc" }, { createdAt: "asc" }],
        },
      },
      where: { id: String(roundId || "") },
    });

    if (!game || !round || round.gameId !== game.id) {
      throw httpError(404, "Round not found.");
    }

    return internalResolveMultiplayerRound(tx, game, round);
  });
}

function rosterStatsForParticipants(participants, rosterPicks, settings) {
  const stats = new Map();

  for (const participant of participants) {
    stats.set(participant.id, {
      count: 0,
      remainingBudget: settings.salaryCap,
      spent: 0,
      totalScore: 0,
    });
  }

  for (const pick of rosterPicks) {
    const stat = stats.get(pick.participantId);

    if (!stat) {
      continue;
    }

    stat.count += 1;
    stat.spent += pick.paidAmount;
    stat.remainingBudget = settings.salaryCap - stat.spent;
    stat.totalScore = rounded(stat.totalScore + pick.finalScore, 2);
  }

  return stats;
}

function shouldCompleteGame({ participants, pool, rosterPicks, settings, nextRoundIndex }) {
  const rosterStats = rosterStatsForParticipants(participants, rosterPicks, settings);
  const allRostersFull = participants.length > 0 && participants.every(
    (participant) => (rosterStats.get(participant.id)?.count || 0) >= settings.rosterSize,
  );
  const poolExhausted = nextRoundIndex >= pool.length;
  const eligibleParticipants = participants.filter((participant) => {
    const stats = rosterStats.get(participant.id);

    return (
      stats &&
      stats.count < settings.rosterSize &&
      stats.remainingBudget >= settings.minimumBid
    );
  });

  return allRostersFull || poolExhausted || eligibleParticipants.length === 0;
}

async function internalAdvanceMultiplayerRound(tx, game, round, now = new Date()) {
  if (!game || game.status === GAME_STATUSES.COMPLETED || !round || round.status !== ROUND_STATUSES.REVEALED) {
    return { advanced: false, game };
  }

  if (round.revealEndsAt && now < round.revealEndsAt) {
    return { advanced: false, game };
  }

  const settings = normalizeGameSettings(game.settings);
  const pool = parsePool(game);
  const lobby = await tx.multiplayerLobby.findUnique({
    include: lobbyParticipantInclude,
    where: { id: game.lobbyId },
  });
  const rosterPicks = await tx.multiplayerRosterPick.findMany({
    where: { gameId: game.id },
  });
  const nextRoundIndex = game.currentRoundIndex + 1;

  await tx.multiplayerRound.update({
    data: { status: ROUND_STATUSES.COMPLETED },
    where: { id: round.id },
  });

  if (
    shouldCompleteGame({
      nextRoundIndex,
      participants: lobby?.participants || [],
      pool,
      rosterPicks,
      settings,
    })
  ) {
    const completedGame = await tx.multiplayerGame.update({
      data: { status: GAME_STATUSES.COMPLETED },
      where: { id: game.id },
    });

    await tx.multiplayerLobby.update({
      data: { status: LOBBY_STATUSES.COMPLETED },
      where: { id: game.lobbyId },
    });

    return { advanced: true, game: completedGame };
  }

  const updatedGame = await tx.multiplayerGame.update({
    data: { currentRoundIndex: nextRoundIndex },
    where: { id: game.id },
  });

  await createRoundForIndex(tx, updatedGame, nextRoundIndex, now);

  return { advanced: true, game: updatedGame };
}

async function advanceMultiplayerRound(gameId) {
  const prisma = getPrismaForMultiplayerGame();

  return prisma.$transaction(async (tx) => {
    const game = await tx.multiplayerGame.findUnique({ where: { id: String(gameId || "") } });
    const round = await getCurrentRound(tx, game);

    if (!game) {
      throw httpError(404, "Game not found.");
    }

    return internalAdvanceMultiplayerRound(tx, game, round);
  });
}

async function syncMultiplayerGameState(gameId) {
  const prisma = getPrismaForMultiplayerGame();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const progressed = await prisma.$transaction(async (tx) => {
      const game = await tx.multiplayerGame.findUnique({ where: { id: String(gameId || "") } });

      if (!game || game.status === GAME_STATUSES.COMPLETED) {
        return false;
      }

      const round = await getCurrentRound(tx, game);
      const now = new Date();

      if (!round) {
        const pool = parsePool(game);

        if (game.currentRoundIndex >= pool.length) {
          await tx.multiplayerGame.update({
            data: { status: GAME_STATUSES.COMPLETED },
            where: { id: game.id },
          });
          await tx.multiplayerLobby.update({
            data: { status: LOBBY_STATUSES.COMPLETED },
            where: { id: game.lobbyId },
          });
          return true;
        }

        await createRoundForIndex(tx, game, game.currentRoundIndex, now);
        return true;
      }

      if (round.status === ROUND_STATUSES.BIDDING && now >= round.bidEndsAt) {
        await internalResolveMultiplayerRound(tx, game, round, now);
        return true;
      }

      if (round.status === ROUND_STATUSES.REVEALED && round.revealEndsAt && now >= round.revealEndsAt) {
        const result = await internalAdvanceMultiplayerRound(tx, game, round, now);
        return result.advanced;
      }

      return false;
    });

    if (!progressed) {
      break;
    }
  }
}

async function submitMultiplayerBid({ amount, codeOrId, participantId, roundId }) {
  const prisma = getPrismaForMultiplayerGame();
  const parsedAmount = Number(amount);

  if (!Number.isInteger(parsedAmount) || parsedAmount < 0) {
    throw httpError(400, "Bid amount must be a whole number.");
  }

  const lobbyCode = String(codeOrId || "");
  const participantIdValue = String(participantId || "");

  try {
    await prisma.$transaction(async (tx) => {
      const lobby = await findLobbyByCodeOrId(tx, lobbyCode, lobbyGameInclude());

      if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
        throw httpError(404, "Lobby not found.");
      }

      if (lobby.status !== LOBBY_STATUSES.STARTED || !lobby.game || lobby.game.status !== GAME_STATUSES.ACTIVE) {
        throw httpError(409, "This multiplayer game is not accepting bids.");
      }

      const participant = lobby.participants.find((candidate) => candidate.id === participantIdValue);

      if (!participant) {
        throw httpError(403, "Participant is not in this lobby.");
      }

      const settings = normalizeGameSettings(lobby.game.settings);
      const round = await getCurrentRound(tx, lobby.game);
      const now = new Date();

      if (!round || round.id !== roundId || round.status !== ROUND_STATUSES.BIDDING) {
        throw httpError(409, "This round is not accepting bids.");
      }

      if (now >= round.bidEndsAt) {
        throw httpError(409, "Bidding has ended for this player.");
      }

      const rosterPicks = await tx.multiplayerRosterPick.findMany({
        where: {
          gameId: lobby.game.id,
        },
      });
      const participantRosterPicks = rosterPicks.filter((pick) => pick.participantId === participant.id);
      const spent = participantRosterPicks.reduce((sum, pick) => sum + pick.paidAmount, 0);
      const remainingBudget = settings.salaryCap - spent;
      const isPass = parsedAmount === 0;

      if (participantRosterPicks.length >= settings.rosterSize) {
        throw httpError(409, "Roster is full.");
      }

      if (!isPass && parsedAmount < settings.minimumBid) {
        throw httpError(400, `Minimum bid is $${settings.minimumBid}.`);
      }

      if (parsedAmount > remainingBudget) {
        throw httpError(400, "Bid cannot exceed remaining salary cap.");
      }

      await tx.multiplayerBid.create({
        data: {
          amount: parsedAmount,
          participantId: participant.id,
          roundId: round.id,
        },
      });

      const rosterStats = rosterStatsForParticipants(lobby.participants, rosterPicks, settings);
      const submissionParticipantIds = lobby.participants
        .filter((candidate) => {
          const stats = rosterStats.get(candidate.id);

          return (
            stats &&
            stats.count < settings.rosterSize &&
            stats.remainingBudget >= settings.minimumBid
          );
        })
        .map((candidate) => candidate.id);

      if (submissionParticipantIds.length) {
        const submissionCount = await tx.multiplayerBid.count({
          where: {
            participantId: { in: submissionParticipantIds },
            roundId: round.id,
          },
        });

        if (submissionCount >= submissionParticipantIds.length) {
          await internalResolveMultiplayerRound(tx, lobby.game, round, now);
        }
      }
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw httpError(409, "You already submitted for this player.");
    }

    throw error;
  }

  return getMultiplayerGameState(lobbyCode, { participantId: participantIdValue });
}

function bestPickForRoster(picks) {
  return [...picks].sort((first, second) => second.finalScore - first.finalScore)[0] ?? null;
}

function mostExpensivePickForRoster(picks) {
  return [...picks].sort((first, second) => second.paidAmount - first.paidAmount)[0] ?? null;
}

function buildRosterPick(pick, pool) {
  const player = pool.find((item) => item.playerSeasonId === pick.playerSeasonId) ?? null;

  return {
    baseScore: pick.baseScore,
    createdAt: pick.createdAt,
    finalScore: pick.finalScore,
    id: pick.id,
    paidAmount: pick.paidAmount,
    player,
    playerName: player?.playerName ?? "Unknown Player",
    playerSeasonId: pick.playerSeasonId,
    roundId: pick.roundId,
    seasonLabel: player?.seasonLabel ?? null,
    team: player?.team ?? null,
  };
}

function buildRosters({ participants, pool, rosterPicks, settings }) {
  return participants.map((participant) => {
    const picks = rosterPicks
      .filter((pick) => pick.participantId === participant.id)
      .sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime())
      .map((pick) => buildRosterPick(pick, pool));
    const spent = picks.reduce((sum, pick) => sum + pick.paidAmount, 0);
    const totalScore = rounded(picks.reduce((sum, pick) => sum + pick.finalScore, 0), 2);
    const bestPick = bestPickForRoster(picks);
    const mostExpensivePick = mostExpensivePickForRoster(picks);

    return {
      bestPick,
      count: picks.length,
      isFull: picks.length >= settings.rosterSize,
      mostExpensivePick,
      participantId: participant.id,
      participantName: participant.name,
      picks,
      remainingBudget: settings.salaryCap - spent,
      rosterSize: settings.rosterSize,
      spent,
      totalScore,
    };
  });
}

function buildStandings(rosters) {
  const sortedRosters = [...rosters].sort(
    (first, second) =>
      second.totalScore - first.totalScore ||
      second.remainingBudget - first.remainingBudget ||
      first.spent - second.spent ||
      first.participantName.localeCompare(second.participantName),
  );
  const standings = [];

  for (let index = 0; index < sortedRosters.length; index += 1) {
    const roster = sortedRosters[index];
    const previousRoster = sortedRosters[index - 1];
    const previousStanding = standings[index - 1];
    const tiedWithPrevious =
      previousRoster &&
      previousRoster.totalScore === roster.totalScore &&
      previousRoster.remainingBudget === roster.remainingBudget &&
      previousRoster.spent === roster.spent;

    standings.push({
      bestPick: roster.bestPick,
      isTie: Boolean(tiedWithPrevious),
      mostExpensivePick: roster.mostExpensivePick,
      participantId: roster.participantId,
      participantName: roster.participantName,
      rank: tiedWithPrevious && previousStanding ? previousStanding.rank : index + 1,
      remainingBudget: roster.remainingBudget,
      roster: roster.picks,
      spent: roster.spent,
      totalScore: roster.totalScore,
    });
  }

  return standings;
}

async function buildFullGameState(tx, lobbyId, { participantId = null } = {}) {
  const lobby = await tx.multiplayerLobby.findUnique({
    include: lobbyGameInclude(),
    where: { id: lobbyId },
  });

  if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
    throw httpError(404, "Lobby not found.");
  }

  const participants = lobby.participants.map(serializeParticipant);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  if (!lobby.game) {
    return {
      bids: [],
      budgets: {},
      currentPlayer: null,
      currentRound: null,
      game: null,
      highestBid: null,
      lobby: serializeLobby(lobby),
      participants,
      rosters: [],
      serverTime: new Date(),
      standings: [],
    };
  }

  const settings = normalizeGameSettings(lobby.game.settings);
  const pool = parsePool(lobby.game);
  const [currentRound, rosterPicks] = await Promise.all([
    getCurrentRound(tx, lobby.game),
    tx.multiplayerRosterPick.findMany({
      orderBy: { createdAt: "asc" },
      where: { gameId: lobby.game.id },
    }),
  ]);
  const shouldRevealAllBidAmounts =
    Boolean(currentRound) &&
    currentRound.status !== ROUND_STATUSES.BIDDING;
  const bids = (currentRound?.bids || []).map((bid) =>
    serializeBid(bid, participantById, {
      revealAmount: shouldRevealAllBidAmounts,
      viewerParticipantId: participantId,
    }),
  );
  const highestBidRaw =
    currentRound?.status === ROUND_STATUSES.BIDDING
      ? null
      : (currentRound?.bids || []).find((bid) => bid.participantId === currentRound?.winnerParticipantId) ?? null;
  const highestBid = highestBidRaw
    ? serializeBid(highestBidRaw, participantById, {
      revealAmount: true,
      viewerParticipantId: participantId,
    })
    : null;
  const currentPlayer = currentRound ? poolItemForRound(lobby.game, currentRound) : null;
  const rosters = buildRosters({
    participants,
    pool,
    rosterPicks,
    settings,
  });
  const budgets = Object.fromEntries(rosters.map((roster) => [roster.participantId, roster.remainingBudget]));

  return {
    bids,
    budgets,
    currentPlayer,
    currentRound: serializeRound(currentRound),
    game: serializeGame(lobby.game, pool),
    highestBid,
    lobby: serializeLobby(lobby),
    participants,
    rosters,
    serverTime: new Date(),
    standings: buildStandings(rosters),
  };
}

async function getMultiplayerGameState(codeOrId, options = {}) {
  const prisma = getPrismaForMultiplayerGame();
  const lobby = await findLobbyByCodeOrId(prisma, codeOrId, lobbyGameInclude());

  if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
    throw httpError(404, "Lobby not found.");
  }

  if (lobby.game) {
    await syncMultiplayerGameState(lobby.game.id);
  }

  return buildFullGameState(prisma, lobby.id, options);
}

module.exports = {
  GAME_STATUSES,
  ROUND_STATUSES,
  advanceMultiplayerRound,
  generateMultiplayerDraftPool,
  getMultiplayerGameState,
  normalizeGameSettings,
  resolveMultiplayerRound,
  startMultiplayerGame,
  submitMultiplayerBid,
  syncMultiplayerGameState,
};
