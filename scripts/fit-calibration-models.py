#!/usr/bin/env python3
"""
Fits walk-forward OLS calibration models for each draft year and position group.
Outputs public/data/calibration_models.json with per-year and 'latest' coefficients.
"""
import csv, json, math, re, unicodedata, gzip, base64
from pathlib import Path

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

DATA = Path(__file__).parent.parent / 'public' / 'data'

GROUPS = {
    'QB': 'QB', 'RB': 'SKILL', 'WR': 'SKILL', 'TE': 'SKILL', 'FB': 'SKILL',
    'OL': 'OL', 'C': 'OL', 'G': 'OL', 'T': 'OL',
    'DL': 'FRONT', 'DE': 'FRONT', 'DT': 'FRONT', 'NT': 'FRONT',
    'LB': 'FRONT', 'ILB': 'FRONT', 'OLB': 'FRONT', 'MLB': 'FRONT',
    'CB': 'DB', 'S': 'DB', 'FS': 'DB', 'SS': 'DB', 'DB': 'DB',
}
MATURE_SEASONS = {'SKILL': 4, 'DB': 4, 'QB': 5, 'OL': 6, 'FRONT': 6}

def clean(s):
    s = unicodedata.normalize('NFKD', (s or '').lower())
    s = ''.join(c for c in s if c.isascii())
    return re.sub(r'[^a-z0-9]', '', s)

def parse_ht(h):
    try:
        parts = str(h).split('-')
        return int(parts[0]) * 12 + int(parts[1])
    except:
        return None

def fv(v, default=None):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except:
        return default

def age_signal(age, pos):
    """Mirror ageSignal() from model.ts — returns 30–94 score."""
    if age is None:
        age = 22.0
    grp_ol = pos in ('OL', 'C', 'G', 'T')
    grp_front = pos in ('DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB')
    if pos == 'QB':
        if age <= 20.8: return 92
        if age <= 21.6: return 82
        if age <= 22.8: return 70
        if age <= 24.0: return 56
        if age <= 25.5: return 44
        return 32
    if pos == 'RB':
        if age <= 20.3: return 94
        if age <= 21.0: return 84
        if age <= 21.8: return 72
        if age <= 22.6: return 60
        if age <= 23.5: return 48
        return 34
    if grp_ol:
        if age <= 21.5: return 84
        if age <= 22.5: return 74
        if age <= 24.0: return 64
        if age <= 25.5: return 54
        if age <= 27.0: return 44
        return 36
    if grp_front:
        if age <= 21.0: return 90
        if age <= 22.0: return 80
        if age <= 23.0: return 68
        if age <= 24.0: return 58
        if age <= 25.0: return 48
        return 36
    # Default (WR, TE, CB, S)
    if age <= 20.8: return 90
    if age <= 21.6: return 80
    if age <= 22.5: return 68
    if age <= 23.5: return 58
    if age <= 24.5: return 50
    return 38

# ── Load PFF profiles ────────────────────────────────────────
b64 = (DATA / 'pff_comparison_profiles.json.gz.b64').read_text().strip()
buf = gzip.decompress(base64.b64decode(b64))
pff_data = json.loads(buf)['profiles']
pff_by_key = {}
for p in pff_data:
    if isinstance(p, list):
        # Format: [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl?]
        name_p, college, raw_pos, draft_season, composite, grade, production, efficiency, clean_play = p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]
        k = clean(name_p)
        yr = int(draft_season)
        pff_by_key[(k, yr)] = {
            'pff': {
                'composite': composite,
                'grade': grade,
                'production': production,
                'efficiency': efficiency,
                'clean': clean_play,
            }
        }
    elif isinstance(p, dict):
        k = clean(p.get('name', ''))
        yr = p.get('draftSeason', 0)
        pff_by_key[(k, yr)] = p

print(f"PFF profiles loaded: {len(pff_data)}")

# ── Load combine ──────────────────────────────────────────────
combine_rows = list(csv.DictReader(open(DATA / 'combine.csv')))
combine_by_key = {}
for r in combine_rows:
    k = clean(r.get('player_name', ''))
    yr = int(r.get('draft_year') or r.get('season') or 0)
    combine_by_key[(k, yr)] = r

print(f"Combine rows loaded: {len(combine_rows)}")

# ── Load draft picks ──────────────────────────────────────────
picks = list(csv.DictReader(open(DATA / 'draft_picks.csv')))
print(f"Draft picks loaded: {len(picks)}")

# ── Build feature matrix ──────────────────────────────────────
records = []
for p in picks:
    yr = int(p.get('season') or 0)
    pos = p.get('position', '')
    grp = GROUPS.get(pos, '')
    if not grp or yr < 2000 or yr > 2023:
        continue

    pick_n = fv(p.get('pick'))
    age = fv(p.get('age'))
    w_av = fv(p.get('w_av'), 0)
    if pick_n is None or pick_n < 1 or pick_n > 260:
        continue

    name = clean(p.get('pfr_player_name', ''))
    cb = combine_by_key.get((name, yr), {})
    pff = pff_by_key.get((name, yr), {})
    pff_stats = pff.get('pff', {}) if pff else {}

    draft_score = 100 * ((1 - (pick_n - 1) / 259) ** 0.58)
    log_pick = math.log(max(1, min(260, pick_n)))
    age_score = age_signal(age, pos)

    # Athletic / size from combine
    ht = parse_ht(cb.get('ht', '')) if cb else None
    wt = fv(cb.get('wt')) if cb else None
    forty = fv(cb.get('forty')) if cb else None
    vertical = fv(cb.get('vertical')) if cb else None
    broad = fv(cb.get('broad_jump')) if cb else None
    cone = fv(cb.get('cone')) if cb else None
    shuttle = fv(cb.get('shuttle')) if cb else None

    # PFF signals (50 = average when missing)
    pff_comp = pff_stats.get('composite', 50) or 50
    pff_grade = pff_stats.get('grade', 50) or 50
    pff_prod = pff_stats.get('production', 50) or 50
    pff_eff = pff_stats.get('efficiency', 50) or 50
    pff_clean = pff_stats.get('clean', 50) or 50

    records.append({
        'year': yr, 'pos': pos, 'grp': grp,
        'av': w_av, 'pick': pick_n, 'age': age_score,
        'name': name,
        'draftScore': draft_score,
        'logPick': log_pick,
        'ageScore': age_score,
        'pffComp': pff_comp,
        'pffGrade': pff_grade,
        'pffProd': pff_prod,
        'pffEff': pff_eff,
        'pffClean': pff_clean,
        'isQB': 1 if grp == 'QB' else 0,
        'isSkill': 1 if grp == 'SKILL' else 0,
        'isOL': 1 if grp == 'OL' else 0,
        'isFront': 1 if grp == 'FRONT' else 0,
        'isDB': 1 if grp == 'DB' else 0,
        # size/athletic raw for info (not used in OLS directly — we use standardized signal)
        'ht': ht, 'wt': wt, 'forty': forty, 'vertical': vertical,
        'broad': broad, 'cone': cone, 'shuttle': shuttle,
    })

print(f"Records built: {len(records)}")

# ── Global features ───────────────────────────────────────────
GLOBAL_FEATURES = ['draftScore', 'logPick', 'pffComp', 'pffGrade', 'pffProd',
                   'pffEff', 'pffClean', 'ageScore', 'isQB', 'isSkill', 'isOL', 'isFront', 'isDB']

# Position-specific features (drop position dummies, same signals)
POS_FEATURES = ['draftScore', 'logPick', 'pffComp', 'pffGrade', 'pffProd',
                'pffEff', 'pffClean', 'ageScore']

def fit_model(recs, features, alpha=0.5):
    """Fit Ridge OLS, return {intercept, features:[{name, coef, mean, sd}]}."""
    if len(recs) < 30:
        return None
    X_raw = np.array([[r[f] for f in features] for r in recs], dtype=float)
    y_raw = np.array([math.log(max(0, r['av']) + 1) for r in recs])

    # Replace NaN with column means
    col_means = np.nanmean(X_raw, axis=0)
    for j in range(X_raw.shape[1]):
        mask = ~np.isfinite(X_raw[:, j])
        X_raw[mask, j] = col_means[j]

    scaler = StandardScaler()
    X_std = scaler.fit_transform(X_raw)

    model = Ridge(alpha=alpha, fit_intercept=True)
    model.fit(X_std, y_raw)

    means = scaler.mean_.tolist()
    sds = scaler.scale_.tolist()

    return {
        'intercept': float(model.intercept_),
        'features': [
            {'name': features[i], 'coef': float(model.coef_[i]),
             'mean': means[i], 'sd': max(sds[i], 0.001)}
            for i in range(len(features))
        ]
    }

# ── Walk-forward fitting ──────────────────────────────────────
result = {grp: {} for grp in ['global', 'QB', 'SKILL', 'OL', 'FRONT', 'DB']}

eval_years = list(range(2008, 2024))

for target_year in eval_years:
    # Training: mature outcomes only, strictly before target year
    train_all = [r for r in records
                 if r['year'] < target_year
                 and r['year'] <= (target_year - MATURE_SEASONS.get(r['grp'], 5))]

    if len(train_all) < 50:
        continue

    # Global model
    m = fit_model(train_all, GLOBAL_FEATURES)
    if m:
        result['global'][str(target_year)] = m

    # Position-specific models
    for grp in ['QB', 'SKILL', 'OL', 'FRONT', 'DB']:
        grp_recs = [r for r in train_all if r['grp'] == grp]
        m = fit_model(grp_recs, POS_FEATURES)
        if m:
            result[grp][str(target_year)] = m

    sizes = {g: sum(1 for r in train_all if r['grp'] == g) for g in ['QB','SKILL','OL','FRONT','DB']}
    print(f"  Year {target_year}: train n={len(train_all)}  {sizes}")

# ── Latest model (all mature data) ───────────────────────────
all_mature = [r for r in records if r['year'] <= 2022 - MATURE_SEASONS.get(r['grp'], 5) + 1]
# More precisely: use data up to the cutoff years
cutoff_year = {'SKILL': 2022, 'DB': 2022, 'QB': 2021, 'OL': 2020, 'FRONT': 2020}
all_mature = [r for r in records if r['year'] <= cutoff_year.get(r['grp'], 2021)]

m = fit_model(all_mature, GLOBAL_FEATURES)
if m:
    result['global']['latest'] = m
    print(f"\nLatest global model: n={len(all_mature)}, features={len(m['features'])}")
    for f in m['features']:
        print(f"  {f['name']:15s} coef={f['coef']:+.4f}")

for grp in ['QB', 'SKILL', 'OL', 'FRONT', 'DB']:
    grp_recs = [r for r in all_mature if r['grp'] == grp]
    m = fit_model(grp_recs, POS_FEATURES)
    if m:
        result[grp]['latest'] = m
        print(f"  {grp} latest: n={len(grp_recs)}")

# ── Save ──────────────────────────────────────────────────────
out_path = DATA / 'calibration_models.json'
out_path.write_text(json.dumps(result, separators=(',', ':')))
print(f"\nWrote {out_path}  ({out_path.stat().st_size // 1024} KB)")
print(f"Years covered: {sorted(result['global'].keys())}")
