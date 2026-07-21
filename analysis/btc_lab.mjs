// BTC/USD strategy lab. Tests trend, breakout, mean-reversion with walk-forward.
// Optimize on 2016..mid-2021 (IS), forward-test mid-2021..now (OOS). vs buy & hold.
// Crypto trades 24/7 (daily bars, 365/yr). Yahoo BTC-USD, no key. Slippage 0.1%/side.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const SLIP = 0.001;  // 0.1% per side (crypto spread/fees)
const SPLIT = Date.parse("2021-07-01") / 1000;

async function fetchDaily() {
  const p1 = Math.floor(Date.parse("2016-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/BTC-USD?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
function atrArr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }
const hh = (b, i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, b[k].h); return m; };

function engine(b, atr, cfg, from, to) {
  let cash = 10000, inPos = false, entryPx = 0, stop = 0, hi = 0, peak = 10000, maxDD = 0, startPx = null, startT = null, endIdx = 0, n = 0, wins = 0;
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (startPx == null) { startPx = b[i].c; startT = b[i].t; } endIdx = i;
    if (inPos) {
      hi = Math.max(hi, b[i].h); if (cfg.trailMult > 0) stop = Math.max(stop, hi - atr[i] * cfg.trailMult);
      let ex = null;
      if (b[i].l <= stop) ex = stop; else if (cfg.exit(i)) ex = b[i].c;
      if (ex != null) { const r = (ex * (1 - SLIP)) / (entryPx * (1 + SLIP)); cash *= r; n++; if (r > 1) wins++; inPos = false; }
    }
    if (!inPos && cfg.entry(i) && atr[i] > 0) { inPos = true; entryPx = b[i].c; stop = b[i].c - atr[i] * cfg.initMult; hi = b[i].h; }
    const mark = inPos ? cash * (b[i].c / (entryPx * (1 + SLIP))) : cash;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak * 100);
  }
  let eq = cash; if (inPos) eq = cash * (b[endIdx].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  const yrs = (b[endIdx].t - startT) / (365.25 * 86400);
  const bhMaxDD = (() => { let pk = -Infinity, dd = 0; for (let i = 205; i < b.length; i++) { if (b[i].t < from || b[i].t > to) continue; pk = Math.max(pk, b[i].c); dd = Math.max(dd, (pk - b[i].c) / pk * 100); } return dd; })();
  return { net: (eq / 10000 - 1) * 100, cagr: (Math.pow(eq / 10000, 1 / yrs) - 1) * 100, n, win: n ? wins / n * 100 : 0, maxDD, bh: (b[endIdx].c / startPx - 1) * 100, bhCagr: (Math.pow(b[endIdx].c / startPx, 1 / yrs) - 1) * 100, bhMaxDD };
}

(async () => {
  const b = await fetchDaily(); if (!b) { console.log("no data"); return; }
  const c = b.map(x => x.c), atr = atrArr(b);
  const eF = {}, e = n => (eF[n] ||= ema(c, n));
  const rsi14 = rsiW(c, 14);
  console.log(`\nBTC-USD: ${b.length} daily bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)}`);
  const bhRow = engine(b, atr, { entry: () => false, exit: () => false, trailMult: 0, initMult: 99 }, 0, 9e18);
  console.log(`BUY & HOLD (full): +${bhRow.bh.toFixed(0)}%  CAGR ${bhRow.bhCagr.toFixed(0)}%/yr  maxDD ${bhRow.bhMaxDD.toFixed(0)}%  <-- the benchmark (brutal drawdown)\n`);

  const arch = {
    "Trend EMA cross": () => { const o = []; for (const [f, s] of [[20, 50], [20, 100], [50, 100]]) for (const tr of [3, 5, 7]) { const ef = e(f), es = e(s); o.push({ p: `${f}/${s} tr${tr}`, cfg: { entry: i => ef[i] > es[i] && ef[i - 1] <= es[i - 1], exit: i => ef[i] < es[i], trailMult: tr, initMult: 3 } }); } return o; },
    "Donchian breakout": () => { const o = []; for (const look of [20, 50, 100]) for (const tr of [3, 5, 7]) o.push({ p: `${look}d tr${tr}`, cfg: { entry: i => c[i] > hh(b, i, look), exit: () => false, trailMult: tr, initMult: 3 } }); return o; },
    "RSI mean-reversion": () => { const o = []; for (const os of [30, 40]) for (const im of [2, 3]) o.push({ p: `os${os} init${im}`, cfg: { entry: i => c[i] > e(200)[i] && rsi14[i] < os, exit: i => rsi14[i] > 55, trailMult: 0, initMult: im } }); return o; },
  };
  for (const [name, gen] of Object.entries(arch)) {
    const grid = gen();
    const scored = grid.map(g => ({ g, is: engine(b, atr, g.cfg, 0, SPLIT) })).filter(x => x.is.n >= 5)
      .sort((a, x) => (x.is.cagr / (x.is.maxDD || 1)) - (a.is.cagr / (a.is.maxDD || 1)));
    if (!scored.length) { console.log(`### ${name}: no valid config\n`); continue; }
    const best = scored[0], oos = engine(b, atr, best.g.cfg, SPLIT, 9e18);
    console.log(`### ${name}  (best IS params: ${best.g.p})`);
    console.log(`   IN  2016-21: +${best.is.net.toFixed(0)}%  CAGR ${best.is.cagr.toFixed(0)}%  maxDD ${best.is.maxDD.toFixed(0)}%  trades ${best.is.n}  win ${best.is.win.toFixed(0)}%`);
    console.log(`   OOS 2021-26: ${oos.net >= 0 ? "+" : ""}${oos.net.toFixed(0)}%  CAGR ${oos.cagr.toFixed(0)}%  maxDD ${oos.maxDD.toFixed(0)}%  trades ${oos.n}  win ${oos.win.toFixed(0)}%  | (HODL same window: +${oos.bh.toFixed(0)}%, maxDD ${oos.bhMaxDD.toFixed(0)}%)`);
    console.log("");
  }
})();
