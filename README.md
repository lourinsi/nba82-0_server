# NBA 82-0 Server

Backend API and data pipeline for NBA 82-0.

The current player data source is:

```text
data/players_accolades_bref.json
```

The older NBA Stats file is still kept here:

```text
data/players_accolades.json
```

Treat `players_accolades.json` as a legacy fallback and seed input. It can be stale for B-Ref-derived fixes. The API defaults to `players_accolades_bref.json`, and the database import should also use that file.

## Quick Answer: George Mikan

If you found this in `data/players_accolades.json`:

```json
"name": "George Mikan",
"scoring_titles": 0
```

you are looking at the legacy NBA Stats fallback file. The current B-Ref file already stores Mikan with 3 scoring titles.

Run this first:

```powershell
cd D:\NBA_82-0\nba_82-0_server
npm.cmd run verify:stat-titles
node -e "const p=require('./data/players_accolades_bref.json').find(p=>p.name==='George Mikan'); console.log(p.accolades.scoring_titles)"
```

Expected output from the Node check:

```text
3
```

If you want to rebuild the current player file from cached B-Ref data, run:

```powershell
npm.cmd run seed:bref:dry
npm.cmd run seed
```

If the API is reading from Postgres, sync the rebuilt JSON into the database:

```powershell
npm.cmd run db:import:players:dry
npm.cmd run db:sync:players
```

Then restart the API, or wait for the player cache to expire.

## What Reads What

```text
API default JSON file
  data/players_accolades_bref.json

Database import default
  PLAYER_DATA_PATH, usually ./data/players_accolades_bref.json

Legacy NBA Stats fallback
  data/players_accolades.json

B-Ref stat-title fallback source
  data/bref_per_game_stats_cache.json

NBA Stats stat-title cache
  data/stat_title_winners.json
```

`PLAYER_DATA_SOURCE=auto` means the API reads Postgres when `DATABASE_URL` is configured and the `players` table has rows. If the database is missing or empty, it falls back to JSON.

Use `PLAYER_DATA_SOURCE=json` when you want to bypass Postgres during local debugging.

## Setup

Install dependencies:

```powershell
cd D:\NBA_82-0\nba_82-0_server
npm.cmd install
```

Create a local env file:

```powershell
Copy-Item .env.example .env
```

For JSON-only local work, use:

```env
PORT=4000
PLAYER_DATA_SOURCE=json
PLAYER_DATA_PATH=./data/players_accolades_bref.json
```

For database-backed work, fill in `DATABASE_URL` and `DIRECT_URL`, then run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:check
```

Do not commit `.env`.

## Run The API

```powershell
npm.cmd start
```

Development mode:

```powershell
npm.cmd run dev
```

Useful endpoints:

```text
http://localhost:4000/api/health
http://localhost:4000/api/players
http://localhost:4000/api/player-cache
http://localhost:4000/api/legacy-engine-config
http://localhost:4000/api/stats-engine-config
```

## Normal Workflows

### Verify The Mikan/Stat-Title Fix

```powershell
npm.cmd run verify:stat-titles
node -e "const p=require('./data/players_accolades_bref.json').find(p=>p.name==='George Mikan'); console.log(p.accolades.scoring_titles)"
```

### Rebuild Current Player JSON

Dry run from existing caches:

```powershell
npm.cmd run seed:bref:dry
```

Write the current B-Ref-primary file:

```powershell
npm.cmd run seed
```

`npm.cmd run seed` is the same as:

```powershell
node seed.js --mode=bref --replace --yes
```

It writes:

```text
data/players_accolades_bref.json
```

It uses `data/players_accolades.json` only as an award/accolade fallback source.

### Recalculate Scores Only

Use this after changing legacy scoring weights or accolade normalization:

```powershell
npm.cmd run seed:legacy-points
```

This rewrites `data/players_accolades_bref.json` without refetching player lists.

### Rebuild Classic Mode Inputs

```powershell
npm.cmd run refresh:league-averages
npm.cmd run seed:classic-points
```

### Sync JSON To Postgres

Preview first:

```powershell
npm.cmd run db:import:players:dry
```

Replace the `players` table with the JSON source:

```powershell
npm.cmd run db:sync:players
```

If you want to import a specific file:

```powershell
npm.cmd run db:import:players:dry -- --file=./data/players_accolades_bref.json
npm.cmd run db:sync:players -- --file=./data/players_accolades_bref.json
```

### Refresh GOAT Ranking Cache

```powershell
npm.cmd run seed:goat-rankings
```

This writes `data/br_goat_rankings.json` and does not rewrite player JSON.

## Command Reference

Core API and database:

```text
npm.cmd start                    Run the API once.
npm.cmd run dev                  Run the API in watch mode.
npm.cmd run db:generate          Generate Prisma Client.
npm.cmd run db:check             Check database connection.
npm.cmd run db:migrate           Apply committed migrations.
npm.cmd run db:migrate:dev       Create/apply development migrations.
npm.cmd run db:studio            Open Prisma Studio.
npm.cmd run db:import:players:dry  Validate the JSON import source.
npm.cmd run db:sync:players      Replace the players table from JSON.
```

Current B-Ref data path:

```text
npm.cmd run verify:stat-titles   Test stat-title fallback behavior.
npm.cmd run seed:bref:dry        Cache-only dry run for B-Ref rebuild.
npm.cmd run seed                 Rebuild players_accolades_bref.json.
npm.cmd run seed:bref:refresh    Refetch B-Ref per-game and advanced caches, then rebuild.
npm.cmd run seed:legacy-points   Recalculate accolades, legacy points, positions, and Classic blocks.
npm.cmd run seed:classic-points  Recalculate Classic team-era points.
npm.cmd run refresh:league-averages  Rebuild historical league-average baselines.
npm.cmd run seed:goat-rankings   Refresh cached media GOAT rankings.
npm.cmd run seed:retro-finals-mvps  Seed estimated pre-1969 Retro FMVP counts.
npm.cmd run seed:retro-finals-mvps:verify  Verify Retro FMVP counts only.
npm.cmd run seed:three-point-accolades:bref  Backfill three-point titles into the B-Ref file.
npm.cmd run verify:aba-teams     Check ABA team translation output.
```

Legacy NBA Stats fallback path:

```text
npm.cmd run seed:active          Refresh current NBA Stats players into players_accolades.json.
npm.cmd run seed:active:resume   Resume active-player refresh.
npm.cmd run seed:full            Refresh all-time NBA Stats players into players_accolades.json.
npm.cmd run seed:full:resume     Resume all-time refresh.
npm.cmd run seed:stats           Refresh active player career-season stats.
npm.cmd run seed:game-wins       Refresh active player game-win counts.
npm.cmd run seed:games-started   Backfill games_started.
npm.cmd run seed:advanced-stats  Backfill TS% and WS/48.
npm.cmd run backfill:season-stats  Backfill PPG/RPG/APG/SPG/BPG.
npm.cmd run refresh:positions    Refresh positions from NBA API cache.
npm.cmd run refresh:positions:dry  Preview NBA API position changes.
npm.cmd run fix:positions        Apply manual position overrides.
npm.cmd run seed:bref-positions  Apply B-Ref positions to the legacy file.
npm.cmd run seed:three-point-accolades  Backfill legacy-file three-point titles and contest wins.
```

Use the legacy commands only when you intentionally need to repair `data/players_accolades.json`.

Other helpers:

```text
npm.cmd run seed:games_started   Alias for seed:games-started.
npm.cmd run example:per100       Print per-100 score examples.
```

## Safe Script Order

For the current app data, this is the usual order:

```powershell
npm.cmd run verify:stat-titles
npm.cmd run seed:bref:dry
npm.cmd run seed
npm.cmd run refresh:league-averages
npm.cmd run seed:classic-points
npm.cmd run seed:goat-rankings
npm.cmd run db:import:players:dry
npm.cmd run db:sync:players
```

Do not run two scripts that write the same player JSON file at the same time.

Writes `players_accolades_bref.json`:

```text
seed
seed:bref:refresh
seed:legacy-points
seed:classic-points
```

Writes `players_accolades.json`:

```text
seed:active
seed:full
seed:stats
seed:game-wins
seed:games-started
seed:advanced-stats
backfill:season-stats
refresh:positions
fix:positions
seed:three-point-accolades
```

Independent cache/file writers:

```text
refresh:league-averages -> data/historical_league_averages.json
seed:goat-rankings      -> data/br_goat_rankings.json
```

## Useful Flags

B-Ref rebuild flags:

```text
--dryRun
--skipFetch
--refreshPerGame
--refreshPer100
--refreshAdvanced
--refreshTeamAdvanced
--limit=100
--offset=100
--saveEvery=10
--delayMs=4000
```

NBA Stats fallback flags:

```text
--mode=active|full
--limit=100
--offset=100
--resume
--replace
--saveEvery=25
--delayMs=1500
--retries=5
--timeoutMs=30000
--refreshNbaDirectory
--gameWins
--refreshGameWins
```

Database import flags:

```text
--file=./data/players_accolades_bref.json
--dryRun
--deleteMissing
--batchSize=100
```

## Troubleshooting

PowerShell says `npm.ps1 cannot be loaded`:

```powershell
npm.cmd run verify:stat-titles
```

Use `npm.cmd` instead of `npm`.

Mikan still shows `scoring_titles: 0` in the API:

```powershell
node -e "const p=require('./data/players_accolades_bref.json').find(p=>p.name==='George Mikan'); console.log(p.accolades.scoring_titles)"
npm.cmd run db:import:players:dry
npm.cmd run db:sync:players
```

If the JSON shows `3` but the API shows `0`, the database is stale or the API cache is still warm. Restart the API, set `PLAYER_DB_CACHE_MS=0` while debugging, or temporarily set `PLAYER_DATA_SOURCE=json`.

Prisma Client is missing:

```powershell
npm.cmd run db:generate
```

B-Ref seed refuses to write:

```powershell
npm.cmd run seed
```

The raw `seed-bref.js` rebuild path requires `--replace --yes`; the `seed` script already passes those flags.

Need a no-database local run:

```env
PLAYER_DATA_SOURCE=json
PLAYER_DATA_PATH=./data/players_accolades_bref.json
```

Then restart the API.
