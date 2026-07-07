// AAPL multi-timeframe technical analysis: price action + EMA 20/50/100/200
// Data: Yahoo Finance chart API (no key). Node 18+ (global fetch).
const SYMBOL = process.argv[2] || "AAPL";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" };

async function fetchChart(interval, range) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastErr;
  for (const h of hosts) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}&includePrePost=false`;
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const j = await res.json();
      const r = j.chart?.result?.[0];
      if (!r) { lastErr = new Error("no result"); continue; }
      const ts = r.timestamp || [];
      const q = r.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] });
      }
      return bars;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function resample4h(bars) {
  const m = new Map();
  for (const b of bars) {
    const key = Math.floor(b.t / (4 * 3600)) * (4 * 3600);
    const cur = m.get(key);
    if (!cur) m.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return [...m.values()].sort((a, b) => a.t - b.t);
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  let prev = sma / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function pct(a, b) { return ((a - b) / b) * 100; }
function fmt(x) { return x == null ? "n/a" : x.toFixed(2); }
function dstr(t) { return new Date(t * 1000).toISOString().slice(0, 10); }

function slope(series, lastIdx, back) {
  const now = series[lastIdx], then = series[lastIdx - back];
  if (now == null || then == null) return null;
  return pct(now, then);
}

function analyze(name, bars) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const i = n - 1;
  const price = closes[i];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e100 = ema(closes, 100), e200 = ema(closes, 200);
  const emas = { 20: e20[i], 50: e50[i], 100: e100[i], 200: e200[i] };

  // stack order (highest to lowest) among price + emas
  const items = [["Price", price], ["EMA20", emas[20]], ["EMA50", emas[50]], ["EMA100", emas[100]], ["EMA200", emas[200]]]
    .filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);

  // range over lookback
  const lookback = { "4H": 120, "Daily": 252, "Weekly": 260, "Monthly": 120 }[name] || Math.min(252, n);
  const start = Math.max(0, n - lookback);
  let hi = -Infinity, lo = Infinity, hiT, loT;
  for (let k = start; k < n; k++) { if (bars[k].h > hi) { hi = bars[k].h; hiT = bars[k].t; } if (bars[k].l < lo) { lo = bars[k].l; loT = bars[k].t; } }

  const chg = { "5": slope(closes, i, 5), "20": slope(closes, i, 20), "60": slope(closes, i, 60) };
  const emaSlope20 = slope(e20, i, Math.min(10, i)), emaSlope50 = slope(e50, i, Math.min(10, i)), emaSlope200 = slope(e200, i, Math.min(20, i));

  console.log(`\n================ ${name}  (${n} bars, last ${dstr(bars[i].t)}) ================`);
  console.log(`Last close: ${fmt(price)}`);
  console.log(`EMA20=${fmt(emas[20])}  EMA50=${fmt(emas[50])}  EMA100=${fmt(emas[100])}  EMA200=${fmt(emas[200])}`);
  console.log(`Price vs: EMA20 ${emas[20] ? pct(price, emas[20]).toFixed(2) : "n/a"}% | EMA50 ${emas[50] ? pct(price, emas[50]).toFixed(2) : "n/a"}% | EMA100 ${emas[100] ? pct(price, emas[100]).toFixed(2) : "n/a"}% | EMA200 ${emas[200] ? pct(price, emas[200]).toFixed(2) : "n/a"}%`);
  console.log(`Stack (high->low): ${items.map(x => `${x[0]}=${fmt(x[1])}`).join("  >  ")}`);
  console.log(`EMA slope (recent): EMA20 ${fmt(emaSlope20)}% | EMA50 ${fmt(emaSlope50)}% | EMA200 ${fmt(emaSlope200)}%`);
  console.log(`Change: 5-bar ${fmt(chg["5"])}% | 20-bar ${fmt(chg["20"])}% | 60-bar ${fmt(chg["60"])}%`);
  console.log(`Range(${lookback}b): high ${fmt(hi)} (${dstr(hiT)})  low ${fmt(lo)} (${dstr(loT)})  | price is ${pct(price, lo).toFixed(1)}% above low, ${pct(price, hi).toFixed(1)}% from high`);

  return { name, price, emas, items, chg, hi, lo, lastDate: dstr(bars[i].t) };
}

(async () => {
  try {
    const daily = await fetchChart("1d", "3y");
    const weekly = await fetchChart("1wk", "10y");
    const monthly = await fetchChart("1mo", "max");
    const hourly = await fetchChart("1h", "730d");
    const h4 = resample4h(hourly);

    console.log(`\n#### TECHNICAL ANALYSIS DATA FOR ${SYMBOL} ####`);
    const R = {};
    R.h4 = analyze("4H", h4);
    R.daily = analyze("Daily", daily);
    R.weekly = analyze("Weekly", weekly);
    R.monthly = analyze("Monthly", monthly);

    console.log("\n#### JSON SUMMARY ####");
    console.log(JSON.stringify(Object.fromEntries(Object.entries(R).map(([k, v]) => [k, {
      lastDate: v.lastDate, price: +v.price.toFixed(2),
      ema: Object.fromEntries(Object.entries(v.emas).map(([p, x]) => [p, x == null ? null : +x.toFixed(2)])),
      hi: +v.hi.toFixed(2), lo: +v.lo.toFixed(2)
    }])), null, 0));
  } catch (e) {
    console.error("FETCH FAILED:", e.message);
    process.exit(1);
  }
})();
