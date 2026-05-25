"""
QB Scoring Model v11
====================
Trains a Ridge regression on 2016-2022 historical QBs (PFF college data + NFL career AV)
to produce data-driven QB scores for 2024+ prospects.

Key design decisions:
  - Pre-transform features so all dimensions have positive=better direction
    (inverts TWP rate, P2S rate before fitting → no sign ambiguity from multicollinearity)
  - Use residual regression: first partial out log(pick) effect, then fit PFF features
    on residual AV → PFF component captures over/under-performance vs draft slot
  - Winsorize target at 95th percentile (removes Mahomes/Jackson distortion)
  - Winsorize features at 5/95 percentile (input outlier protection)
  - Score = 0.72 * draft_pct + 0.23 * pff_pct + 0.05 * athletic_pct
    (slightly more PFF weight than old 75/20/5 since PFF component is now better calibrated)
  - Single comp: cosine similarity in standardized PFF-only feature space
"""

import json, math, re, sys, warnings
from pathlib import Path
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold, cross_val_score
from sklearn.preprocessing import StandardScaler

REPO = Path(__file__).parent.parent

# ── helpers ────────────────────────────────────────────────────────────────────

def cleanname(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', str(s or '').lower())

def num(v, default=None):
    try:
        n = float(v)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default

def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, float(v) if math.isfinite(float(v)) else lo))

def winsorize(arr: np.ndarray, lo_pct=5.0, hi_pct=95.0):
    lo, hi = np.percentile(arr, lo_pct), np.percentile(arr, hi_pct)
    return np.clip(arr, lo, hi), float(lo), float(hi)

# ── data loading ───────────────────────────────────────────────────────────────

def load_hit_miss_labels():
    d = json.loads((REPO / 'public/data/model/qb_historic_hit_miss_labels.json').read_text())
    return d['labels']

def load_pff_map():
    raw = json.loads((REPO / 'public/data/qb_pff_seasons.json').read_text())
    rows = raw if isinstance(raw, list) else raw.get('records', [])
    m = {}
    for r in rows:
        name = r.get('name') or r.get('player') or ''
        season = num(r.get('season') or r.get('year'), 0)
        if name and season:
            m[(cleanname(name), int(season))] = r
    return m

MIN_DROPBACKS_COMP = 200   # min dropbacks for a QB to be in the comp pool
COMP_SCORE_BRACKET = 15    # primary bracket: comps must be within ±N v11 points
COMP_MIN_POOL      = 4     # expand if fewer than this many candidates in bracket
LABEL_WEIGHT       = {'Hit': 0.85, 'Neutral': 1.0, 'Miss': 1.15}  # distance multiplier by outcome

def find_best_pff(pff_map, name, draft_year):
    """Best qualifying pre-draft PFF season.
    Priority: (1) most recent season with >=150 dropbacks,
               (2) fallback to any season with the highest sample.
    This ensures a QB's senior breakout year wins over a more productive sophomore year."""
    candidates = []
    for lb in [1, 2, 3]:
        row = pff_map.get((cleanname(name), draft_year - lb))
        if row is None:
            continue
        db = max(num(row.get('dropbacks'), 0), num(row.get('attempts'), 0))
        candidates.append((lb, db, row))

    if not candidates:
        return None

    # Prefer most recent season (lowest lb) with enough sample
    qualifying = [(lb, db, r) for lb, db, r in candidates if db >= 150]
    if qualifying:
        return min(qualifying, key=lambda x: x[0])[2]   # lowest lb = most recent

    # Fallback: most dropbacks
    return max(candidates, key=lambda x: x[1])[2]

# ── feature engineering ───────────────────────────────────────────────────────
#
# All features are direction-aligned so that HIGHER = BETTER.
# This prevents Ridge from finding spurious negative coefficients under collinearity.

SENTINEL = {
    'pass_grade': 50.0,
    'btt_rate':    4.0,
    'safety':      1.5,    # 5 - twp_rate  (higher=safer)
    'acc_pct':    68.0,
    'epa':         0.0,
    'pocket':      3.0,    # 25 - p2s_rate/5  (higher=better pocket)
    'adot':        9.0,
}

def extract_features(row) -> dict | None:
    if row is None:
        return None
    pg   = num(row.get('grades_pass') or row.get('pass_grade'))
    og   = num(row.get('grades_offense') or row.get('offense_grade'))
    btt  = num(row.get('btt_rate') or row.get('btt_pct'))
    twp  = num(row.get('twp_rate') or row.get('twp_pct'))
    acc  = num(row.get('adjusted_completion_percent') or row.get('accuracy_percent'))
    epa  = num(row.get('epa'))
    p2s  = num(row.get('pressure_to_sack_rate') or row.get('pressure_to_sack_pct'))
    adot = num(row.get('avg_depth_of_target') or row.get('adot'))
    db   = max(num(row.get('dropbacks'), 0), num(row.get('attempts'), 0))

    pgrade = pg if pg is not None else (og or 50.0)
    if pgrade == 0 and og == 0:
        return None

    return {
        'pass_grade': pgrade,
        'btt_rate':   btt  if btt  is not None else SENTINEL['btt_rate'],
        'safety':     (5.0 - twp) if twp is not None else SENTINEL['safety'],   # inverted TWP
        'acc_pct':    acc  if acc  is not None else SENTINEL['acc_pct'],
        'epa':        epa  if epa  is not None else SENTINEL['epa'],
        'pocket':     max(0.0, (25.0 - (p2s or 12.0)) / 5.0),                  # inverted P2S
        'adot':       adot if adot is not None else SENTINEL['adot'],
        'log_db':     math.log(max(1.0, db)),
    }

FEAT_NAMES = ['pass_grade', 'btt_rate', 'safety', 'acc_pct', 'epa', 'pocket', 'adot', 'log_db']
COMP_FEAT  = ['pass_grade', 'btt_rate', 'safety', 'acc_pct', 'epa', 'pocket', 'adot']

def feat_vec(feats: dict, names: list[str]) -> np.ndarray:
    return np.array([feats[k] for k in names], dtype=float)

# ── draft score ────────────────────────────────────────────────────────────────

def draft_score(pick: float) -> float:
    p = max(1.0, float(pick or 260))
    # Log-compressed 0-100 scale: pick 1 → 100, pick 260 → 0
    raw = 100.0 - (math.log(p) / math.log(260)) * 100.0
    return clamp(raw)

# ── training set ──────────────────────────────────────────────────────────────

TRAIN_YEARS = (2016, 2022)

def career_normalized_av(actual_av: float, draft_year: int, ref_year: int = 2025) -> float:
    """Scale AV to a 6-season reference window."""
    seasons = max(1, ref_year - draft_year)
    # Scale up shorter careers (recent QBs), but cap the multiplier at 2×
    return actual_av * min(6.0 / seasons, 2.0)

def build_training(labels, pff_map):
    rows = []
    for qb in labels:
        yr = qb['year']
        if not (TRAIN_YEARS[0] <= yr <= TRAIN_YEARS[1]):
            continue
        pff_row = find_best_pff(pff_map, qb['name'], yr)
        feats = extract_features(pff_row)
        if feats is None:
            continue
        rows.append({
            'name': qb['name'], 'year': yr, 'pick': qb['pick'],
            'actual_av': qb['actual'],
            'norm_av': career_normalized_av(qb['actual'], yr),
            'label': qb['label'],
            'feats': feats,
        })
    return rows

# ── model fitting ─────────────────────────────────────────────────────────────

def fit_model(training):
    """Two-stage residual regression.
    Stage 1: predict norm_av from log(pick) alone.
    Stage 2: predict residual from PFF features.
    This cleanly separates draft-capital signal from PFF signal.
    """
    picks  = np.array([math.log(max(1, r['pick'])) for r in training]).reshape(-1, 1)
    y_raw  = np.array([r['norm_av'] for r in training])
    X_pff  = np.array([feat_vec(r['feats'], FEAT_NAMES) for r in training])

    # Winsorize target
    y, y_lo, y_hi = winsorize(y_raw, 5.0, 95.0)
    print(f'  Target AV: raw [{y_raw.min():.1f}–{y_raw.max():.1f}]  '
          f'clipped [{y_lo:.1f}–{y_hi:.1f}]')

    # Winsorize PFF features
    feat_bounds = {}
    X_pff_clipped = X_pff.copy()
    for i, fn in enumerate(FEAT_NAMES):
        col, lo, hi = winsorize(X_pff[:, i])
        X_pff_clipped[:, i] = col
        feat_bounds[fn] = (float(lo), float(hi))

    # Stage 1: OLS pick model (single feature → no regularization needed)
    pick_scaler  = StandardScaler()
    picks_scaled = pick_scaler.fit_transform(picks)
    pick_model   = Ridge(alpha=0.01)
    pick_model.fit(picks_scaled, y)
    pick_preds   = pick_model.predict(picks_scaled)
    residuals    = y - pick_preds
    print(f'  Stage 1 (pick only) training R²: '
          f'{1 - np.var(residuals)/np.var(y):.4f}')

    # Stage 2: Ridge on PFF features → residual AV
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    best_alpha, best_cv = 10.0, -np.inf
    pff_scaler = StandardScaler()
    X_pff_sc   = pff_scaler.fit_transform(X_pff_clipped)
    for alpha in [0.5, 1, 2, 5, 10, 20, 50, 100, 200]:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            cv = cross_val_score(Ridge(alpha=alpha), X_pff_sc, residuals,
                                 cv=kf, scoring='neg_mean_squared_error').mean()
        if cv > best_cv:
            best_cv, best_alpha = cv, alpha
    pff_model = Ridge(alpha=best_alpha)
    pff_model.fit(X_pff_sc, residuals)
    print(f'  Stage 2 (PFF residual) alpha={best_alpha}  5-fold neg-MSE={best_cv:.2f}')
    print('  PFF feature coefficients (standardized):')
    for fn, c in zip(FEAT_NAMES, pff_model.coef_):
        print(f'    {fn:12s}: {c:+.3f}')

    # Calibration: build percentile mapping over training predictions
    full_preds = pick_preds + pff_model.predict(X_pff_sc)
    preds_sorted = np.sort(full_preds)

    def to_score(predicted_av: float) -> float:
        # Percentile within training distribution, mapped to 0–100
        pct = np.searchsorted(preds_sorted, predicted_av, side='right') / len(preds_sorted)
        return clamp(pct * 100.0)

    # Spearman on training
    from scipy.stats import spearmanr
    scores = [to_score(p) for p in full_preds]
    rho, pval = spearmanr(scores, y_raw)
    print(f'  Training Spearman ρ (v11 pct-score vs raw AV): {rho:.4f}  p={pval:.3f}')

    return {
        'pick_model': pick_model, 'pick_scaler': pick_scaler,
        'pff_model': pff_model,   'pff_scaler': pff_scaler,
        'feat_bounds': feat_bounds,
        'preds_sorted': preds_sorted,
    }, to_score

def predict_av(pick, feats, mdl):
    """Predict norm_av for a QB using the two-stage model."""
    log_p = math.log(max(1.0, float(pick or 260)))
    ps    = mdl['pick_scaler'].transform([[log_p]])
    pick_part = float(mdl['pick_model'].predict(ps)[0])

    if feats is None:
        return pick_part

    # Clip PFF features to training bounds
    fv = feat_vec(feats, FEAT_NAMES).copy()
    for i, fn in enumerate(FEAT_NAMES):
        lo, hi = mdl['feat_bounds'][fn]
        fv[i]  = max(lo, min(hi, fv[i]))

    pff_sc   = mdl['pff_scaler'].transform([fv])
    pff_part = float(mdl['pff_model'].predict(pff_sc)[0])
    return pick_part + pff_part

# ── comp matching ─────────────────────────────────────────────────────────────

def fit_comp_scaler(training, to_score, mdl):
    """Fit scaler only on high-sample QBs; tag each with its predicted v11 score."""
    qual = [r for r in training if r['feats'].get('log_db', 0) >= math.log(MIN_DROPBACKS_COMP)]
    pool = qual if len(qual) >= 10 else training
    for r in pool:
        r['v11_score'] = to_score(predict_av(r['pick'], r['feats'], mdl))
    vecs = np.array([feat_vec(r['feats'], COMP_FEAT) for r in pool])
    sc   = StandardScaler()
    sc.fit(vecs)
    return sc, pool

def best_comp(target_feats, target_score, comp_pool, comp_scaler, exclude_name=None):
    """Nearest-neighbor in standardized PFF feature space, restricted to comps
    within COMP_SCORE_BRACKET points of target_score so high-scorers only match
    elite-tier historical QBs, not high-volume mid-rounders with similar raw stats."""
    if target_feats is None:
        return None
    tv = comp_scaler.transform([feat_vec(target_feats, COMP_FEAT)])[0]

    def _candidates(bracket):
        return [r for r in comp_pool
                if abs(r.get('v11_score', 50.0) - target_score) <= bracket
                and not (exclude_name and cleanname(r['name']) == cleanname(exclude_name))]

    pool = _candidates(COMP_SCORE_BRACKET)          # ±15 primary
    if len(pool) < COMP_MIN_POOL:
        pool = _candidates(COMP_SCORE_BRACKET + 7)  # ±22 fallback
    if len(pool) < COMP_MIN_POOL:
        pool = _candidates(COMP_SCORE_BRACKET + 18) # ±33 wide fallback
    if not pool:
        pool = [r for r in comp_pool
                if not (exclude_name and cleanname(r['name']) == cleanname(exclude_name))]

    best, best_weighted, best_raw_dist = None, np.inf, np.inf
    for r in pool:
        rv       = comp_scaler.transform([feat_vec(r['feats'], COMP_FEAT)])[0]
        raw_dist = float(np.linalg.norm(tv - rv))
        weighted = raw_dist * LABEL_WEIGHT.get(r.get('label', 'Neutral'), 1.0)
        if weighted < best_weighted:
            best_weighted, best_raw_dist, best = weighted, raw_dist, r

    if best is None:
        return None
    sim = max(0.0, 1.0 - best_raw_dist / (best_raw_dist + 1.0))
    return {**best, 'similarity': round(sim, 3), 'distance': round(best_raw_dist, 3)}

# ── prospect scoring ───────────────────────────────────────────────────────────

PROSPECT_FILES = [
    'public/data/prospects_2024_qb.json',
    'public/data/prospects_2025_qb.json',
    'public/data/prospects_2026_qb.json',
]

def ras_athletic_score(rec) -> float:
    pff = rec.get('pff') or {}
    for k in ('ras', 'alltime_ras'):
        v = num(pff.get(k))
        if v is not None and v > 0:
            return clamp(v * 10.0)
    return 50.0

def build_final_score(pct_score: float, pick: float, athletic: float = 50.0) -> float:
    """Blend percentile-model score (captures both pick + PFF) with athletic."""
    # pct_score already bakes in draft capital via the two-stage model.
    # Athletic is a light 5% trim on top.
    return clamp(pct_score * 0.95 + athletic * 0.05)

def update_prospects(training, mdl, to_score, comp_scaler, comp_pool, pff_map):
    for fp in PROSPECT_FILES:
        path = REPO / fp
        if not path.exists():
            continue
        raw   = json.loads(path.read_text())
        recs  = raw if isinstance(raw, list) else raw.get('records', raw)
        yr_re = re.search(r'(\d{4})', fp)
        file_year = int(yr_re.group(1)) if yr_re else 0

        updated = []
        for rec in recs:
            name = rec.get('name') or ''
            year = int(rec.get('year') or rec.get('draftYear') or file_year)
            pick = num(rec.get('pick'), 260)

            # Try matched PFF first, then embedded pff block
            pff_row = find_best_pff(pff_map, name, year)
            feats   = extract_features(pff_row)
            if feats is None:
                feats = extract_features(rec.get('pff'))

            av_pred   = predict_av(pick, feats, mdl)
            pct       = to_score(av_pred)
            athletic  = ras_athletic_score(rec)
            final     = build_final_score(pct, pick, athletic)
            final_r   = round(final, 1)

            comp = best_comp(feats, pct, comp_pool, comp_scaler)
            comp_obj  = None
            if comp:
                comp_obj = {
                    'name': comp['name'],
                    'year': comp['year'],
                    'pick': comp['pick'],
                    'actualAv': comp['actual_av'],
                    'outcome': comp['label'],
                    'similarity': comp['similarity'],
                    'distance': comp['distance'],
                    'reason': (
                        'Closest college-profile match in v11 standardized feature space '
                        '(pass grade, BTT, ball-security, accuracy, EPA, pocket presence).'
                    ),
                }

            updated.append({
                **rec,
                'qbV11Score': final_r,
                'qbV11PctScore': round(pct, 1),
                'qbV11DraftScore': round(draft_score(pick), 1),
                'score': final_r, 'grade': final_r,
                'modelScore': final_r, 'qbProjectionScore': final_r,
                'primaryQbProfileComp': comp_obj,
                'projectionComps': [comp_obj] if comp_obj else [],
                'styleComps':      [comp_obj] if comp_obj else [],
                'qbComps':         [comp_obj] if comp_obj else [],
                'comps':           [comp_obj] if comp_obj else [],
            })

        out = updated if isinstance(raw, list) else {**raw, 'records': updated}
        path.write_text(json.dumps(out, indent=2))
        print(f'  {path.name}: {len(updated)} QBs updated')

    return None

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print('=== QB Scoring Model v11 ===\n')

    labels   = load_hit_miss_labels()
    pff_map  = load_pff_map()
    training = build_training(labels, pff_map)
    print(f'Training set: {len(training)} QBs  ({TRAIN_YEARS[0]}–{TRAIN_YEARS[1]})\n')

    if len(training) < 20:
        sys.exit('ERROR: Insufficient training data.')

    print('Fitting model...')
    mdl, to_score = fit_model(training)
    comp_scaler, comp_pool = fit_comp_scaler(training, to_score, mdl)
    print(f'  Comp pool (>={MIN_DROPBACKS_COMP} dropbacks): {len(comp_pool)} QBs')

    # Training validation
    print('\nTop/bottom 8 training QBs by predicted score:')
    scored = [(to_score(predict_av(r['pick'], r['feats'], mdl)), r) for r in training]
    scored.sort(key=lambda x: -x[0])
    for s, r in scored[:8]:
        c = best_comp(r['feats'], s, comp_pool, comp_scaler, exclude_name=r['name'])
        print(f"  {r['year']} #{r['pick']:3d} {r['name']:22s}  v11={s:.1f}  AV={r['actual_av']:.0f}  {r['label']:8s}  comp: {c['name'] if c else '—'}")
    print('  ...')
    for s, r in scored[-5:]:
        print(f"  {r['year']} #{r['pick']:3d} {r['name']:22s}  v11={s:.1f}  AV={r['actual_av']:.0f}  {r['label']:8s}")

    # Prospect file scoring
    print('\nScoring 2024+ prospect files...')
    update_prospects(training, mdl, to_score, comp_scaler, comp_pool, pff_map)

    # Print key 2024/2025 prospects
    for fp in PROSPECT_FILES[:2]:
        path = REPO / fp
        if not path.exists():
            continue
        raw  = json.loads(path.read_text())
        recs = raw if isinstance(raw, list) else raw.get('records', raw)
        print(f'\n  {path.name}:')
        for r in recs[:10]:
            comp_name = (r.get('primaryQbProfileComp') or {}).get('name', '—')
            comp_out  = (r.get('primaryQbProfileComp') or {}).get('outcome', '')
            print(f"    #{r.get('pick',0):3d} {r['name']:22s} v11={r.get('qbV11Score'):.1f}  "
                  f"comp: {comp_name} ({comp_out})")

    # Save model meta
    model_meta = {
        'generatedAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'model': 'qb_v11',
        'trainYears': list(TRAIN_YEARS),
        'nTrain': len(training),
        'featNames': FEAT_NAMES,
        'compFeats': COMP_FEAT,
        'featBounds': mdl['feat_bounds'],
        'historic': [
            {'name': r['name'], 'year': r['year'], 'pick': r['pick'],
             'actual_av': r['actual_av'], 'label': r['label'],
             'v11Score': round(to_score(predict_av(r['pick'], r['feats'], mdl)), 1),
             'features': r['feats']}
            for r in training
        ],
    }
    out = REPO / 'public/data/model/qb_model_v11.json'
    out.write_text(json.dumps(model_meta, indent=2))
    print(f'\nWrote {out.name}  ({out.stat().st_size // 1024} KB)')
    print('Done.')

if __name__ == '__main__':
    main()
