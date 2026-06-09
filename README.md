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
npm run seed:goat-rankings
npm run seed:legacy-points
npm run seed:classic-points
npm run seed:position-bonus
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
Refreshes current active NBA players. This is the default active-player seed command.

npm run seed:active
Same active-player refresh as npm run seed.

npm run seed:active:resume
Continues an active-player seed and skips players already saved in data/players_accolades.json.

npm run seed:full
Refreshes the all-time player dataset. This can take a long time.

npm run seed:full:resume
Continues a long all-time seed and skips players already saved.

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

npm run seed:position-bonus
Applies position_bonus and final_score after legacy points and GOAT scores are available.

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
npm run seed:legacy-points
npm run refresh:league-averages
npm run backfill:season-stats -- --saveEvery=25
npm run seed:classic-points -- --dryRun
npm run seed:classic-points
npm run seed:goat-rankings
npm run seed:position-bonus
```

Step-by-step:

1. Preview position changes with `npm run refresh:positions:dry`.
   This shows what would change before touching `players_accolades.json`.

2. Apply position updates with `npm run refresh:positions`.
   This keeps `positions` and `primary_position` current.

3. Refresh player data with `npm run seed:active` or `npm run seed:full`.
   Use `seed:active` for current NBA players. Use `seed:full` only when you want the all-time dataset.

4. Recalculate base scoring with `npm run seed:legacy-points`.
   This updates `legacy_points` from the accolades already stored locally.

5. Refresh league averages with `npm run refresh:league-averages`.
   This builds `data/historical_league_averages.json` for the season climate baseline.

6. Backfill stored career season stats with `npm run backfill:season-stats -- --saveEvery=25`.
   This fills PPG/RPG/APG/SPG/BPG on `career_seasons` from NBA Stats career totals.

7. Recalculate Classic Mode team-era points with `npm run seed:classic-points`.
   This uses `data/historical_league_averages.json` and only overwrites each classic block's `points`.

8. Refresh GOAT ranking data with `npm run seed:goat-rankings`.
   This updates the cached media ranking file used for GOAT score overlays.

9. Apply positional alignment scoring with `npm run seed:position-bonus`.
   This writes `position_bonus` and recalculates `final_score = legacy_points + goat_ranking/goat_score + position_bonus`.

## Running Scripts Safely

Run only one script that writes `data/players_accolades.json` at a time. These commands all touch that file and should be run sequentially:

```powershell
npm run seed
npm run seed:active
npm run seed:full
npm run seed:legacy-points
npm run backfill:season-stats
npm run seed:classic-points
npm run seed:position-bonus
npm run refresh:positions
npm run fix:positions
```

Do not run `npm run backfill:season-stats` at the same time as `npm run seed:full` or `npm run seed:full:resume`. Both can checkpoint or rewrite `players_accolades.json`, and whichever write finishes last can overwrite the other script's changes.

This pairing is safe because the scripts write different files, though slower delays are still friendlier to the remote data sources:

```powershell
# Terminal 1: writes data/players_accolades.json
npm run backfill:season-stats -- --limit=250 --saveEvery=25 --delayMs=500

# Terminal 2: writes data/historical_league_averages.json
npm run refresh:league-averages -- --prefer=bref --delayMs=10000
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` with the same arguments.

## Seed Modes

`active` fetches current active players from the NBA Stats player directory and refreshes their awards/career data.

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

When `--limit`, `--offset`, or `--resume` is used, output is merged into the existing `players_accolades.json` instead of replacing it.

## Resume Mode

Resume mode skips players already present in `data/players_accolades.json`.

All-time resume:

```powershell
npm run seed:full:resume
```

Active resume:

```powershell
npm run seed:active:resume
```

Recommended all-time long run:

```powershell
npm run seed:full:resume -- --saveEvery=25
```

This checkpoints the JSON after every 25 processed players.

## Replace Mode

Use `--replace` when you intentionally want the output file to contain only the current run.

Example:

```powershell
npm run seed:full -- --limit=100 --replace
```

Without `--replace`, limited/resume runs merge into existing data.

## Useful Flags

```text
--mode=active|full
--limit=100
--offset=100
--resume
--merge
--replace
--saveEvery=25
--delayMs=1500
--retries=5
--timeoutMs=30000
--refreshNbaDirectory
```

Common examples:

```powershell
npm run seed:full -- --limit=100
npm run seed:full -- --offset=100 --limit=100
npm run seed:full:resume -- --saveEvery=25
npm run seed:active:resume
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

## Legacy Points

Each player gets a top-level `legacy_points` field calculated from stored `accolades`.

Recalculate points without refetching APIs:

```powershell
npm run seed:legacy-points
```

Fetch/cache the Bleacher Report GOAT Top 100 media score without refetching NBA APIs:

```powershell
npm run seed:goat-rankings
```

This writes `data/br_goat_rankings.json` and reports current matches. It does not modify `data/players_accolades.json`.

The weights live in `legacyPoints.js`.

Current weighted fields:

```text
mvp_count: 10
finals_mvp_count: 5
dpoy_count: 5
roy_won: 5
championship_rings: 5
most_improved: 2
6moy: 2
olympic_gold_medals: 3
olympic_silver_medals: 1
olympic_bronze_medals: 0.5
all_nba_1st: 5
all_nba_2nd: 3
all_nba_3rd: 2
all_def_1st: 3
all_def_2nd: 2
all_rookie_1st: 3
all_rookie_2nd: 2
all_star_selections: 2
all_star_mvp_count: 3
seasons_played: 0.5
scoring_titles: 3
assist_titles: 3
rebound_titles: 3
steal_titles: 3
block_titles: 3
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

The frontend/API final score is:

```text
final_legacy_points = legacy_points + goat_score
```

Normal `seed`, `seed:active`, and `seed:full` runs also apply legacy points before writing output.

## Classic Points

Each player also gets `classic_points_by_team_era`, derived from `career_seasons` and per-season `awards_raw`.

This is for Classic Mode. It does not replace all-time `legacy_points`.

Run the era-relative statistical recalculation after `career_seasons` include per-game stats and
`data/historical_league_averages.json` is available:

```powershell
npm run refresh:league-averages
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
npm run seed:active -- --replace
```

If you want a clean all-time file:

```powershell
npm run seed:full -- --replace
```

For most long runs, prefer resume mode instead of deleting `players_accolades.json`.
