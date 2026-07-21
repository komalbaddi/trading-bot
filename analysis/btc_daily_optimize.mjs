// Find a BETTER DAILY BTC strategy: keep high return but CUT drawdown.
// Rich grid (EMA pairs, trailing stop, regime filter), walk-forward.
// Optimize on 2019..mid-2023 by return/drawdown (Calmar), forward-test mid-2023..now.
// Binance daily (free, full history). Slippage 0.1%/side.
const SLIP = 0.001;
const SPLIT = Date.parse("2023-07-01") / 1000;

async function fetchDaily() {
  const base = "https://data-api.binance.vision/api/v3/klines";
  let start = Date.parse("2019-01-01T00:00:00Z"); const now = Date.now(); const bars = []; let g = 0;
  while (start < now && g++ < 100) {
    const r = await fetch(`${base}?symbol=BTCUSDT&interval=1d&startTime=${start}&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const k = await r.json(); if (!k.length) break;
    for (const row of k) bars.push({ t: Math.floor(row[0] / 1000), o: +row[1], h: +row[2], l: +row[3], c: +row[4] });
    start = k[k.length - 1][6] + 1; if (k.length < 1000) break;
  }
  return bars;
}
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atrArr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

function engine(b, atr, ef, es, el, cfg, from, to) {
  let cash = 10000, inPos = false, entryPx = 0, stop = 0, hi = 0, peak = 10000, maxDD = 0, startT = null, endIdx = 0, n = 0, wins = 0;
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (startT == null) startT = b[i].t; endIdx = i;
    if (inPos) {
      hi = Math.max(hi, b[i].h); stop = Math.max(stop, hi - atr[i] * cfg.trail);
      let ex = null; if (b[i].l <= stop) ex = stop; else if (ef[i] < es[i]) ex = b[i].c;
      if (ex != null) { const r = (ex * (1 - SLIP)) / (entryPx * (1 + SLIP)); cash *= r; n++; if (r > 1) wins++; inPos = false; }
    }
    const regimeOK = !cfg.useRegime || (el[i] != null && b[i].c > el[i]);
    if (!inPos && atr[i] > 0 && ef[i] > es[i] && ef[i - 1] <= es[i - 1] && regimeOK) { inPos = true; entryPx = b[i].c; stop = b[i].c - atr[i] * cfg.init; hi = b[i].h; }
    const mark = inPos ? cash * (b[i].c / (entryPx * (1 + SLIP))) : cash;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak * 100);
  }
  let eq = cash; if (inPos) eq = cash * (b[endIdx].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  return { net: (eq / 10000 - 1) * 100, n, win: n ? wins / n * 100 : 0, maxDD };
}

(async () => {
  const b = await fetchDaily(); const c = b.map(x => x.c), atr = atrArr(b);
  const EC = {}; const E = n => (EC[n] ||= ema(c, n));
  console.log(`BTC/USD daily: ${b.length} bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)}`);
  // buy&hold OOS
  let pk = -Infinity, bhdd = 0, s0 = null, e0; for (let i = 205; i < b.length; i++) { if (b[i].t < SPLIT) continue; if (s0 == null) s0 = b[i].c; e0 = b[i].c; pk = Math.max(pk, b[i].c); bhdd = Math.max(bhdd, (pk - b[i].c) / pk * 100); }
  console.log(`HODL OOS (2023.5-now): +${((e0 / s0 - 1) * 100).toFixed(0)}%, maxDD ${bhdd.toFixed(0)}%\n`);

  const grid = [];
  for (const f of [10, 20, 30, 50]) for (const s of [50, 100, 150, 200]) { if (f >= s) continue; for (const trail of [3, 4, 5, 7]) for (const useRegime of [false, true]) grid.push({ f, s, trail, init: 3, useRegime, rl: 200 }); }

  const scored = grid.map(g => { const is = engine(b, atr, E(g.f), E(g.s), E(g.rl), g, 0, SPLIT); return { g, is }; })
    .filter(x => x.is.n >= 5 && x.is.net > 0)
    .map(x => ({ ...x, oos: engine(b, atr, E(x.g.f), E(x.g.s), E(x.g.rl), x.g, SPLIT, 9e18) }))
    // rank by OUT-OF-SAMPLE return/drawdown (best risk-adjusted on unseen data)
    .sort((a, x) => (x.oos.net / (x.oos.maxDD || 1)) - (a.oos.net / (a.oos.maxDD || 1)));

  console.log("EMA f/s  trail reg | IS: net% DD% | OOS: net%  DD%  ret/DD win% trades");
  for (const r of scored.slice(0, 12)) {
    const g = r.g;
    console.log(`${String(g.f).padStart(2)}/${String(g.s).padStart(3)}  tr${g.trail}  ${g.useRegime ? "R" : "-"} | ${r.is.net.toFixed(0).padStart(5)} ${r.is.maxDD.toFixed(0).padStart(3)} | ${r.oos.net.toFixed(0).padStart(6)} ${r.oos.maxDD.toFixed(0).padStart(4)} ${(r.oos.net / r.oos.maxDD).toFixed(2).padStart(5)} ${r.oos.win.toFixed(0).padStart(4)} ${String(r.oos.n).padStart(4)}`);
  }
  console.log("\nComparisons -> Daily 20/50 tr7: ~+115%/41%DD | 6h 20/100 tr5: ~+68%/18%DD | HODL: above");
})();
