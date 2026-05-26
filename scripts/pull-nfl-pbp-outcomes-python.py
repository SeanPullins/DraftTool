from pathlib import Path
import pandas as pd
import nfl_data_py as nfl

OUT = Path("data/nfl_outcomes")
OUT.mkdir(parents=True, exist_ok=True)

years = list(range(2014, 2026))

cols = [
    "game_id",
    "season",
    "season_type",
    "week",
    "posteam",
    "defteam",
    "passer_player_id",
    "passer_player_name",
    "rusher_player_id",
    "rusher_player_name",
    "receiver_player_id",
    "receiver_player_name",
    "pass",
    "rush",
    "complete_pass",
    "interception",
    "sack",
    "touchdown",
    "pass_touchdown",
    "rush_touchdown",
    "yards_gained",
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "epa",
    "air_yards",
    "yards_after_catch",
]

print("Pulling PBP...")
pbp = nfl.import_pbp_data(years, columns=cols, downcast=True)
print("PBP shape:", pbp.shape)

pbp.to_csv(OUT / "nfl_pbp_2014_2025_slim.csv", index=False)
print("Wrote slim PBP")

# QB passing aggregation
pass_df = pbp[pbp["passer_player_id"].notna()].copy()
qb = pass_df.groupby(["passer_player_id", "passer_player_name"], dropna=False).agg(
    nfl_seasons=("season", "nunique"),
    games=("game_id", "nunique"),
    pass_plays=("pass", "sum"),
    completions=("complete_pass", "sum"),
    passing_yards=("passing_yards", "sum"),
    passing_tds=("pass_touchdown", "sum"),
    interceptions=("interception", "sum"),
    sacks=("sack", "sum"),
    passing_epa=("epa", "sum"),
).reset_index()

qb = qb.rename(columns={
    "passer_player_id": "player_id",
    "passer_player_name": "player",
})
qb["position_bucket"] = "QB"

# rushing aggregation
rush_df = pbp[pbp["rusher_player_id"].notna()].copy()
rush = rush_df.groupby(["rusher_player_id", "rusher_player_name"], dropna=False).agg(
    nfl_seasons=("season", "nunique"),
    games=("game_id", "nunique"),
    rush_plays=("rush", "sum"),
    carries=("rush", "sum"),
    rushing_yards=("rushing_yards", "sum"),
    rushing_tds=("rush_touchdown", "sum"),
    rushing_epa=("epa", "sum"),
).reset_index()

rush = rush.rename(columns={
    "rusher_player_id": "player_id",
    "rusher_player_name": "player",
})
rush["position_bucket"] = "RUSH"

# receiving aggregation
rec_df = pbp[pbp["receiver_player_id"].notna()].copy()
rec = rec_df.groupby(["receiver_player_id", "receiver_player_name"], dropna=False).agg(
    nfl_seasons=("season", "nunique"),
    games=("game_id", "nunique"),
    targets=("pass", "sum"),
    receptions=("complete_pass", "sum"),
    receiving_yards=("receiving_yards", "sum"),
    receiving_tds=("pass_touchdown", "sum"),
    receiving_epa=("epa", "sum"),
    air_yards=("air_yards", "sum"),
    yards_after_catch=("yards_after_catch", "sum"),
).reset_index()

rec = rec.rename(columns={
    "receiver_player_id": "player_id",
    "receiver_player_name": "player",
})
rec["position_bucket"] = "REC"

qb.to_csv(OUT / "nfl_pbp_qb_outcomes_2014_2025.csv", index=False)
rush.to_csv(OUT / "nfl_pbp_rushing_outcomes_2014_2025.csv", index=False)
rec.to_csv(OUT / "nfl_pbp_receiving_outcomes_2014_2025.csv", index=False)

print("Wrote:")
print(" ", OUT / "nfl_pbp_qb_outcomes_2014_2025.csv", len(qb))
print(" ", OUT / "nfl_pbp_rushing_outcomes_2014_2025.csv", len(rush))
print(" ", OUT / "nfl_pbp_receiving_outcomes_2014_2025.csv", len(rec))
print("DONE")
