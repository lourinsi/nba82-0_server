import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

from nba_api.stats.endpoints import commonplayerinfo, playerindex

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "data" / "players_accolades.json"
POSITION_CACHE_PATH = ROOT / "data" / "nba_api_player_positions.json"
POSITION_OVERRIDES_PATH = ROOT / "data" / "position_overrides.json"
POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"]


def configure_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        pass


def normalize_name(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).strip().lower()
    return re.sub(r"\s+", " ", text)


def unique_positions(values):
    output = []

    for value in values:
        if value in POSITION_ORDER and value not in output:
            output.append(value)

    return output


def parse_position_group(position):
    normalized = str(position or "").strip().upper()

    if not normalized:
        return []

    normalized = normalized.replace("POINT GUARD", "PG")
    normalized = normalized.replace("SHOOTING GUARD", "SG")
    normalized = normalized.replace("SMALL FORWARD", "SF")
    normalized = normalized.replace("POWER FORWARD", "PF")
    normalized = normalized.replace("CENTER", "C")
    normalized = normalized.replace("GUARD", "G")
    normalized = normalized.replace("FORWARD", "F")

    tokens = re.findall(r"PG|SG|SF|PF|C|G|F", normalized)
    positions = []

    for token in tokens:
        if token == "PG":
            positions.append("PG")
        elif token == "SG":
            positions.append("SG")
        elif token == "SF":
            positions.append("SF")
        elif token == "PF":
            positions.append("PF")
        elif token == "C":
            positions.append("C")
        elif token == "G":
            positions.extend(["PG", "SG"])
        elif token == "F":
            positions.extend(["SF", "PF"])

    joined = "-".join(tokens)

    if joined in {"F-C", "FC"}:
        positions = ["PF", "C"]
    elif joined in {"C-F", "CF"}:
        positions = ["C", "PF"]
    elif joined in {"G-F", "GF"}:
        positions = ["SG", "SF"]
    elif joined in {"F-G", "FG"}:
        positions = ["SF", "SG"]

    return unique_positions(positions)


def positions_equal(left, right):
    return list(left or []) == list(right or [])


def looks_like_legacy_unknown(positions):
    return list(positions or []) == POSITION_ORDER


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_position_overrides():
    overrides = load_json(POSITION_OVERRIDES_PATH, [])
    normalized = []

    for override in overrides:
        positions = unique_positions(override.get("positions", []))

        if not positions:
            continue

        normalized.append(
            {
                **override,
                "positions": positions,
                "name_key": normalize_name(override.get("name")),
            }
        )

    return normalized


def find_position_override(player, overrides):
    player_name_key = normalize_name(player.get("name"))
    nba_stats_id = player.get("nba_stats_id")
    balldontlie_id = player.get("balldontlie_id")

    for override in overrides:
        if override.get("nba_stats_id") and override.get("nba_stats_id") == nba_stats_id:
            return override

        if override.get("balldontlie_id") and override.get("balldontlie_id") == balldontlie_id:
            return override

        if override.get("name_key") and override.get("name_key") == player_name_key:
            return override

    return None


def cache_record_from_player_index(row):
    player_id = row.get("PERSON_ID") or row.get("PLAYER_ID")
    first_name = row.get("PLAYER_FIRST_NAME") or ""
    last_name = row.get("PLAYER_LAST_NAME") or ""
    display_name = row.get("PLAYER_NAME") or f"{first_name} {last_name}".strip()

    return {
        "nba_stats_id": player_id,
        "name": display_name,
        "position": row.get("POSITION") or "",
        "positions": parse_position_group(row.get("POSITION")),
        "height": row.get("HEIGHT"),
        "weight": row.get("WEIGHT"),
        "from_year": row.get("FROM_YEAR"),
        "to_year": row.get("TO_YEAR"),
        "roster_status": row.get("ROSTER_STATUS"),
        "source": "PlayerIndex",
    }


def fetch_position_cache(season, timeout):
    response = playerindex.PlayerIndex(historical_nullable="1", season=season, timeout=timeout)
    rows = response.get_normalized_dict().get("PlayerIndex", [])
    records = [cache_record_from_player_index(row) for row in rows]
    records = [record for record in records if record.get("nba_stats_id")]
    payload = {
        "source": "nba_api.stats.endpoints.playerindex.PlayerIndex",
        "season": season,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "records": records,
    }
    write_json(POSITION_CACHE_PATH, payload)
    return payload


def load_position_cache(refresh, season, timeout):
    if not refresh:
        cached = load_json(POSITION_CACHE_PATH, None)

        if cached and cached.get("records"):
            return cached

    return fetch_position_cache(season, timeout)


def build_position_lookup(cache):
    by_id = {}
    by_name = {}

    for record in cache.get("records", []):
        if record.get("positions"):
            by_id[record.get("nba_stats_id")] = record
            by_name[normalize_name(record.get("name"))] = record

    return by_id, by_name


def common_player_info_record(nba_stats_id, timeout):
    response = commonplayerinfo.CommonPlayerInfo(player_id=nba_stats_id, timeout=timeout)
    rows = response.get_normalized_dict().get("CommonPlayerInfo", [])

    if not rows:
        return None

    row = rows[0]
    position = row.get("POSITION") or ""

    return {
        "nba_stats_id": nba_stats_id,
        "name": row.get("DISPLAY_FIRST_LAST") or "",
        "position": position,
        "positions": parse_position_group(position),
        "height": row.get("HEIGHT"),
        "weight": row.get("WEIGHT"),
        "source": "CommonPlayerInfo",
    }


def source_record_for_player(player, by_id, by_name, timeout, fallback_common_info):
    nba_stats_id = player.get("nba_stats_id")

    if nba_stats_id and nba_stats_id in by_id:
        return by_id[nba_stats_id]

    name_key = normalize_name(player.get("name"))

    if name_key in by_name:
        return by_name[name_key]

    if fallback_common_info and nba_stats_id:
        try:
            return common_player_info_record(nba_stats_id, timeout)
        except Exception as exc:
            print(f"{player.get('name')}: CommonPlayerInfo failed ({type(exc).__name__}: {exc})")

    return None


def should_update_positions(player, next_positions, override, force_broad):
    current_positions = player.get("positions") or []

    if not next_positions or positions_equal(current_positions, next_positions):
        return False

    if override:
        return True

    if force_broad:
        return True

    return not current_positions or looks_like_legacy_unknown(current_positions)


def refresh_positions(args):
    players = load_json(PLAYERS_PATH, [])
    overrides = load_position_overrides()
    cache = load_position_cache(args.refresh_cache, args.season, args.timeout)
    by_id, by_name = build_position_lookup(cache)
    changes = []
    source_hits = 0
    skipped_specific = 0

    for player in players:
        override = find_position_override(player, overrides)

        if override:
            next_positions = override["positions"]
            source_label = "override"
        else:
            source_record = source_record_for_player(
                player,
                by_id,
                by_name,
                args.timeout,
                args.fallback_common_info,
            )

            if not source_record or not source_record.get("positions"):
                continue

            source_hits += 1
            next_positions = source_record["positions"]
            source_label = source_record.get("source") or "nba_api"

        if should_update_positions(player, next_positions, override, args.force_broad):
            changes.append(
                {
                    "name": player.get("name"),
                    "nba_stats_id": player.get("nba_stats_id"),
                    "from": player.get("positions") or [],
                    "to": next_positions,
                    "source": source_label,
                }
            )

            player["positions"] = next_positions
            player["primary_position"] = next_positions[0]
        else:
            skipped_specific += 1

    print(f"Loaded {len(players)} players.")
    print(f"Loaded {len(cache.get('records', []))} nba_api position records from {cache.get('source')}.")
    print(f"Matched {source_hits} players through nba_api; loaded {len(overrides)} manual overrides.")
    print(f"Prepared {len(changes)} position updates; skipped {skipped_specific} already-specific records.")

    for change in changes[: args.preview]:
        print(
            f"- {change['name']}: {'/'.join(change['from']) or '(empty)'} -> "
            f"{'/'.join(change['to'])} ({change['source']})"
        )

    if len(changes) > args.preview:
        print(f"... {len(changes) - args.preview} more updates not shown.")

    if args.dry_run:
        print("Dry run only; players_accolades.json was not modified.")
        return

    write_json(PLAYERS_PATH, players)
    print(f"Wrote updated positions to {PLAYERS_PATH}.")


def main():
    configure_stdout()
    parser = argparse.ArgumentParser(description="Refresh player positions using nba_api PlayerIndex data.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned updates without writing players_accolades.json.")
    parser.add_argument("--force-broad", action="store_true", help="Replace already-specific positions with broad NBA API positions.")
    parser.add_argument("--refresh-cache", action="store_true", help="Refetch nba_api PlayerIndex data even when a cache file exists.")
    parser.add_argument("--fallback-common-info", action="store_true", help="Call CommonPlayerInfo for players missing from PlayerIndex cache.")
    parser.add_argument("--season", default="2025-26", help="Season passed to nba_api PlayerIndex.")
    parser.add_argument("--timeout", type=int, default=30, help="nba_api request timeout in seconds.")
    parser.add_argument("--preview", type=int, default=25, help="Number of planned updates to print.")
    args = parser.parse_args()
    refresh_positions(args)


if __name__ == "__main__":
    main()
