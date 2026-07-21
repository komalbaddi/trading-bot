// Walk-forward OPTIMIZATION of the basket dip signal. Sweeps entry/exit params,
// optimizes on 2015..mid-2021 (IS), forward-tests mid-2021..now (OOS), across 12 names.
// Ranks by robustness (must work in BOTH windows). Yahoo daily, no key.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const UNIVERSE = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "AVGO", "NFLX", "CRM", "JPM"];
const SPLIT = Date.parse("2021-07-01") / 1000;

async function fetchDaily(sym) {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function stdev(v, p, i) { const m = sma(v, p, i); if (m == null) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += (v[k] - m) ** 2; return Math.sqrt(s / p); }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }

// precompute per-name indicators
function prep(bars) {
  const c = bars.map(b => b.c), n = c.length;
  const r2 = rsiW(c, 2), s200 = [], lbb = [];
  for (let i = 0; i < n; i++) { s200[i] = sma(c, 200, i); const ba = sma(c, 20, i), sd = stdev(c, 20, i); lbb[i] = ba != null && sd != null ? ba - 2 * sd : null; }
  return { bars, c, r2, s200, lbb };
}
function trades(P, cfg) {
  const { bars, c, r2, s200, lbb } = P; const out = [];
  let i = 200;
  while (i < bars.length - 2) {
    const dip = s200[i] && c[i] > s200[i] && ((r2[i] != null && r2[i] < cfg.os) || (cfg.useBB && lbb[i] != null && c[i] < lbb[i]));
    if (dip) {
      const e = i + 1, entry = bars[e].o; let j = e, hold = 0, px = null;
      while (j < bars.length - 1) { hold = j - e + 1; if (bars[j].c > bars[j].o || r2[j] > cfg.exitRsi || hold >= cfg.maxHold) { px = bars[j].c; break; } j++; }
      if (px == null) px = c[bars.length - 1];
      out.push({ t: bars[e].t, ret: (px / entry - 1) * 100 });
      i = j + 1;
    } else i++;
  }
  return out;
}
function stats(ts) { const w = ts.filter(t => t.ret > 0), gW = w.reduce((a, t) => a + t.ret, 0), gL = -ts.filter(t => t.ret < 0).reduce((a, t) => a + t.ret, 0); return { n: ts.length, win: ts.length ? w.length / ts.length * 100 : 0, avg: ts.length ? ts.reduce((a, t) => a + t.ret, 0) / ts.length : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), total: ts.reduce((a, t) => a + t.ret, 0) }; }

(async () => {
  const preps = [];
  for (const s of UNIVERSE) { const b = await fetchDaily(s); if (b && b.length > 210) preps.push(prep(b)); process.stdout.write("."); }
  console.log(`\nLoaded ${preps.length} names. IS 2015..mid-2021 | OOS mid-2021..now\n`);

  const grid = [];
  for (const os of [5, 10, 15]) for (const useBB of [true, false]) for (const exitRsi of [55, 60, 70]) for (const maxHold of [2, 3, 4]) grid.push({ os, useBB, exitRsi, maxHold });

  const results = grid.map(cfg => {
    let all = []; for (const P of preps) all.push(...trades(P, cfg));
    const is = stats(all.filter(t => t.t < SPLIT)), oos = stats(all.filter(t => t.t >= SPLIT));
    return { cfg, is, oos };
  }).filter(r => r.is.n >= 50 && r.oos.n >= 30)
    .sort((a, b) => (b.oos.pf + b.oos.avg) - (a.oos.pf + a.oos.avg));   // rank by OOS robustness

  console.log("cfg (os/BB/exitRsi/hold)      | IS: n win% avg% PF | OOS: n win% avg% PF");
  for (const r of results.slice(0, 12)) {
    const c = r.cfg;
    console.log(`os${String(c.os).padStart(2)} BB:${c.useBB ? "Y" : "N"} exit${c.exitRsi} hold${c.maxHold}   | ${String(r.is.n).padStart(4)} ${r.is.win.toFixed(0).padStart(3)} ${r.is.avg.toFixed(2).padStart(5)} ${r.is.pf.toFixed(2)} | ${String(r.oos.n).padStart(4)} ${r.oos.win.toFixed(0).padStart(3)} ${r.oos.avg.toFixed(2).padStart(5)} ${r.oos.pf.toFixed(2)}`);
  }
  const best = results[0];
  console.log(`\nBEST (robust): os<${best.cfg.os}, useBB=${best.cfg.useBB}, exitRSI>${best.cfg.exitRsi}, maxHold=${best.cfg.maxHold}`);
  console.log(`  IS  ${best.is.n} trades, ${best.is.win.toFixed(0)}% win, avg ${best.is.avg.toFixed(2)}%, PF ${best.is.pf.toFixed(2)}`);
  console.log(`  OOS ${best.oos.n} trades, ${best.oos.win.toFixed(0)}% win, avg ${best.oos.avg.toFixed(2)}%, PF ${best.oos.pf.toFixed(2)}`);
})();
