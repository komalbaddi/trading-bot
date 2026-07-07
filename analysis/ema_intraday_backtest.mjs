// EMA-ONLY intraday strategies for AAPL, tested on real 5m & 15m data WITH slippage.
// Tests: EMA crossover (long-only), crossover (long+short), and EMA pullback-in-trend.
// Uniform 1x sizing (qty = equity/close) so we compare SIGNAL QUALITY fairly.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchIntraday(interval, range) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}&includePrePost=false`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
      return b;
    } catch {}
  }
  return null;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }
function prep(bars) { let day = null; return bars.map(b => { const d = etDate(b.t); const nd = d !== day; if (nd) day = d; return { ...b, day: d, min: etMin(b.t), newDay: nd }; }); }

function stats(tr, eq, maxDD) { const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0); return { net: (eq / 10000 - 1) * 100, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD }; }

// generic engine. mode: "cross" (LO), "crossLS" (long+short), "pull" (pullback-in-trend)
function bt(bars, { fast, slow, mode, mid = 0, trend = 0, atrStop = 0, rr = 0, tol = 0.1, slip = 0.02 }) {
  const c = bars.map(b => b.c), eF = ema(c, fast), eS = ema(c, slow), a = atr(bars, 14);
  const eMid = mid ? ema(c, mid) : null, eT = trend ? ema(c, trend) : null;
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  const close = (px, i) => { const pnl = ((px - slip * pos.dir) - (pos.entry + slip * pos.dir)) * pos.qty * pos.dir; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = slow + 1; i < bars.length; i++) {
    const b = bars[i]; if (eS[i] == null || eS[i - 1] == null) continue;
    const lastBarOfDay = (i + 1 >= bars.length) || bars[i + 1].newDay;
    const xUp = eF[i - 1] <= eS[i - 1] && eF[i] > eS[i];
    const xDn = eF[i - 1] >= eS[i - 1] && eF[i] < eS[i];
    // manage
    if (pos) {
      if (atrStop && pos.dir > 0 && b.l <= pos.stop) close(pos.stop, i);
      else if (atrStop && pos.dir < 0 && b.h >= pos.stop) close(pos.stop, i);
      else if (pos && rr && pos.dir > 0 && b.h >= pos.tp) close(pos.tp, i);
      else if (pos && rr && pos.dir < 0 && b.l <= pos.tp) close(pos.tp, i);
      else if (pos && mode === "stack" && pos.dir > 0 && !(eF[i] > eMid[i] && eMid[i] > eS[i])) close(b.c, i);
      else if (pos && ((mode === "cross" || mode === "crossLS") && pos.dir > 0 && xDn) || (pos && mode === "crossLS" && pos.dir < 0 && xUp)) close(b.c, i);
      else if (pos && lastBarOfDay) close(b.c, i);
    }
    if (pos || lastBarOfDay || b.min < 35) { peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); continue; }
    // entries
    const qty = eq / b.c;
    if (mode === "cross" && xUp) pos = { entry: b.c, qty, dir: 1 };
    else if (mode === "crossLS" && xUp) pos = { entry: b.c, qty, dir: 1 };
    else if (mode === "crossLS" && xDn) pos = { entry: b.c, qty, dir: -1 };
    else if (mode === "pull" && eF[i] > eS[i] && (b.l <= eF[i] * (1 + tol / 100)) && (b.l < eF[i] || b.c > eF[i]) && b.c > eF[i] && b.c > b.o) {
      const sd = a[i] * atrStop; pos = { entry: b.c, qty, dir: 1, stop: b.c - sd, tp: b.c + sd * rr };
    }
    else if (mode === "stack" && eF[i] > eMid[i] && eMid[i] > eS[i] && !(eF[i - 1] > eMid[i - 1] && eMid[i - 1] > eS[i - 1]) && b.c > eF[i]) {
      pos = { entry: b.c, qty, dir: 1 };  // enter on first bar of a bullish stack; exit when stack breaks/EOD
    }
    else if (mode === "pullTrend" && eT[i] != null && b.c > eT[i] && eF[i] > eMid[i] && (b.l <= eF[i] * (1 + tol / 100)) && (b.l < eF[i] || b.c > eF[i]) && b.c > eF[i] && b.c > b.o) {
      const sd = a[i] * atrStop; pos = { entry: b.c, qty, dir: 1, stop: b.c - sd, tp: b.c + sd * rr };
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  return stats(tr, eq, maxDD);
}

const show = (n, r) => console.log(`${n.padEnd(30)} net ${r.net.toFixed(1).padStart(6)}%  trades ${String(r.n).padStart(4)}  win ${r.win.toFixed(0).padStart(3)}%  PF ${Math.min(r.pf, 9).toFixed(2)}  maxDD ${r.maxDD.toFixed(1)}%`);

(async () => {
  for (const [iv, rg] of [["5m", "60d"], ["15m", "60d"]]) {
    const raw = await fetchIntraday(iv, rg); if (!raw || raw.length < 100) { console.log(`\n${iv}: no data`); continue; }
    const bars = prep(raw), days = new Set(bars.map(b => b.day)).size;
    console.log(`\n===== ${SYMBOL} ${iv} — ${bars.length} bars / ${days} days (slippage $0.02/side) =====`);
    console.log("-- EMA crossover, LONG-ONLY (exit on opposite cross / EOD) --");
    for (const [f, s] of [[9, 21], [8, 34], [5, 20], [20, 50], [12, 26]]) show(`cross ${f}/${s} LO`, bt(bars, { fast: f, slow: s, mode: "cross" }));
    console.log("-- EMA crossover, LONG+SHORT (always flip) --");
    for (const [f, s] of [[9, 21], [8, 34], [20, 50]]) show(`cross ${f}/${s} L+S`, bt(bars, { fast: f, slow: s, mode: "crossLS" }));
    console.log("-- EMA pullback-in-trend (fast>slow, dip to fast, ATR stop, 2R) --");
    for (const [f, s] of [[9, 21], [8, 34], [20, 50]]) show(`pull ${f}/${s}`, bt(bars, { fast: f, slow: s, mode: "pull", atrStop: 1.5, rr: 2, tol: 0.1 }));
    console.log("-- EMA triple-stack long-only (enter when f>m>s aligns, exit on break/EOD) --");
    for (const [f, m, s] of [[9, 21, 50], [8, 21, 55], [5, 13, 34]]) show(`stack ${f}/${m}/${s}`, bt(bars, { fast: f, mid: m, slow: s, mode: "stack" }));
    console.log("-- EMA pullback + 200-EMA trend filter (long-only) --");
    for (const [f, m] of [[9, 21], [20, 50]]) show(`pullTrend ${f}/${m}+200`, bt(bars, { fast: f, mid: m, slow: m, trend: 200, mode: "pullTrend", atrStop: 1.5, rr: 2, tol: 0.15 }));
  }
})();
