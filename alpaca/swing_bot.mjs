// =============================================================================
// ALPACA DAILY SWING BOT (Node.js) — mirrors Pine strategy 09 (tuned breakout).
// Long-only. Run ONCE PER DAY, after the US market close (~4:15pm ET).
//
//   Entry : 50-day high breakout while price > 200-EMA and 20-EMA > 50-EMA
//   Stop  : server-side GTC stop order, trailed to (highest-high-since-entry - 5*ATR)
//   Exit  : trailing stop (held by Alpaca), or regime flip (close < 200-EMA)
//   Size  : risk 1.5% of equity per trade, capped so notional <= equity (no leverage)
//
// PAPER TRADING by default. Keep it that way until you've watched it for weeks.
//
// CREDENTIALS (never pasted into chat):
//   env APCA_API_KEY_ID / APCA_API_SECRET_KEY, or file analysis/alpaca_keys.json
//
// RUN:  node alpaca\swing_bot.mjs
// SCHEDULE: Windows Task Scheduler -> daily 16:15 ET -> program "node", args this file.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------- CONFIG ----------------
const PAPER    = true;                                   // <<< keep true
const SYMBOLS  = ["AAPL","MSFT","NVDA","GOOGL","AMZN","META","AVGO","AMD","TSLA","JPM",
                  "V","UNH","JNJ","XOM","WMT","HD","COST","LLY","SPY","QQQ"]; // diversified watchlist
const BRK_LEN  = 50;      // breakout lookback (days)
const ATR_LEN  = 14;
const ATR_INIT = 2.5;     // initial stop = ATR x
const CH_MULT  = 6.0;     // trailing stop = ATR x (walk-forward optimum; 5-6 equivalent)
const RISK_PCT = 1.5;     // % equity risked per trade
const MAX_LEV  = 1.0;     // notional cap
const SLOTS      = 10;    // portfolio slots (each position ~ budget/SLOTS)
const BUDGET_PCT = 40;    // this bot's share of the whole account (rest goes to BTC / options bots)
const FEED     = "iex";   // "iex" (free) or "sip" (paid)
// ----------------------------------------

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dir, "..", "analysis", "swing_state.json");

function loadCreds() {
  let id = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || "";
  let sec = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || "";
  const f = path.join(__dir, "..", "analysis", "alpaca_keys.json");
  if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = id || j.keyId; sec = sec || j.secretKey; }
  return { id, sec };
}
const { id, sec } = loadCreds();
if (!id || !sec) { console.error("NO_CREDS: set env vars or create analysis/alpaca_keys.json"); process.exit(2); }

const TRADE = PAPER ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
const DATA  = "https://data.alpaca.markets";
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec, "Content-Type": "application/json" };

async function api(base, method, p, body) {
  const res = await fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404) return null;
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

const loadState = () => fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

function ema(v, p) { const k = 2 / (p + 1); let e = null; const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atr(bars, p) { const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))); const o = Array(bars.length).fill(null); let a = 0, pr = null; for (let i = 0; i < bars.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

async function getBars(sym) {
  const start = new Date(Date.now() - 400 * 86400000).toISOString();
  const bars = []; let token = null;
  do {
    const u = new URL(`${DATA}/v2/stocks/${sym}/bars`);
    u.searchParams.set("timeframe", "1Day"); u.searchParams.set("start", start);
    u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", FEED);
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`bars ${sym}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    for (const b of j.bars || []) bars.push({ d: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c });
    token = j.next_page_token;
  } while (token);
  // Inject the CURRENT (near-close) price so the breakout signal reflects NOW — this bot
  // is meant to run ~10 min before the close so entries execute same-day instead of gapping
  // at the next open. Falls back to the last daily close if the live price is unavailable.
  try {
    const q = await api(DATA, "GET", `/v2/stocks/${sym}/trades/latest?feed=${FEED}`);
    const lp = q?.trade?.p;
    if (lp && bars.length) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (bars[bars.length - 1].d === today) { bars[bars.length - 1].c = lp; bars[bars.length - 1].h = Math.max(bars[bars.length - 1].h, lp); bars[bars.length - 1].l = Math.min(bars[bars.length - 1].l, lp); }
      else bars.push({ d: today, o: lp, h: lp, l: lp, c: lp });
    }
  } catch { /* keep last daily close */ }
  return bars;
}

async function cancelOrder(oid) { if (oid) try { await api(TRADE, "DELETE", `/v2/orders/${oid}`); } catch (e) { /* already gone */ } }
async function placeStop(sym, qty, stop) {
  return api(TRADE, "POST", "/v2/orders", { symbol: sym, qty: String(qty), side: "sell", type: "stop", stop_price: stop.toFixed(2), time_in_force: "gtc" });
}

async function processSymbol(sym, equity, state, avail) {
  const bars = await getBars(sym);
  if (bars.length < 210) { console.log(`[${sym}] not enough history (${bars.length})`); return; }
  const c = bars.map(b => b.c);
  const eF = ema(c, 20), eM = ema(c, 50), eT = ema(c, 200), a = atr(bars, ATR_LEN);
  const i = bars.length - 1, b = bars[i];
  const upRegime = b.c > eT[i] && eF[i] > eM[i];
  let priorHigh = -Infinity; for (let k = i - BRK_LEN; k < i; k++) priorHigh = Math.max(priorHigh, bars[k].h);

  const pos = await api(TRADE, "GET", `/v2/positions/${sym}`);   // null if flat
  const st = state[sym];

  // ---------------- FLAT: look for entry ----------------
  if (!pos) {
    if (state[sym]) delete state[sym];                            // clean stale state
    if (upRegime && b.c > priorHigh) {
      // SAFETY: if a buy order is already pending (unfilled, e.g. placed while market closed),
      // do NOT place another — this prevents the duplicate-order bug (the 3x JNJ issue).
      const openOrders = await api(TRADE, "GET", `/v2/orders?status=open&symbols=${sym}&limit=10`);
      if (openOrders && openOrders.length > 0) { console.log(`[${sym}] breakout but an order is already pending — skip (no duplicate)`); return; }
      const stopDist = a[i] * ATR_INIT;
      const allocCap = (equity * BUDGET_PCT / 100) / SLOTS;                  // per position, within this bot's budget
      const notionalCap = Math.min(equity * MAX_LEV, allocCap, avail.cash);  // never exceed available cash
      const qty = Math.floor(Math.min((equity * RISK_PCT / 100) / stopDist, notionalCap / b.c));
      if (qty < 1) { console.log(`[${sym}] breakout but no capital slot free (avail cash $${avail.cash.toFixed(0)})`); return; }
      await api(TRADE, "POST", "/v2/orders", { symbol: sym, qty: String(qty), side: "buy", type: "market", time_in_force: "day" });
      avail.cash -= qty * b.c;                                               // reserve the capital for this run
      state[sym] = { entryDate: b.d, hi: b.h, stop: +(b.c - stopDist).toFixed(2), stopOrderId: null };
      console.log(`[${sym}] ENTER breakout: buy ${qty} @~${b.c.toFixed(2)} (>50d high ${priorHigh.toFixed(2)}), init stop ${state[sym].stop}. Stop order placed next run.`);
    } else {
      console.log(`[${sym}] flat, no signal (regime ${upRegime ? "UP" : "down"}, close ${b.c.toFixed(2)} vs 50d high ${priorHigh.toFixed(2)})`);
    }
    return;
  }

  // ---------------- IN POSITION: manage trail / regime exit ----------------
  const qty = Math.abs(parseFloat(pos.qty));
  const entryStop = st ? st.stop : +(parseFloat(pos.avg_entry_price) - a[i] * ATR_INIT).toFixed(2);
  const hi = Math.max(st ? st.hi : b.h, b.h);
  const newStop = +Math.max(entryStop, hi - a[i] * CH_MULT).toFixed(2);

  if (b.c < eT[i]) {                                              // regime flip -> exit
    await cancelOrder(st?.stopOrderId);
    await api(TRADE, "DELETE", `/v2/positions/${sym}`);
    delete state[sym];
    console.log(`[${sym}] REGIME FLIP (close ${b.c.toFixed(2)} < 200EMA ${eT[i].toFixed(2)}) -> closed position.`);
    return;
  }

  let oid = st?.stopOrderId;
  if (!oid || newStop > (st?.stop ?? -Infinity)) {                // create or ratchet up the stop
    await cancelOrder(oid);
    const o = await placeStop(sym, qty, newStop);
    oid = o?.id || null;
    console.log(`[${sym}] hold ${qty} sh, trailing stop -> ${newStop} (hi ${hi.toFixed(2)}, ATRx${CH_MULT}).`);
  } else {
    console.log(`[${sym}] hold ${qty} sh, stop stays ${st.stop}.`);
  }
  state[sym] = { entryDate: st?.entryDate || b.d, hi, stop: newStop, stopOrderId: oid };
}

(async () => {
  const acct = await api(TRADE, "GET", "/v2/account");
  const clock = await api(TRADE, "GET", "/v2/clock");
  const equity = parseFloat(acct.equity);
  const avail = { cash: Math.min(parseFloat(acct.cash), equity * BUDGET_PCT / 100) };  // cap total to this bot's budget
  console.log(`Alpaca ${PAPER ? "PAPER" : "LIVE"} | equity $${equity.toFixed(0)} | cash $${avail.cash.toFixed(0)} | ${SYMBOLS.length} symbols | market ${clock.is_open ? "OPEN" : "closed"} | ${new Date().toISOString()}`);
  if (clock.is_open) console.log("NOTE: market is open — for clean daily signals run this AFTER the close (~16:15 ET).");
  const state = loadState();
  for (const sym of SYMBOLS) {
    try { await processSymbol(sym, equity, state, avail); }
    catch (e) { console.error(`[${sym}] ERROR: ${e.message}`); }
  }
  saveState(state);
  console.log("Done. State saved to analysis/swing_state.json");
})();
