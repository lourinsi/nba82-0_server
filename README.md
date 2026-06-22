# NBA 82-0 Server

Backend API and data seeding tools for the 82-0 accolade workspace.

This server serves live player accolade data from PostgreSQL through Prisma when `DATABASE_URL` is configured, with `data/players_accolades_bref.json` kept as the migration fallback. It also includes scripts for fetching NBA data, resuming long seed runs, recalculating `legacy_points`, and deriving team-era Classic scores. The older NBA Stats fallback dataset remains at `data/players_accolades.json`.

## Setup

Install dependencies:

```powershell
npm install
```

Create a local `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Defaults are already usable locally:

```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
PLAYER_DATA_PATH=./data/players_accolades_bref.json
PLAYER_DATA_SOURCE=auto
DATABASE_URL="postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@[region].pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@[region].pooler.supabase.com:5432/postgres?sslmode=require"
```

In development, the API also accepts browser requests from localhost on any port.
This covers Next.js falling back to ports such as `3001` or `3002` when `3000`
is already in use. In production, use `FRONTEND_ORIGIN` for the explicit
allowed origin list.

Do not commit `.env`.

## Run The API

Start the backend:

```powershell
npm start
```

Development mode:

```powershell
npm run dev
```

Default API endpoint:

```text
http://localhost:4000/api/players
```

With `PLAYER_DATA_SOURCE=auto`, the server reads players from PostgreSQL when `DATABASE_URL` is set and the `players` table has rows. If the database is unavailable or empty during local migration, it falls back to `PLAYER_DATA_PATH`. Set `PLAYER_DATA_SOURCE=json` to force the JSON file, or `PLAYER_DATA_SOURCE=database` to fail fast when Postgres is not ready.

## Prisma Database

The player migration keeps the existing API response shape intact. Searchable identity fields live in columns, while nested basketball data such as `career_seasons`, `accolades`, `awards_raw`, and `classic_points_by_team_era` is stored as `jsonb`.

Initial local setup:

```powershell
# Replace the bracketed DATABASE_URL and DIRECT_URL placeholders in .env first.
npm run db:generate
npm run db:migrate
npm run db:import:players:dry
npm run db:sync:players
```

Command guide:

```text
npm run db:generate
Generates Prisma Client from prisma/schema.prisma.

npm run db:migrate
Applies committed migrations to the configured PostgreSQL database.

npm run db:migrate:dev
Creates/applies development migrations after schema edits.

npm run db:studio
Opens Prisma Studio using DIRECT_URL when it is configured. This avoids Supabase transaction-pooler metadata issues.

npm run db:import:players
Upserts players from PLAYER_DATA_PATH or --file without deleting rows missing from the source.

npm run db:import:players:dry
Validates and summarizes the JSON import source without writing to Postgres.

npm run db:sync:players
Upserts players from the JSON source and deletes database rows that are no longer present.
```

Useful import flags:

```text
--file=./data/players_accolades_bref.json
--dryRun
--deleteMissing
--batchSize=100
```

## Seed Scripts

Available scripts:

```powershell
npm start
npm run dev
npm run db:generate
npm run db:migrate
npm run db:migrate:dev
npm run db:studio
npm run db:import:players
npm run db:import:players:dry
npm run db:sync:players
npm run seed
npm run seed:bref
npm run seed:bref:dry
npm run seed:bref:refresh
npm run seed:active
npm run seed:active:resume
npm run seed:full
npm run seed:full:resume
npm run seed:game-wins
npm run seed:advanced-stats
npm run seed:stats
npm run seed:games-started
npm run seed:games_started
npm run seed:bref-positions
npm run seed:goat-rankings
npm run seed:legacy-points
npm run seed:classic-points
npm run backfill:season-stats
npm run refresh:league-averages
npm run refresh:positions:dry
npm run refresh:positions
npm run fix:positions
```

`npm run seed` is the same as:

```powershell
node seed.js --mode=bref --replace --yes
```

Simple command guide:

```text
npm start
Runs the Express API server once.

npm run dev
Runs the Express API server with Node watch mode, so it restarts after local code changes.

npm run seed
Rebuilds `data/players_accolades_bref.json` from Basketball Reference player identity, per-game stats, positions, TS%, and WS/48. Existing NBA award rows are matched from `data/players_accolades.json` as the accolade fallback, then legacy/classic points are recalculated.

npm run seed:bref
Same B-Ref-primary full rebuild as npm run seed.

npm run seed:bref:dry
Builds the B-Ref-primary output in memory from existing caches without writing files.

npm run seed:bref:refresh
Forces fresh Basketball Reference per-game and advanced stat page fetches before rebuilding.

npm run seed:active
Refreshes active NBA players from NBA Stats and merges them into the existing player file. This is now a fallback/repair path, not the default seed.

npm run seed:active:resume
Continues an active-player seed and skips players already saved in data/players_accolades.json.

npm run seed:full
Refreshes the all-time player dataset. This can take a long time.

npm run seed:full:resume
Continues a long all-time seed and skips players already saved.

npm run seed:game-wins
Refreshes active players with fresh NBA Stats regular-season game-log wins, storing `career_seasons[*].games_won` and `accolades.games_won`.

npm run seed:advanced-stats
Backfills Basketball Reference advanced metrics into `career_seasons[*].ts_pct` and `career_seasons[*].ws_per_48`.

npm run seed:stats
Refreshes active players' cached NBA Stats career seasons, appends new seasons, syncs active/current_team from the NBA Stats directory, and writes the updated player file.

npm run seed:games-started
Backfills career games started from NBA Stats career totals into `career_seasons[*].games_started` and `accolades.games_started`, then updates `legacy_points`. When NBA Stats has no `GS` value, the seeder counts that season's `GP` as starts. Explicit `GS=0` only falls back to `GP` before 1970-71.

npm run seed:games_started
Alias for npm run seed:games-started.

npm run seed:bref-positions
Overwrites stored positions and primary_position from data/bref_positions.json for matching players.

npm run seed:legacy-points
Recalculates legacy_points from stored accolades without refetching NBA APIs.

npm run seed:classic-points
Recalculates Classic Mode team-era points from era-relative per-season stats.

npm run backfill:season-stats
Backfills PPG/RPG/APG/SPG/BPG into stored career_seasons from NBA Stats career totals.

npm run refresh:league-averages
Builds data/historical_league_averages.json from NBA Stats/Basketball Reference season data, including league `TS_PCT` for future TS+ calculations.

npm run seed:goat-rankings
Fetches or refreshes the cached Bleacher Report GOAT ranking scores in data/br_goat_rankings.json.

npm run refresh:positions:dry
Previews position updates without writing changes.

npm run refresh:positions
Updates player positions and primary_position from the local NBA API position cache.

npm run fix:positions
Applies manual position overrides from data/position_overrides.json.
```

Recommended seed pipeline:

```powershell
npm run seed
npm run refresh:league-averages
npm run seed:goat-rankings
```

Step-by-step:

1. Rebuild B-Ref transition storage with `npm run seed`.
   This writes `data/players_accolades_bref.json` with the Basketball Reference player universe from `data/bref_positions.json`, fetches/reuses B-Ref per-game and advanced stat caches, carries forward existing NBA-derived award rows from `data/players_accolades.json` as fallback, and recalculates `legacy_points` plus Classic team-era blocks.

2. Refresh league averages with `npm run refresh:league-averages`.
   This builds `data/historical_league_averages.json` for the season climate baseline, including league TS%.

3. Refresh GOAT ranking data with `npm run seed:goat-rankings`.
   This updates the cached media ranking file used for GOAT score overlays.

The older NBA Stats commands are still available as fallback tools:
`npm run seed:active`, `npm run seed:full`, `npm run seed:game-wins`, `npm run seed:stats`,
`npm run seed:games-started`, and `npm run backfill:season-stats`.

## Running Scripts Safely

Run only one script that writes player data JSON at a time. B-Ref seed writes `data/players_accolades_bref.json`; the NBA Stats fallback scripts write `data/players_accolades.json`. Keep these commands sequential so cached fallback reads and full-file writes do not race:

```powershell
npm run seed
npm run seed:bref
npm run seed:bref:refresh
npm run seed:active
npm run seed:full
npm run seed:game-wins
npm run seed:advanced-stats
npm run seed:stats
npm run seed:games-started
npm run seed:bref-positions
npm run seed:legacy-points
npm run backfill:season-stats
npm run seed:classic-points
npm run refresh:positions
npm run fix:positions
```

Do not run `npm run seed`, `npm run seed:bref`, `npm run seed:bref:refresh`, `npm run seed:stats`, `npm run seed:game-wins`, `npm run seed:advanced-stats`, `npm run seed:games-started`, `npm run seed:bref-positions`, `npm run backfill:season-stats`, or `npm run refresh:positions` at the same time as another command that writes one of the player data files. The legacy commands all read the full live file, update their own fields in memory, and write the full file back. Whichever write finishes last can overwrite the other command's changes.

This pairing is safe because the scripts write different files, though slower delays are still friendlier to the remote data sources:

```powershell
# Terminal 1: writes data/players_accolades.json
npm run seed:stats -- --limit=250 --delayMs=500

# Terminal 2: writes data/historical_league_averages.json
npm run refresh:league-averages -- --prefer=bref --delayMs=10000
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` with the same arguments.

## Seed Modes

`bref` rebuilds the transition player file from Basketball Reference identity and stat caches. It writes `data/players_accolades_bref.json` by default and reads `data/players_accolades.json` only as the award/accolade fallback source. It is a replacement mode, so use `--replace --yes` when writing output. This is the default behind `npm run seed`.

```powershell
npm run seed
node seed.js --mode=bref --replace --yes
```

`active` fetches current active players from the NBA Stats player directory, refreshes their awards/career data, and merges those updates into the existing player file by default. This is a fallback mode.

```powershell
npm run seed:active
```

`full` fetches the all-time NBA Stats player directory, then refreshes awards/career data.

```powershell
npm run seed:full
```

Full all-time seeding can take a long time because each player may require NBA Stats awards, career, and stat-title requests with delays. BALLDONTLIE is no longer the primary source; keep it only as a future fallback if NBA Stats/nba_api cannot resolve a player.

## Batching

Use `--limit` to process a small batch:

```powershell
npm run seed:full -- --limit=100
```

Use `--offset` with `--limit` to continue manually:

```powershell
npm run seed:full -- --offset=100 --limit=100
npm run seed:full -- --offset=200 --limit=100
npm run seed:full -- --offset=300 --limit=100
```

For NBA Stats active-player fallback runs:

```powershell
npm run seed:active -- --limit=100
npm run seed:active -- --offset=100 --limit=100
```

`npm run seed` is now a B-Ref replacement rebuild for `players_accolades_bref.json`. NBA Stats fallback seed runs (`seed:active` and `seed:full`) still merge into the live `players_accolades.json` unless you pass `--replace --yes`.

## Resume Mode

Resume mode skips players already present in `data/players_accolades.json`. Use it when you only want to fill missing records. If you want to refresh from the beginning and overwrite existing records as they complete, run without `--resume`.

All-time resume:

```powershell
npm run seed:full:resume
```

Active resume:

```powershell
npm run seed:active:resume
```

Recommended all-time refresh from the beginning:

```powershell
npm run seed:full -- --saveEvery=25
```

This checkpoints the merged JSON after every 25 processed players, so stopping the command leaves the old data plus the completed refreshed records.

Recommended all-time missing-record fill:

```powershell
npm run seed:full:resume -- --saveEvery=25
```

This skips existing records and checkpoints after every 25 newly processed players.

## Replace Mode

Use `--replace` when you intentionally want the output file to contain only the current run. B-Ref mode requires replacement and targets `players_accolades_bref.json`; NBA Stats fallback modes can either merge or replace `players_accolades.json`.

Example:

```powershell
npm run seed:full -- --limit=100 --replace --yes
```

Without `--replace`, NBA Stats fallback seed runs merge into existing data. Replacement prompts for confirmation when run interactively; use `--yes` only when you intentionally want a non-interactive replacement.

## Useful Flags

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
--hydratePlayerInfo
```

Common examples:

```powershell
npm run seed:full -- --limit=100
npm run seed:full -- --offset=100 --limit=100
npm run seed:full:resume -- --saveEvery=25
npm run seed:active:resume
npm run seed:stats -- --limit=50 --dryRun
```

## Position Refresh

Refresh bad or unknown player positions without refetching awards:

```powershell
npm run refresh:positions:dry
npm run refresh:positions
```

This uses `nba_api.stats.endpoints.playerindex.PlayerIndex` from `swar/nba_api`, stores source rows in `data/nba_api_player_positions.json`, and only updates `positions` plus `primary_position` in `players_accolades.json`.

Default behavior is conservative:

```text
- manual overrides always apply
- blank positions are updated
- legacy unknown PG/SG/SF/PF/C positions are updated
- already-specific positions are kept
```

Use this only when you intentionally want broad NBA API labels to replace existing specific positions:

```powershell
npm run refresh:positions -- --force-broad
```

Manual corrections live in `data/position_overrides.json`. These are still necessary because nba_api often returns broad historical labels such as `G`, `F`, or `F-G`; the override file keeps high-impact players in their true primary-slot order.

To make Basketball Reference the authority for matching player positions, run:

```powershell
npm run seed:bref-positions
```

Preview first with:

```powershell
npm run seed:bref-positions -- --dryRun
```

This reads `data/bref_positions.json` and overwrites each matching player's `positions` and `primary_position` in `players_accolades.json`. It does not merge with existing positions, so stale extras such as `["C", "SF", "PF"]` become the B-Ref ordered value, for example `["C", "PF"]`.

## Season Stats

Use `seed:stats` for the usual active-player stat refresh:

```powershell
npm run seed:stats
```

This runs the normalized stats seeder file, `seed-stats.js`:

```powershell
node seed-stats.js --mode=active --maxCacheAgeDays=1 --force --appendMissingSeasons
```

It reads `data/players_accolades.json`, `data/nba_stats_career_stats_cache.json`, and `data/nba_stats_player_directory.json` once, uses cached career rows when fresh, fetches only missing or stale NBA Stats career payloads, then writes the updated cache and player file at the end. In active mode it also syncs `active` and `current_team` from the player directory. Refreshed career rows include `games_started` from NBA Stats `GS`.

Useful examples:

```powershell
npm run seed:stats -- --dryRun
npm run seed:stats -- --limit=50
npm run seed:stats -- --maxCacheAgeDays=7
npm run seed:stats -- --refreshCache --delayMs=2000
npm run seed:games-started -- --dryRun --limit=25
npm run seed:games-started -- --mode=all --saveEvery=25
npm run seed:advanced-stats -- --dryRun --limit=25
npm run seed:advanced-stats -- --mode=all --saveEvery=100
npm run backfill:season-stats -- --mode=missing --saveEvery=25
npm run backfill:season-stats -- --mode=all --maxCacheAgeDays=30 --dryRun
```

Modes:

```text
missing: only players with missing games started, PPG/RPG/APG/SPG/BPG, TS%, or WS/48 in stored career_seasons
active: current players from nba_stats_player_directory.json plus active/current_team sync
all: every stored player with career_seasons
```

`seed:advanced-stats` reads Basketball Reference advanced season pages, caches them in `data/bref_advanced_stats_cache.json`, and matches rows by player name, season, and team. Missing seasons are filled from that player's career average for the metric. If the player has no TS% or WS/48 value anywhere in their career, the fallback is `ts_pct=0.5` and `ws_per_48=0.1`. Use `--refreshCache` to refetch B-Ref season pages and `--force` to overwrite existing B-Ref-matched `ts_pct` / `ws_per_48` values.

Important: do not run `seed:stats`, `seed:game-wins`, `seed:advanced-stats`, or `seed:games-started` at the same time as `refresh:positions`, `seed`, `seed:full`, `seed:legacy-points`, `seed:classic-points`, or `backfill:season-stats`. They can update different fields, but they still rewrite the same whole `players_accolades.json` file.

## Legacy Points

Each player gets a top-level `legacy_points` field calculated from stored `accolades`. The base score is the sum of weighted accolades, including career `games_started` at `0.01` points per start.

```text
seasons = max(seasons_played, 1)
uShapeModifier = (descentNumerator / seasons^descentExponent) + (ascentMultiplier * seasons)
densityBonus = basePoints * uShapeModifier * densityBonusMultiplier
legacy_points = round(basePoints + densityBonus, 2)
```

The shared U-shape constants live in `legacyPoints.js` as `LEGACY_ENGINE_FACTORS`:

```text
descentNumerator: 3.2
descentExponent: 1.35
ascentMultiplier: 0.0027
densityBonusMultiplier: 4
```

Recalculate points without refetching APIs:

```powershell
npm run seed:legacy-points
```

After changing `LEGACY_ENGINE_FACTORS`, run this script so `data/players_accolades_bref.json` stores updated `legacy_points` and regenerated Classic team-era blocks. The API serves those stored scores instead of recalculating top-level legacy points on every request.

Fetch/cache the Bleacher Report GOAT Top 100 media score without refetching NBA APIs:

```powershell
npm run seed:goat-rankings
```

This writes `data/br_goat_rankings.json` and reports current matches. It does not modify `data/players_accolades.json`.

The weights live in `legacyPoints.js`.

Current weighted fields:

```text
mvp_count: 8
finals_mvp_count: 7
all_nba_1st: 7
all_nba_2nd: 5.5
all_nba_3rd: 4
championship_rings: 2.5
dpoy_count: 2.5
all_def_1st: 2
all_def_2nd: 1.5
scoring_titles: 3
assist_titles: 3
rebound_titles: 2
steal_titles: 1.5
block_titles: 1.5
all_star_mvp_count: 1
all_star_selections: 1
6moy: 1
most_improved: 1
roy_won: 1
all_rookie_1st: 1
all_rookie_2nd: 0.75
seasons_played: 0.25
games_started: 0.01
```

The API overlays GOAT data from Bleacher Report's "B/R's Top 100 NBA Players of All Time, Ranked":
`https://bleacherreport.com/articles/25223594-brs-top-100-nba-players-all-time-ranked`

```text
GOAT rank 1 = 100 points
GOAT rank 2 = 99 points
GOAT rank 3 = 98 points
...
GOAT rank 100 = 1 point
```

The API overlays BR GOAT data onto player responses:

```text
goat_rank = BR top-100 rank, or null for unranked players
goat_score = 101 - goat_rank, or 0 for unranked players
```

Normal `seed`, `seed:active`, and `seed:full` runs also apply legacy points before writing output.

All-Time mode calculates the playable score at simulation time instead of storing it in JSON:

```text
player_score = (legacy_points + goat_score) * position_multiplier
position_multiplier = 1.15 when assigned slot matches primary_position and legacy_points < 100
position_multiplier = 1.10 when assigned slot matches primary_position and legacy_points >= 100
position_multiplier = 1.00 otherwise
```

## Classic Points

Each player also gets `classic_points_by_team_era`, derived from `career_seasons` and per-season `awards_raw`.

This is for Classic Mode. It does not replace all-time `legacy_points`.

Run the era-relative statistical recalculation after `career_seasons` include per-game stats and
`data/historical_league_averages.json` is available. By default, this updates `data/players_accolades_bref.json`:

```powershell
npm run refresh:league-averages
npm run seed:stats
npm run backfill:season-stats -- --saveEvery=25
npm run seed:classic-points -- --dryRun
npm run seed:classic-points
```

The league-average file is keyed by NBA season:

```json
{
  "2011-12": { "PPG": 96.3, "RPG": 42.2, "APG": 21.0, "SPG": 7.7, "BPG": 5.1, "TS_PCT": 0.527 },
  "1961-62": { "PPG": 118.8, "RPG": 71.4, "APG": 23.9, "TS_PCT": 0.479 }
}
```

`TS_PCT` is stored as a decimal, so future TS+ can use `player.ts_pct / leagueAverage.TS_PCT`.
For very early seasons, the refresh script parses B-Ref's Advanced Stats league-average row when available.
If a requested season has no league TS% source, the script fills `TS_PCT` from the earliest available league TS% season so TS+ still has a denominator.

The weights live at the top of `eraRelativeClassicPoints.js`. If a league-average season has no
`SPG`/`BPG`, the scorer drops defensive metrics and evenly redistributes the total stat weight across
PPG/RPG/APG for that season. The command preserves the stored accolade and award arrays and only
overwrites `classic_points_by_team_era[*].points`.

Useful recovery commands for source limits:

```powershell
npm run refresh:league-averages -- --prefer=bref --delayMs=5000
npm run refresh:league-averages -- --source=nba --startEndYear=1997 --endEndYear=2024
npm run seed:stats -- --maxCacheAgeDays=7 --delayMs=1500
npm run backfill:season-stats -- --offset=250 --limit=250 --saveEvery=25
```

Example behavior:

```text
LeBron James CLE 00's: counts only Cavaliers 2000s seasons and awards
LeBron James MIA 10's: counts only Heat 2010s seasons and awards
LeBron James LAL 20's: counts only Lakers 2020s seasons and awards
```

The stored shape is:

```json
{
  "team": "CLE",
  "era": "00's",
  "points": 72.5,
  "accolades": {
    "mvp_count": 2,
    "championship_rings": 0,
    "seasons_played": 7
  },
  "award_rows": []
}
```

Stat titles are backfilled into `awards_raw` from `data/stat_title_winners.json` so titles like scoring/assist/rebound/steal/block can be attached to the right team-era.

Team codes are normalized to current NBA franchises before writing:

```text
SEA -> OKC
NJN -> BKN
MNL -> LAL
PHW/SFW -> GSW
```

## Environment Controls

The main optional controls are in `.env.example`:

```env
SEED_MODE=bref
SEED_OFFSET=0
SEED_RESUME=false
SEED_SAVE_EVERY=
BREF_SEED_DELAY_MS=4000
BREF_SEED_RETRIES=3
BREF_SEED_TIMEOUT_MS=30000
BREF_SEED_SAVE_EVERY=10
NBA_STATS_DELAY_MS=1500
NBA_STATS_MAX_RETRIES=5
NBA_STATS_TIMEOUT_MS=30000
NBA_STATS_DIRECTORY_SEASON=2025-26
NBA_STATS_REFRESH_PLAYER_DIRECTORY=false
NBA_STATS_ID_MAP_PATH=./data/nba_stats_id_map.json
```

CLI flags override environment values.

## Troubleshooting

If the seed looks stuck after:

```text
Loaded 5126 NBA Stats player directory rows from cache.
```

it is usually fetching NBA player info or NBA Stats data with configured delays. Recent versions print more progress during this stage.

If NBA Stats blocks or times out, try slower requests:

```powershell
npm run seed:full:resume -- --delayMs=2500 --timeoutMs=45000 --saveEvery=10
```

If you want a clean active-only file:

```powershell
npm run seed:active -- --replace --yes
```

If you want a clean all-time file:

```powershell
npm run seed:full -- --replace --yes
```

If you want the clean B-Ref-primary transition file:

```powershell
npm run seed
```

This writes `data/players_accolades_bref.json`.

For older NBA Stats long runs, prefer resume mode instead of deleting `players_accolades.json`.
