#!/bin/bash
# Wdrożenie Asystentki: strona + funkcje
cd ~/kramm-notatka && git pull -q && npx -y firebase-tools deploy --only hosting,functions --force --non-interactive 2>&1 | tail -6
