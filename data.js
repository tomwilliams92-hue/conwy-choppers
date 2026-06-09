/* ------------------------------------------------------------------ *
 *  CONWY CHOPPERS — leaderboard data
 *  This is the ONLY file you edit each week (or the scraper rewrites).
 *
 *  • Add a round:  { date: "YYYY-MM-DD", course: "Conwy", points: 36 }
 *  • points = the Stableford total Wales Golf already calculated.
 *  • Optional (scraper fills these): gross, net, chcp (course handicap).
 *    They power the gross/net records & awards — leave them off if unknown.
 *  • No cap — submit as many rounds as you like; the board auto-counts the best 6.
 *  • Set competition.lastUpdated to today's date when you update.
 * ------------------------------------------------------------------ */

window.CHOPPERS_DATA = {
  competition: {
    club:        "Conwy Golf Club",
    name:        "Conwy Choppers",
    subtitle:    "Order of Merit",
    format:      "Best 6 Stableford",
    startDate:   "2026-05-30",   // first counting rounds
    endDate:     "2026-09-30",   // season close
    lastUpdated: "2026-06-07",
    bestN:       6,
    recap:       "Three cards on the board. <b>Callum</b> leads on 36, <b>Tom</b> right behind on 33, <b>Josh</b> on 30 — it's tight at the top.",
    moverId:     null,    // player id with the biggest jump this week (scraper fills)
    celebrate:   false    // true triggers lead-change confetti
  },

  players: [
    {
      id: "tom",
      name: "Tom Williams",
      short: "Tom",
      handicap: "+1.3",            // current WHS Handicap Index
      handicapTrend: 0,            // change over recent rounds (− improving/green, + slipping/red, 0 flat, null n/a)
      handicapHistory: [-1.2, -1.3, -1.3, -1.2, -1.3],  // recent HI values (plus golfers are negative)
      movement: null,             // places moved since last update (+ up / − down / null = n/a)
      rounds: [
        { date: "2026-05-30", course: "Conwy", points: 33 }
      ]
    },
    {
      id: "josh",
      name: "Josh Morris",
      short: "Josh",
      handicap: "2.7",
      handicapTrend: null,
      handicapHistory: [2.5, 2.6, 2.7],
      movement: null,
      rounds: [
        { date: "2026-05-30", course: "Conwy", points: 30 }
      ]
    },
    {
      id: "callum",
      name: "Callum Bennett",
      short: "Callum",
      handicap: "21.3",
      handicapTrend: -0.3,
      handicapHistory: [21.9, 21.6, 21.5, 21.3],
      movement: null,
      rounds: [
        { date: "2026-06-05", course: "Conwy", points: 36 }
      ]
    }
  ]
};
