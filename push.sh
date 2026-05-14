#!/bin/bash

# ─────────────────────────────────────────────────────────
# ROLA — Deploy to rolaglobal.com
# Usage: ~/Desktop/ROLA/push.sh
# ─────────────────────────────────────────────────────────

GOLD='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${GOLD}${BOLD}  ROLA — Deploying to rolaglobal.com${NC}"
echo -e "${DIM}  ────────────────────────────────────${NC}"
echo ""

cd ~/Desktop/ROLA || { echo -e "${RED}  ERROR: ~/Desktop/ROLA not found.${NC}"; exit 1; }

STATUS=$(git status --porcelain)
if [ -z "$STATUS" ]; then
  echo -e "${DIM}  No changes. Nothing to deploy.${NC}"
  echo ""
  exit 0
fi

echo -e "${DIM}  Changes detected:${NC}"
git status --short | sed 's/^/    /'
echo ""

TIMESTAMP=$(date "+%Y-%m-%d %H:%M")
git add .
git commit -m "Update — $TIMESTAMP" --quiet
git push origin main --quiet

if [ $? -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  Deployed. Vercel is building now.${NC}"
  echo -e "${DIM}  Live in ~30 seconds at rolaglobal.com${NC}"
  echo ""
else
  echo -e "${RED}  Push failed. Check GitHub connection.${NC}"
  exit 1
fi
