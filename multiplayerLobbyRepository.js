const { getPrismaClient } = require("./db");

const LOBBY_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 30;
const LOBBY_STATUSES = Object.freeze({
  ABANDONED: "abandoned",
  COMPLETED: "completed",
  STARTED: "started",
  WAITING: "waiting",
});

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
}

function normalizeLobbyCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value, fallback) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");

  return (trimmed || fallback).slice(0, 32);
}

function normalizeClientId(value) {
  const trimmed = String(value || "").trim();

  return trimmed ? trimmed.slice(0, 120) : null;
}

function generateLobbyCode(length = LOBBY_CODE_LENGTH) {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += LOBBY_CODE_CHARS[Math.floor(Math.random() * LOBBY_CODE_CHARS.length)];
  }

  return code;
}

async function generateUniqueLobbyCode(prisma) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateLobbyCode();
    const existingLobby = await prisma.multiplayerLobby.findUnique({
      select: { id: true },
      where: { code },
    });

    if (!existingLobby) {
      return code;
    }
  }

  throw httpError(500, "Unable to generate a unique lobby code.");
}

function normalizeMultiplayerSettings(settings) {
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const multiplayer = source.multiplayer && typeof source.multiplayer === "object" ? source.multiplayer : {};
  const bidTimerSeconds = Number.isFinite(Number(source.bidTimerSeconds ?? multiplayer.bidTimerSeconds))
    ? Number(source.bidTimerSeconds ?? multiplayer.bidTimerSeconds)
    : 20;
  const revealDurationSeconds = Number.isFinite(Number(source.revealDurationSeconds ?? multiplayer.revealDurationSeconds))
    ? Number(source.revealDurationSeconds ?? multiplayer.revealDurationSeconds)
    : 4;
  const minimumBid = Number.isFinite(Number(source.minimumBid ?? source.minimumOffer))
    ? Number(source.minimumBid ?? source.minimumOffer)
    : 1;
  const bidIncrement = Number.isFinite(Number(source.bidIncrement ?? source.offerIncrement))
    ? Number(source.bidIncrement ?? source.offerIncrement)
    : 1;
  const revealAllBidsAfterRound = Boolean(source.revealAllBidsAfterRound ?? multiplayer.revealAllBidsAfterRound);

  return {
    ...source,
    bidIncrement,
    bidTimerSeconds,
    gameMode: "multiplayer",
    highestBidWins: true,
    minimumBid,
    noMarketRange: true,
    poolSize: Number.isFinite(Number(source.poolSize)) ? Number(source.poolSize) : 30,
    revealAllBidsAfterRound,
    revealDurationSeconds,
    revealTruePrice: Boolean(source.revealTruePrice),
    revealTrueSeason: Boolean(source.revealTrueSeason),
    multiplayer: {
      ...multiplayer,
      bidTimerSeconds,
      highestBidWins: true,
      noMarketRange: true,
      revealAllBidsAfterRound,
      revealDurationSeconds,
    },
  };
}

const lobbyWithParticipants = {
  participants: {
    orderBy: { joinedAt: "asc" },
  },
};

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
  const participants = (lobby.participants || []).map(serializeParticipant);

  return {
    lobby: {
      code: lobby.code,
      createdAt: lobby.createdAt,
      hostUserId: lobby.hostUserId,
      id: lobby.id,
      settings: lobby.settings,
      status: lobby.status,
      updatedAt: lobby.updatedAt,
    },
    participants,
  };
}

function getPrismaForLobby() {
  try {
    return getPrismaClient({ required: true });
  } catch {
    throw httpError(503, "Database is required for multiplayer lobbies.");
  }
}

async function createMultiplayerLobby({ clientId, hostName, settings, userId }) {
  const prisma = getPrismaForLobby();
  const normalizedClientId = normalizeClientId(clientId);
  const normalizedUserId = normalizeClientId(userId);
  const hostUserId = normalizedUserId || normalizedClientId;

  return prisma.$transaction(async (tx) => {
    const code = await generateUniqueLobbyCode(tx);
    const lobby = await tx.multiplayerLobby.create({
      data: {
        code,
        hostUserId,
        settings: normalizeMultiplayerSettings(settings),
        participants: {
          create: {
            clientId: normalizedClientId,
            isHost: true,
            name: normalizeName(hostName, "Host"),
            userId: normalizedUserId,
          },
        },
      },
      include: lobbyWithParticipants,
    });

    return {
      ...serializeLobby(lobby),
      participant: serializeParticipant(lobby.participants[0]),
    };
  });
}

async function findLobbyByCodeOrId(tx, codeOrId) {
  const normalizedCode = normalizeLobbyCode(codeOrId);

  if (!normalizedCode) {
    return null;
  }

  return tx.multiplayerLobby.findFirst({
    include: lobbyWithParticipants,
    where: {
      OR: [
        { code: normalizedCode },
        { id: String(codeOrId || "").trim() },
      ],
    },
  });
}

function existingParticipantForIdentity(participants, { clientId, userId }) {
  return participants.find(
    (participant) =>
      (clientId && participant.clientId === clientId) ||
      (userId && participant.userId === userId),
  );
}

async function joinMultiplayerLobby({ clientId, code, playerName, userId }) {
  const prisma = getPrismaForLobby();
  const normalizedCode = normalizeLobbyCode(code);
  const normalizedClientId = normalizeClientId(clientId);
  const normalizedUserId = normalizeClientId(userId);

  if (!normalizedCode) {
    throw httpError(400, "Lobby code is required.");
  }

  return prisma.$transaction(async (tx) => {
    const lobby = await findLobbyByCodeOrId(tx, normalizedCode);

    if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
      throw httpError(404, "Lobby not found.");
    }

    if (lobby.status !== LOBBY_STATUSES.WAITING) {
      throw httpError(409, "This lobby has already started.");
    }

    const existingParticipant = existingParticipantForIdentity(lobby.participants, {
      clientId: normalizedClientId,
      userId: normalizedUserId,
    });

    if (existingParticipant) {
      return {
        ...serializeLobby(lobby),
        participant: serializeParticipant(existingParticipant),
      };
    }

    const participant = await tx.multiplayerParticipant.create({
      data: {
        clientId: normalizedClientId,
        lobbyId: lobby.id,
        name: normalizeName(playerName, "Player"),
        userId: normalizedUserId,
      },
    });
    const updatedLobby = await tx.multiplayerLobby.findUniqueOrThrow({
      include: lobbyWithParticipants,
      where: { id: lobby.id },
    });

    return {
      ...serializeLobby(updatedLobby),
      participant: serializeParticipant(participant),
    };
  });
}

async function getMultiplayerLobby(codeOrId) {
  const prisma = getPrismaForLobby();
  const lobby = await findLobbyByCodeOrId(prisma, codeOrId);

  if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
    throw httpError(404, "Lobby not found.");
  }

  return serializeLobby(lobby);
}

async function leaveMultiplayerLobby({ lobbyId, participantId }) {
  const prisma = getPrismaForLobby();

  return prisma.$transaction(async (tx) => {
    const lobby = await tx.multiplayerLobby.findUnique({
      include: lobbyWithParticipants,
      where: { id: String(lobbyId || "") },
    });

    if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
      throw httpError(404, "Lobby not found.");
    }

    const participant = lobby.participants.find((candidate) => candidate.id === participantId);

    if (!participant) {
      throw httpError(404, "Participant not found.");
    }

    await tx.multiplayerParticipant.delete({ where: { id: participant.id } });

    const remainingParticipants = lobby.participants.filter((candidate) => candidate.id !== participant.id);

    if (!remainingParticipants.length) {
      const abandonedLobby = await tx.multiplayerLobby.update({
        data: { status: LOBBY_STATUSES.ABANDONED },
        include: lobbyWithParticipants,
        where: { id: lobby.id },
      });

      return serializeLobby(abandonedLobby);
    }

    if (participant.isHost) {
      const nextHost = remainingParticipants[0];

      await tx.multiplayerParticipant.update({
        data: { isHost: true },
        where: { id: nextHost.id },
      });
      await tx.multiplayerLobby.update({
        data: { hostUserId: nextHost.userId || nextHost.clientId },
        where: { id: lobby.id },
      });
    }

    const updatedLobby = await tx.multiplayerLobby.findUniqueOrThrow({
      include: lobbyWithParticipants,
      where: { id: lobby.id },
    });

    return serializeLobby(updatedLobby);
  });
}

async function startMultiplayerLobby({ lobbyId, participantId }) {
  const prisma = getPrismaForLobby();

  return prisma.$transaction(async (tx) => {
    const lobby = await tx.multiplayerLobby.findUnique({
      include: lobbyWithParticipants,
      where: { id: String(lobbyId || "") },
    });

    if (!lobby || lobby.status === LOBBY_STATUSES.ABANDONED) {
      throw httpError(404, "Lobby not found.");
    }

    if (lobby.status !== LOBBY_STATUSES.WAITING) {
      return serializeLobby(lobby);
    }

    const participant = lobby.participants.find((candidate) => candidate.id === participantId);

    if (!participant?.isHost) {
      throw httpError(403, "Only the host can start this lobby.");
    }

    const updatedLobby = await tx.multiplayerLobby.update({
      data: { status: LOBBY_STATUSES.STARTED },
      include: lobbyWithParticipants,
      where: { id: lobby.id },
    });

    return serializeLobby(updatedLobby);
  });
}

module.exports = {
  LOBBY_STATUSES,
  createMultiplayerLobby,
  generateLobbyCode,
  getMultiplayerLobby,
  joinMultiplayerLobby,
  leaveMultiplayerLobby,
  normalizeLobbyCode,
  startMultiplayerLobby,
};
