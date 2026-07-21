// AGGRESSIVE + ACTIVE mean-reversion BASKET (the proven edge, scaled for frequency).
// Signal per name: uptrend (>200SMA) AND (RSI2<10 OR close<lower Bollinger) -> buy dip.
// Exit fast: first green close / RSI2>60 / max 4d. Portfolio sim across a 12-name basket.
// Walk-forward: optimize/observe on 2020-2023, FORWARD-TEST 2024-2026. Yahoo daily.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const UNIVERSE = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "AVGO", "NFLX", "CRM", "JPM"];
const SLOTS = 8;                 // max concurrent positions (each ~1/8 of equity)
const IS = [Date.parse("2020-01-01") / 1000, Date.parse("2023-12-31") / 1000];
const OOS = [Date.parse("2024-01-01") / 1000, Date.parse("2026-12-31") / 1000];

async function fetchDaily(sym) {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function stdev(v, p, i) { const m = sma(v, p, i); if (m == null) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += (v[k] - m) ** 2; return Math.sqrt(s / p); }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }

function signals(sym, bars) {
  const c = bars.map(b => b.c), r2 = rsiW(c, 2), trades = [];
  let i = 200;
  while (i < bars.length - 2) {
    const s200 = sma(c, 200, i), basis = sma(c, 20, i), sd = stdev(c, 20, i);
    const lowerBB = basis != null && sd != null ? basis - 2 * sd : null;
    const dip = s200 && c[i] > s200 && ((r2[i] != null && r2[i] < 10) || (lowerBB != null && c[i] < lowerBB));
    if (dip) {
      const e = i + 1, entry = bars[e].o; let j = e, hold = 0, px = null;
      while (j < bars.length - 1) { hold = j - e + 1; if (bars[j].c > bars[j].o || (r2[j] > 60) || hold >= 4) { px = bars[j].c; break; } j++; }
      if (px == null) px = c[bars.length - 1];
      trades.push({ sym, tEntry: bars[e].t, tExit: bars[j].t, ret: (px / entry - 1) * 100, hold });
      i = j + 1;
    } else i++;
  }
  return trades;
}

function portfolio(trades, [from, to]) {
  const T = trades.filter(t => t.tEntry >= from && t.tEntry <= to).sort((a, b) => a.tEntry - b.tEntry);
  let cash = 100000; const open = []; const equitySeries = []; let taken = 0, skipped = 0; const rets = [];
  const events = [];
  for (const t of T) { events.push({ time: t.tEntry, type: "open", t }); }
  events.sort((a, b) => a.time - b.time);
  // process opens in time order; closes handled by scanning open list each step
  let peak = 100000, maxDD = 0;
  for (const ev of events) {
    // first, close any open trades whose exit <= this event time
    for (let k = open.length - 1; k >= 0; k--) { if (open[k].tExit <= ev.time) { cash += open[k].alloc * (1 + open[k].ret / 100); rets.push(open[k].ret); open.splice(k, 1); } }
    const equity = cash + open.reduce((a, p) => a + p.alloc, 0);
    peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
    if (open.length < SLOTS) { const alloc = equity / SLOTS; if (cash >= alloc) { cash -= alloc; open.push({ ...ev.t, alloc }); taken++; } else skipped++; }
    else skipped++;
  }
  // close remaining at their ret
  for (const p of open) { cash += p.alloc * (1 + p.ret / 100); rets.push(p.ret); }
  const eq = cash;
  const yrs = (to - from) / (365.25 * 86400);
  const cagr = (Math.pow(eq / 100000, 1 / yrs) - 1) * 100;
  const wins = rets.filter(r => r > 0).length;
  return { net: (eq / 100000 - 1) * 100, cagr, taken, skipped, perYr: taken / yrs, win: rets.length ? wins / rets.length * 100 : 0, avg: rets.length ? rets.reduce((a, r) => a + r, 0) / rets.length : 0, maxDD };
}

(async () => {
  let all = [];
  for (const s of UNIVERSE) { const b = await fetchDaily(s); if (b && b.length > 210) all.push(...signals(s, b)); process.stdout.write("."); }
  console.log(`\nBasket: ${UNIVERSE.length} names, ${all.length} dip signals 2015-2026\n`);
  const rpt = (lbl, w) => { const r = portfolio(all, w); console.log(`${lbl}: return ${r.net.toFixed(0)}%  CAGR ${r.cagr.toFixed(1)}%/yr  | ${r.taken} trades (${r.perYr.toFixed(0)}/yr)  win ${r.win.toFixed(0)}%  avg/trade ${r.avg.toFixed(2)}%  maxDD ${r.maxDD.toFixed(1)}%`); };
  console.log("STOCK basket (equal-weight, 8 slots, no leverage):");
  rpt("  IN-SAMPLE  2020-2023", IS);
  rpt("  OUT-SAMPLE 2024-2026", OOS);
  console.log("\n(avg/trade % is the underlying move; options multiply this by leverage. See notes.)");
})();
