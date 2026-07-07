// Reproduce strategy 07 (Daily Swing Trend) in code to diagnose the -94% result.
// Data: Yahoo daily (no key). Prints stats + trade log so we can SEE what breaks.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

const RANGE = process.argv[3] || "max";   // "max" = full daily history like TradingView; or "3y"
async function fetchDaily() {
  // Force DAILY granularity over full history via period1/period2 (range=max downsamples to monthly).
  const p1 = RANGE === "max" ? 315532800 : Math.floor(Date.now() / 1000) - (parseInt(RANGE) || 3) * 365 * 86400; // 1980-01-01
  const p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < ts.length; i++) if (q.close[i] != null) bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return bars;
    } catch {}
  }
  throw new Error("fetch failed");
}
function ema(v, p) { const o = new Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let s = 0; for (let i = 0; i < p; i++) s += v[i]; let e = s / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr14(bars, p = 14) { const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))); const o = new Array(bars.length).fill(null); let a = 0; for (let i = 0; i < p; i++) a += tr[i]; let prev = a / p; o[p - 1] = prev; for (let i = p; i < bars.length; i++) { prev = (prev * (p - 1) + tr[i]) / p; o[i] = prev; } return o; }
const d = t => new Date(t * 1000).toISOString().slice(0, 10);

function backtest(bars, opt) {
  const c = bars.map(b => b.c);
  const eF = ema(c, 20), eM = ema(c, 50), eT = ema(c, 200), atr = atr14(bars);
  const highest = (i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, bars[k].h); return m; };

  let equity = 10000, peak = 10000, maxDD = 0;
  let pos = null; const trades = [];
  const fromT = opt.from ? Math.floor(Date.parse(opt.from) / 1000) : 0;
  let startIdx = 201;
  while (startIdx < bars.length && bars[startIdx].t < fromT) startIdx++;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    // ---- manage open position (Pine sets exit stop on bar i using bar i values, checked intrabar) ----
    if (pos) {
      // TWO chandelier variants:
      //   buggy: highest high of last 22 bars (includes PRE-entry highs above entry -> stop too tight)
      //   fixed: highest high SINCE ENTRY (gives the trade room, ratchets only on new post-entry highs)
      pos.hiSinceEntry = Math.max(pos.hiSinceEntry, b.h);
      const chStop = opt.fixedTrail ? (pos.hiSinceEntry - atr[i] * 3.0) : (highest(i, 22) - atr[i] * 3.0);
      pos.stop = Math.max(pos.stop, chStop);              // ratchet up only
      let exit = null, reason = null;
      if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = "trail-stop"; }   // stop hit intrabar
      else if (opt.maExit && b.c < eM[i]) { exit = b.c; reason = "lost-midEMA"; }
      else if (b.c < eT[i]) { exit = b.c; reason = "regime-flip"; }
      if (exit != null) {
        const slip = opt.slip || 0;                       // $/share applied to BOTH fills (like TradingView ticks)
        const pnl = ((exit - slip) - (pos.entry + slip)) * pos.qty;
        equity += pnl;
        trades.push({ in: pos.date, out: d(b.t), entry: +pos.entry.toFixed(2), exit: +exit.toFixed(2), qty: +pos.qty.toFixed(2), pnl: +pnl.toFixed(2), retPct: +((exit / pos.entry - 1) * 100).toFixed(2), reason });
        pos = null;
        peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
      }
    }
    // ---- entry (long only) ----
    if (!pos) {
      const upRegime = b.c > eT[i] && eF[i] > eM[i];
      const nearFast = (b.l <= eF[i] * (1 + opt.tol / 100)) && (b.l < eF[i] || b.c > eF[i]);
      const reclaim = b.c > eF[i] && b.c > b.o;
      if (upRegime && nearFast && reclaim) {
        const stopDist = atr[i] * 2.5;
        const qtyRisk = stopDist > 0 ? (equity * 0.015) / stopDist : 0;
        const qtyCap = (equity * 1.0) / b.c;
        const qty = Math.min(qtyRisk, qtyCap);
        pos = { entry: b.c, qty, stop: b.c - stopDist, date: d(b.t), hiSinceEntry: b.h };
      }
    }
    peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  const grossW = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossL = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const avgW = wins ? grossW / wins : 0, avgL = (trades.length - wins) ? grossL / (trades.length - wins) : 0;
  const bh = (c[c.length - 1] / c[startIdx] - 1) * 100;
  return { equity, netPct: (equity / 10000 - 1) * 100, trades, wins, winRate: trades.length ? wins / trades.length * 100 : 0, maxDD, bh, pf: grossL ? grossW / grossL : Infinity, avgW, avgL };
}

(async () => {
  const bars = await fetchDaily();
  console.log(`\n${SYMBOL} daily: ${bars.length} bars, ${d(bars[0].t)} -> ${d(bars[bars.length - 1].t)}  (range=${RANGE})`);
  const configs = [
    { tol: 2.0, maExit: true, fixedTrail: false, slip: 0,    label: "NO slippage, full history (my earlier model)" },
    { tol: 2.0, maExit: true, fixedTrail: false, slip: 0.01, label: "WITH 1-tick ($0.01) slippage, full history from 1980  <-- reproduces TradingView" },
    { tol: 2.0, maExit: true, fixedTrail: true,  slip: 0.01, from: "2015-01-01", label: "FIXED trail + 1-tick slippage, ONLY from 2015 (realistic prices)" },
  ];
  for (const opt of configs) {
    const r = backtest(bars, opt);
    console.log(`\n===== ${opt.label} =====`);
    console.log(`Net: ${r.netPct.toFixed(1)}%  | Buy&Hold: ${r.bh.toFixed(1)}%  | Trades: ${r.trades.length}  | Win%: ${r.winRate.toFixed(1)}  | ProfitFactor: ${r.pf.toFixed(3)}  | MaxDD: ${r.maxDD.toFixed(1)}%`);
    console.log(`AvgWin: $${r.avgW.toFixed(2)}  AvgLoss: $${r.avgL.toFixed(2)}  (win must be >> loss for a low win-rate trend system)`);
  }
})();
