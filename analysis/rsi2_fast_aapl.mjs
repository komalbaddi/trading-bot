// Sharpen the RSI-2 dip for a FAST 1-2 day exit (for a shorter-hold options play).
// Entry: RSI(2) oversold in an uptrend. Test several quick exits. IS/OOS. Yahoo daily.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchDaily() {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);

function backtest(bars, { rsiBuy, exit, maxHold, from, to }) {
  const c = bars.map(b => b.c), r2 = rsiW(c, 2);
  const trades = [];
  let i = 200;
  while (i < bars.length - 2) {
    if (bars[i].t < from || bars[i].t > to) { i++; continue; }
    const s200 = sma(c, 200, i);
    if (s200 && c[i] > s200 && r2[i] != null && r2[i] < rsiBuy) {
      const e = i + 1, entry = bars[e].o;                 // enter next open
      let j = e, exitPx = null, hold = 0;
      while (j < bars.length - 1) {
        hold = j - e + 1;
        let done = false;
        if (exit === "d1") done = (j === e);               // sell same day's close as entry-open day
        else if (exit === "d2") done = (j === e + 1);
        else if (exit === "firstGreen") done = (bars[j].c > bars[j].o) || hold >= maxHold;
        else if (exit === "rsi50") done = (r2[j] > 50) || hold >= maxHold;
        else if (exit === "sma3") { const s3 = sma(c, 3, j); done = (s3 && c[j] > s3) || hold >= maxHold; }
        if (done) { exitPx = bars[j].c; break; }
        j++;
      }
      if (exitPx == null) exitPx = c[bars.length - 1];
      trades.push({ ret: (exitPx / entry - 1) * 100, hold });
      i = j + 1;
    } else i++;
  }
  const w = trades.filter(t => t.ret > 0), gW = w.reduce((a, t) => a + t.ret, 0), gL = -trades.filter(t => t.ret < 0).reduce((a, t) => a + t.ret, 0);
  return { n: trades.length, win: trades.length ? w.length / trades.length * 100 : 0, avg: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0, avgHold: trades.length ? trades.reduce((a, t) => a + t.hold, 0) / trades.length : 0, pf: gL ? gW / gL : 9, total: trades.reduce((a, t) => a + t.ret, 0) };
}

(async () => {
  const bars = await fetchDaily(); if (!bars) { console.log("no data"); return; }
  const mid = bars[Math.floor(bars.length * 0.6)].t;
  console.log(`\n${SYMBOL}: ${bars.length} bars ${dstr(bars[0].t)}..${dstr(bars[bars.length - 1].t)} | IS..${dstr(mid)} | OOS after\n`);
  const variants = [
    { rsiBuy: 10, exit: "d1", maxHold: 1, label: "RSI2<10, exit SAME-DAY close (~1d)" },
    { rsiBuy: 10, exit: "d2", maxHold: 2, label: "RSI2<10, exit +2 days (fixed)" },
    { rsiBuy: 10, exit: "firstGreen", maxHold: 2, label: "RSI2<10, exit 1st GREEN close (max 2d)" },
    { rsiBuy: 10, exit: "rsi50", maxHold: 2, label: "RSI2<10, exit RSI2>50 (max 2d)" },
    { rsiBuy: 5, exit: "firstGreen", maxHold: 2, label: "RSI2<5,  exit 1st GREEN close (max 2d)" },
    { rsiBuy: 5, exit: "d2", maxHold: 2, label: "RSI2<5,  exit +2 days (fixed)" },
  ];
  console.log("variant                                    |  IS: win% avg%  PF  hold | OOS: win% avg%  PF  hold  n");
  for (const v of variants) {
    const is = backtest(bars, { ...v, from: 0, to: mid }), o = backtest(bars, { ...v, from: mid, to: 9e18 });
    console.log(`${v.label.padEnd(42)} | ${is.win.toFixed(0).padStart(4)} ${is.avg.toFixed(2).padStart(5)} ${is.pf.toFixed(2)} ${is.avgHold.toFixed(1)} | ${o.win.toFixed(0).padStart(4)} ${o.avg.toFixed(2).padStart(5)} ${o.pf.toFixed(2)} ${o.avgHold.toFixed(1)}  ${o.n}`);
  }
  console.log("\nWant: win% and avg% POSITIVE and holding up in OOS, with hold ~1-2 days. avg% is the underlying move the option must beat.");
})();
