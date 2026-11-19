#!/bin/bash
# Test przygotowania briefu (bez zapisu)
cd ~/kramm-notatka && git pull -q
SEKRET=$(gcloud secrets versions access latest --secret=GOOGLE_CLIENT_SECRET) KLUCZ=$(gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY) node narzedzia/pokaz-brief.js 2>&1 | grep BRIEF | cut -c1-600
