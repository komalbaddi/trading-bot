// Does the overnight GAP (open vs prev close) predict the FIRST 1-2 HOURS of the session?
// 6 years of Alpaca 5-min RTH data, walk-forward IS/OOS. Decisive sample size.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(fs.readFileSync(path.join(__dir, "alpaca_keys.json"), "utf8"));
const H = { "APCA-API-KEY-ID": j.keyId, "APCA-API-SECRET-KEY": j.secretKey };
const FEED = j.feed || "iex";
const SYMBOL = process.argv[2] || "AAPL";

async function fetchBars() {
  const bars = []; let token = null, pages = 0;
  do {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars`);
    u.searchParams.set("timeframe", "5Min"); u.searchParams.set("start", "2019-01-01T00:00:00Z");
    u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", FEED);
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    for (const b of d.bars || []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c });
    token = d.next_page_token; pages++;
  } while (token && pages < 60);
  return bars;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };

function buildDays(raw) {
  const rth = raw.filter(b => { const m = etMin(b.t); return m >= 570 && m < 960; });
  const map = new Map();
  for (const b of rth) { const d = etDate(b.t); if (!map.has(d)) map.set(d, []); map.get(d).push({ ...b, min: etMin(b.t) }); }
  const days = [...map.entries()].map(([d, bs]) => ({ d, bs: bs.sort((a, b) => a.t - b.t), t0: bs[0].t })).sort((a, b) => a.t0 - b.t0);
  const rows = [];
  for (let k = 1; k < days.length; k++) {
    const bs = days[k].bs, prev = days[k - 1].bs;
    if (bs.length < 12) continue;
    const regOpen = bs[0].o, prevClose = prev[prev.length - 1].c;
    const h1 = bs.filter(b => b.min <= 630), h2 = bs.filter(b => b.min <= 690);
    rows.push({
      t: days[k].t0,
      gap: Math.sign(regOpen - prevClose),
      firstHr: Math.sign((h1.length ? h1[h1.length - 1].c : bs[bs.length - 1].c) - regOpen),
      first2Hr: Math.sign((h2.length ? h2[h2.length - 1].c : bs[bs.length - 1].c) - regOpen),
    });
  }
  return rows;
}

function report(rows, sig, out, label) {
  const v = rows.filter(r => (r[sig] === 1 || r[sig] === -1) && r[out] !== 0);
  const up = v.filter(r => r[sig] === 1), dn = v.filter(r => r[sig] === -1);
  const upHit = up.filter(r => r[out] === 1).length, dnHit = dn.filter(r => r[out] === -1).length;
  const baseUp = v.filter(r => r[out] === 1).length / v.length * 100;
  const followAcc = (upHit + dnHit) / v.length * 100;      // follow the gap (momentum)
  const fadeAcc = 100 - followAcc;                          // fade the gap (contrarian)
  const naive = Math.max(baseUp, 100 - baseUp);
  console.log(`  ${label}  (N=${v.length})`);
  console.log(`     P(early up | gap UP)=${(upHit / up.length * 100).toFixed(1)}%  P(early down | gap DOWN)=${(dnHit / dn.length * 100).toFixed(1)}%`);
  console.log(`     FOLLOW-gap acc=${followAcc.toFixed(1)}%   FADE-gap acc=${fadeAcc.toFixed(1)}%   naive(always-common)=${naive.toFixed(1)}%`);
  console.log(`     -> best edge vs naive = ${(Math.max(followAcc, fadeAcc) - naive).toFixed(1)} pts (${followAcc > fadeAcc ? "FOLLOW" : "FADE"})`);
}

(async () => {
  const raw = await fetchBars();
  const rows = buildDays(raw);
  const mid = rows[Math.floor(rows.length * 0.6)].t;
  const IS = rows.filter(r => r.t < mid), OOS = rows.filter(r => r.t >= mid);
  console.log(`\n${SYMBOL}: ${rows.length} days | IS ${etDate(rows[0].t)}..${etDate(mid)} (${IS.length}) | OOS ..${etDate(rows[rows.length - 1].t)} (${OOS.length})`);
  for (const [name, set] of [["IN-SAMPLE", IS], ["OUT-OF-SAMPLE", OOS]]) {
    console.log(`\n===== ${name} =====`);
    report(set, "gap", "firstHr", "gap -> first HOUR (open->10:30)");
    report(set, "gap", "first2Hr", "gap -> first 2 HOURS (open->11:30)");
  }
  console.log("\nEdge must be POSITIVE in BOTH IS and OOS to be real. Anything ~0 or negative = no tradeable edge.");
})();
