CREATE TABLE "multiplayer_games" (
    "id" TEXT NOT NULL,
    "lobby_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_round_index" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL,
    "pool" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "multiplayer_games_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "multiplayer_rounds" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "round_index" INTEGER NOT NULL,
    "player_season_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'bidding',
    "bid_started_at" TIMESTAMP(3) NOT NULL,
    "bid_ends_at" TIMESTAMP(3) NOT NULL,
    "reveal_ends_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "winner_participant_id" TEXT,
    "winning_bid" INTEGER,
    "no_bid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "multiplayer_rounds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "multiplayer_bids" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiplayer_bids_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "multiplayer_roster_picks" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "player_season_id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "paid_amount" INTEGER NOT NULL,
    "base_score" DOUBLE PRECISION NOT NULL,
    "final_score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiplayer_roster_picks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "multiplayer_games_lobby_id_key" ON "multiplayer_games"("lobby_id");
CREATE INDEX "multiplayer_games_status_idx" ON "multiplayer_games"("status");
CREATE UNIQUE INDEX "multiplayer_rounds_game_id_round_index_key" ON "multiplayer_rounds"("game_id", "round_index");
CREATE INDEX "multiplayer_rounds_game_id_idx" ON "multiplayer_rounds"("game_id");
CREATE INDEX "multiplayer_rounds_game_id_round_index_idx" ON "multiplayer_rounds"("game_id", "round_index");
CREATE INDEX "multiplayer_bids_round_id_idx" ON "multiplayer_bids"("round_id");
CREATE INDEX "multiplayer_bids_participant_id_idx" ON "multiplayer_bids"("participant_id");
CREATE UNIQUE INDEX "multiplayer_roster_picks_round_id_key" ON "multiplayer_roster_picks"("round_id");
CREATE INDEX "multiplayer_roster_picks_game_id_idx" ON "multiplayer_roster_picks"("game_id");
CREATE INDEX "multiplayer_roster_picks_participant_id_idx" ON "multiplayer_roster_picks"("participant_id");

ALTER TABLE "multiplayer_games"
ADD CONSTRAINT "multiplayer_games_lobby_id_fkey"
FOREIGN KEY ("lobby_id") REFERENCES "multiplayer_lobbies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "multiplayer_rounds"
ADD CONSTRAINT "multiplayer_rounds_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "multiplayer_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "multiplayer_bids"
ADD CONSTRAINT "multiplayer_bids_round_id_fkey"
FOREIGN KEY ("round_id") REFERENCES "multiplayer_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "multiplayer_roster_picks"
ADD CONSTRAINT "multiplayer_roster_picks_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "multiplayer_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
