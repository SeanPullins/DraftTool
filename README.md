# DraftLens

A free, deployable NFL prospect projection tool. It uses nflverse combine data, draft outcome data, college PFF profile data, and NFL season outcomes, then blends draft capital, athletic testing, size, age, manual scouting grades, college production comps, and uncertainty bands.

No model can project exact NFL success. DraftLens is built to be honest about that: it reports probabilities, ranges, comps, and confidence instead of pretending the future is deterministic.

## Use it

- Search **College PFF profile** to load a prospect with PFF composite, grade, production, efficiency, and clean-play signals.
- Search **Historical draft/combine player** to load an older player from the nflverse baseline.
- Click **New** to enter a player who is not in the loaded datasets yet.
- Click **Save** to store a prospect in **My prospects**. Saved prospects live in your browser's local storage.
- Use **Export** and **Import** to move your saved prospect list between browsers or devices.

## Run locally

```bash
npm install
npm run data:pff
npm run dev
```

## Deploy

Vercel can use the default settings:

```bash
npm run build
```

The `prebuild` script restores compressed source assets, downloads the free nflverse CSV files into `public/data`, and emits the compact PFF comparison payload used by the browser. `npm run data:pff` regenerates that PFF payload from the local CSV exports listed below.

## Data sources

- https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv
- https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv
- Local PFF NCAA all-position export: `pff_ncaa_all_positions_2015_2025.csv`
- Local NFL seasonal outcome export: `nfl_player_season_outcomes_2016_2025.csv`
