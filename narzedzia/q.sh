#!/bin/bash
# Limity Gmail API dla projektu
gcloud alpha services quota list --service=gmail.googleapis.com --consumer=projects/calm-metric-514918-h8 --format=json 2>&1 | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
except Exception as e:
  print('BLAD', sys.stdin.read()[:300]); sys.exit()
for m in d:
  for l in m.get('consumerQuotaLimits',[]):
    for b in l.get('quotaBuckets',[]):
      print(l.get('unit'), '|', l.get('metric','').split('/')[-1], '| eff', b.get('effectiveLimit'), '| def', b.get('defaultLimit'))
"
