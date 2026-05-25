import fs from 'fs';

function loadJsonRows(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  return payload.records || payload || [];
}

function cleanKey(k = '') {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasAny(row, aliases) {
  for (const alias of aliases) {
    const target = cleanKey(alias);
    for (const [key, value] of Object.entries(row || {})) {
      if (cleanKey(key) === target && value !== '' && value != null) return true;
    }
  }
  return false;
}

const files = {
  QB: 'public/data/qb_pff_seasons.json',
  WR: 'public/data/wr_pff_seasons.json',
  RB: 'public/data/rb_pff_seasons.json',
  TE: 'public/data/te_pff_seasons.json',
};

const wanted = {
  QB: {
    pass_grade: ['pass_grade','grades_pass','passGrade'],
    offense_grade: ['offense_grade','grades_offense','offenseGrade'],
    btt_rate: ['btt_rate','btt_pct','btt','big_time_throw_rate'],
    twp_rate: ['twp_rate','twp_pct','twp','turnover_worthy_play_rate'],
    adjusted_accuracy: ['adjusted_completion_percent','accuracy_percent','adjustedAccuracy','adj_comp_pct'],
    adot: ['adot','avg_depth_of_target','average_depth_of_target'],
    time_to_throw: ['time_to_throw','avg_time_to_throw','ttt'],
    pressure_to_sack: ['pressure_to_sack_rate','pressure_to_sack_pct','p2s'],
    epa: ['epa','epa_per_play'],
    attempts: ['attempts','dropbacks'],
  },

  WR: {
    route_grade: ['route_grade','grades_pass_route','routeGrade','receiving'],
    yprr: ['yprr','yards_per_route_run','yardsPerRouteRun'],
    targets: ['targets'],
    yards: ['yards','receiving_yards','recYards'],
    adot: ['adot','avg_depth_of_target','average_depth_of_target'],
    drop_rate: ['drop_rate','dropRate'],
    target_share: ['target_share','targetShare'],
    yard_share: ['yard_share','yardShare','receivingYardShare'],
    breakout_age: ['breakout_age','breakoutAge'],
    age: ['age'],
    slot_rate: ['slot_rate','slotRate'],
    outside_rate: ['outside_rate','outsideRate'],
    height: ['height'],
    weight: ['weight'],
    ras: ['ras','officialRAS','officialRas','alltime_ras'],
  },

  RB: {
    run_grade: ['run_grade','grades_run','runGrade','rushing'],
    receiving_grade: ['receiving_grade','route_grade','grades_pass_route','receiving'],
    pass_pro: ['pass_block_grade','grades_pass_block','passPro','pass_pro'],
    yco: ['yco','yco_attempt','yards_after_contact_per_attempt','yardsAfterContactPerAttempt'],
    elusive: ['elusive','elusive_rating','elusiveRating'],
    breakaway_percent: ['breakaway_percent','breakawayPercent'],
    avoided_tackles: ['avoided_tackles','missed_tackles_forced','mtf'],
    targets: ['targets'],
    yards: ['yards','rushing_yards','rushYards'],
    attempts: ['attempts','carries','usage'],
    fumbles: ['fumbles'],
    ras: ['ras','officialRAS','officialRas','alltime_ras'],
  },

  TE: {
    route_grade: ['route_grade','grades_pass_route','routeGrade','receiving'],
    receiving_grade: ['receiving_grade','receiving','route_grade','grades_pass_route'],
    yprr: ['yprr','yards_per_route_run','yardsPerRouteRun'],
    targets: ['targets'],
    yards: ['yards','receiving_yards','recYards'],
    run_block: ['run_block_grade','grades_run_block','runBlock','runGrade'],
    pass_block: ['pass_block_grade','grades_pass_block','passBlock','passPro'],
    inline_rate: ['inline_rate','inlineRate'],
    slot_rate: ['slot_rate','slotRate'],
    wide_rate: ['wide_rate','wideRate'],
    route_participation: ['route_participation','routeParticipation'],
    height: ['height'],
    weight: ['weight'],
    ras: ['ras','officialRAS','officialRas','alltime_ras'],
  },
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

  const coverage = Object.entries(wanted[pos]).map(([feature, aliases]) => {
    const count = rows.filter(row => hasAny(row, aliases)).length;

    return {
      feature,
      aliases,
      count,
      rate: rows.length ? Number((count / rows.length).toFixed(3)) : 0,
      present: count > 0,
    };
  });

  report.byPosition[pos] = {
    file: path,
    rows: rows.length,
    availableKeys: Array.from(allKeys).sort(),
    wantedCoverage: coverage,
    missingOrSparse: coverage.filter(c => !c.present || c.rate < 0.25),
    strongCoverage: coverage.filter(c => c.rate >= 0.75),
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
      strongCoverage: block.strongCoverage.map(x => `${x.feature} (${Math.round(x.rate * 100)}%)`),
      missingOrSparse: block.missingOrSparse.map(x => `${x.feature} (${Math.round(x.rate * 100)}%)`)
    }
  ]))
}, null, 2));

console.log('Wrote public/data/model/position_feature_coverage_report.json');
