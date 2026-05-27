from pathlib import Path
import pandas as pd
import re

OUT = Path("data/nfl_outcomes")

players_path = OUT / "nfl_players.csv"
ids_path = OUT / "nfl_ids.csv"

def clean(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def load_identity():
    identity = {}

    if players_path.exists():
        p = pd.read_csv(players_path, low_memory=False)
        for _, r in p.iterrows():
            name = (
                r.get("display_name")
                or r.get("full_name")
                or r.get("football_name")
                or r.get("name")
                or r.get("player_name")
            )
            pos = r.get("position") or r.get("pos") or ""
            for col in ["gsis_id", "nflverse_id", "pfr_id", "espn_id", "sportradar_id", "nfl_id"]:
                val = r.get(col)
                if pd.notna(val) and str(val).strip():
                    identity[str(val)] = {"player": name, "position": pos}

    if ids_path.exists():
        p = pd.read_csv(ids_path, low_memory=False)
        for _, r in p.iterrows():
            name = (
                r.get("name")
                or r.get("player_name")
                or r.get("full_name")
                or r.get("display_name")
            )
            pos = r.get("position") or r.get("pos") or ""
            for col in ["gsis_id", "nflverse_id", "pfr_id", "espn_id", "sportradar_id", "nfl_id"]:
                val = r.get(col)
                if pd.notna(val) and str(val).strip():
                    existing = identity.get(str(val), {})
                    identity[str(val)] = {
                        "player": existing.get("player") or name,
                        "position": existing.get("position") or pos,
                    }

    return identity

identity = load_identity()
print("identity ids:", len(identity))

files = [
    OUT / "nfl_pbp_qb_outcomes_2014_2025.csv",
    OUT / "nfl_pbp_rushing_outcomes_2014_2025.csv",
    OUT / "nfl_pbp_receiving_outcomes_2014_2025.csv",
]

for file in files:
    df = pd.read_csv(file, low_memory=False)

    fixed_names = []
    fixed_pos = []

    for _, r in df.iterrows():
        pid = str(r.get("player_id", "")).strip()
        info = identity.get(pid, {})
        fixed_names.append(info.get("player") or r.get("player"))
        fixed_pos.append(info.get("position") or r.get("position_bucket") or "")

    df["player_original_pbp"] = df["player"]
    df["player"] = fixed_names
    df["position"] = fixed_pos

    df.to_csv(file, index=False)
    print("fixed", file, "rows", len(df))

print("\nSample checks:")
for file in files:
    df = pd.read_csv(file, low_memory=False)
    print("\n", file.name)
    for name in ["Patrick Mahomes", "Josh Allen", "Joe Burrow", "Justin Jefferson", "Ja'Marr Chase", "CeeDee Lamb", "Saquon Barkley", "Christian McCaffrey"]:
        rows = df[df["player"].astype(str).map(clean).eq(clean(name))]
        if not rows.empty:
            cols = [c for c in ["player", "position", "games", "nfl_seasons", "passing_yards", "rushing_yards", "receiving_yards"] if c in rows.columns]
            print(rows[cols].to_string(index=False))
