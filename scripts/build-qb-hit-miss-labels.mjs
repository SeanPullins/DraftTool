import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        values.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }

    values.push(cur);

    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? '');
    return obj;
  });
}

function outcomeScore(row) {
  const wAv = num(row.w_av, num(row.car_av, 0));
  const starts = num(row.seasons_started, 0);
  const pb = num(row.probowls, 0);
  const ap = num(row.allpro, 0);
  return wAv + Math.min(starts, 8) * 1.2 + pb * 8 + ap * 12;
}

function expectedOutcomeByPick(pick) {
  const p = Number(pick) || 260;
  return Math.max(3, 65 * Math.exp(-0.018 * (p - 1)));
}

function hitMissLabel(actual, expected, pick) {
  const delta = actual - expected;

  if (actual >= 45 || delta >= 15) return 'Hit';
  if (pick <= 100 && (actual <= 5 || delta <= -15)) return 'Miss';
  if (pick > 100 && actual >= 10) return 'Hit';
  if (pick > 100 && actual <= 3) return 'Miss';
  return 'Neutral';
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));

const labels = [];

for (const row of draftRows) {
  const pos = String(row.position || row.pos || '').toUpperCase();
  if (pos !== 'QB') continue;

  const year = num(row.season || row.year);
  const name = row.pfr_player_name || row.player_name || row.name || '';
  const pick = num(row.pick, 260);
  if (!year || !name) continue;

  const actual = outcomeScore(row);
  const expected = expectedOutcomeByPick(pick);
  const delta = actual - expected;

  labels.push({
    key: `${year}|QB|${clean(name)}`,
    year,
    pos: 'QB',
    name,
    pick,
    actual: Number(actual.toFixed(1)),
    expected: Number(expected.toFixed(1)),
    delta: Number(delta.toFixed(1)),
    label: hitMissLabel(actual, expected, pick),
    labelType: 'historic',
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Historic QB hit/miss labels based on outcome score versus draft-slot expectation.',
  counts: labels.reduce((acc, x) => {
    acc[x.label] = (acc[x.label] || 0) + 1;
    return acc;
  }, {}),
  labels,
};

fs.writeFileSync('public/data/model/qb_historic_hit_miss_labels.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  counts: report.counts,
  sample: labels.slice(0, 30),
}, null, 2));

console.log('Wrote public/data/model/qb_historic_hit_miss_labels.json');
