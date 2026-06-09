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
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { parseHi, parseGross, toStableford, writeDataJs } from "./lib.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "./.chrome-profile";
const DEBUG = process.argv.includes("--debug");

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

const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); res(a); });
});

/* Find the table whose header row contains ALL of `must` (case-insensitive). */
async function extractTable(page, must) {
  return page.evaluate((must) => {
    const norm = s => s.replace(/\s+/g, " ").trim();
    for (const t of document.querySelectorAll("table")) {
      const head = [...t.querySelectorAll("thead th, thead td")].map(c => norm(c.innerText).toLowerCase());
      const headers = head.length ? head : [...t.querySelectorAll("tr")][0]
        ? [...[...t.querySelectorAll("tr")][0].children].map(c => norm(c.innerText).toLowerCase()) : [];
      if (headers.length && must.every(m => headers.some(h => h.includes(m)))) {
        const rows = [...t.querySelectorAll("tbody tr")].map(tr =>
          [...tr.querySelectorAll("td, th")].map(td => norm(td.innerText)));
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
      best6: [...p.rounds].sort((a, b) => b.points - a.points).slice(0, data.competition.bestN)
        .reduce((s, r) => s + r.points, 0),
    })).sort((a, b) => b.best6 - a.best6);
    const out = {}; ps.forEach((p, i) => out[p.id] = { pos: i + 1, best6: p.best6 });
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
  console.log("→ Launching Chrome (its own window)…");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: PROFILE,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());

  // ---- ensure logged in ----
  await page.goto("https://www.walesgolf.org/my-overview", { waitUntil: "networkidle2", timeout: 60000 });
  let scores = await extractTable(page, ["adj", "course rating", "slope"]);
  if (!scores) {
    console.log("\n⚠  Not logged in (or scores not visible yet).");
    console.log("   Log in to Wales Golf in the Chrome window that just opened,");
    console.log("   make sure you can see YOUR scores on My Overview, then…");
    await ask("   press ENTER here to continue ▸ ");
    await page.goto("https://www.walesgolf.org/my-overview", { waitUntil: "networkidle2", timeout: 60000 });
    scores = await extractTable(page, ["adj", "course rating", "slope"]);
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
  } else {
    console.log("✗ Could not read your scores table.");
    await dumpDebug(page, "my-overview");
  }

  /* ---------- Josh + Callum from My Friends ---------- */
  await page.goto("https://www.walesgolf.org/my-friends", { waitUntil: "networkidle2", timeout: 60000 });
  const friends = await extractTable(page, ["name", "adj", "handicap"]);
  if (friends) {
    const H = friends.headers;
    const iName = colIndex(H, "name"), iDate = colIndex(H, "date"),
          iCourse = colIndex(H, "played at"), iTee = colIndex(H, "marker"),
          iGross = colIndex(H, "adj"), iHi = colIndex(H, "handicap");
    for (const r of friends.rows) {
      const name = (r[iName] || "").toLowerCase();
      const t = TARGETS.find(t => t.source === "friend" && name.includes(t.match));
      if (!t) continue;
      const date = toISO(r[iDate]);
      byId[t.id].hiSeries.push({ date, hi: parseHi(r[iHi]) });
      addRound(byId[t.id], {
        date, course: r[iCourse], tee: r[iTee],
        adjGross: parseGross(r[iGross]), hi: parseHi(r[iHi]),
      });
    }
  } else {
    console.log("✗ Could not read the friends table.");
    await dumpDebug(page, "my-friends");
  }

  await browser.close();

  /* ---------- build + write ---------- */
  const prev = prevState(); // read BEFORE we overwrite data.js
  const built = TARGETS.map(t => {
    const p = byId[t.id];
    const rounds = p.rounds.sort((a, b) => b.points - a.points); // no cap — keep every card
    const best6 = rounds.slice(0, COMPETITION.bestN).reduce((s, r) => s + r.points, 0);
    const { handicap, handicapTrend, handicapHistory } = summariseHcp(p.hiSeries);
    return { id: t.id, name: t.name, short: t.short, handicap, handicapTrend, handicapHistory, movement: null, rounds, _best6: best6 };
  });
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
    // de-dupe on date+course
    if (player.rounds.some(r => r.date === raw.date && r.course === raw.course)) return;
    const gross = raw.adjGross ?? null;
    const chcp  = res.courseHcp ?? null;
    const net   = (gross != null && chcp != null) ? gross - chcp : null;
    player.rounds.push({ date: raw.date, course: (raw.course || "").trim(), points: res.points, gross, net, chcp });
  }
})().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
