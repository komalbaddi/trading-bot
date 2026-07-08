// =============================================================================
// BTC/USD TREND BOT (6-hour) — loss-minimized, runs every 6 hours.
// Strategy (walk-forward optimized to MINIMIZE drawdown): EMA 20/100 cross on 6h bars,
// exit on 5xATR trailing stop or EMA cross-down. Long/flat. OOS: +68%, 18% maxDD, 52% win.
//
// Data: Binance public 6h bars (free, current). Execution: Alpaca PAPER crypto (24/7).
// SAFETY: DRY_RUN=true by default = logs only. Set false to place paper crypto orders.
//
// RUN every 6h: node alpaca\btc_bot.mjs   (schedule via GitHub Actions cron "5 */6 * * *")
// =============================================================================
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));

// ---------------- CONFIG ----------------
const PAPER   = true;
const DRY_RUN = true;                 // <<< true = log only. Set false to place paper orders.
const FAST = 20, SLOW = 100, ATR_LEN = 14, TRAIL = 5, INIT = 3;
const ALLOC_PCT = 30;                 // this bot's share of the account (rest goes to swing / options bots)
// ----------------------------------------

let id = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || "";
let sec = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || "";
{ const f = path.join(__dir, "..", "analysis", "alpaca_keys.json"); if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = id || j.keyId; sec = sec || j.secretKey; } }
if (!id || !sec) { console.error("NO_CREDS"); process.exit(2); }
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec, "Content-Type": "application/json" };
const TRADE = PAPER ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
const STATE = path.join(__dir, "..", "analysis", "btc_state.json");
const loadState = () => fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const saveState = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

async function api(method, p, body) {
  const r = await fetch(TRADE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) return null;
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}
async function bars6h() {
  const base = "https://data-api.binance.vision/api/v3/klines";
  let start = Date.now() - 400 * 6 * 3600 * 1000; const out = []; let g = 0;      // ~400 6h bars
  while (start < Date.now() && g++ < 10) {
    const r = await fetch(`${base}?symbol=BTCUSDT&interval=6h&startTime=${start}&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const k = await r.json(); if (!k.length) break;
    for (const row of k) out.push({ o: +row[1], h: +row[2], l: +row[3], c: +row[4], ct: row[6] });
    start = k[k.length - 1][6] + 1; if (k.length < 1000) break;
  }
  return out.filter(b => b.ct < Date.now());   // only fully CLOSED 6h bars
}
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atr(b, p) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

(async () => {
  const acct = await api("GET", "/v2/account"); const equity = parseFloat(acct.equity);
  const b = await bars6h(); const c = b.map(x => x.c);
  const eF = ema(c, FAST), eS = ema(c, SLOW), aa = atr(b, ATR_LEN), i = b.length - 1;
  const price = c[i], up = eF[i] > eS[i], crossUp = eF[i] > eS[i] && eF[i - 1] <= eS[i - 1], crossDn = eF[i] < eS[i];

  const positions = await api("GET", "/v2/positions");
  const pos = (positions || []).find(p => p.symbol.includes("BTC"));
  const st = loadState();

  console.log(`\n=== BTC 6h BOT (${DRY_RUN ? "DRY-RUN" : "LIVE PAPER"}) === ${new Date().toISOString()}`);
  console.log(`equity $${equity.toFixed(0)} | BTC $${price.toFixed(0)} | EMA20 ${eF[i].toFixed(0)} EMA100 ${eS[i].toFixed(0)} -> ${up ? "UPTREND" : "downtrend"} | ATR ${aa[i].toFixed(0)}`);

  if (pos && parseFloat(pos.qty) > 0) {
    // manage open position
    let s = st.btc || { entry: parseFloat(pos.avg_entry_price), hi: price, stop: parseFloat(pos.avg_entry_price) - aa[i] * INIT };
    s.hi = Math.max(s.hi, b[i].h);
    s.stop = Math.max(s.stop, s.hi - aa[i] * TRAIL);
    if (price <= s.stop || crossDn) {
      console.log(`SELL: ${price <= s.stop ? "trailing stop hit" : "EMA cross-down"} @ $${price.toFixed(0)} (stop ${s.stop.toFixed(0)}). Closing ${pos.qty} BTC.`);
      if (!DRY_RUN) { try { await api("DELETE", `/v2/positions/${encodeURIComponent(pos.symbol)}`); } catch (e) { console.log("  sell err:", e.message); } }
      delete st.btc;
    } else { console.log(`HOLD: ${pos.qty} BTC, trailing stop $${s.stop.toFixed(0)} (${((price / s.stop - 1) * 100).toFixed(1)}% above).`); st.btc = s; }
  } else {
    // flat -> look for entry
    if (crossUp) {
      const notional = Math.round(equity * ALLOC_PCT / 100);
      console.log(`BUY: EMA20 crossed above EMA100 (uptrend). Deploy $${notional} into BTC @ ~$${price.toFixed(0)}.`);
      if (!DRY_RUN) { try { await api("POST", "/v2/orders", { symbol: "BTC/USD", notional: String(notional), side: "buy", type: "market", time_in_force: "gtc" }); } catch (e) { console.log("  buy err:", e.message); } }
      st.btc = { entry: price, hi: b[i].h, stop: price - aa[i] * INIT };
    } else console.log(`FLAT: no entry (need EMA20 to cross above EMA100). Currently ${up ? "uptrend but no fresh cross" : "downtrend — stay out"}.`);
  }
  saveState(st);
  console.log(`Done.${DRY_RUN ? " DRY-RUN — no orders placed." : ""}`);
})();
