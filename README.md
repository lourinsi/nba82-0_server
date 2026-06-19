# NBA 82-0 Server

Backend API and data seeding tools for the 82-0 accolade workspace.

This server stores player accolade data in `data/players_accolades.json`, serves it through Express, and includes scripts for fetching NBA data, resuming long seed runs, recalculating `legacy_points`, and deriving team-era Classic scores.

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

The server reads `data/players_accolades.json` fresh on each request, so seed updates are reflected without restarting the server.

## Seed Scripts

Available scripts:

```powershell
npm start
npm run dev
npm run seed
npm run seed:active
npm run seed:active:resume
npm run seed:full
npm run seed:full:resume
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
node seed.js --mode=active
```

Simple command guide:

```text
npm start
Runs the Express API server once.

npm run dev
Runs the Express API server with Node watch mode, so it restarts after local code changes.

npm run seed
Refreshes current active NBA players and merges them into the existing player file.

npm run seed:active
Same active-player refresh as npm run seed.

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
Builds data/historical_league_averages.json from NBA Stats/Basketball Reference season data.

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
npm run refresh:positions:dry
npm run refresh:positions
npm run seed:active
npm run seed:bref-positions
npm run seed:games-started -- --saveEvery=25
npm run seed:legacy-points
npm run refresh:league-averages
npm run seed:stats
npm run backfill:season-stats -- --saveEvery=25
npm run seed:classic-points -- --dryRun
npm run seed:classic-points
npm run seed:goat-rankings
```

Step-by-step:

1. Preview position changes with `npm run refresh:positions:dry`.
   This shows what would change before touching `players_accolades.json`.

2. Apply position updates with `npm run refresh:positions`.
   This keeps blank, unknown, and broad NBA API positions current.

3. Refresh player data with `npm run seed:active` or `npm run seed:full`.
   Both commands merge into existing data by default. Use `seed:active` for current NBA players. Use `seed:full` when you want to refresh the all-time dataset from the start while preserving unprocessed records.

4. Re-enforce Basketball Reference positions with `npm run seed:bref-positions`.
   This overwrites matching players' `positions` and `primary_position` from `data/bref_positions.json` after player refreshes, so stale merged values are removed.

5. Backfill games started with `npm run seed:games-started`.
   This uses NBA Stats career totals (`GS`) and stores both per-season `games_started` and aggregate `accolades.games_started`. If a season has no `GS`, its `GP` is counted as `games_started`. Explicit `GS=0` only falls back to `GP` before 1970-71.

6. Optionally seed game wins with `npm run seed:game-wins`.
   This counts NBA Stats regular-season game logs where `WL` is `W`, stores per-season `games_won`, and exposes the career total as `accolades.games_won`. Use `--gameWins` without `--refreshGameWins` when you want to reuse cached win rows.

7. Recalculate base scoring with `npm run seed:legacy-points`.
   This updates `legacy_points` from the accolades already stored locally.

8. Refresh league averages with `npm run refresh:league-averages`.
   This builds `data/historical_league_averages.json` for the season climate baseline.

9. Refresh active-player career season stats with `npm run seed:stats`.
   This keeps current players' `career_seasons`, active status, and current team fresh from `data/nba_stats_player_directory.json` and `data/nba_stats_career_stats_cache.json`.

10. Backfill Basketball Reference advanced stats with `npm run seed:advanced-stats`.
   This stores TS% as `ts_pct` and WS/48 as `ws_per_48` on matching stored career seasons.

11. Backfill any remaining stored career season stat gaps with `npm run backfill:season-stats -- --saveEvery=25`.
   This fills PPG/RPG/APG/SPG/BPG on `career_seasons` from NBA Stats career totals.

12. Recalculate Classic Mode team-era points with `npm run seed:classic-points`.
   This uses `data/historical_league_averages.json` and only overwrites each classic block's `points`.

13. Refresh GOAT ranking data with `npm run seed:goat-rankings`.
   This updates the cached media ranking file used for GOAT score overlays.

## Running Scripts Safely

Run only one script that writes `data/players_accolades.json` at a time. These commands all touch that file and should be run sequentially:

```powershell
npm run seed
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

Do not run `npm run seed:stats`, `npm run seed:game-wins`, `npm run seed:advanced-stats`, `npm run seed:games-started`, `npm run seed:bref-positions`, `npm run backfill:season-stats`, or `npm run refresh:positions` at the same time as any other command that writes `players_accolades.json`. These commands all read the full file, update their own fields in memory, and write the full file back. Whichever write finishes last can overwrite the other command's changes.

This pairing is safe because the scripts write different files, though slower delays are still friendlier to the remote data sources:

```powershell
# Terminal 1: writes data/players_accolades.json
npm run seed:stats -- --limit=250 --delayMs=500

# Terminal 2: writes data/historical_league_averages.json
npm run refresh:league-averages -- --prefer=bref --delayMs=10000
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` with the same arguments.

## Seed Modes

`active` fetches current active players from the NBA Stats player directory, refreshes their awards/career data, and merges those updates into the existing player file by default.

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

For active players:

```powershell
npm run seed -- --limit=100
npm run seed -- --offset=100 --limit=100
```

Normal seed runs merge into the existing `players_accolades.json` instead of replacing it. This means refreshed players overwrite matching records one by one, while unprocessed players remain in the file. Use `--replace --yes` only when you intentionally want the output file to contain only the current run.

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

Use `--replace` when you intentionally want the output file to contain only the current run.

Example:

```powershell
npm run seed:full -- --limit=100 --replace --yes
```

Without `--replace`, seed runs merge into existing data. Replacement prompts for confirmation when run interactively; use `--yes` only when you intentionally want a non-interactive replacement.

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

`seed:advanced-stats` reads Basketball Reference advanced season pages, caches them in `data/bref_advanced_stats_cache.json`, and matches rows by player name, season, and team. Use `--refreshCache` to refetch B-Ref season pages and `--force` to overwrite existing `ts_pct` / `ws_per_48` values.

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

After changing `LEGACY_ENGINE_FACTORS`, run this script so `data/players_accolades.json` stores updated `legacy_points`. The API serves those stored scores instead of recalculating top-level legacy points on every request.

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
`data/historical_league_averages.json` is available:

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
  "2011-12": { "PPG": 96.3, "RPG": 42.2, "APG": 21.0, "SPG": 7.7, "BPG": 5.1 },
  "1961-62": { "PPG": 118.8, "RPG": 71.4, "APG": 23.9 }
}
```

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
SEED_MODE=active
SEED_OFFSET=0
SEED_RESUME=false
SEED_SAVE_EVERY=
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

For most long runs, prefer resume mode instead of deleting `players_accolades.json`.
