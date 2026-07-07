// Honest intraday backtest for AAPL on real 5-min & 15-min data (Yahoo, ~60 days).
// Tests Opening-Range-Breakout and VWAP-trend, WITH realistic slippage.
// Small sample (intraday history is limited free) -> treat as indicative, not proof.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchIntraday(interval, range) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}&includePrePost=false`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < ts.length; i++) if (q.close[i] != null) bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
      return bars;
    } catch {}
  }
  return null;
}

const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };

function atr(bars, p = 14) { const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))); const o = Array(bars.length).fill(null); let a = 0, pr = null; for (let i = 0; i < bars.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

// annotate day boundaries + session VWAP
function prep(bars) {
  let day = null, cumPV = 0, cumV = 0;
  return bars.map((b, i) => {
    const d = etDate(b.t), min = etMin(b.t);
    const newDay = d !== day; if (newDay) { day = d; cumPV = 0; cumV = 0; }
    const tp = (b.h + b.l + b.c) / 3; cumPV += tp * b.v; cumV += b.v;
    return { ...b, day: d, min, newDay, vwap: cumV ? cumPV / cumV : b.c };
  });
}

// ---- Opening Range Breakout ----
function orb(bars, { orbMin = 15, rr = 2, atrStop = 0, useVwap = true, slip = 0.02, longOnly = true }) {
  const a = atr(bars, 14); let eq = 10000, peak = 10000, maxDD = 0; const tr = [];
  let pos = null, orH = null, orL = null, orDone = false, dayTraded = 0, curDay = null, orEndMin = 0;
  const flat = (px, why) => { const pnl = ((px - slip) - (pos.entry + slip)) * pos.qty * (pos.dir); eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = 30; i < bars.length; i++) {
    const b = bars[i];
    if (b.newDay) { curDay = b.day; orH = b.h; orL = b.l; orDone = false; dayTraded = 0; orEndMin = b.min + orbMin; }
    else if (!orDone && b.min < orEndMin) { orH = Math.max(orH, b.h); orL = Math.min(orL, b.l); }
    else orDone = true;
    const lastBarOfDay = (i + 1 >= bars.length) || bars[i + 1].newDay;
    if (pos) { // manage
      if (b.l <= pos.stop && pos.dir > 0) flat(pos.stop, "stop");
      else if (pos && b.h >= pos.tp && pos.dir > 0) flat(pos.tp, "tp");
      else if (pos && lastBarOfDay) flat(b.c, "eod");
    }
    if (!pos && orDone && dayTraded < 1 && !lastBarOfDay && orH != null) {
      const longOK = b.c > orH && (!useVwap || b.c > b.vwap);
      if (longOK) {
        const stop = atrStop > 0 ? b.c - a[i] * atrStop : orL;
        const risk = b.c - stop; if (risk > 0) { const qty = Math.min((eq * 0.01) / risk, eq / b.c); pos = { entry: b.c, qty, stop, tp: b.c + risk * rr, dir: 1 }; dayTraded++; }
      }
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  return stats(tr, eq, maxDD);
}

// ---- VWAP trend pullback ----
function vwapTrend(bars, { rr = 1.5, atrStop = 1.5, tol = 0.1, slip = 0.02 }) {
  const a = atr(bars, 14); let eq = 10000, peak = 10000, maxDD = 0; const tr = [];
  let pos = null;
  const flat = (px) => { const pnl = ((px - slip) - (pos.entry + slip)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = 30; i < bars.length; i++) {
    const b = bars[i]; const lastBarOfDay = (i + 1 >= bars.length) || bars[i + 1].newDay;
    if (pos) { if (b.l <= pos.stop) flat(pos.stop); else if (b.h >= pos.tp) flat(pos.tp); else if (lastBarOfDay) flat(b.c); }
    if (!pos && !lastBarOfDay && b.min > 40) { // skip first ~40 min
      const upTrend = b.c > b.vwap;
      const nearVwap = Math.abs(b.l - b.vwap) / b.vwap * 100 <= tol || (b.l < b.vwap && b.c > b.vwap);
      const reclaim = b.c > b.vwap && b.c > b.o;
      if (upTrend && nearVwap && reclaim) { const sd = a[i] * atrStop; if (sd > 0) { const qty = Math.min((eq * 0.01) / sd, eq / b.c); pos = { entry: b.c, qty, stop: b.c - sd, tp: b.c + sd * rr }; } }
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  return stats(tr, eq, maxDD);
}

function stats(tr, eq, maxDD) {
  const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0);
  return { net: (eq / 10000 - 1) * 100, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD };
}
const show = (name, r) => console.log(`${name.padEnd(34)} net ${r.net.toFixed(1).padStart(6)}%  trades ${String(r.n).padStart(3)}  win ${r.win.toFixed(0).padStart(3)}%  PF ${Math.min(r.pf,9).toFixed(2)}  maxDD ${r.maxDD.toFixed(1)}%`);

(async () => {
  for (const [iv, rg] of [["5m", "60d"], ["15m", "60d"]]) {
    const raw = await fetchIntraday(iv, rg); if (!raw || raw.length < 100) { console.log(`\n${iv}: no data`); continue; }
    const bars = prep(raw);
    const days = new Set(bars.map(b => b.day)).size;
    console.log(`\n===== ${SYMBOL} ${iv} — ${bars.length} bars over ${days} trading days =====`);
    console.log("-- with realistic slippage ($0.02/side) --");
    show("ORB 15m (VWAP filter, stop=range)", orb(bars, { orbMin: 15, rr: 2, useVwap: true, slip: 0.02 }));
    show("ORB 30m (VWAP filter, ATR stop)", orb(bars, { orbMin: 30, rr: 2, atrStop: 1.5, useVwap: true, slip: 0.02 }));
    show("VWAP trend pullback", vwapTrend(bars, { rr: 1.5, atrStop: 1.5, tol: 0.1, slip: 0.02 }));
    console.log("-- ZERO slippage (fantasy, shows how much costs matter) --");
    show("ORB 15m (no slippage)", orb(bars, { orbMin: 15, rr: 2, useVwap: true, slip: 0 }));
    show("VWAP trend (no slippage)", vwapTrend(bars, { rr: 1.5, atrStop: 1.5, tol: 0.1, slip: 0 }));
  }
})();
