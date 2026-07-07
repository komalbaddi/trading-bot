// AAPL multi-timeframe TA (price action + EMA 20/50/100/200) using ALPACA market data.
// Native Alpaca timeframes: 4Hour, 1Day, 1Week, 1Month  (no resampling needed).
//
// CREDENTIALS (read in this order — you never paste keys into chat):
//   1) Env vars:  APCA_API_KEY_ID / APCA_API_SECRET_KEY   (or ALPACA_API_KEY / ALPACA_SECRET_KEY)
//   2) Local file: analysis/alpaca_keys.json  ->  { "keyId": "...", "secretKey": "...", "feed": "iex" }
//
// feed: "iex" (free plan) or "sip" (paid). Free IEX history is shallow, so monthly
//       EMA100/200 may be n/a — that's a data-plan limit, not a bug.
//
// Run:  node analysis/aapl_ta_alpaca.mjs AAPL

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYMBOL = process.argv[2] || "AAPL";
const __dir = path.dirname(fileURLToPath(import.meta.url));

function loadCreds() {
  let keyId = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || "";
  let secretKey = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || "";
  let feed = process.env.ALPACA_FEED || "iex";
  const f = path.join(__dir, "alpaca_keys.json");
  if ((!keyId || !secretKey) && fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    keyId = keyId || j.keyId; secretKey = secretKey || j.secretKey; feed = j.feed || feed;
  }
  return { keyId, secretKey, feed };
}

const { keyId, secretKey, feed } = loadCreds();
if (!keyId || !secretKey) {
  console.error("NO_CREDS: set APCA_API_KEY_ID/APCA_API_SECRET_KEY env vars, or create analysis/alpaca_keys.json");
  process.exit(2);
}
const HEADERS = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };

function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

async function fetchBars(timeframe, startISO) {
  const bars = [];
  let pageToken = null;
  do {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars`);
    u.searchParams.set("timeframe", timeframe);
    u.searchParams.set("start", startISO);
    u.searchParams.set("limit", "10000");
    u.searchParams.set("adjustment", "split");
    u.searchParams.set("feed", feed);
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const res = await fetch(u, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${timeframe}: ${await res.text()}`);
    const j = await res.json();
    for (const b of j.bars || []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    pageToken = j.next_page_token;
  } while (pageToken);
  return bars;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  let prev = sma / period; out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
const pct = (a, b) => ((a - b) / b) * 100;
const fmt = (x) => (x == null ? "n/a" : x.toFixed(2));
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
function slope(s, i, back) { const a = s[i], b = s[i - back]; return a == null || b == null ? null : pct(a, b); }

function analyze(name, bars) {
  if (bars.length === 0) { console.log(`\n==== ${name}: NO DATA (feed=${feed}) ====`); return null; }
  const closes = bars.map(b => b.c);
  const n = closes.length, i = n - 1, price = closes[i];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e100 = ema(closes, 100), e200 = ema(closes, 200);
  const emas = { 20: e20[i], 50: e50[i], 100: e100[i], 200: e200[i] };
  const items = [["Price", price], ["EMA20", emas[20]], ["EMA50", emas[50]], ["EMA100", emas[100]], ["EMA200", emas[200]]]
    .filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  const lookback = Math.min({ "4H": 120, "Daily": 252, "Weekly": 260, "Monthly": 120 }[name] || 252, n);
  const start = n - lookback; let hi = -Infinity, lo = Infinity, hiT, loT;
  for (let k = start; k < n; k++) { if (bars[k].h > hi) { hi = bars[k].h; hiT = bars[k].t; } if (bars[k].l < lo) { lo = bars[k].l; loT = bars[k].t; } }
  const chg = { 5: slope(closes, i, Math.min(5, i)), 20: slope(closes, i, Math.min(20, i)), 60: slope(closes, i, Math.min(60, i)) };

  console.log(`\n================ ${name}  (${n} bars, last ${dstr(bars[i].t)}) ================`);
  console.log(`Last close: ${fmt(price)}`);
  console.log(`EMA20=${fmt(emas[20])}  EMA50=${fmt(emas[50])}  EMA100=${fmt(emas[100])}  EMA200=${fmt(emas[200])}`);
  console.log(`Price vs: EMA20 ${emas[20] ? pct(price, emas[20]).toFixed(2) : "n/a"}% | EMA50 ${emas[50] ? pct(price, emas[50]).toFixed(2) : "n/a"}% | EMA100 ${emas[100] ? pct(price, emas[100]).toFixed(2) : "n/a"}% | EMA200 ${emas[200] ? pct(price, emas[200]).toFixed(2) : "n/a"}%`);
  console.log(`Stack (high->low): ${items.map(x => `${x[0]}=${fmt(x[1])}`).join("  >  ")}`);
  console.log(`Change: 5-bar ${fmt(chg[5])}% | 20-bar ${fmt(chg[20])}% | 60-bar ${fmt(chg[60])}%`);
  console.log(`Range(${lookback}b): high ${fmt(hi)} (${dstr(hiT)})  low ${fmt(lo)} (${dstr(loT)})  | ${pct(price, lo).toFixed(1)}% above low, ${pct(price, hi).toFixed(1)}% from high`);
  return { name, price, emas, hi, lo, lastDate: dstr(bars[i].t), bars: n };
}

(async () => {
  try {
    console.log(`\n#### ALPACA TA for ${SYMBOL} (feed=${feed}) ####`);
    const h4 = await fetchBars("4Hour", isoDaysAgo(730));
    const daily = await fetchBars("1Day", isoDaysAgo(365 * 3));
    const weekly = await fetchBars("1Week", isoDaysAgo(365 * 12));
    const monthly = await fetchBars("1Month", isoDaysAgo(365 * 25));
    const R = {};
    R.h4 = analyze("4H", h4);
    R.daily = analyze("Daily", daily);
    R.weekly = analyze("Weekly", weekly);
    R.monthly = analyze("Monthly", monthly);
    console.log("\n#### JSON ####");
    console.log(JSON.stringify(Object.fromEntries(Object.entries(R).filter(([, v]) => v).map(([k, v]) => [k, {
      lastDate: v.lastDate, bars: v.bars, price: +v.price.toFixed(2),
      ema: Object.fromEntries(Object.entries(v.emas).map(([p, x]) => [p, x == null ? null : +x.toFixed(2)])),
      hi: +v.hi.toFixed(2), lo: +v.lo.toFixed(2)
    }]))));
  } catch (e) {
    console.error("FETCH FAILED:", e.message);
    process.exit(1);
  }
})();
