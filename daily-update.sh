#!/bin/bash
# Unattended daily updater, run by launchd (com.conwy.choppers.update).
# Pulls scores from Wales Golf, then commits & pushes if anything changed.
# Safe to fail: if the Wales Golf login has expired the scraper leaves
# data.js untouched (see the SAFETY guard in scrape.mjs) and we just exit.
#
# To run by hand:  ./daily-update.sh   (tail -f daily-update.log to watch)

cd "$(dirname "$0")" || exit 1
# launchd starts with a bare PATH — make sure node + git are findable.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

LOG="daily-update.log"
{
  echo "──────── $(date '+%Y-%m-%d %H:%M:%S') ────────"

  # stdin from /dev/null so any "press ENTER" prompt can't hang an unattended run.
  if ! node scrape.mjs < /dev/null; then
    echo "Scrape did not update the board (login may need refreshing). Board left unchanged."
    exit 0
  fi

  if git diff --quiet -- data.js courses.js; then
    echo "Scores unchanged — nothing to publish."
    exit 0
  fi

  git add data.js courses.js
  git commit -m "Update scores $(date +%F)" && git push && echo "✓ Published to GitHub Pages." \
    || echo "✗ Commit/push failed — check git auth."
} >> "$LOG" 2>&1
