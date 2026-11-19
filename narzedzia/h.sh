#!/bin/bash
# Wdrożenie Asystentki pod adresem asystentka-kramm.web.app
cd ~/kramm-notatka
npx -y firebase-tools hosting:sites:create asystentka-kramm 2>&1 | tail -3
npx -y firebase-tools deploy --only hosting,functions --force 2>&1 | tail -6
