// Thorough 15-min BTC walk-forward: EMA-cross trend + regime filter + trailing stop.
// Optimize on IS (2021..mid-2023), forward-test OOS (mid-2023..now). Binance, fees 0.1%/side.
const SLIP = 0.001;
const SPLIT = Date.parse("2023-07-01") / 1000;

async function fetchBinance(interval, sinceISO) {
  const base = "https://data-api.binance.vision/api/v3/klines";
  let start = Date.parse(sinceISO); const now = Date.now(); const bars = []; let g = 0;
  while (start < now && g++ < 400) {
    const r = await fetch(`${base}?symbol=BTCUSDT&interval=${interval}&startTime=${start}&limit=1000`);
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
  let cash = 10000, inPos = false, entryPx = 0, stop = 0, hi = 0, peak = 10000, maxDD = 0, sT = null, ei = 0, n = 0, wins = 0;
  for (let i = 305; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (sT == null) sT = b[i].t; ei = i;
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
  let eq = cash; if (inPos) eq = cash * (b[ei].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  return { net: (eq / 10000 - 1) * 100, n, win: n ? wins / n * 100 : 0, maxDD };
}

(async () => {
  const b = await fetchBinance("15m", "2021-01-01T00:00:00Z");
  const c = b.map(x => x.c), atr = atrArr(b), EC = {}, E = n => (EC[n] ||= ema(c, n));
  console.log(`BTC 15m: ${b.length} bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)}\n`);
  const grid = [];
  for (const f of [20, 50, 100]) for (const s of [100, 200, 400]) { if (f >= s) continue; for (const trail of [3, 5, 8]) for (const useRegime of [false, true]) grid.push({ f, s, trail, init: 3, useRegime, rl: 400 }); }
  const scored = grid.map(g => ({ g, is: engine(b, atr, E(g.f), E(g.s), E(g.rl), g, 0, SPLIT) })).filter(x => x.is.n >= 10)
    .sort((a, x) => (x.is.net / (x.is.maxDD || 1)) - (a.is.net / (a.is.maxDD || 1)));
  console.log("f/s trail reg | IS: net% DD% n | OOS: net% DD% n win% | OK?");
  for (const r of scored.slice(0, 12)) {
    const g = r.g, o = engine(b, atr, E(g.f), E(g.s), E(g.rl), g, SPLIT, 9e18);
    const ok = o.net > 0 && o.n >= 10;
    console.log(`${String(g.f).padStart(3)}/${String(g.s).padStart(3)} tr${g.trail} ${g.useRegime ? "R" : "-"} | ${r.is.net.toFixed(0).padStart(5)} ${r.is.maxDD.toFixed(0).padStart(3)} ${String(r.is.n).padStart(4)} | ${o.net.toFixed(0).padStart(5)} ${o.maxDD.toFixed(0).padStart(3)} ${String(o.n).padStart(4)} ${o.win.toFixed(0).padStart(3)} | ${ok ? "✅" : "❌"}`);
  }
  const anyOK = scored.some(r => { const o = engine(b, atr, E(r.g.f), E(r.g.s), E(r.g.rl), r.g, SPLIT, 9e18); return o.net > 0 && o.n >= 10; });
  console.log(`\nVerdict: ${anyOK ? "at least one 15m config is positive OOS" : "NO 15m config is positive out-of-sample — 15m day-trading has no edge."}`);
})();
