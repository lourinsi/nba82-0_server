# NBA 82-0 Server

Backend API and data seeding tools for the 82-0 accolade workspace.

This server stores player accolade data in `data/players_accolades.json`, serves it through Express, and includes scripts for fetching NBA data, resuming long seed runs, and recalculating `legacy_points`.

## Setup

Install dependencies:

```powershell
npm install
```

Create a local `.env` from `.env.example` and set your BALLDONTLIE API key:

```powershell
Copy-Item .env.example .env
```

Required:

```env
BALLDONTLIE_API_KEY=your_key_here
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
npm run seed
npm run seed:active
npm run seed:active:resume
npm run seed:full
npm run seed:full:resume
npm run seed:legacy-points
```

`npm run seed` is the same as:

```powershell
node seed.js --mode=active
```

## Seed Modes

`active` fetches current active players from the NBA Stats player directory and refreshes their awards/career data.

```powershell
npm run seed:active
```

`full` fetches all BALLDONTLIE players, resolves them to NBA Stats IDs, then refreshes awards/career data.

```powershell
npm run seed:full
```

Full all-time seeding can take a long time because each player may require NBA Stats awards, career, and stat-title requests with delays.

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

Manual corrections live in `data/position_overrides.json`.

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

## Environment Controls

The main optional controls are in `.env.example`:

```env
SEED_MODE=active
SEED_OFFSET=0
SEED_RESUME=false
SEED_SAVE_EVERY=
BALLDONTLIE_PER_PAGE=100
BALLDONTLIE_MAX_PLAYERS=
BALLDONTLIE_DELAY_MS=12500
BALLDONTLIE_MAX_RETRIES=6
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
