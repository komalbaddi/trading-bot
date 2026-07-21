// Can you DAY-TRADE BTC? Test intraday strategies (1h & 15m) with walk-forward + fees.
// Trend, breakout, mean-reversion. Optimize 2019/21..mid-2023, forward-test mid-2023..now.
// Binance (free, full history). Fees 0.1%/side (crypto day-trading pays this a LOT).
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
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
function atrArr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }
const hh = (b, i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, b[k].h); return m; };

function engine(b, atr, cfg, from, to) {
  let cash = 10000, inPos = false, entryPx = 0, stop = 0, hi = 0, peak = 10000, maxDD = 0, sT = null, ei = 0, n = 0, wins = 0;
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (sT == null) sT = b[i].t; ei = i;
    if (inPos) {
      hi = Math.max(hi, b[i].h); if (cfg.trail) stop = Math.max(stop, hi - atr[i] * cfg.trail);
      let ex = null; if (b[i].l <= stop) ex = stop; else if (cfg.exit(i)) ex = b[i].c;
      if (ex != null) { const r = (ex * (1 - SLIP)) / (entryPx * (1 + SLIP)); cash *= r; n++; if (r > 1) wins++; inPos = false; }
    }
    if (!inPos && atr[i] > 0 && cfg.entry(i)) { inPos = true; entryPx = b[i].c; stop = b[i].c - atr[i] * cfg.init; hi = b[i].h; }
    const mark = inPos ? cash * (b[i].c / (entryPx * (1 + SLIP))) : cash;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak * 100);
  }
  let eq = cash; if (inPos) eq = cash * (b[ei].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  return { net: (eq / 10000 - 1) * 100, n, win: n ? wins / n * 100 : 0, maxDD };
}

async function testTF(interval, sinceISO) {
  const b = await fetchBinance(interval, sinceISO);
  const c = b.map(x => x.c), atr = atrArr(b), EC = {}, E = n => (EC[n] ||= ema(c, n)), r14 = rsiW(c, 14);
  console.log(`\n===== BTC ${interval}: ${b.length} bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)} =====`);
  const arch = {
    "Trend EMA": () => { const o = []; for (const [f, s] of [[20, 50], [20, 100], [50, 200]]) for (const tr of [3, 5]) { const ef = E(f), es = E(s); o.push({ p: `${f}/${s} tr${tr}`, cfg: { entry: i => ef[i] > es[i] && ef[i - 1] <= es[i - 1], exit: i => ef[i] < es[i], trail: tr, init: 3 } }); } return o; },
    "Breakout": () => { const o = []; for (const look of [24, 48, 96]) for (const tr of [3, 5]) o.push({ p: `${look}b tr${tr}`, cfg: { entry: i => c[i] > hh(b, i, look), exit: () => false, trail: tr, init: 3 } }); return o; },
    "RSI mean-rev": () => { const o = []; for (const os of [25, 35]) for (const im of [2, 3]) o.push({ p: `os${os}`, cfg: { entry: i => c[i] > E(200)[i] && r14[i] < os, exit: i => r14[i] > 55, trail: 0, init: im } }); return o; },
  };
  for (const [name, gen] of Object.entries(arch)) {
    const scored = gen().map(g => ({ g, is: engine(b, atr, g.cfg, 0, SPLIT) })).filter(x => x.is.n >= 10)
      .sort((a, x) => (x.is.net / (x.is.maxDD || 1)) - (a.is.net / (a.is.maxDD || 1)));
    if (!scored.length) { console.log(`  ${name}: no valid config`); continue; }
    const best = scored[0], oos = engine(b, atr, best.g.cfg, SPLIT, 9e18);
    const ok = oos.net > 0 && oos.n >= 10;
    console.log(`  ${name.padEnd(13)} best ${best.g.p.padEnd(10)} | IS +${best.is.net.toFixed(0)}% DD${best.is.maxDD.toFixed(0)} n${best.is.n} | OOS ${oos.net >= 0 ? "+" : ""}${oos.net.toFixed(0)}% DD${oos.maxDD.toFixed(0)} n${oos.n} win${oos.win.toFixed(0)} ${ok ? "✅" : "❌"}`);
  }
}

(async () => {
  await testTF("1h", "2019-01-01T00:00:00Z");
  await testTF("15m", "2021-01-01T00:00:00Z");
  console.log("\n✅ = positive out-of-sample. Fees (0.1%/side) included — they hurt fast timeframes most.");
})();
