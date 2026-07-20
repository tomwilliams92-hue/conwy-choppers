/* ==================================================================
 *  CONWY CHOPPERS — Wales Golf score puller
 *
 *  WHAT IT DOES
 *  1. Opens its OWN Chrome window (saved profile in ./.chrome-profile).
 *     First run: you log in to Wales Golf by hand (incl. any 2FA).
 *     The session persists, so future runs are already logged in.
 *     >>> Your password is never stored in code or sent anywhere. <<<
 *  2. Reads your rounds from /my-overview and Josh + Callum's from
 *     /my-friends, keeps everything from the competition start date on.
 *  3. Converts each round to Stableford points and rewrites data.js.
 *
 *  RUN:  node scrape.mjs           (normal weekly pull)
 *        node scrape.mjs --debug   (saves page HTML to ./debug if stuck)
 * ================================================================== */
import puppeteer from "puppeteer-core";
import readline from "node:readline";
import { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { parseHi, parseGross, toStableford, writeDataJs } from "./lib.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "./.chrome-profile";
const DEBUG = process.argv.includes("--debug");
const CONNECT = process.argv.includes("--connect"); // attach to an already-open, logged-in Chrome
const DEBUG_PORT = 9222;
const SIGNAL = "./.login-ready"; // assistant touches this to say "logged in — proceed"

const COMPETITION = {
  club: "Conwy Golf Club",
  name: "Conwy Choppers",
  subtitle: "Order of Merit",
  format: "Best 6 Stableford",
  startDate: "2026-05-30",
  endDate: "2026-09-30",
  lastUpdated: new Date().toISOString().slice(0, 10),
  bestN: 6,
  recap: "",          // weekly summary line (computed below)
  moverId: null,      // biggest gainer this week
  celebrate: false,   // lead changed -> confetti
};

// source:"self" → read from /my-overview ; source:"friend" → match a row on /my-friends
const TARGETS = [
  { id: "tom",    name: "Tom Williams",   short: "Tom",    source: "self" },
  { id: "josh",   name: "Josh Morris",    short: "Josh",   source: "friend", match: "morris, josh" },
  { id: "callum", name: "Callum Bennett", short: "Callum", source: "friend", match: "bennett, callum" },
];

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const pad = n => String(n).padStart(2, "0");

/* Parse "06 Jun 2026" or "30/05/2026" → "2026-06-06". */
function toISO(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  return null;
}

/* Key a round by date + course with spacing/case normalised — the friends table
 * writes "Conwy (Caernarvonshire)" where the profile/overview write
 * "Conwy(Caernarvonshire)", which used to double-count merged history. */
const roundKey = (date, course) => `${date}|${String(course || "").toLowerCase().replace(/\s+/g, "")}`;

const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); res(a); });
});

/* Find the table whose header row contains ALL of `must` (case-insensitive). */
async function extractTable(page, must) {
  return page.evaluate((must) => {
    const norm = s => s.replace(/\s+/g, " ").trim();
    // Cell normaliser that PRESERVES line breaks (course & tee sit on separate lines,
    // e.g. "Conwy(Caernarvonshire)\nBlue" — collapsing the newline broke the course lookup).
    const normCell = s => (s || "").split("\n").map(x => x.replace(/[ \t \f\v]+/g, " ").trim()).filter(Boolean).join("\n");
    for (const t of document.querySelectorAll("table")) {
      const head = [...t.querySelectorAll("thead th, thead td")].map(c => norm(c.innerText).toLowerCase());
      const headers = head.length ? head : [...t.querySelectorAll("tr")][0]
        ? [...[...t.querySelectorAll("tr")][0].children].map(c => norm(c.innerText).toLowerCase()) : [];
      if (headers.length && must.every(m => headers.some(h => h.includes(m)))) {
        const rows = [...t.querySelectorAll("tbody tr")].map(tr =>
          [...tr.querySelectorAll("td, th")].map(td => normCell(td.innerText)));
        return { headers, rows: rows.filter(r => r.length) };
      }
    }
    return null;
  }, must);
}

const colIndex = (headers, name) => headers.findIndex(h => h.includes(name));

/* Current handicap (display string) + recent trend from a {date,hi} series.
 * trend < 0 = index dropping (improving); > 0 = rising (slipping). */
function summariseHcp(series) {
  const s = series.filter(x => x.hi != null && x.date).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!s.length) return { handicap: null, handicapTrend: null };
  const latest = s[s.length - 1].hi;
  const back = s[Math.max(0, s.length - 1 - 6)].hi; // ~6 rounds ago
  const display = latest < 0 ? "+" + (-latest).toFixed(1) : latest.toFixed(1);
  const handicapTrend = s.length >= 2 ? Math.round((latest - back) * 10) / 10 : null;
  const handicapHistory = s.slice(-8).map(x => Math.round(x.hi * 10) / 10); // for the sparkline
  return { handicap: display, handicapTrend, handicapHistory };
}

/* Previous state (position + best 6) from the existing data.js — for movement, mover, recap. */
function prevState() {
  try {
    const txt = readFileSync("./data.js", "utf8");
    const m = txt.match(/window\.CHOPPERS_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!m) return {};
    const data = Function('"use strict";return (' + m[1] + ')')();
    const ps = data.players.map(p => ({
      id: p.id,
      rounds: p.rounds || [],
      best6: [...p.rounds].sort((a, b) => b.points - a.points).slice(0, data.competition.bestN)
        .reduce((s, r) => s + r.points, 0),
    })).sort((a, b) => b.best6 - a.best6);
    const out = {}; ps.forEach((p, i) => out[p.id] = { pos: i + 1, best6: p.best6, rounds: p.rounds });
    return out;
  } catch { return {}; }
}

/* Build the weekly recap line, mover of the week, and lead-change flag. */
function weeklySummary(built, prev) {
  const first = p => p.name.split(" ")[0];
  const ranked = [...built].sort((a, b) => b._best6 - a._best6);
  const leader = ranked[0];
  let prevLeaderId = null;
  for (const id in prev) if (prev[id].pos === 1) prevLeaderId = id;
  const celebrate = !!(leader._best6 > 0 && prevLeaderId && prevLeaderId !== leader.id);
  let moverId = null, bestGain = 0;
  for (const p of built) { const g = p._best6 - (prev[p.id] ? prev[p.id].best6 : 0); if (g > bestGain) { bestGain = g; moverId = p.id; } }
  const parts = [];
  if (celebrate) parts.push(`<b>New leader!</b> ${first(leader)} tops the board on ${leader._best6}.`);
  else if (leader._best6 > 0) parts.push(`<b>${first(leader)}</b> leads on ${leader._best6}.`);
  if (moverId && bestGain > 0) { const m = built.find(x => x.id === moverId); parts.push(`${first(m)}'s best week (+${bestGain}).`); }
  built.forEach(p => { const pb = prev[p.id]; if ((!pb || pb.best6 === 0) && p._best6 > 0 && p.id !== moverId && p.id !== leader.id) parts.push(`${first(p)} is on the board.`); });
  return { recap: parts.join(" ") || "The race is on.", moverId, celebrate };
}

async function dumpDebug(page, tag) {
  if (!DEBUG) return;
  mkdirSync("./debug", { recursive: true });
  writeFileSync(`./debug/${tag}.html`, await page.content());
  console.log(`   ↳ debug HTML saved to ./debug/${tag}.html`);
}

(async () => {
  let browser;
  if (CONNECT) {
    console.log(`→ Connecting to the Chrome you're logged in to (port ${DEBUG_PORT})…`);
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}`, defaultViewport: null });
  } else {
    console.log("→ Launching Chrome (its own window)…");
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      userDataDir: PROFILE,
      defaultViewport: null,
      args: ["--no-first-run", "--no-default-browser-check"],
    });
  }
  const page = (await browser.pages())[0] || (await browser.newPage());

  // ---- ensure logged in ----
  await page.goto("https://www.walesgolf.org/my-overview", { waitUntil: "networkidle2", timeout: 60000 });
  let scores = await extractTable(page, ["adj", "course rating", "slope"]);
  if (!scores && CONNECT) {
    console.log("\n⚠  Not logged in yet in the open Chrome window.");
    console.log("   Log in to Wales Golf there, open My Overview so your scores show, then tell me.");
    await browser.disconnect();
    process.exit(2);
  }
  if (!scores) {
    console.log("\n⚠  Not logged in yet.");
    console.log("   Log in to Wales Golf in the Chrome window that just opened (incl. any 2FA),");
    console.log("   and open My Overview so your scores show. This window will NOT reload while you do it.");
    console.log("   The assistant tells me when you're done — then I read your scores. Waiting…");
    // Make THIS window unmistakable: pop it to the front + paint a red banner on it.
    try {
      await page.bringToFront();
      await page.evaluate(() => {
        if (document.getElementById("__choppers_banner")) return;
        const b = document.createElement("div");
        b.id = "__choppers_banner";
        b.textContent = "👇 LOG IN IN THIS WINDOW — Conwy Choppers leaderboard (your normal Chrome doesn't count)";
        b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#d11;color:#fff;font:bold 18px/1.4 system-ui,sans-serif;padding:14px 16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.4)";
        document.documentElement.appendChild(b);
      });
    } catch { /* page may be mid-load; banner is best-effort */ }
    const deadline = Date.now() + 12 * 60 * 1000; // up to 12 min to log in at your own pace
    while (!scores && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      if (!existsSync(SIGNAL)) continue;            // touch NOTHING until the assistant signals
      try {
        await page.goto("https://www.walesgolf.org/my-overview", { waitUntil: "networkidle2", timeout: 60000 });
        scores = await extractTable(page, ["adj", "course rating", "slope"]);
      } catch { /* transient nav error — will retry on next signal */ }
      if (scores) console.log("   ✓ Scores detected — continuing.");
      else { try { unlinkSync(SIGNAL); } catch {} console.log("   Signalled, but still no scores — finish logging in, then signal again."); }
    }
  }

  const byId = Object.fromEntries(TARGETS.map(t => [t.id, { ...t, rounds: [], skipped: [], hiSeries: [] }]));

  /* ---------- Tom (self) from My Overview ---------- */
  if (scores) {
    const H = scores.headers;
    const iDate = colIndex(H, "played"), iCT = colIndex(H, "course"),
          iGross = colIndex(H, "adj"), iHcp = colIndex(H, "course hdcp"),
          iHi = colIndex(H, "handicap");
    for (const r of scores.rows) {
      const ct = (r[iCT] || "").split("\n").map(s => s.trim()).filter(Boolean);
      const date = toISO(r[iDate]);
      byId.tom.hiSeries.push({ date, hi: parseHi(r[iHi]) });
      addRound(byId.tom, {
        date, course: ct[0], tee: ct[1],
        adjGross: parseGross(r[iGross]), courseHcp: parseHi(r[iHcp]), // parseHi keeps "+1" as −1
      });
    }
    // The scores-table column is the PRE-round index; the current official Handicap
    // Index is the headline figure ("My Handicap Index® +1.5"). Use it as the latest
    // point so the displayed handicap, trend and sparkline reflect today's real index.
    const officialHI = await page.evaluate(() => {
      const body = document.body.innerText.replace(/\s+/g, " ");
      const m = body.match(/Handicap Index®?\s*([+\-]?\d+\.\d)/i);
      return m ? m[1] : null;
    });
    const ohi = parseHi(officialHI);
    if (ohi != null) byId.tom.hiSeries.push({ date: COMPETITION.lastUpdated, hi: ohi });
  } else {
    console.log("✗ Could not read your scores table.");
    await dumpDebug(page, "my-overview");
  }

  /* ---------- Josh + Callum from My Friends ---------- */
  await page.goto("https://www.walesgolf.org/my-friends", { waitUntil: "networkidle2", timeout: 60000 });
  let friends = await extractTable(page, ["name", "adj", "handicap"]);
  // The friends rows render a moment after the page settles — wait for them to populate.
  for (let i = 0; i < 12 && (!friends || !friends.rows.length); i++) {
    await new Promise(r => setTimeout(r, 1500));
    friends = await extractTable(page, ["name", "adj", "handicap"]);
  }
  // SAFETY: if the friends table never loaded, don't publish a half-update that wipes Josh/Callum.
  if (!friends || !friends.rows.length) {
    console.error("\n✗ Couldn't read the My Friends table (page didn't load in time).");
    console.error("  Leaving data.js UNCHANGED to avoid a partial update.");
    if (CONNECT) await browser.disconnect(); else await browser.close();
    process.exit(1);
  }
  if (friends) {
    const H = friends.headers;
    const iName = colIndex(H, "name"), iDate = colIndex(H, "date"),
          iCourse = colIndex(H, "played at"), iTee = colIndex(H, "marker"),
          iGross = colIndex(H, "adj"), iHi = colIndex(H, "handicap");
    // The friends table only ever shows each friend's LATEST round, so any round
    // played between updates used to vanish (Josh's Abergele 14 Jul was lost this
    // way). Each row links to the friend's /golf-profile page, which carries their
    // FULL score history in the same format as My Overview — incl. the platform's
    // own Course Hdcp, so points match Wales Golf exactly. Grab the links now,
    // before we navigate away from the friends page.
    const profileLinks = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map(tr => ({
        text: (tr.innerText || "").toLowerCase(),
        href: (tr.querySelector("a[href*='golf-profile']") || {}).href || null,
      })).filter(x => x.href));
    for (const r of friends.rows) {
      const name = (r[iName] || "").toLowerCase();
      const t = TARGETS.find(t => t.source === "friend" && name.includes(t.match));
      if (!t) continue;
      const link = (profileLinks.find(x => x.text.includes(t.match)) || {}).href;
      let gotHistory = false;
      if (link) {
        try {
          await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
          let hist = await extractTable(page, ["adj", "course rating", "slope"]);
          for (let i = 0; i < 12 && (!hist || !hist.rows.length); i++) {
            await new Promise(res => setTimeout(res, 1500));
            hist = await extractTable(page, ["adj", "course rating", "slope"]);
          }
          if (hist && hist.rows.length) {
            const h = hist.headers;
            const jDate = colIndex(h, "played"), jCT = colIndex(h, "course"),
                  jGross = colIndex(h, "adj"), jHcp = colIndex(h, "course hdcp"),
                  jHi = colIndex(h, "handicap");
            for (const row of hist.rows) {
              const date = toISO(row[jDate]);
              if (!date) continue; // expanded-scorecard sub-rows, not rounds
              const ct = (row[jCT] || "").split("\n").map(s => s.trim()).filter(Boolean);
              byId[t.id].hiSeries.push({ date, hi: parseHi(row[jHi]) });
              addRound(byId[t.id], {
                date, course: ct[0], tee: ct[1],
                adjGross: parseGross(row[jGross]), courseHcp: parseHi(row[jHcp]),
                hi: parseHi(row[jHi]),
              });
            }
            gotHistory = true;
          }
        } catch { /* profile didn't load — fall back to the friends-row round */ }
      }
      if (!gotHistory) {
        // Fallback: the friend's latest round from the friends table (old behaviour).
        const date = toISO(r[iDate]);
        byId[t.id].hiSeries.push({ date, hi: parseHi(r[iHi]) });
        addRound(byId[t.id], {
          date, course: r[iCourse], tee: r[iTee],
          adjGross: parseGross(r[iGross]), hi: parseHi(r[iHi]),
        });
      }
      // Profile rows carry the PRE-round index; the friends-table column is the
      // current official one — push it last so the displayed handicap is today's.
      byId[t.id].hiSeries.push({ date: COMPETITION.lastUpdated, hi: parseHi(r[iHi]) });
    }
  } else {
    console.log("✗ Could not read the friends table.");
    await dumpDebug(page, "my-friends");
  }

  if (CONNECT) await browser.disconnect(); else await browser.close();

  /* ---------- build + write ---------- */
  const prev = prevState(); // read BEFORE we overwrite data.js
  const built = TARGETS.map(t => {
    const p = byId[t.id];
    let rounds = p.rounds;
    // Accumulate history for EVERYONE (de-dupe on date+course):
    //  • Friends' source (My Friends) only ever shows each friend's LATEST round.
    //  • Tom's source (My Overview) only shows a rolling window of his last ~5 rounds,
    //    so older season rounds roll off the view and would otherwise vanish from the best-6.
    // The fresh scrape stays authoritative for any round it still returns (those go into
    // `seen` first); we only re-add previously-recorded rounds that have dropped out of view.
    if (prev[t.id]?.rounds?.length) {
      const seen = new Set(rounds.map(r => roundKey(r.date, r.course)));
      for (const er of prev[t.id].rounds) {
        const k = roundKey(er.date, er.course);
        if (!seen.has(k)) { rounds.push(er); seen.add(k); }
      }
    }
    rounds = rounds.sort((a, b) => b.points - a.points); // no cap — keep every card
    const best6 = rounds.slice(0, COMPETITION.bestN).reduce((s, r) => s + r.points, 0);
    const { handicap, handicapTrend, handicapHistory } = summariseHcp(p.hiSeries);
    return { id: t.id, name: t.name, short: t.short, handicap, handicapTrend, handicapHistory, movement: null, rounds, _best6: best6 };
  });
  // SAFETY: never overwrite the board with an empty read (expired login / page change).
  // A successful scrape always returns each player's full history from the start date,
  // so zero rounds means the read failed — leave data.js untouched and exit non-zero.
  const totalRounds = built.reduce((s, p) => s + p.rounds.length, 0);
  if (totalRounds === 0) {
    console.error("\n✗ No rounds read (likely not logged in to Wales Golf, or the page changed).");
    console.error("  Leaving data.js UNCHANGED so the leaderboard isn't wiped.");
    process.exit(1);
  }
  // position movement since last update
  const ranked = [...built].sort((a, b) => b._best6 - a._best6);
  const newPos = {}; ranked.forEach((p, i) => newPos[p.id] = i + 1);
  built.forEach(p => { if (prev[p.id] != null) p.movement = prev[p.id].pos - newPos[p.id]; });
  // weekly recap + mover + lead-change confetti
  const sum = weeklySummary(built, prev);
  COMPETITION.recap = sum.recap; COMPETITION.moverId = sum.moverId; COMPETITION.celebrate = sum.celebrate;
  built.forEach(p => delete p._best6);
  const players = built;
  writeDataJs("./data.js", COMPETITION, players);

  console.log("\n──────── SUMMARY ────────");
  for (const t of TARGETS) {
    const p = byId[t.id];
    const best6 = p.rounds.slice(0, 6).reduce((s, r) => s + r.points, 0);
    console.log(`${t.name.padEnd(16)} ${p.rounds.length} round(s), best-6 = ${best6}`);
    p.skipped.forEach(s => console.log(`   ⤷ skipped ${s.date || "?"}: ${s.reason}`));
  }
  console.log("\n✓ data.js updated. Refresh the dashboard / push to publish.");

  function addRound(player, raw) {
    if (!raw.date || raw.date < COMPETITION.startDate || raw.date > COMPETITION.endDate) return;
    const res = toStableford(raw);
    if (!res.ok) { player.skipped.push({ date: raw.date, reason: res.reason }); return; }
    // de-dupe on date+course (normalised — see roundKey)
    if (player.rounds.some(r => roundKey(r.date, r.course) === roundKey(raw.date, raw.course))) return;
    const gross = raw.adjGross ?? null;
    const chcp  = res.courseHcp ?? null;
    const net   = (gross != null && chcp != null) ? gross - chcp : null;
    player.rounds.push({ date: raw.date, course: (raw.course || "").trim(), points: res.points, gross, net, chcp });
  }
})().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
