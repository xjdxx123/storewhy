"""Independent stdlib reference: raw CSV loops, not the TypeScript SQL compiler."""
import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

raw = Path('data/raw')
profiles = {}
calendar_users = defaultdict(set)
calendar_orders = defaultdict(list)
for row_id, row in enumerate(csv.DictReader((raw / 'visits_info_short.csv').open()), 1):
    uid = row['User Id']
    time = datetime.fromisoformat(row['Session Start'])
    candidate = (time, row['Channel'], row['Device'], row['Region'], row_id)
    if uid not in profiles or candidate < profiles[uid]:
        profiles[uid] = candidate
    calendar_users[time.strftime('%Y-%m')].add(uid)
orders = defaultdict(list)
for row_id, row in enumerate(csv.DictReader((raw / 'orders_info_short.csv').open()), 1):
    uid = row['User Id']
    time = datetime.fromisoformat(row['Event Dt'])
    amount = Decimal(row['Revenue'])
    orders[uid].append((time, row_id, amount))
    calendar_users[time.strftime('%Y-%m')].add(uid)
for uid, items in orders.items():
    items.sort()
    for index, (time, _, amount) in enumerate(items):
        calendar_orders[time.strftime('%Y-%m')].append((uid, time, amount, index))
costs = [(datetime.fromisoformat(row['dt']), row['Channel'], Decimal(row['costs']))
         for row in csv.DictReader((raw / 'costs_info_short.csv').open())]

def rounded(value, digits=2):
    return float(Decimal(value).quantize(Decimal(10) ** -digits, rounding=ROUND_HALF_UP))

def cohort(month, horizon):
    start = datetime(2019, month, 1)
    end = datetime(2019, month + 1, 1)
    cutoff = datetime(2019, 11, 1) - timedelta(days=horizon)
    users = {uid: p for uid, p in profiles.items()
             if start <= p[0] < min(end, cutoff) and p[1] != 'organic'}
    revenue = Decimal(0)
    payers = 0
    for uid, profile in users.items():
        selected = [amount for time, _, amount in orders[uid]
                    if profile[0] <= time < profile[0] + timedelta(days=horizon)]
        revenue += sum(selected, Decimal(0))
        payers += bool(selected)
    spend = sum((amount for date, channel, amount in costs
                 if start <= date < min(end, cutoff) and channel != 'organic'), Decimal(0))
    return {'spend': rounded(spend), 'new_users': len(users), 'payers': payers,
            'revenue': rounded(revenue), 'payer_rate': rounded(Decimal(payers) / len(users), 6),
            'revenue_per_payer': rounded(revenue / payers, 6),
            'cost_per_new_user': rounded(spend / len(users), 6),
            'revenue_to_spend': rounded(revenue / spend, 6)}

cohorts = {str(h): [cohort(m, h) for m in (6, 7)] for h in (7, 14)}
calendar = []
for month in ('2019-06', '2019-07'):
    rows = calendar_orders[month]
    delays = [Decimal(str((time - profiles[uid][0]).total_seconds())) / 3600
              for uid, time, _, index in rows if index == 0]
    calendar.append({'users': len(calendar_users[month]), 'purchases': len(rows),
                     'revenue': rounded(sum((r[2] for r in rows), Decimal(0))),
                     'first_purchase_revenue': rounded(sum((r[2] for r in rows if r[3] == 0), Decimal(0))),
                     'repeat_purchase_revenue': rounded(sum((r[2] for r in rows if r[3] > 0), Decimal(0))),
                     'avg_first_purchase_hours': rounded(sum(delays) / len(delays), 6)})
Path('evidence').mkdir(exist_ok=True)
Path('evidence/reference-metrics.json').write_text(json.dumps({
    'method': 'Python stdlib CSV loops and Decimal; independent of TypeScript and SQL compiler',
    'cohorts': cohorts, 'calendar': calendar}, indent=2) + '\n')
print('Independent reference calculated: H7, H14 and calendar June/July')
