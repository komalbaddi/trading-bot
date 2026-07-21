// Does adding a STOCH RSI confirmation improve the RSI-2 daily dip? Test it, don't assume.
// Base: RSI(2)<10 in uptrend, exit 1st green close (max 2d). Filters: Stoch RSI variants.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchDaily() {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) { if (v[k] == null) return null; s += v[k]; } return s / p; }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
function smaSeries(v, p) { const o = Array(v.length).fill(null); for (let i = 0; i < v.length; i++) o[i] = sma(v, p, i); return o; }
function stochRSI(c, rsiLen = 14, stochLen = 14, kS = 3, dS = 3) {
  const rsi = rsiW(c, rsiLen), st = Array(c.length).fill(null);
  for (let i = stochLen; i < c.length; i++) {
    let mn = Infinity, mx = -Infinity, ok = true;
    for (let k = i - stochLen + 1; k <= i; k++) { if (rsi[k] == null) { ok = false; break; } mn = Math.min(mn, rsi[k]); mx = Math.max(mx, rsi[k]); }
    if (ok) st[i] = mx > mn ? (rsi[i] - mn) / (mx - mn) * 100 : 0;
  }
  const k = smaSeries(st, kS), d = smaSeries(k, dS);
  return { k, d };
}
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);

function backtest(bars, filterFn, from, to) {
  const c = bars.map(b => b.c), r2 = rsiW(c, 2), { k, d } = stochRSI(c);
  const trades = [];
  let i = 200;
  while (i < bars.length - 2) {
    if (bars[i].t < from || bars[i].t > to) { i++; continue; }
    const s200 = sma(c, 200, i);
    const base = s200 && c[i] > s200 && r2[i] != null && r2[i] < 10;
    if (base && filterFn(k, d, i)) {
      const e = i + 1, entry = bars[e].o; let j = e, px = null, hold = 0;
      while (j < bars.length - 1) { hold = j - e + 1; if (bars[j].c > bars[j].o || hold >= 2) { px = bars[j].c; break; } j++; }
      if (px == null) px = c[bars.length - 1];
      trades.push({ ret: (px / entry - 1) * 100, hold }); i = j + 1;
    } else i++;
  }
  const w = trades.filter(t => t.ret > 0), gW = w.reduce((a, t) => a + t.ret, 0), gL = -trades.filter(t => t.ret < 0).reduce((a, t) => a + t.ret, 0);
  return { n: trades.length, win: trades.length ? w.length / trades.length * 100 : 0, avg: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0, pf: gL ? gW / gL : 9 };
}

(async () => {
  const bars = await fetchDaily(); if (!bars) { console.log("no data"); return; }
  const mid = bars[Math.floor(bars.length * 0.6)].t;
  console.log(`\n${SYMBOL}: ${bars.length} bars | IS..${dstr(mid)} | OOS after | exit=1st green (max 2d)\n`);
  const filters = [
    { label: "BASE: RSI2<10 only (no Stoch filter)", fn: () => true },
    { label: "+ Stoch %K < 20 (also oversold)", fn: (k, d, i) => k[i] != null && k[i] < 20 },
    { label: "+ Stoch %K > %D (turning up)", fn: (k, d, i) => k[i] != null && d[i] != null && k[i] > d[i] },
    { label: "+ Stoch %K crossed up %D (fresh turn)", fn: (k, d, i) => k[i] != null && d[i] != null && k[i] > d[i] && k[i - 1] <= d[i - 1] },
    { label: "+ Stoch %K < 20 AND turning up", fn: (k, d, i) => k[i] != null && d[i] != null && k[i] < 30 && k[i] > d[i] },
  ];
  console.log("filter                                    |  IS: n  win%  avg%  PF  | OOS: n  win%  avg%  PF");
  for (const f of filters) {
    const is = backtest(bars, f.fn, 0, mid), o = backtest(bars, f.fn, mid, 9e18);
    console.log(`${f.label.padEnd(42)} | ${String(is.n).padStart(3)} ${is.win.toFixed(0).padStart(4)} ${is.avg.toFixed(2).padStart(5)} ${is.pf.toFixed(2)} | ${String(o.n).padStart(3)} ${o.win.toFixed(0).padStart(4)} ${o.avg.toFixed(2).padStart(5)} ${o.pf.toFixed(2)}`);
  }
  console.log("\nKey question: does the Stoch filter RAISE win%/PF enough to justify FEWER trades? Or just shrink the sample?");
})();
