// Try NEW indicators on BTC daily: Supertrend, MACD, Parabolic SAR, ADX/DI.
// Long/flat, walk-forward (IS 2019..mid-2023, OOS after), fees 0.1%/side. vs EMA champion.
const SLIP = 0.001, SPLIT = Date.parse("2023-07-01") / 1000;

async function fetchDaily() {
  const base = "https://data-api.binance.vision/api/v3/klines";
  let start = Date.parse("2019-01-01T00:00:00Z"); const now = Date.now(); const b = []; let g = 0;
  while (start < now && g++ < 100) {
    const r = await fetch(`${base}?symbol=BTCUSDT&interval=1d&startTime=${start}&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`); const k = await r.json(); if (!k.length) break;
    for (const row of k) b.push({ t: Math.floor(row[0] / 1000), o: +row[1], h: +row[2], l: +row[3], c: +row[4] });
    start = k[k.length - 1][6] + 1; if (k.length < 1000) break;
  }
  return b;
}
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atrArr(b, p) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

function supertrend(b, atr, mult) {
  const n = b.length, st = Array(n).fill(null), up = Array(n).fill(false);
  let fUp = 0, fLo = 0, prevSt = 0, prevUpTrend = true;
  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    const hl2 = (b[i].h + b[i].l) / 2, bu = hl2 + mult * atr[i], bl = hl2 - mult * atr[i];
    const pfUp = fUp, pfLo = fLo, pc = i > 0 ? b[i - 1].c : b[i].c;
    fUp = (bu < pfUp || pc > pfUp || pfUp === 0) ? bu : pfUp;
    fLo = (bl > pfLo || pc < pfLo || pfLo === 0) ? bl : pfLo;
    let curUp; let stv;
    if (prevSt === pfUp) { curUp = b[i].c > fUp; } else { curUp = b[i].c >= fLo; }
    stv = curUp ? fLo : fUp;
    st[i] = stv; up[i] = b[i].c > stv; prevSt = stv;
  }
  return up;   // longState: true when in uptrend
}
function macd(c, f = 12, s = 26, sig = 9) { const ef = ema(c, f), es = ema(c, s), m = c.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null); const sg = ema(m.map(x => x ?? 0), sig); return c.map((_, i) => m[i] != null && sg[i] != null ? m[i] > sg[i] : false); }
function psar(b, step = 0.02, max = 0.2) {
  const n = b.length, up = Array(n).fill(false); if (n < 2) return up;
  let bull = true, af = step, ep = b[0].h, sar = b[0].l;
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (bull) { if (b[i].l < sar) { bull = false; sar = ep; ep = b[i].l; af = step; } else { if (b[i].h > ep) { ep = b[i].h; af = Math.min(max, af + step); } } }
    else { if (b[i].h > sar) { bull = true; sar = ep; ep = b[i].h; af = step; } else { if (b[i].l < ep) { ep = b[i].l; af = Math.min(max, af + step); } } }
    up[i] = bull;
  }
  return up;
}
function adxDI(b, p, thresh) {
  const n = b.length, pdm = Array(n).fill(0), ndm = Array(n).fill(0), tr = Array(n).fill(0);
  for (let i = 1; i < n; i++) { const u = b[i].h - b[i - 1].h, d = b[i - 1].l - b[i].l; pdm[i] = (u > d && u > 0) ? u : 0; ndm[i] = (d > u && d > 0) ? d : 0; tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); }
  const sm = a => { const o = Array(n).fill(null); let s = 0; for (let i = 1; i <= p; i++) s += a[i]; let pr = s; o[p] = s; for (let i = p + 1; i < n; i++) { pr = pr - pr / p + a[i]; o[i] = pr; } return o; };
  const str = sm(tr), sp = sm(pdm), sn = sm(ndm), dx = Array(n).fill(null); let prev = null; const adx = Array(n).fill(null);
  for (let i = p; i < n; i++) { if (!str[i]) continue; const pdi = 100 * sp[i] / str[i], ndi = 100 * sn[i] / str[i]; dx[i] = 100 * Math.abs(pdi - ndi) / (pdi + ndi || 1); }
  let s = 0, cnt = 0; for (let i = p; i < 2 * p && i < n; i++) if (dx[i] != null) { s += dx[i]; cnt++; }
  prev = cnt ? s / cnt : null; for (let i = 2 * p; i < n; i++) if (dx[i] != null && prev != null) { prev = (prev * (p - 1) + dx[i]) / p; adx[i] = prev; }
  return b.map((_, i) => { if (str[i] == null || adx[i] == null) return false; const pdi = 100 * sp[i] / str[i], ndi = 100 * sn[i] / str[i]; return pdi > ndi && adx[i] > thresh; });
}

function run(b, longState, from, to) {
  let cash = 10000, inPos = false, entryPx = 0, peak = 10000, dd = 0, ei = 0, n = 0, wins = 0, sT = null;
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue; if (sT == null) sT = b[i].t; ei = i;
    if (inPos && !longState[i]) { const r = (b[i].c * (1 - SLIP)) / (entryPx * (1 + SLIP)); cash *= r; n++; if (r > 1) wins++; inPos = false; }
    else if (!inPos && longState[i]) { inPos = true; entryPx = b[i].c; }
    const mark = inPos ? cash * (b[i].c / (entryPx * (1 + SLIP))) : cash;
    peak = Math.max(peak, mark); dd = Math.max(dd, (peak - mark) / peak * 100);
  }
  let eq = cash; if (inPos) eq = cash * (b[ei].c * (1 - SLIP)) / (entryPx * (1 + SLIP));
  return { net: (eq / 10000 - 1) * 100, n, win: n ? wins / n * 100 : 0, dd };
}
const show = (name, b, ls) => { const is = run(b, ls, 0, SPLIT), o = run(b, ls, SPLIT, 9e18); const ok = o.net > 0 && o.n >= 5; console.log(`  ${name.padEnd(22)} | IS +${is.net.toFixed(0)}% DD${is.dd.toFixed(0)} n${is.n} | OOS ${o.net >= 0 ? "+" : ""}${o.net.toFixed(0)}% DD${o.dd.toFixed(0)} n${o.n} win${o.win.toFixed(0)} ${ok ? "✅" : "❌"}`); };

(async () => {
  const b = await fetchDaily(), c = b.map(x => x.c), atr10 = atrArr(b, 10);
  console.log(`BTC daily ${b.length} bars ${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)}\n`);
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  show("EMA 20/50 +regime (champ)", b, b.map((_, i) => e20[i] > e50[i] && c[i] > e200[i]));
  for (const m of [2, 3, 4]) show(`Supertrend x${m}`, b, supertrend(b, atr10, m));
  show("MACD 12/26/9", b, macd(c));
  show("Parabolic SAR", b, psar(b));
  for (const t of [20, 25]) show(`ADX/DI thr${t}`, b, adxDI(b, 14, t));
  console.log("\n✅ = positive out-of-sample.");
})();
