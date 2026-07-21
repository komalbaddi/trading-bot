// Optimize BTC trend on 6-HOUR bars to MINIMIZE DRAWDOWN (loss), walk-forward.
// Adds a regime filter (only long above a long EMA) to cut false entries/losses.
// Optimize on 2020..mid-2023 (IS), forward-test mid-2023..now (OOS). Alpaca crypto (free).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(fs.readFileSync(path.join(__dir, "alpaca_keys.json"), "utf8"));
const H = { "APCA-API-KEY-ID": j.keyId, "APCA-API-SECRET-KEY": j.secretKey };
const SLIP = 0.001;
const SPLIT = Date.parse("2023-07-01") / 1000;

async function fetchCrypto(tf) {
  // Binance public market-data mirror (free, no key, full history). BTCUSDT ~ BTC/USD.
  const base = "https://data-api.binance.vision/api/v3/klines";
  let start = Date.parse("2019-01-01T00:00:00Z"); const now = Date.now(); const bars = []; let guard = 0;
  while (start < now && guard++ < 100) {
    const r = await fetch(`${base}?symbol=BTCUSDT&interval=${tf}&startTime=${start}&limit=1000`);
    if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
    const k = await r.json(); if (!k.length) break;
    for (const row of k) bars.push({ t: Math.floor(row[0] / 1000), o: +row[1], h: +row[2], l: +row[3], c: +row[4] });
    start = k[k.length - 1][6] + 1;             // advance past last close time
    if (k.length < 1000) break;
  }
  return bars;
}
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atrArr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

function engine(b, atr, ef, es, el, cfg, from, to) {
  let cash = 10000, inPos = false, entryPx = 0, stop = 0, hi = 0, peak = 10000, maxDD = 0, startPx = null, startT = null, endIdx = 0, n = 0, wins = 0;
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (startPx == null) { startPx = b[i].c; startT = b[i].t; } endIdx = i;
    if (inPos) {
      hi = Math.max(hi, b[i].h); stop = Math.max(stop, hi - atr[i] * cfg.trail);
      let ex = null;
      if (b[i].l <= stop) ex = stop; else if (ef[i] < es[i]) ex = b[i].c;
      if (ex != null) { const r = (ex * (1 - SLIP)) / (entryPx * (1 + SLIP)); cash *= r; n++; if (r > 1) wins++; inPos = false; }
    }
    const regimeOK = !cfg.useRegime || (el[i] != null && b[i].c > el[i]);
    if (!inPos && atr[i] > 0 && ef[i] > es[i] && ef[i - 1] <= es[i - 1] && regimeOK) { inPos = true; entryPx = b[i].c; stop = b[i].c - atr[i] * cfg.init; hi = b[i].h; }
    const mark = inPos ? cash * (b[i].c / (entryPx * (1 + SLIP))) : cash;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak * 100);
  }
  let eq = cash; if (inPos) eq = cash * (b[endIdx].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  const yrs = (b[endIdx].t - startT) / (365.25 * 86400);
  return { net: (eq / 10000 - 1) * 100, cagr: (Math.pow(Math.max(eq, 1) / 10000, 1 / yrs) - 1) * 100, n, win: n ? wins / n * 100 : 0, maxDD };
}

(async () => {
  const b = await fetchCrypto("6h"); if (!b.length) { console.log("no data"); return; }
  const c = b.map(x => x.c), atr = atrArr(b);
  console.log(`BTC/USD 6h: ${b.length} bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)}`);
  console.log("Optimizing to MINIMIZE drawdown (ranked by return/drawdown). IS 2020..mid-2023 | OOS after\n");
  const emaCache = {}; const E = n => (emaCache[n] ||= ema(c, n));

  const grid = [];
  for (const f of [10, 20, 30]) for (const s of [50, 100]) for (const trail of [3, 5, 7]) for (const useRegime of [false, true]) for (const rl of [200]) grid.push({ f, s, trail, init: 3, useRegime, rl });

  const scored = grid.map(g => {
    const is = engine(b, atr, E(g.f), E(g.s), E(g.rl), g, 0, SPLIT);
    return { g, is, score: is.net > 0 ? is.net / (is.maxDD || 1) : -1 };
  }).filter(x => x.is.n >= 5).sort((a, x) => x.score - a.score);

  console.log("f/s trail regime | IS: net%  maxDD% ret/DD trades win% | OOS: net%  maxDD% trades win%");
  for (const r of scored.slice(0, 10)) {
    const g = r.g, oos = engine(b, atr, E(g.f), E(g.s), E(g.rl), g, SPLIT, 9e18);
    console.log(`${g.f}/${g.s} tr${g.trail} ${g.useRegime ? "reg" : "---"} | ${r.is.net.toFixed(0).padStart(6)} ${r.is.maxDD.toFixed(0).padStart(5)} ${(r.is.net / r.is.maxDD).toFixed(2).padStart(5)} ${String(r.is.n).padStart(4)} ${r.is.win.toFixed(0).padStart(3)} | ${oos.net.toFixed(0).padStart(6)} ${oos.maxDD.toFixed(0).padStart(5)} ${String(oos.n).padStart(4)} ${oos.win.toFixed(0).padStart(3)}`);
  }
  const best = scored[0].g, bo = engine(b, atr, E(best.f), E(best.s), E(best.rl), best, SPLIT, 9e18);
  console.log(`\nLOWEST-LOSS ROBUST config: EMA ${best.f}/${best.s}, trail ${best.trail}xATR, regime-filter ${best.useRegime ? "ON (>"+best.rl+"EMA)" : "off"}`);
  console.log(`  OOS: +${bo.net.toFixed(0)}%, maxDD ${bo.maxDD.toFixed(0)}%, ${bo.n} trades, ${bo.win.toFixed(0)}% win`);
})();
