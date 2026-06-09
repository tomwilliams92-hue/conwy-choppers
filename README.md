# Conwy Choppers — Order of Merit

A best-6 Stableford leaderboard for Tom, Josh & Callum.
Season: **5 Jun → 30 Sep 2026**. No cap on rounds — your best 6 count, highest combined total leads.
Prize: every losing player owes the winner **two dozen balls** (or the cash equivalent).

## Files
| File | What it is |
|---|---|
| `index.html` | The dashboard (open it in a browser to view) |
| `data.js` | The scores the board reads — rewritten by the scraper |
| `scrape.mjs` | Pulls scores from Wales Golf and updates `data.js` |
| `courses.js` | Course rating / slope / par lookup (add courses here) |
| `lib.mjs` | Stableford maths + data writer |

## View the board
Double-click `index.html`, or once hosted, share the live link.

## Update the scores (weekly)
```bash
node scrape.mjs
```
- **First run:** a Chrome window opens. Log in to Wales Golf (incl. any 2FA),
  make sure you can see your scores on *My Overview*, then press **ENTER** in the
  terminal. Your login is saved in `./.chrome-profile` (gitignored) — future runs
  are already logged in. **Your password is never stored in code or sent anywhere.**
- It reads your rounds from *My Overview* and Josh + Callum's from *My Friends*,
  converts each to Stableford, and rewrites `data.js`.
- A summary prints at the end, including any rounds it skipped (and why).

If a round is skipped for **"course not in courses.js"**, add that course to
`courses.js` (read CR / Slope off the Wales Golf scores table, par is the course
par) and re-run.

Debug a stuck run with `node scrape.mjs --debug` (saves page HTML to `./debug`).

## The Stableford conversion
Wales Golf records **Adjusted Gross**, not Stableford. They convert exactly:

```
Stableford = 36 + CourseHandicap + Par − AdjustedGross
```

Verified against Callum's 5 Jun round: `36 + 29 + 72 − 101 = 36` ✓

## Take a screenshot
```bash
node shot.mjs "file://$(pwd)/index.html" shots/board.png
```
