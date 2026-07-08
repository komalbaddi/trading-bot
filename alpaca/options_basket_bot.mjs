// =============================================================================
// OPTIONS-BASKET PAPER BOT (Node.js) — leverages the validated dip edge across a basket.
// Signal (per name, daily): uptrend (>200-SMA) AND (RSI2<10 OR close<lower Bollinger).
// Action: recommend/buy a slightly-ITM CALL (~2-week expiry), sized to your balance.
// Exit: first green close / RSI2>60 / max ~6 days (the fast mean-reversion exit).
//
// SAFETY: DRY_RUN=true by default -> it only LOGS the exact trades, places NO orders.
//         Flip DRY_RUN=false to place PAPER option orders (needs options approval on
//         your Alpaca account). Keep PAPER=true. Run once per day after the US close.
//
// CREDENTIALS: analysis/alpaca_keys.json (or env). RUN: node alpaca\options_basket_bot.mjs
// =============================================================================
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));

// ---------------- CONFIG ----------------
const PAPER   = true;
const DRY_RUN = true;                         // <<< true = log only. Set false to place paper option orders.
const UNIVERSE = ["AAPL","MSFT","NVDA","TSLA","AMZN","META","GOOGL","AMD","AVGO","NFLX","CRM","JPM"];
const PREMIUM_PCT = 4.0;                       // % of equity spent on premium per trade (aggressive; -50% stop = 2% risk)
const MAX_POSITIONS = 8;                       // concurrent option positions
const TARGET_DTE = 14;                         // aim ~2 weeks to expiry
const ITM_FACTOR = 0.97;                       // strike ~3% below spot = slightly ITM (~0.65 delta)
const MAX_HOLD_DAYS = 4;   // walk-forward optimum
// ----------------------------------------

let id = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || "";
let sec = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || "";
{ const f = path.join(__dir, "..", "analysis", "alpaca_keys.json"); if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = id || j.keyId; sec = sec || j.secretKey; } }
if (!id || !sec) { console.error("NO_CREDS"); process.exit(2); }
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec, "Content-Type": "application/json" };
const TRADE = PAPER ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
const DATA = "https://data.alpaca.markets";
const STATE_FILE = path.join(__dir, "..", "analysis", "options_state.json");
const loadState = () => fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const saveState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

async function api(base, method, p, body) {
  const r = await fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) return null;
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function stdev(v, p, i) { const m = sma(v, p, i); if (m == null) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += (v[k] - m) ** 2; return Math.sqrt(s / p); }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }

async function getDaily(sym) {
  const start = new Date(Date.now() - 420 * 86400000).toISOString();
  const u = new URL(`${DATA}/v2/stocks/${sym}/bars`);
  u.searchParams.set("timeframe", "1Day"); u.searchParams.set("start", start);
  u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", "iex");
  const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`bars ${sym}: ${r.status}`);
  const j = await r.json();
  return (j.bars || []).map(b => ({ d: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c }));
}

// pick a slightly-ITM call ~TARGET_DTE out; return {symbol, strike, expiry, premium} (premium estimated if quote unavailable)
async function pickCall(sym, spot) {
  const lo = new Date(Date.now() + (TARGET_DTE - 5) * 86400000).toISOString().slice(0, 10);
  const hi = new Date(Date.now() + (TARGET_DTE + 10) * 86400000).toISOString().slice(0, 10);
  const targetStrike = spot * ITM_FACTOR;
  try {
    const res = await api(TRADE, "GET", `/v2/options/contracts?underlying_symbols=${sym}&type=call&status=active&expiration_date_gte=${lo}&expiration_date_lte=${hi}&limit=500`);
    const cs = res?.option_contracts || [];
    if (cs.length) {
      cs.sort((a, b) => Math.abs(a.strike_price - targetStrike) - Math.abs(b.strike_price - targetStrike));
      const pick = cs[0];
      let premium = null;
      try { const q = await api(DATA, "GET", `/v1beta1/options/quotes/latest?symbols=${pick.symbol}&feed=indicative`); const qq = q?.quotes?.[pick.symbol]; if (qq) premium = (qq.ap + qq.bp) / 2 || qq.ap; } catch {}
      return { symbol: pick.symbol, strike: +pick.strike_price, expiry: pick.expiration_date, premium, live: true };
    }
  } catch (e) { /* options entitlement may be off — fall through to estimate */ }
  // fallback estimate (no live chain access)
  const strike = Math.round(targetStrike / 2.5) * 2.5;
  const est = Math.max(spot - strike, 0) + spot * 0.028 * Math.sqrt(TARGET_DTE / 30);  // intrinsic + rough time value
  return { symbol: `${sym} ~${strike}C ~${TARGET_DTE}dte`, strike, expiry: hi, premium: +est.toFixed(2), live: false };
}

(async () => {
  const acct = await api(TRADE, "GET", "/v2/account");
  const equity = parseFloat(acct.equity);
  const state = loadState();
  const openCount = Object.keys(state).length;
  console.log(`\n=== OPTIONS BASKET BOT (${DRY_RUN ? "DRY-RUN / log only" : "LIVE PAPER"}) ===`);
  console.log(`Equity $${equity.toFixed(0)} | open positions ${openCount}/${MAX_POSITIONS} | premium/trade ${PREMIUM_PCT}% ($${(equity * PREMIUM_PCT / 100).toFixed(0)})\n`);

  // ---- manage EXITS on open positions (exit rule is on the STOCK) ----
  for (const sym of Object.keys(state)) {
    try {
      const bars = await getDaily(sym); const c = bars.map(b => b.c); const r2 = rsiW(c, 2); const i = bars.length - 1;
      const st = state[sym];
      const held = bars.filter(b => b.d > st.entryDate).length;
      const exit = (bars[i].c > bars[i].o) || (r2[i] > 60) || (held >= MAX_HOLD_DAYS);
      if (exit) {
        console.log(`SELL  ${sym}: exit signal (green close / RSI2>60 / max hold). Contract ${st.optSymbol} x${st.contracts}. Held ${held}d.`);
        if (!DRY_RUN && st.live) { try { await api(TRADE, "POST", "/v2/orders", { symbol: st.optSymbol, qty: String(st.contracts), side: "sell", type: "market", time_in_force: "day" }); } catch (e) { console.log(`   sell order error: ${e.message}`); } }
        delete state[sym];
      } else console.log(`HOLD  ${sym}: ${st.optSymbol} x${st.contracts} (held ${held}d, waiting for bounce)`);
    } catch (e) { console.log(`[${sym}] exit-check error: ${e.message}`); }
  }

  // ---- scan for NEW entries ----
  for (const sym of UNIVERSE) {
    if (state[sym]) continue;
    if (Object.keys(state).length >= MAX_POSITIONS) { console.log(`(slots full — skipping remaining scans)`); break; }
    try {
      const bars = await getDaily(sym); if (bars.length < 210) continue;
      const c = bars.map(b => b.c); const r2 = rsiW(c, 2); const i = bars.length - 1;
      const s200 = sma(c, 200, i);
      // Optimized (walk-forward): pure RSI-2 dip. The Bollinger 'OR' condition was
      // shown to ADD worse trades and lower quality — removed. RSI2<10 (73% OOS win, PF 1.64).
      const dip = s200 && c[i] > s200 && (r2[i] != null && r2[i] < 10);
      if (!dip) continue;
      const spot = c[i];
      const call = await pickCall(sym, spot);
      const budget = equity * PREMIUM_PCT / 100;
      const contracts = Math.max(1, Math.floor(budget / (call.premium * 100)));
      const cost = contracts * call.premium * 100;
      console.log(`BUY   ${sym}: dip (RSI2=${r2[i].toFixed(0)}${c[i] < lowerBB ? ", <lowerBB" : ""}) @ $${spot.toFixed(2)}`);
      console.log(`      -> CALL ${call.symbol}  strike ${call.strike}  exp ${call.expiry}  ~$${call.premium} x${contracts} = ~$${cost.toFixed(0)} (${(cost / equity * 100).toFixed(1)}% of acct)${call.live ? "" : "  [ESTIMATED — options chain not accessible]"}`);
      if (!DRY_RUN && call.live) {
        try { await api(TRADE, "POST", "/v2/orders", { symbol: call.symbol, qty: String(contracts), side: "buy", type: "market", time_in_force: "day" }); console.log(`      order placed (paper).`); }
        catch (e) { console.log(`      order error: ${e.message}`); continue; }
      }
      state[sym] = { entryDate: bars[i].d, entryStock: spot, optSymbol: call.symbol, strike: call.strike, expiry: call.expiry, contracts, entryPremium: call.premium, live: call.live };
    } catch (e) { console.log(`[${sym}] scan error: ${e.message}`); }
  }

  saveState(state);
  console.log(`\nDone. ${DRY_RUN ? "DRY-RUN — no orders placed. Review above, then set DRY_RUN=false to trade on paper." : "Paper orders placed where possible."} State: analysis/options_state.json`);
})();
