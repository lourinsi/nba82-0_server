"use strict";

const DEFAULT_PER100_SCORE_CONFIG = Object.freeze({
  pointsWeight: 1.0,
  assistWeight: 0.6,
  reboundWeight: 0.5,
  praMultiplier: 1.0,
  tsPlusDivisor: 200,
  owsWeight: 0.8,
  dwsWeight: 1.2,
  winShareScale: 200,
  baseMPG: 32,
  maxMPG: 50,
  maxMinutesMultiplier: 1.3,
  minMinutesMultiplier: 0.1,
  regulationMinutes: 48,
  possessionsScale: 100,
});

function requireFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function requirePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero.`);
  }
}

function minutesMultiplier(mpg, overrides = {}) {
  const config = { ...DEFAULT_PER100_SCORE_CONFIG, ...overrides };
  requireFiniteNumber(mpg, "mpg");

  if (mpg <= 0) {
    return config.minMinutesMultiplier;
  }

  if (config.baseMPG <= 0 || config.maxMPG <= config.baseMPG) {
    throw new RangeError("maxMPG must be greater than baseMPG, and both must be positive.");
  }

  const k = (config.maxMinutesMultiplier - 1) / Math.log(config.maxMPG / config.baseMPG);
  const raw = 1 + k * Math.log(mpg / config.baseMPG);

  return Math.max(config.minMinutesMultiplier, Math.min(config.maxMinutesMultiplier, raw));
}

function estimatePossessionsPlayed(minutes, teamPace, overrides = {}) {
  const config = { ...DEFAULT_PER100_SCORE_CONFIG, ...overrides };
  requirePositiveNumber(minutes, "minutes");
  requirePositiveNumber(teamPace, "teamPace");

  return (minutes / config.regulationMinutes) * teamPace;
}

function estimateStatPer100(statTotal, estimatedPossessions, overrides = {}) {
  const config = { ...DEFAULT_PER100_SCORE_CONFIG, ...overrides };
  requireFiniteNumber(statTotal, "statTotal");
  requirePositiveNumber(estimatedPossessions, "estimatedPossessions");

  if (statTotal < 0) {
    throw new RangeError("statTotal must be non-negative.");
  }

  return (statTotal / estimatedPossessions) * config.possessionsScale;
}

function estimateStatPer100FromPerGame(statPerGame, mpg, teamPace, overrides = {}) {
  const config = { ...DEFAULT_PER100_SCORE_CONFIG, ...overrides };
  requireFiniteNumber(statPerGame, "statPerGame");
  requirePositiveNumber(mpg, "mpg");
  requirePositiveNumber(teamPace, "teamPace");

  if (statPerGame < 0) {
    throw new RangeError("statPerGame must be non-negative.");
  }

  const possessionsPerGame = (mpg / config.regulationMinutes) * teamPace;

  return estimateStatPer100(statPerGame, possessionsPerGame, config);
}

function calculateWeightedPer100SeasonScore(player, overrides = {}) {
  const config = { ...DEFAULT_PER100_SCORE_CONFIG, ...overrides };
  const {
    per100PTS,
    per100AST,
    per100REB,
    tsPct,
    tsPlus,
    OWS,
    DWS,
    minutes,
    mpg,
  } = player;

  for (const [name, value] of Object.entries({
    per100PTS,
    per100AST,
    per100REB,
    tsPct,
    tsPlus,
    OWS,
    DWS,
    minutes,
    mpg,
  })) {
    requireFiniteNumber(value, name);
  }

  if (minutes <= 0) {
    throw new RangeError("minutes must be greater than zero.");
  }

  if (tsPct < 0 || tsPct > 1) {
    throw new RangeError("tsPct must be a decimal between 0 and 1.");
  }

  const scaledTSPlus = tsPlus / config.tsPlusDivisor;
  const weightedPoints = per100PTS * (tsPct + scaledTSPlus) * config.pointsWeight;
  const weightedAssists = per100AST * config.assistWeight;
  const weightedRebounds = per100REB * config.reboundWeight;
  const weightedPRA = weightedPoints + weightedAssists + weightedRebounds;
  const mpgMultiplier = minutesMultiplier(mpg, config);
  const adjustedPRA = weightedPRA * mpgMultiplier * config.praMultiplier;
  const weightedOWS48 =
    ((OWS * config.owsWeight * config.regulationMinutes) / minutes) * config.winShareScale;
  const weightedDWS48 =
    ((DWS * config.dwsWeight * config.regulationMinutes) / minutes) * config.winShareScale;
  const totalScore = adjustedPRA + weightedOWS48 + weightedDWS48;

  return {
    totalScore,
    adjustedPRA,
    weightedPRA,
    weightedPoints,
    weightedAssists,
    weightedRebounds,
    weightedOWS48,
    weightedDWS48,
    scaledTSPlus,
    mpgMultiplier,
  };
}

module.exports = {
  DEFAULT_PER100_SCORE_CONFIG,
  calculateWeightedPer100SeasonScore,
  estimatePossessionsPlayed,
  estimateStatPer100,
  estimateStatPer100FromPerGame,
  minutesMultiplier,
};
