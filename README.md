# DraftLens

A free, deployable NFL prospect projection tool. It uses nflverse combine data and draft outcome data, then blends draft capital, athletic testing, size, age, manual scouting grades, historical comps, and uncertainty bands.

No model can project exact NFL success. DraftLens is built to be honest about that: it reports probabilities, ranges, comps, and confidence instead of pretending the future is deterministic.

## Use it

- Search for an existing player in **Existing prospect**, then load them into the board.
- Click **New prospect** to enter a player who is not in the nflverse data yet.
- Click **Save current** to store a prospect in **My prospects**. Saved prospects live in your browser's local storage.
- Use **Export** and **Import** to move your saved prospect list between browsers or devices.

## Run locally

```bash
npm install
npm run data:refresh
npm run dev
```

## Deploy

Vercel can use the default settings:

```bash
npm run build
```

The `prebuild` script downloads the free nflverse CSV files into `public/data`, so the deployed app has the same calibration data without committing generated CSVs to GitHub.

## Data sources

- https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv
- https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv
