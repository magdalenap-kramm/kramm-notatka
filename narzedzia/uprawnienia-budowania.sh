#!/bin/bash
# Nadaje kontu technicznemu projektu role potrzebne do budowania Cloud Functions, potem wdraża.
set -e
PROJEKT=calm-metric-514918-h8
NR=$(gcloud projects describe "$PROJEKT" --format='value(projectNumber)')
SA="$NR-compute@developer.gserviceaccount.com"
for R in cloudbuild.builds.builder logging.logWriter artifactregistry.writer storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJEKT" --member="serviceAccount:$SA" --role="roles/$R" --condition=None --quiet >/dev/null
  echo "OK $R"
done
echo "Czekam 60 s, aż uprawnienia zaczną działać..."
sleep 60
cd "$(dirname "$0")/.." && npx -y firebase-tools@latest deploy --only functions --project "$PROJEKT" --force
