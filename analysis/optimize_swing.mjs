// WALK-FORWARD optimization: optimize params on IN-SAMPLE data (2015-2020),
// then validate the winner on OUT-OF-SAMPLE data (2021-now) it never saw.
// The gap between IS and OOS tells us if we're finding real edge or curve-fitting.
// Data: Yahoo daily. No key needed.
const SYMBOLS = (process.argv[2] || "AAPL,MSFT,NVDA,SPY,QQQ,AMZN,GOOGL,META,TSLA,JPM").split(",");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

const IS_FROM = Date.parse("2015-01-01") / 1000, IS_TO = Date.parse("2020-12-31") / 1000;
const OOS_FROM = Date.parse("2021-01-01") / 1000, OOS_TO = Date.now() / 1000;

async function fetchDaily(sym) {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `${"https://" + h}/v8/finance/chart/${sym}?interval=1d&period1=${Math.floor(IS_FROM - 300 * 86400)}&period2=${Math.floor(OOS_TO)}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const bars = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return bars;
    } catch {}
  }
  return null;
}
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let s = 0; for (let i = 0; i < p; i++) s += v[i]; let e = s / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr14(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0; for (let i = 0; i < p; i++) a += tr[i]; let pr = a / p; o[p - 1] = pr; for (let i = p; i < b.length; i++) { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } return o; }

function run(bars, cfg, from, to) {
  const c = bars.map(b => b.c);
  const eF = ema(c, 20), eM = ema(c, 50), eT = ema(c, 200), atr = atr14(bars);
  const hp = (i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, bars[k].h); return m; };
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  let s = 201; while (s < bars.length && bars[s].t < from) s++;
  let startClose = null, endIdx = s;
  for (let i = s; i < bars.length && bars[i].t <= to; i++) {
    const b = bars[i]; endIdx = i; if (startClose == null) startClose = b.c;
    if (pos) {
      pos.hi = Math.max(pos.hi, b.h); pos.stop = Math.max(pos.stop, pos.hi - atr[i] * cfg.ch);
      let ex = null;
      if (b.l <= pos.stop) ex = Math.min(b.o, pos.stop);
      else if (cfg.maExit && b.c < eM[i]) ex = b.c;
      else if (cfg.regExit && b.c < eT[i]) ex = b.c;
      if (ex != null) { const pnl = ((ex - cfg.slip) - (pos.entry + cfg.slip)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); }
    }
    if (!pos) {
      const up = b.c > eT[i] && eF[i] > eM[i]; let entry = false;
      if (cfg.mode === "pullback") entry = up && (b.l <= eF[i] * (1 + cfg.tol / 100)) && (b.l < eF[i] || b.c > eF[i]) && b.c > eF[i] && b.c > b.o;
      else entry = up && b.c > hp(i, cfg.brk);
      if (entry) { const sd = atr[i] * cfg.init, qty = Math.min((eq * 0.015) / sd, eq / b.c); pos = { entry: b.c, qty, stop: b.c - sd, hi: b.h }; }
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  if (pos) { eq += ((c[endIdx] - cfg.slip) - (pos.entry + cfg.slip)) * pos.qty; tr.push(0); }  // mark-to-market at window end
  const wins = tr.filter(x => x > 0), gW = wins.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0);
  const bh = startClose ? (c[endIdx] / startClose - 1) * 100 : 0;
  return { net: (eq / 10000 - 1) * 100, bh, n: tr.length, win: tr.length ? wins.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD };
}

function agg(data, syms, cfg, from, to) {
  const rs = syms.map(s => run(data[s], cfg, from, to));
  return {
    net: rs.reduce((a, r) => a + r.net, 0) / rs.length,
    pf: rs.reduce((a, r) => a + Math.min(r.pf, 5), 0) / rs.length,
    dd: rs.reduce((a, r) => a + r.maxDD, 0) / rs.length,
    trades: rs.reduce((a, r) => a + r.n, 0) / rs.length,
    beat: rs.filter(r => r.net > r.bh).length,
  };
}

(async () => {
  const data = {}; for (const s of SYMBOLS) { const b = await fetchDaily(s); if (b && b.length > 210) data[s] = b; }
  const syms = Object.keys(data);
  console.log(`Symbols: ${syms.join(", ")}\nIN-SAMPLE 2015-2020  |  OUT-OF-SAMPLE 2021-now\n`);

  const grid = [];
  for (const mode of ["pullback", "breakout"])
    for (const init of [2.0, 2.5, 3.0])
      for (const ch of [3, 4, 5, 6])
        for (const maExit of [false, true])
          for (const regExit of [true, false])
            for (const tol of (mode === "pullback" ? [1.5, 3.0] : [2.0]))
              for (const brk of (mode === "breakout" ? [20, 50] : [20]))
                grid.push({ mode, init, ch, maExit, regExit, tol, brk, slip: 0.01 });

  // optimize on IN-SAMPLE only
  const scored = grid.map(cfg => { const is = agg(data, syms, cfg, IS_FROM, IS_TO); return { cfg, is, score: is.pf + is.net / (is.dd || 1) / 10 }; });
  scored.sort((a, b) => b.score - a.score);

  console.log("Top 8 by IN-SAMPLE score, with their OUT-OF-SAMPLE result (the honest test):");
  console.log("  mode      init ch maE reg brk |  IS: net%  PF   DD%  |  OOS: net%  PF   DD%  beatBH");
  for (const r of scored.slice(0, 8)) {
    const c = r.cfg, oos = agg(data, syms, c, OOS_FROM, OOS_TO);
    console.log(`  ${c.mode.padEnd(9)} ${c.init} ${c.ch}  ${String(c.maExit)[0]}   ${String(c.regExit)[0]}   ${String(c.brk).padStart(2)} | ${r.is.net.toFixed(0).padStart(6)}  ${r.is.pf.toFixed(2)} ${r.is.dd.toFixed(1).padStart(4)}  | ${oos.net.toFixed(0).padStart(6)}  ${oos.pf.toFixed(2)} ${oos.dd.toFixed(1).padStart(4)}  ${oos.beat}/${syms.length}`);
  }

  const best = scored[0].cfg;
  const oos = agg(data, syms, best, OOS_FROM, OOS_TO);
  console.log(`\nIS-BEST config: ${JSON.stringify(best)}`);
  console.log(`Verdict -> IS PF ${scored[0].is.pf.toFixed(2)} vs OOS PF ${oos.pf.toFixed(2)}  (if OOS holds up, edge is real; if it collapses, it was curve-fit)`);
  console.log("\nOOS per-symbol for IS-best:");
  console.log("symbol | OOS net%  buy&hold%  trades win%  PF    maxDD%");
  for (const s of syms) { const r = run(data[s], best, OOS_FROM, OOS_TO); console.log(`${s.padEnd(6)} | ${r.net.toFixed(0).padStart(6)}  ${r.bh.toFixed(0).padStart(7)}   ${String(r.n).padStart(4)}  ${r.win.toFixed(0).padStart(3)}   ${Math.min(r.pf, 9).toFixed(2)}  ${r.maxDD.toFixed(1)}`); }
})();
