"""Scrape Basketball-Reference per-game pages for granular player positions.

Basketball-Reference season URLs use the season end year:
https://www.basketball-reference.com/leagues/NBA_2026_per_game.html

The output is a B-Ref player id -> position record dictionary with the source
display name, best primary slot, every traditional position seen in B-Ref
season rows, and non-TOT season/team rows for safer downstream matching, for
example:

{
  "jamesle01": {
    "name": "LeBron James",
    "bref_id": "jamesle01",
    "primary_position": "SF",
    "positions": ["SG", "SF", "PF", "PG", "C"],
    "seasons": [
      { "season": "2003-04", "team": "CLE", "games_played": 79 }
    ]
  }
}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Dict, List, TypedDict

import requests
from bs4 import BeautifulSoup, Comment


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_PATH = ROOT / "data" / "bref_positions.json"
POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"]
VALID_POSITIONS = set(POSITION_ORDER)
POSITION_PATTERN = re.compile(r"\b(?:PG|SG|SF|PF|C)\b", re.IGNORECASE)
BASE_URL = "https://www.basketball-reference.com/leagues/NBA_{year}_per_game.html"

# B-Ref rejects many default script user agents. Keep this looking like a
# normal browser request and retain the 4 second delay between season pages.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}


class SeasonRecord(TypedDict):
    season: str
    team: str
    games_played: int


class PositionRecord(TypedDict, total=False):
    name: str
    bref_id: str | None
    primary_position: str
    positions: List[str]
    seasons: List[SeasonRecord]


def configure_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        pass


def default_end_year(today: date | None = None) -> int:
    """Return the likely current NBA season end year.

    NBA_2026 is the 2025-26 season. Before October, the current calendar year
    is the season end year; from October onward, the active season ends next
    calendar year.
    """

    today = today or date.today()
    return today.year + 1 if today.month >= 10 else today.year


def clean_player_name(value: str) -> str:
    """Normalize visible B-Ref names without changing accents."""

    name = value.replace("*", "")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def parse_positions(value: str) -> List[str]:
    """Return valid traditional positions from values like PG-SG."""

    positions: List[str] = []

    for match in POSITION_PATTERN.finditer(str(value or "").upper()):
        position = match.group(0).upper()
        if position in VALID_POSITIONS and position not in positions:
            positions.append(position)

    return positions


def primary_position(value: str) -> str | None:
    """Keep the first slot from values like PG-SG."""

    positions = parse_positions(value)
    return positions[0] if positions else None


def is_aggregate_team(value: str) -> bool:
    team = str(value or "").upper()
    return team == "TOT" or bool(re.fullmatch(r"\d+TM", team))


def cell_text(row, data_stat: str) -> str:
    cell = row.find(["td", "th"], attrs={"data-stat": data_stat})
    return cell.get_text(" ", strip=True) if cell else ""


def cell_text_any(row, data_stats: List[str]) -> str:
    for data_stat in data_stats:
        value = cell_text(row, data_stat)
        if value:
            return value

    return ""


def numeric_cell(row, data_stat: str) -> float | None:
    value = cell_text(row, data_stat)

    if not value:
        return None

    try:
        return float(value)
    except ValueError:
        return None


def numeric_cell_any(row, data_stats: List[str]) -> float | None:
    for data_stat in data_stats:
        value = numeric_cell(row, data_stat)
        if value is not None:
            return value

    return None


def position_weight(row) -> float:
    """Approximate season minutes for choosing a career primary position."""

    games = numeric_cell_any(row, ["g", "games"])
    minutes_per_game = numeric_cell(row, "mp_per_g")

    if games is not None and minutes_per_game is not None:
        return games * minutes_per_game
    if minutes_per_game is not None:
        return minutes_per_game
    if games is not None:
        return games

    return 1.0


def player_cell_from_row(row):
    """B-Ref has used both player and name_display for this column."""

    return row.find("td", attrs={"data-stat": "player"}) or row.find("td", attrs={"data-stat": "name_display"})


def find_per_game_table(html: str) -> BeautifulSoup | None:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="per_game_stats")

    if table:
        return table

    # Some B-Ref tables can be wrapped in HTML comments. The per-game table is
    # usually visible, but this fallback makes the scraper tolerant of markup
    # changes.
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "per_game_stats" not in comment:
            continue

        commented_soup = BeautifulSoup(comment, "html.parser")
        table = commented_soup.find("table", id="per_game_stats")
        if table:
            return table

    return None


def fetch_year_html(session: requests.Session, year: int, timeout: int, retries: int, sleep_seconds: float) -> str:
    url = BASE_URL.format(year=year)
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            response = session.get(url, headers=HEADERS, timeout=timeout)
            response.raise_for_status()
            return response.content.decode("utf-8", errors="replace")
        except requests.RequestException as exc:
            last_error = exc
            status = getattr(exc.response, "status_code", None)
            retryable = status in {403, 429, 500, 502, 503, 504} or status is None

            if attempt >= retries or not retryable:
                break

            wait = sleep_seconds * attempt
            print(f"{year}: request failed ({exc}); retrying in {wait:.1f}s...")
            time.sleep(wait)

    raise RuntimeError(f"{year}: failed to fetch {url}: {last_error}")


def best_primary_position(positions: List[str], weights: Dict[str, float]) -> str:
    return sorted(positions, key=lambda position: (-weights.get(position, 0), positions.index(position)))[0]


def season_label(end_year: int) -> str:
    return f"{end_year - 1}-{str(end_year)[-2:]}"


def bref_player_id(player_cell) -> str | None:
    link = player_cell.find("a", href=True)

    if not link:
        return None

    match = re.search(r"/players/[a-z]/([^/.]+)\.html", link["href"])
    return match.group(1) if match else None


def scrape_positions(
    start_year: int,
    end_year: int,
    sleep_seconds: float,
    timeout: int,
    retries: int,
) -> Dict[str, PositionRecord]:
    position_records: Dict[str, PositionRecord] = {}
    position_weights: Dict[str, Dict[str, float]] = {}

    with requests.Session() as session:
        for index, year in enumerate(range(start_year, end_year + 1), start=1):
            html = fetch_year_html(session, year, timeout, retries, sleep_seconds)
            table = find_per_game_table(html)

            if not table:
                print(f"{year}: per_game_stats table not found; skipping.")
            else:
                added = 0
                parsed_rows = []
                for row in table.find_all("tr"):
                    player_cell = player_cell_from_row(row)
                    position_cell = row.find("td", attrs={"data-stat": "pos"})

                    if not player_cell or not position_cell:
                        continue

                    name = clean_player_name(player_cell.get_text(" ", strip=True))
                    player_id = bref_player_id(player_cell)
                    row_positions = parse_positions(position_cell.get_text(" ", strip=True))

                    if not name or not row_positions:
                        continue

                    parsed_rows.append(
                        {
                            "key": player_id or f"name:{name}",
                            "bref_id": player_id,
                            "name": name,
                            "season": season_label(year),
                            "positions": row_positions,
                            "primary": row_positions[0],
                            "team": cell_text_any(row, ["team_id", "team_name_abbr"]).upper(),
                            "games_played": int(numeric_cell_any(row, ["g", "games"]) or 0),
                            "weight": position_weight(row),
                        }
                    )

                player_seasons_with_totals = {
                    (entry["key"], entry["season"]) for entry in parsed_rows if is_aggregate_team(entry["team"])
                }

                for entry in parsed_rows:
                    key = entry["key"]

                    if key not in position_records:
                        position_records[key] = {
                            "name": entry["name"],
                            "bref_id": entry["bref_id"],
                            "primary_position": entry["primary"],
                            "positions": [],
                            "seasons": [],
                        }
                        position_weights[key] = {}
                        added += 1

                    record = position_records[key]
                    for position in entry["positions"]:
                        if position not in record["positions"]:
                            record["positions"].append(position)

                    if not is_aggregate_team(entry["team"]):
                        season_row = {
                            "season": entry["season"],
                            "team": entry["team"],
                            "games_played": entry["games_played"],
                        }
                        season_key = f"{season_row['season']}:{season_row['team']}"

                        if not any(f"{row['season']}:{row['team']}" == season_key for row in record["seasons"]):
                            record["seasons"].append(season_row)

                    # For traded players, B-Ref includes a TOT row plus team
                    # splits. Use only the aggregate row for primary weighting
                    # so mid-season moves do not double-count minutes.
                    if (key, entry["season"]) in player_seasons_with_totals and not is_aggregate_team(entry["team"]):
                        continue

                    weights = position_weights[key]
                    weights[entry["primary"]] = weights.get(entry["primary"], 0.0) + entry["weight"]

                print(f"{year}: added {added} new player position records ({len(position_records)} total).")

            if index < (end_year - start_year + 1):
                time.sleep(sleep_seconds)

    for key, record in position_records.items():
        record["primary_position"] = best_primary_position(record["positions"], position_weights.get(key, {}))

    return position_records


def write_positions(output_path: Path, positions: Dict[str, PositionRecord]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ordered_positions = dict(
        sorted(positions.items(), key=lambda item: (item[1].get("name", ""), item[0]))
    )
    output_path.write_text(
        json.dumps(ordered_positions, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Basketball-Reference player position records.")
    parser.add_argument("--start-year", type=int, default=1950, help="First B-Ref season end year to scrape.")
    parser.add_argument("--end-year", type=int, default=default_end_year(), help="Last B-Ref season end year to scrape.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Output JSON path.")
    parser.add_argument("--sleep", type=float, default=4.0, help="Delay between season requests, in seconds.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP request timeout, in seconds.")
    parser.add_argument("--retries", type=int, default=3, help="HTTP retries per season page.")
    return parser.parse_args()


def main() -> None:
    configure_stdout()
    args = parse_args()

    if args.start_year > args.end_year:
        raise ValueError("--start-year must be less than or equal to --end-year")
    if args.sleep < 4:
        raise ValueError("--sleep must be at least 4 seconds to respect Basketball-Reference rate limits")

    positions = scrape_positions(
        start_year=args.start_year,
        end_year=args.end_year,
        sleep_seconds=args.sleep,
        timeout=args.timeout,
        retries=args.retries,
    )
    write_positions(args.output, positions)
    print(f"Wrote {len(positions)} Basketball-Reference positions to {args.output}.")


if __name__ == "__main__":
    main()
