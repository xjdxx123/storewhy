"""Verify every aggregate cell in a Why evaluation from raw CSV, without SQL/TS."""
import csv
import json
import sys
import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

profiles = {}
visits = defaultdict(list)
orders = defaultdict(list)
for i, row in enumerate(csv.DictReader(Path('data/raw/visits_info_short.csv').open()), 1):
    uid, t = row['User Id'], datetime.fromisoformat(row['Session Start'])
    candidate = (t, row['Channel'], row['Device'], row['Region'], i)
    if uid not in profiles or candidate < profiles[uid]:
        profiles[uid] = candidate
    visits[uid].append(t)
for i, row in enumerate(csv.DictReader(Path('data/raw/orders_info_short.csv').open()), 1):
    orders[row['User Id']].append((datetime.fromisoformat(row['Event Dt']), i, Decimal(row['Revenue'])))
for items in orders.values():
    items.sort()
costs = [(datetime.fromisoformat(r['dt']), r['Channel'], Decimal(r['costs']))
         for r in csv.DictReader(Path('data/raw/costs_info_short.csv').open())]

def rounded(v, digits=2):
    return None if v is None else float(Decimal(v).quantize(Decimal(10) ** -digits, rounding=ROUND_HALF_UP))

def calculate(spec):
    result, coverage = {}, []
    for period in spec['periods']:
        start, requested_end = (datetime.fromisoformat(period[k]) for k in ('start', 'end'))
        end = requested_end if spec['mode'] == 'calendar' else min(requested_end, datetime(2019, 10, 28), datetime(2019, 11, 1) - timedelta(days=spec['windowDays']))
        def accepts(p):
            return (spec['audience'] == 'all' or p[1] != 'organic') and all(not spec['filters'][f] or p[index] in spec['filters'][f] for f, index in [('channels', 1), ('devices', 2), ('regions', 3)])
        excluded = sum(accepts(p) and max(start, end) <= p[0] < requested_end for p in profiles.values()) if spec['mode'] == 'cohort' else 0
        coverage.append({'period': period['label'], 'effectiveEnd': end.date().isoformat(), 'excludedUsers': excluded, 'days': (end-start).days})
        groups = defaultdict(lambda: {'users': 0, 'new_users': 0, 'payers': 0, 'repeat': 0, 'sessions': 0, 'purchases': 0, 'revenue': Decimal(0), 'first': Decimal(0), 'subsequent': Decimal(0), 'delays': [], 'costs': []})
        for uid, p in profiles.items():
            if not accepts(p):
                continue
            if spec['mode'] == 'cohort':
                if not start <= p[0] < end:
                    continue
                lo, hi = p[0], p[0] + timedelta(days=spec['windowDays'])
            else:
                lo, hi = start, end
                if not any(lo <= t < hi for t in visits[uid]) and not any(lo <= t < hi for t, _, _ in orders[uid]):
                    continue
            key = tuple(p[{'channel': 1, 'device': 2, 'region': 3}[d]] for d in spec['groupBy'])
            g = groups[key]
            selected = [(index, t, amount) for index, (t, _, amount) in enumerate(orders[uid]) if lo <= t < hi]
            g['users'] += 1
            g['new_users'] += start <= p[0] < end
            g['payers'] += bool(selected)
            g['repeat'] += len(selected) > 1
            g['sessions'] += sum(lo <= t < hi for t in visits[uid])
            g['purchases'] += len(selected)
            for index, t, amount in selected:
                g['revenue'] += amount
                g['first' if index == 0 else 'subsequent'] += amount
                if index == 0:
                    g['delays'].append(Decimal(str((t-p[0]).total_seconds())) / 3600)
        if not any(d in ('device', 'region') for d in spec['groupBy']):
            for date, channel, amount in costs:
                if start <= date < end and (not spec['filters']['channels'] or channel in spec['filters']['channels']):
                    groups[(channel,) if spec['groupBy'] else ()]['costs'].append(amount)
        for key, g in groups.items():
            revenue = rounded(g['revenue'])
            spend = rounded(sum(g['costs'], Decimal(0))) if g['costs'] else None
            def ratio(a, b):
                return rounded(Decimal(str(a)) / Decimal(str(b)), 6) if a is not None and b else None
            result[(period['label'], key)] = {k: g[k] for k in ('users', 'new_users', 'payers', 'sessions', 'purchases')} | {
                'revenue': revenue, 'spend': spend, 'first_purchase_revenue': rounded(g['first']), 'repeat_purchase_revenue': rounded(g['subsequent']),
                'payer_rate': ratio(g['payers'], g['users']), 'revenue_per_user': ratio(revenue, g['users']), 'revenue_per_payer': ratio(revenue, g['payers']),
                'repeat_payer_rate': ratio(g['repeat'], g['payers']), 'cost_per_new_user': ratio(spend, g['new_users']), 'revenue_to_spend': ratio(revenue, spend),
                'avg_first_purchase_hours': rounded(sum(g['delays']) / len(g['delays']), 6) if g['delays'] else None}
    return result, coverage

report_path = Path(sys.argv[1] if len(sys.argv) > 1 else 'evidence/why-reliability-final.json')
report = json.loads(report_path.read_text())
checked, errors, cache = 0, [], {}
for record in report['records']:
    for evidence in record.get('evidence', []):
        spec = evidence['spec']
        if spec.get('timeGrain'):
            errors.append(f"{record['id']}: unexpected trend; reference supports summaries only")
            continue
        fingerprint = json.dumps(spec, sort_keys=True)
        if fingerprint not in cache:
            cache[fingerprint] = calculate(spec)
        expected, coverage = cache[fingerprint]
        actual_keys = set()
        for row in evidence['rows']:
            key = (row['period'], tuple(row['dimensions'][d] for d in spec['groupBy']))
            actual_keys.add(key)
            for metric, value in row['values'].items():
                want = expected.get(key, {}).get(metric)
                checked += 1
                if value != want and not (value is not None and want is not None and abs(value-want) < 0.000002):
                    errors.append(f"{record['id']} {key} {metric}: actual={value}, reference={want}")
        if actual_keys != set(expected):
            errors.append(f"{record['id']}: aggregate groups differ")
        for want, actual in zip(coverage, evidence['coverage'], strict=True):
            for k, v in want.items():
                if actual[k] != v:
                    errors.append(f"{record['id']}: coverage {k} differs")
    summary = record.get('answer', {}).get('summary', '')
    if summary.startswith('所列渠道合计'):
        match = re.search(r'收入与记录费用比从([0-9.]+)变为([0-9.]+)', summary)
        source = record['evidence'][0]
        expected, _ = cache[json.dumps(source['spec'], sort_keys=True)]
        ratios = []
        for period in source['spec']['periods']:
            rows = [v for (label, _), v in expected.items() if label == period['label']]
            total_cost = sum((Decimal(str(row['spend'])) for row in rows), Decimal(0))
            total_revenue = sum((Decimal(str(row['revenue'])) for row in rows), Decimal(0))
            ratios.append(rounded(total_revenue / total_cost, 6))
        checked += 2
        if not match or any(abs(float(match[i+1]) - want) > 0.000002 for i, want in enumerate(ratios)):
            errors.append(f"{record['id']}: aggregate ratio headline differs from independent CSV totals")

result = {'method': 'Independent Python CSV loops and Decimal; verifies all executed aggregate cells and maturity coverage without TS/SQL', 'report': report_path.name, 'cellsChecked': checked, 'uniqueSpecs': len(cache), 'pass': not errors, 'errors': errors}
report_path.with_name(report_path.stem + '-reference.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
sys.exit(bool(errors))
