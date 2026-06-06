#!/bin/bash
# Double-click this from Finder to update the leaderboard each week.
# It pulls scores from Wales Golf, then publishes them to the live site.
cd "$(dirname "$0")" || exit 1
echo "════════════════════════════════════════"
echo "  CONWY CHOPPERS — weekly score update"
echo "════════════════════════════════════════"
node scrape.mjs || { echo "Scrape failed."; read -p "Press ENTER to close."; exit 1; }
git add data.js courses.js
git commit -m "Update scores $(date +%F)" 2>/dev/null && git push || echo "(no score changes to publish)"
echo ""
echo "✓ Done. Live in ~1 min:"
echo "  https://tomwilliams92-hue.github.io/conwy-choppers/"
read -p "Press ENTER to close."
