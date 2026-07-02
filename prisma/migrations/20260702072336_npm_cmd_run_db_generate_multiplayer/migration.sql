-- AlterTable
ALTER TABLE "multiplayer_lobbies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "players" ALTER COLUMN "positions" DROP DEFAULT,
ALTER COLUMN "teams" DROP DEFAULT,
ALTER COLUMN "eras" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;
