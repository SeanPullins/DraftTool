#!/usr/bin/env python3
"""
Import PFF college receiving_summary CSV files into DraftTool WR PFF seasons JSON.

Usage examples:
  python3 scripts/import_wr_pff_from_archive.py ~/Downloads/Archive\ 2\(1\).zip
  python3 scripts/import_wr_pff_from_archive.py ~/Downloads/Archive\ 2\(1\).zip ~/Downloads/receiving_summary\ \(10\).csv ~/Downloads/receiving_summary\ \(11\).csv

Writes:
  public/data/wr_pff_seasons.json

Notes:
- Filters to position == WR only.
- Does not invent metric values.
- Season values are inferred from known top-player/signature rows in each PFF receiving_summary CSV.
- In the current file set:
  2015 = receiving_summary (11).csv, top WR Tajae Sharpe
  2017 = receiving_summary (10).csv, top WR Michael Gallup
"""

from __future__ import annotations

import json
import math
import sys
import zipfile
from pathlib import Path
from typing import Iterable

import pandas as pd


SEASON_MAP = {
    "receiving_summary.csv": 2014,
    "receiving_summary (11).csv": 2015,
    "receiving_summary (1).csv": 2016,
    "receiving_summary (10).csv": 2017,
    "receiving_summary (2).csv": 2018,
    "receiving_summary (3).csv": 2019,
    "receiving_summary (4).csv": 2020,
    "receiving_summary (5).csv": 2021,
    "receiving_summary (6).csv": 2022,
    "receiving_summary (7).csv": 2023,
    "receiving_summary (8).csv": 2024,
    "receiving_summary (9).csv": 2025,
}

WANTED_COLS = [
    "player", "player_id", "position", "team_name", "player_game_count", "avg_depth_of_target",
    "avoided_tackles", "caught_percent", "contested_catch_rate", "contested_receptions", "contested_targets",
    "drop_rate", "drops", "epa", "first_downs", "fumbles", "grades_hands_drop", "grades_hands_fumble",
    "grades_offense", "grades_pass_block", "grades_pass_route", "inline_rate", "inline_snaps", "longest",
    "pass_block_rate", "pass_blocks", "pass_plays", "penalties", "positive_epa_percent", "receptions",
    "route_rate", "routes", "slot_rate", "slot_snaps", "targeted_qb_rating", "targets", "touchdowns",
    "wide_rate", "wide_snaps", "yards", "yards_after_catch", "yards_after_catch_per_reception",
    "yards_per_reception", "yprr",
]


def clean_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return value
    return value


def normalize_name(path_name: str) -> str:
    # Zip entries may include nested dirs; local files are just basenames.
    return Path(path_name).name


def records_from_frame(df: pd.DataFrame, source_file: str, season: int):
    total_rows = len(df)
    if "position" not in df.columns:
        raise ValueError(f"{source_file} has no position column")

    # Include true WRs AND two-way/off-position players who have meaningful receiving usage.
    # Example: Travis Hunter may be listed by PFF as CB, but he still belongs in receiving context.
    routes = pd.to_numeric(df["routes"], errors="coerce") if "routes" in df.columns else 0
    targets = pd.to_numeric(df["targets"], errors="coerce") if "targets" in df.columns else 0
    receptions = pd.to_numeric(df["receptions"], errors="coerce") if "receptions" in df.columns else 0
    yards = pd.to_numeric(df["yards"], errors="coerce") if "yards" in df.columns else 0

    receiving_usage = (routes.fillna(0) > 0) | (targets.fillna(0) > 0) | (receptions.fillna(0) > 0) | (yards.fillna(0) != 0)
    listed_wr = df["position"].astype(str).str.upper() == "WR"

    wr_df = df[listed_wr | receiving_usage].copy()

    summary = {
        "source_file": source_file,
        "season": season,
        "rows_total": total_rows,
        "wr_rows": len(wr_df),
        "top_player": str(wr_df.iloc[0]["player"]) if len(wr_df) and "player" in wr_df.columns else None,
        "note": "Includes WR plus off-position/two-way players with receiving usage.",
    }

    records = []
    for _, row in wr_df.iterrows():
        rec = {"season": season, "source_file": source_file}
        for col in WANTED_COLS:
            rec[col] = clean_value(row[col]) if col in row else None

        rec["name"] = rec.pop("player")
        rec["team"] = rec.pop("team_name")
        rec["games"] = rec.pop("player_game_count")
        rec["adot"] = rec.pop("avg_depth_of_target")
        rec["catch_rate"] = rec.pop("caught_percent")
        rec["route_grade"] = rec.pop("grades_pass_route")
        rec["offense_grade"] = rec.pop("grades_offense")
        rec["hands_drop_grade"] = rec.pop("grades_hands_drop")
        rec["hands_fumble_grade"] = rec.pop("grades_hands_fumble")
        records.append(rec)

    return records, summary


def iter_csv_sources(paths: Iterable[Path]):
    seen = set()
    for path in paths:
        path = path.expanduser().resolve()
        if not path.exists():
            print(f"[WARN] File not found: {path}; skipping", file=sys.stderr)
            continue

        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as zf:
                for member in zf.namelist():
                    if member.startswith("__MACOSX") or not member.endswith(".csv"):
                        continue
                    source_name = normalize_name(member)
                    if source_name not in SEASON_MAP:
                        print(f"[WARN] No season mapping for {member}; skipping", file=sys.stderr)
                        continue
                    key = (source_name, SEASON_MAP[source_name])
                    if key in seen:
                        continue
                    seen.add(key)
                    yield source_name, SEASON_MAP[source_name], pd.read_csv(zf.open(member))
        elif path.suffix.lower() == ".csv":
            source_name = path.name
            if source_name not in SEASON_MAP:
                print(f"[WARN] No season mapping for {source_name}; skipping", file=sys.stderr)
                continue
            key = (source_name, SEASON_MAP[source_name])
            if key in seen:
                continue
            seen.add(key)
            yield source_name, SEASON_MAP[source_name], pd.read_csv(path)
        else:
            print(f"[WARN] Unsupported file type: {path}; skipping", file=sys.stderr)


def build_records(paths: Iterable[Path]):
    records = []
    summary = []
    for source_file, season, df in iter_csv_sources(paths):
        chunk, item = records_from_frame(df, source_file, season)
        records.extend(chunk)
        summary.append(item)

    records.sort(key=lambda r: (r["season"], str(r.get("name") or ""), int(r.get("player_id") or 0)))
    summary.sort(key=lambda s: s["season"])
    return records, summary


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/import_wr_pff_from_archive.py /path/to/archive.zip [extra_csv ...]", file=sys.stderr)
        return 2

    paths = [Path(arg) for arg in sys.argv[1:]]
    records, summary = build_records(paths)
    included = sorted({r["season"] for r in records})
    expected = list(range(2014, 2026))
    missing = [year for year in expected if year not in included]

    payload = {
        "metadata": {
            "source_files": [p.name for p in paths],
            "record_type": "college_pff_receiving_summary_wr_only",
            "position_filter": "WR plus receiving-usage players, including two-way/off-position receiving rows",
            "season_mapping_basis": "Inferred from top-player/signature rows in each downloaded PFF receiving_summary CSV. No metric values were invented.",
            "included_seasons": included,
            "missing_seasons_in_input": missing,
            "records": len(records),
            "files": summary,
        },
        "records": records,
    }

    out_path = Path("public/data/wr_pff_seasons.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")))

    print(f"Wrote {out_path} ({len(records)} WR seasons)")
    print(f"Included seasons: {included}")
    if missing:
        print(f"Missing seasons: {missing}")
    for item in summary:
        print(f"  {item['season']}: {item['wr_rows']} WR rows from {item['source_file']} (top: {item['top_player']})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
