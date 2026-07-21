// Gap -> early-session test using Yahoo 1-HOUR bars (~2 years, no API key).
// Signal = overnight gap (1st-hour open vs prev day's last-hour close).
// Outcome = direction of the 1st hour, and first 2 hours. Walk-forward IS/OOS.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchYahoo() {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=1h&range=730d&includePrePost=false`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });

function buildDays(bars) {
  const map = new Map();
  for (const b of bars) { const d = etDate(b.t); if (!map.has(d)) map.set(d, []); map.get(d).push(b); }
  const days = [...map.entries()].map(([d, bs]) => ({ d, bs: bs.sort((a, b) => a.t - b.t), t0: bs[0].t })).sort((a, b) => a.t0 - b.t0);
  const rows = [];
  for (let k = 1; k < days.length; k++) {
    const bs = days[k].bs, prev = days[k - 1].bs;
    if (bs.length < 2) continue;
    const gap = Math.sign(bs[0].o - prev[prev.length - 1].c);
    const firstHr = Math.sign(bs[0].c - bs[0].o);                 // 1st hour candle
    const first2Hr = Math.sign(bs[Math.min(1, bs.length - 1)].c - bs[0].o);  // through 2nd hour
    rows.push({ t: days[k].t0, gap, firstHr, first2Hr });
  }
  return rows;
}

function report(rows, out, label) {
  const v = rows.filter(r => (r.gap === 1 || r.gap === -1) && r[out] !== 0);
  const up = v.filter(r => r.gap === 1), dn = v.filter(r => r.gap === -1);
  const upHit = up.filter(r => r[out] === 1).length, dnHit = dn.filter(r => r[out] === -1).length;
  const baseUp = v.filter(r => r[out] === 1).length / v.length * 100;
  const follow = (upHit + dnHit) / v.length * 100, fade = 100 - follow, naive = Math.max(baseUp, 100 - baseUp);
  console.log(`  ${label} (N=${v.length})`);
  console.log(`     P(up | gap UP)=${(upHit / up.length * 100).toFixed(1)}%  P(down | gap DOWN)=${(dnHit / dn.length * 100).toFixed(1)}%  | base(up)=${baseUp.toFixed(1)}%`);
  console.log(`     FOLLOW=${follow.toFixed(1)}%  FADE=${fade.toFixed(1)}%  naive=${naive.toFixed(1)}%  -> edge=${(Math.max(follow, fade) - naive).toFixed(1)} pts (${follow > fade ? "FOLLOW" : "FADE"})`);
}

(async () => {
  const bars = await fetchYahoo(); if (!bars) { console.log("no data"); return; }
  const rows = buildDays(bars);
  const mid = rows[Math.floor(rows.length * 0.6)].t;
  const IS = rows.filter(r => r.t < mid), OOS = rows.filter(r => r.t >= mid);
  console.log(`\n${SYMBOL}: ${rows.length} days (Yahoo 1h, ~2yr) | IS=${IS.length} OOS=${OOS.length}`);
  for (const [name, set] of [["IN-SAMPLE", IS], ["OUT-OF-SAMPLE", OOS]]) {
    console.log(`\n===== ${name} =====`);
    report(set, "firstHr", "gap -> 1st hour");
    report(set, "first2Hr", "gap -> first 2 hours");
  }
  console.log("\nReal edge = POSITIVE in BOTH IS and OOS, same direction (FOLLOW or FADE).");
})();
