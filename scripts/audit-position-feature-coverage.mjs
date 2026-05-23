import fs from 'fs';

function loadJsonRows(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  return payload.records || payload || [];
}

function cleanKey(k = '') {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const files = {
  QB: 'public/data/qb_pff_seasons.json',
  WR: 'public/data/wr_pff_seasons.json',
  RB: 'public/data/rb_pff_seasons.json',
  TE: 'public/data/te_pff_seasons.json',
};

const wanted = {
  QB: [
    'pass_grade','grades_pass','offense_grade','grades_offense','btt_rate','btt_pct',
    'twp_rate','twp_pct','adjusted_completion_percent','accuracy_percent',
    'adot','avg_depth_of_target','time_to_throw','avg_time_to_throw',
    'pressure_to_sack_rate','pressure_to_sack_pct','epa','attempts','dropbacks'
  ],
  WR: [
    'route_grade','grades_pass_route','yprr','yards_per_route_run','targets',
    'yards','receiving_yards','adot','avg_depth_of_target','drop_rate',
    'target_share','yard_share','breakout_age','age','slot_rate','outside_rate',
    'height','weight','ras'
  ],
  RB: [
    'run_grade','grades_run','receiving_grade','route_grade','grades_pass_route',
    'pass_block_grade','grades_pass_block','yco','yco_attempt',
    'yards_after_contact_per_attempt','elusive','elusive_rating',
    'breakaway_percent','avoided_tackles','targets','rec_yards',
    'yards','rushing_yards','attempts','carries','fumbles','ras'
  ],
  TE: [
    'route_grade','grades_pass_route','receiving_grade','yprr','yards_per_route_run',
    'targets','yards','run_block_grade','grades_run_block','pass_block_grade',
    'grades_pass_block','inline_rate','slot_rate','wide_rate','route_participation',
    'height','weight','ras'
  ],
};

const report = {
  generatedAt: new Date().toISOString(),
  byPosition: {},
};

for (const [pos, path] of Object.entries(files)) {
  const rows = loadJsonRows(path);
  const allKeys = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row || {})) allKeys.add(cleanKey(key));
  }

  const coverage = wanted[pos].map(field => {
    const normalized = cleanKey(field);
    const count = rows.filter(row =>
      Object.keys(row || {}).some(k => cleanKey(k) === normalized && row[k] !== '' && row[k] != null)
    ).length;

    return {
      field,
      present: allKeys.has(normalized),
      count,
      rate: rows.length ? Number((count / rows.length).toFixed(3)) : 0,
    };
  });

  report.byPosition[pos] = {
    file: path,
    rows: rows.length,
    availableKeys: Array.from(allKeys).sort(),
    wantedCoverage: coverage,
    missingOrSparse: coverage.filter(c => !c.present || c.rate < 0.25),
  };
}

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/position_feature_coverage_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  summary: Object.fromEntries(Object.entries(report.byPosition).map(([pos, block]) => [
    pos,
    {
      rows: block.rows,
      missingOrSparse: block.missingOrSparse.map(x => `${x.field} (${Math.round(x.rate * 100)}%)`)
    }
  ]))
}, null, 2));

console.log('Wrote public/data/model/position_feature_coverage_report.json');
