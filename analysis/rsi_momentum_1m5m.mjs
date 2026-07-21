// RSI MOMENTUM scalping test for AAPL 1m & 5m (for options). Sweeps RSI length + thresholds.
// Momentum long = RSI crosses UP through buyLevel while above VWAP; short = mirror.
// Exit = RSI fades back / trailing ATR stop / EOD. Realistic slippage. Uniform 1x sizing.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchY(interval, range) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}&includePrePost=false`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
      return b;
    } catch {}
  }
  return null;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
function atr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }
function prep(raw) { let day = null, pv = 0, vv = 0; return raw.map(b => { const d = etDate(b.t), m = etMin(b.t); const nd = d !== day; if (nd) { day = d; pv = 0; vv = 0; } const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; return { ...b, day: d, min: m, newDay: nd, vwap: vv ? pv / vv : b.c }; }); }

function bt(bars, { len, buy, exit, chMult = 2, slip = 0.02, useVwap = true, allowShort = true }) {
  const c = bars.map(b => b.c), rsi = rsiW(c, len), a = atr(bars, 14);
  const sell = 100 - buy, exitDn = 100 - exit;
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  const cls = (px) => { const pnl = ((px - slip * pos.dir) - (pos.entry + slip * pos.dir)) * pos.qty * pos.dir; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = len + 2; i < bars.length; i++) {
    const b = bars[i], last = (i + 1 >= bars.length) || bars[i + 1].newDay;
    const xUp = rsi[i - 1] <= buy && rsi[i] > buy, xDn = rsi[i - 1] >= sell && rsi[i] < sell;
    if (pos) {
      if (pos.dir > 0) { pos.stop = Math.max(pos.stop, b.h - a[i] * chMult); if (b.l <= pos.stop || rsi[i] < exit) cls(Math.min(b.c, pos.stop === b.h - a[i] * chMult ? b.c : pos.stop)); }
      else if (pos) { pos.stop = Math.min(pos.stop, b.l + a[i] * chMult); if (b.h >= pos.stop || rsi[i] > exitDn) cls(b.c); }
      if (pos && last) cls(b.c);
    }
    if (!pos && !last && b.min > 35 && b.min < 940) {
      const qty = eq / b.c;
      if (xUp && (!useVwap || b.c > b.vwap)) pos = { entry: b.c, qty, dir: 1, stop: b.c - a[i] * chMult };
      else if (allowShort && xDn && (!useVwap || b.c < b.vwap)) pos = { entry: b.c, qty, dir: -1, stop: b.c + a[i] * chMult };
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0);
  return { net: (eq / 10000 - 1) * 100, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD };
}

(async () => {
  for (const [iv, rg] of [["5m", "60d"], ["1m", "7d"]]) {
    const raw = await fetchY(iv, rg); if (!raw || raw.length < 100) { console.log(`\n${iv}: no data`); continue; }
    const bars = prep(raw); const days = new Set(bars.map(b => b.day)).size;
    console.log(`\n===== ${SYMBOL} ${iv} RSI-MOMENTUM — ${bars.length} bars / ${days} days (slip $0.02/side) =====`);
    const grid = [];
    for (const len of [5, 7, 9, 14]) for (const buy of [55, 60, 65, 70]) grid.push({ len, buy, exit: 45 });
    const res = grid.map(g => ({ g, r: bt(bars, g) })).sort((a, b) => b.r.pf - a.r.pf);
    console.log("  RSIlen buy | net%    trades win%  PF    maxDD%   (sorted by PF, top 8)");
    for (const { g, r } of res.slice(0, 8))
      console.log(`   ${String(g.len).padStart(2)}   ${g.buy}  | ${r.net.toFixed(1).padStart(6)}  ${String(r.n).padStart(4)}  ${r.win.toFixed(0).padStart(3)}   ${Math.min(r.pf, 9).toFixed(2)}  ${r.maxDD.toFixed(1)}`);
    const best = res[0];
    console.log(`  BEST: RSI(${best.g.len}) cross>${best.g.buy} -> PF ${Math.min(best.r.pf,9).toFixed(2)}, net ${best.r.net.toFixed(1)}%, ${best.r.n} trades`);
  }
})();
