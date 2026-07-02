CREATE TABLE "multiplayer_lobbies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "host_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiplayer_lobbies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "multiplayer_participants" (
    "id" TEXT NOT NULL,
    "lobby_id" TEXT NOT NULL,
    "user_id" TEXT,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiplayer_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "multiplayer_lobbies_code_key" ON "multiplayer_lobbies"("code");
CREATE INDEX "multiplayer_lobbies_status_idx" ON "multiplayer_lobbies"("status");
CREATE INDEX "multiplayer_participants_client_id_idx" ON "multiplayer_participants"("client_id");
CREATE INDEX "multiplayer_participants_lobby_id_idx" ON "multiplayer_participants"("lobby_id");

ALTER TABLE "multiplayer_participants"
ADD CONSTRAINT "multiplayer_participants_lobby_id_fkey"
FOREIGN KEY ("lobby_id") REFERENCES "multiplayer_lobbies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
