#!/bin/bash
# Wdrożenie zaplecza Asystentki KRAMM. Uruchom w Google Cloud Shell (shell.cloud.google.com):
#   git clone https://github.com/magdalenap-kramm/kramm-notatka && cd kramm-notatka && bash narzedzia/wdroz-asystentke.sh
# Kolejne aktualizacje: cd kramm-notatka && git pull && bash narzedzia/wdroz-asystentke.sh
set -e
PROJEKT=calm-metric-514918-h8
REGION=europe-central2
FB="npx -y firebase-tools@latest"

echo "== Projekt $PROJEKT"
gcloud config set project "$PROJEKT" >/dev/null

echo "== Włączam potrzebne usługi Google (pierwszy raz trwa kilka minut)"
gcloud services enable gmail.googleapis.com calendar-json.googleapis.com drive.googleapis.com sheets.googleapis.com \
  firestore.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com run.googleapis.com cloudscheduler.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com firebase.googleapis.com

echo "== Baza Firestore"
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
fi

sekret_jest() { gcloud secrets describe "$1" >/dev/null 2>&1; }
ustaw_sekret() {   # nazwa, wartość
  if sekret_jest "$1"; then printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null; fi
}
zapytaj_sekret() {   # nazwa, opis; żeby podmienić istniejące: ZMIEN_SEKRETY=1 bash narzedzia/wdroz-asystentke.sh
  if sekret_jest "$1" && [ -z "$ZMIEN_SEKRETY" ]; then echo "   $1: jest (pomijam)"; return; fi
  read -r -s -p "   Wklej $2 i naciśnij Enter: " W; echo
  [ -n "$W" ] || { echo "Pusto - przerywam."; exit 1; }
  ustaw_sekret "$1" "$W"; echo "   $1: zapisany"
}

echo "== Sekrety (nie trafiają do repozytorium)"
zapytaj_sekret GOOGLE_CLIENT_SECRET "Client secret klienta OAuth (Google Cloud -> Dane logowania)"
zapytaj_sekret ANTHROPIC_API_KEY "klucz API Claude (console.anthropic.com -> API keys)"
if ! sekret_jest VAPID_PUBLIC; then
  echo "   Tworzę klucze powiadomień"
  KLUCZE=$(npx -y web-push generate-vapid-keys --json)
  ustaw_sekret VAPID_PUBLIC "$(node -e "console.log(JSON.parse(process.argv[1]).publicKey)" "$KLUCZE")"
  ustaw_sekret VAPID_PRIVATE "$(node -e "console.log(JSON.parse(process.argv[1]).privateKey)" "$KLUCZE")"
else echo "   Klucze powiadomień: są (pomijam)"; fi

echo "== Logowanie Firebase"
if ! $FB projects:list >/dev/null 2>&1; then $FB login --no-localhost; fi

echo "== Instaluję i testuję funkcje"
(cd funkcje && npm install --no-audit --no-fund && node test.js)

echo "== Wdrażam"
$FB deploy --only functions,firestore:rules --project "$PROJEKT" --force

echo
echo "Gotowe. Adres aplikacji: https://magdalenap-kramm.github.io/kramm-notatka/asystentka/"
