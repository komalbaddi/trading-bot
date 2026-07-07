// Parameter sweep for the Daily swing strategy across MULTIPLE symbols (anti-overfit).
// Ranks configs by average net return, profit factor, drawdown, and % of symbols beating buy&hold.
// Data: Yahoo daily from 2015 (realistic-price era). No key needed.
const SYMBOLS = (process.argv[2] || "AAPL,MSFT,NVDA,SPY,QQQ,AMZN,GOOGL").split(",");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const FROM = Math.floor(Date.parse("2015-01-01") / 1000);
const NOW = Math.floor(Date.now() / 1000);

async function fetchDaily(sym) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${sym}?interval=1d&period1=${FROM - 300 * 86400}&period2=${NOW}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < ts.length; i++) if (q.close[i] != null) bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return bars;
    } catch {}
  }
  return null;
}
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let s = 0; for (let i = 0; i < p; i++) s += v[i]; let e = s / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr14(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0; for (let i = 0; i < p; i++) a += tr[i]; let pr = a / p; o[p - 1] = pr; for (let i = p; i < b.length; i++) { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } return o; }

function run(bars, cfg) {
  const c = bars.map(b => b.c);
  const eF = ema(c, 20), eM = ema(c, 50), eT = ema(c, 200), atr = atr14(bars);
  const highestPrior = (i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, bars[k].h); return m; };
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  let start = 201; while (start < bars.length && bars[start].t < FROM) start++;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      pos.hi = Math.max(pos.hi, b.h);
      pos.stop = Math.max(pos.stop, pos.hi - atr[i] * cfg.ch);
      let ex = null;
      if (b.l <= pos.stop) ex = Math.min(b.o, pos.stop);
      else if (cfg.maExit && b.c < eM[i]) ex = b.c;
      else if (cfg.regExit && b.c < eT[i]) ex = b.c;
      if (ex != null) {
        const pnl = ((ex - cfg.slip) - (pos.entry + cfg.slip)) * pos.qty; eq += pnl;
        tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
      }
    }
    if (!pos) {
      const up = b.c > eT[i] && eF[i] > eM[i];
      let entry = false;
      if (cfg.mode === "pullback") entry = up && (b.l <= eF[i] * (1 + cfg.tol / 100)) && (b.l < eF[i] || b.c > eF[i]) && b.c > eF[i] && b.c > b.o;
      else entry = up && b.c > highestPrior(i, cfg.brk);   // breakout
      if (entry) {
        const sd = atr[i] * cfg.init, qty = Math.min((eq * 0.015) / sd, eq / b.c);
        pos = { entry: b.c, qty, stop: b.c - sd, hi: b.h };
      }
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  const wins = tr.filter(x => x > 0), gW = wins.reduce((s, x) => s + x, 0), gL = -tr.filter(x => x < 0).reduce((s, x) => s + x, 0);
  const bh = (c[c.length - 1] / c[start] - 1) * 100;
  return { net: (eq / 10000 - 1) * 100, bh, n: tr.length, win: tr.length ? wins.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 99 : 0), maxDD };
}

(async () => {
  const data = {};
  for (const s of SYMBOLS) { const b = await fetchDaily(s); if (b) data[s] = b; }
  const syms = Object.keys(data);
  console.log(`Loaded ${syms.join(", ")} | tuning from 2015\n`);

  const grid = [];
  for (const mode of ["pullback", "breakout"])
    for (const init of [2.0, 2.5, 3.0])
      for (const ch of [3, 4, 5, 6])
        for (const maExit of [true, false])
          for (const regExit of [true, false])
            for (const tol of (mode === "pullback" ? [1.5, 3.0] : [2.0]))
              for (const brk of (mode === "breakout" ? [20, 50] : [20]))
                grid.push({ mode, init, ch, maExit, regExit, tol, brk, slip: 0.01 });

  const results = grid.map(cfg => {
    const rs = syms.map(s => run(data[s], cfg));
    const avgNet = rs.reduce((a, r) => a + r.net, 0) / rs.length;
    const avgPF = rs.reduce((a, r) => a + Math.min(r.pf, 5), 0) / rs.length;
    const avgDD = rs.reduce((a, r) => a + r.maxDD, 0) / rs.length;
    const beat = rs.filter(r => r.net > r.bh).length;
    const avgTrades = rs.reduce((a, r) => a + r.n, 0) / rs.length;
    return { cfg, avgNet, avgPF, avgDD, beat, avgTrades, retDD: avgNet / (avgDD || 1) };
  });

  // rank by profit factor then return/drawdown (robust, not raw return)
  results.sort((a, b) => (b.avgPF + b.retDD) - (a.avgPF + a.retDD));
  console.log("TOP 12 CONFIGS (ranked by profit-factor + return/drawdown, across all symbols):");
  console.log("rank | mode      init ch maExit regExit tol brk | avgNet% avgPF avgDD% ret/DD beatBH trades");
  results.slice(0, 12).forEach((r, i) => {
    const c = r.cfg;
    console.log(`${String(i + 1).padStart(2)}   | ${c.mode.padEnd(9)} ${c.init}  ${c.ch}  ${String(c.maExit).padEnd(5)} ${String(c.regExit).padEnd(5)}  ${c.tol} ${c.brk} | ${r.avgNet.toFixed(1).padStart(6)}  ${r.avgPF.toFixed(2)}  ${r.avgDD.toFixed(1).padStart(5)}  ${r.retDD.toFixed(2).padStart(5)}  ${r.beat}/${syms.length}   ${r.avgTrades.toFixed(0)}`);
  });

  // show per-symbol detail for the winner
  const best = results[0].cfg;
  console.log(`\nWINNER detail: ${JSON.stringify(best)}`);
  console.log("symbol | net%   buy&hold%  trades win%  PF    maxDD%");
  for (const s of syms) { const r = run(data[s], best); console.log(`${s.padEnd(6)} | ${r.net.toFixed(0).padStart(5)}  ${r.bh.toFixed(0).padStart(7)}   ${String(r.n).padStart(4)}  ${r.win.toFixed(0)}   ${Math.min(r.pf,99).toFixed(2)}  ${r.maxDD.toFixed(1)}`); }
})();
