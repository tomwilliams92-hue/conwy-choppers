/* ------------------------------------------------------------------ *
 *  CONWY CHOPPERS — leaderboard data
 *  This is the ONLY file you edit each week (or the scraper rewrites).
 *
 *  • Add a round:  { date: "YYYY-MM-DD", course: "Conwy", points: 36 }
 *  • points = the Stableford total Wales Golf already calculated.
 *  • Up to 12 rounds per player; the board auto-counts the best 6.
 *  • Set competition.lastUpdated to today's date when you update.
 * ------------------------------------------------------------------ */

window.CHOPPERS_DATA = {
  competition: {
    club:        "Conwy Golf Club",
    name:        "Conwy Choppers",
    subtitle:    "Order of Merit",
    format:      "Best 6 Stableford",
    startDate:   "2026-06-05",   // this past Friday
    endDate:     "2026-09-30",   // season close
    lastUpdated: "2026-06-06",
    bestN:       6,
    maxCards:    12
  },

  players: [
    {
      id: "tom",
      name: "Tom Williams",
      short: "Tom",
      rounds: [
        // no rounds yet — add as they come in
      ]
    },
    {
      id: "josh",
      name: "Josh Morris",
      short: "Josh",
      rounds: [
        // no rounds yet
      ]
    },
    {
      id: "callum",
      name: "Callum Bennett",
      short: "Callum",
      rounds: [
        { date: "2026-06-05", course: "Conwy", points: 36 }
      ]
    }
  ]
};
