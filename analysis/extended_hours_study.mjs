// Does the PRE-MARKET (extended hours) direction predict the regular session?
// Tests several signal definitions on real AAPL data incl. pre/post market (Yahoo).
// Reports conditional probabilities + sample sizes, and compares to the naive base rate.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchYahoo(interval, range) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}&includePrePost=true`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };

function groupDays(bars) {
  const days = new Map();
  for (const b of bars) { const d = etDate(b.t); if (!days.has(d)) days.set(d, []); days.get(d).push({ ...b, min: etMin(b.t) }); }
  return [...days.entries()].map(([d, bs]) => ({ d, bs: bs.sort((a, b) => a.t - b.t) })).sort((a, b) => a.bs[0].t - b.bs[0].t);
}

function analyze(days) {
  // build per-day features
  const rows = [];
  for (let k = 1; k < days.length; k++) {
    const { bs } = days[k];
    const pre = bs.filter(b => b.min < 570);              // pre-market (before 9:30)
    const reg = bs.filter(b => b.min >= 570 && b.min < 960);
    const prevReg = days[k - 1].bs.filter(b => b.min >= 570 && b.min < 960);
    if (reg.length < 5 || prevReg.length < 1) continue;
    const regOpen = reg[0].o, regClose = reg[reg.length - 1].c, prevClose = prevReg[prevReg.length - 1].c;

    // signal 1: first hour of pre-market (first premarket bar -> +60min)
    let preFirstHr = null;
    if (pre.length >= 2) {
      const start = pre[0].t, win = pre.filter(b => b.t <= start + 3600);
      if (win.length >= 2) preFirstHr = Math.sign(win[win.length - 1].c - win[0].o);
    }
    // signal 2: overnight gap (regular open vs prev regular close) — very robust data
    const gap = Math.sign(regOpen - prevClose);
    // signal 3: full pre-market net (last pre bar vs prev close)
    const preNet = pre.length ? Math.sign(pre[pre.length - 1].c - prevClose) : null;

    // OUTCOME windows: just the first 1 and 2 hours of the regular session
    const h1 = reg.filter(b => b.min <= 630), h2 = reg.filter(b => b.min <= 690);  // 10:30, 11:30
    const h1c = h1.length ? h1[h1.length - 1].c : regClose;
    const h2c = h2.length ? h2[h2.length - 1].c : regClose;
    rows.push({
      preFirstHr, gap, preNet,
      firstHr: Math.sign(h1c - regOpen),      // did the FIRST HOUR (open->10:30) go up?
      first2Hr: Math.sign(h2c - regOpen),     // did the FIRST 2 HOURS (open->11:30) go up?
    });
  }
  return rows;
}

function prob(rows, sigKey, outKey, label) {
  const valid = rows.filter(r => r[sigKey] === 1 || r[sigKey] === -1);
  const up = valid.filter(r => r[sigKey] === 1), dn = valid.filter(r => r[sigKey] === -1);
  const upHit = up.filter(r => r[outKey] === 1).length, dnHit = dn.filter(r => r[outKey] === -1).length;
  const baseUp = valid.filter(r => r[outKey] === 1).length / valid.length * 100;
  const acc = (upHit + dnHit) / valid.length * 100;
  console.log(`  ${label}`);
  console.log(`     N=${valid.length} | P(up outcome | signal UP)=${up.length ? (upHit / up.length * 100).toFixed(1) : "-"}% (n=${up.length}) | P(down | signal DOWN)=${dn.length ? (dnHit / dn.length * 100).toFixed(1) : "-"}% (n=${dn.length})`);
  console.log(`     Directional accuracy=${acc.toFixed(1)}%  vs base rate (always-up)=${Math.max(baseUp, 100 - baseUp).toFixed(1)}%  -> edge=${(acc - Math.max(baseUp, 100 - baseUp)).toFixed(1)} pts`);
}

(async () => {
  const bars = await fetchYahoo("5m", "60d");
  if (!bars) { console.log("no data"); return; }
  const days = groupDays(bars);
  const withPre = days.filter(d => d.bs.some(b => b.min < 570)).length;
  console.log(`\n${SYMBOL}: ${days.length} days, ${withPre} have pre-market bars (Yahoo 5m, 60d incl. pre/post)\n`);
  const rows = analyze(days);
  console.log(`Analyzable days: ${rows.length}\n`);

  console.log("=== SIGNAL: first 1hr of pre-market -> predicts EARLY SESSION ===");
  prob(rows, "preFirstHr", "firstHr", "outcome = first HOUR (open->10:30)");
  prob(rows, "preFirstHr", "first2Hr", "outcome = first 2 HOURS (open->11:30)");
  console.log("\n=== SIGNAL: overnight gap (open vs prev close) -> predicts EARLY SESSION ===");
  prob(rows, "gap", "firstHr", "outcome = first HOUR (open->10:30)");
  prob(rows, "gap", "first2Hr", "outcome = first 2 HOURS (open->11:30)");
  console.log("\n=== SIGNAL: full pre-market net (vs prev close) -> predicts EARLY SESSION ===");
  prob(rows, "preNet", "firstHr", "outcome = first HOUR (open->10:30)");
  prob(rows, "preNet", "first2Hr", "outcome = first 2 HOURS (open->11:30)");
  console.log("\nNOTE: 'edge' > 0 means the signal beats simply always guessing the more-common direction.");
  console.log("Small sample (60 days). Indicative only — positive hints need a bigger sample + out-of-sample test.");
})();
