// Short-term mean-reversion (Connors RSI-2 style) on AAPL — the directional signal
// behind a 1-3 day options swing. Tests: in an uptrend, buy oversold dips, exit on bounce.
// Validates the STOCK signal (direction) over years with IS/OOS. Yahoo daily, no key.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchDaily() {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), res = j.chart.result[0], ts = res.timestamp, q = res.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function rsiWilder(closes, p) {
  const o = Array(closes.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); }
  }
  return o;
}
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);

function backtest(bars, { rsiBuy, exitSma, maxHold, from, to }) {
  const c = bars.map(b => b.c), rsi = rsiWilder(c, 2);
  const trades = [];
  let i = 200;
  while (i < bars.length - 1) {
    if (bars[i].t < from || bars[i].t > to) { i++; continue; }
    const s200 = sma(c, 200, i);
    if (s200 && c[i] > s200 && rsi[i] != null && rsi[i] < rsiBuy) {
      // enter next open
      const entry = bars[i + 1].o, entryDate = dstr(bars[i + 1].t);
      let j = i + 1, exit = null, hold = 0;
      while (j < bars.length - 1) {
        const sX = sma(c, exitSma, j);
        hold = j - (i + 1) + 1;
        if ((sX && c[j] > sX) || hold >= maxHold) { exit = bars[j + 1].o; break; }  // exit next open after signal
        j++;
      }
      if (exit == null) { exit = c[bars.length - 1]; }
      trades.push({ ret: (exit / entry - 1) * 100, hold, entryDate });
      i = j + 1;
    } else i++;
  }
  const wins = trades.filter(t => t.ret > 0);
  const gW = wins.reduce((a, t) => a + t.ret, 0), gL = -trades.filter(t => t.ret < 0).reduce((a, t) => a + t.ret, 0);
  const avg = trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0;
  const avgHold = trades.length ? trades.reduce((a, t) => a + t.hold, 0) / trades.length : 0;
  return { n: trades.length, win: trades.length ? wins.length / trades.length * 100 : 0, avg, avgHold, pf: gL ? gW / gL : 9, total: trades.reduce((a, t) => a + t.ret, 0) };
}

(async () => {
  const bars = await fetchDaily(); if (!bars) { console.log("no data"); return; }
  const mid = bars[Math.floor(bars.length * 0.6)].t;
  console.log(`\n${SYMBOL}: ${bars.length} daily bars ${dstr(bars[0].t)}..${dstr(bars[bars.length - 1].t)}`);
  console.log(`IS ..${dstr(mid)} | OOS after\n`);
  const variants = [
    { rsiBuy: 10, exitSma: 5, maxHold: 6, label: "RSI2<10, exit>SMA5 (classic)" },
    { rsiBuy: 5, exitSma: 5, maxHold: 6, label: "RSI2<5 (stricter), exit>SMA5" },
    { rsiBuy: 10, exitSma: 10, maxHold: 8, label: "RSI2<10, exit>SMA10" },
  ];
  for (const v of variants) {
    const is = backtest(bars, { ...v, from: 0, to: mid });
    const oos = backtest(bars, { ...v, from: mid, to: 9e18 });
    console.log(`${v.label}`);
    console.log(`   IS : trades ${String(is.n).padStart(3)}  win ${is.win.toFixed(0)}%  avg/trade ${is.avg.toFixed(2)}%  hold ${is.avgHold.toFixed(1)}d  PF ${is.pf.toFixed(2)}  total ${is.total.toFixed(0)}%`);
    console.log(`   OOS: trades ${String(oos.n).padStart(3)}  win ${oos.win.toFixed(0)}%  avg/trade ${oos.avg.toFixed(2)}%  hold ${oos.avgHold.toFixed(1)}d  PF ${oos.pf.toFixed(2)}  total ${oos.total.toFixed(0)}%`);
  }
  console.log("\nFor an OPTIONS play, what matters: high win% + positive avg move over 1-3 days, holding up in OOS.");
})();
