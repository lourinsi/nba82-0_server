CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "bref_id" TEXT,
    "balldontlie_id" INTEGER,
    "nba_stats_id" INTEGER,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "primary_position" TEXT,
    "current_team" TEXT,
    "teams" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "eras" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "team_eras" JSONB NOT NULL,
    "career_seasons" JSONB NOT NULL,
    "accolades" JSONB NOT NULL,
    "awards_raw" JSONB NOT NULL,
    "classic_points_by_team_era" JSONB NOT NULL,
    "legacy_points" DOUBLE PRECISION,
    "draft_year" INTEGER,
    "active" BOOLEAN,
    "source" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "player_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "players_bref_id_idx" ON "players"("bref_id");
CREATE INDEX "players_name_idx" ON "players"("name");
CREATE INDEX "players_current_team_idx" ON "players"("current_team");
CREATE INDEX "players_primary_position_idx" ON "players"("primary_position");
CREATE INDEX "players_legacy_points_idx" ON "players"("legacy_points");
CREATE INDEX "players_sort_order_idx" ON "players"("sort_order");
CREATE INDEX "data_imports_source_idx" ON "data_imports"("source");
