/* ------------------------------------------------------------------ *
 *  COURSE DATABASE — rating / slope / par per course + tee
 *
 *  Used to convert a Wales Golf round into Stableford points:
 *      Stableford = 36 + CourseHandicap + Par − AdjustedGross
 *  where CourseHandicap = round( HandicapIndex × Slope/113 + (CR − Par) )
 *
 *  ADD A COURSE: copy a line below. Key = "course name|tee" (any case /
 *  spacing — it's normalised). Read CR / Slope straight off the Wales Golf
 *  scores table; Par is the course par (18 holes).
 *
 *  The scraper PRINTS any course it can't find here, so you'll always know
 *  what to add.
 * ------------------------------------------------------------------ */

export const COURSES = {
  // ---- Conwy (Caernarvonshire) — your home club ----
  "conwy(caernarvonshire)|blue":  { cr: 74.5, slope: 138, par: 72 },
  "conwy(caernarvonshire)|white": { cr: 71.9, slope: 121, par: 72 },

  // ---- Others (fill CR/Slope/Par from the Wales Golf scores table as needed) ----
  "bromborough|white":            { cr: 72.9, slope: 142, par: 72 },
  "wallasey|white":               { cr: 73.0, slope: 133, par: 72 },
  // CR/slope read off the Wales Golf scores table 2026-07-20; par 69 confirmed by
  // back-solving Wales Golf's own course handicap (+2 at HI +1.6 ⇒ par 69, not 68).
  "stmelyd|white":                { cr: 68.4, slope: 120, par: 69 },
  // CR/slope from Josh's golf-profile table 2026-07-20; par 72 back-solves his
  // course handicap on all three of his Abergele rounds (2025-2026).
  "abergele|white":               { cr: 71.8, slope: 124, par: 72 },
  // "ruthin-pwllglas|white":     { cr: 65.6, slope: 116, par: 70 },
  // "prestatyn|white":           { cr: 0,    slope: 0,   par: 0  },
};

export function courseKey(course, tee) {
  return `${course || ""}|${tee || ""}`.toLowerCase().replace(/\s+/g, "");
}

export function lookupCourse(course, tee) {
  return COURSES[courseKey(course, tee)] || null;
}
