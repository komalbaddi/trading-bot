// Performance analysis of all 3 bots: account equity curve + realized/unrealized P&L
// per bot (attributed by asset class). Read-only.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
let id = process.env.APCA_API_KEY_ID || "", sec = process.env.APCA_API_SECRET_KEY || "";
{ const f = path.join(__dir, "..", "analysis", "alpaca_keys.json"); if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = j.keyId; sec = j.secretKey; } }
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec };
const TRADE = "https://paper-api.alpaca.markets";
const get = async p => { const r = await fetch(TRADE + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };
const $ = n => (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2);
const botOf = (sym, ac) => (ac === "crypto" || /USD$/.test(sym) || sym.includes("/")) ? "BTC" : (ac === "us_option" || /\d{6}[CP]\d{5,}/.test(sym)) ? "OPTIONS" : "SWING";

async function allFills() {
  const out = []; let pageToken = null;
  do {
    const p = `/v2/account/activities?activity_types=FILL&page_size=100${pageToken ? `&page_token=${pageToken}` : ""}`;
    const batch = await get(p); out.push(...batch);
    pageToken = batch.length === 100 ? batch[batch.length - 1].id : null;
  } while (pageToken);
  return out;
}

(async () => {
  const acct = await get("/v2/account");
  const eq = +acct.equity;
  console.log(`\n================ BOT PERFORMANCE ANALYSIS ================`);

  // account-level equity curve
  try {
    const ph = await get("/v2/account/portfolio/history?period=3M&timeframe=1D");
    const eqs = (ph.equity || []).filter(x => x != null && x > 0);   // drop pre-funding zero/null days
    const base = eqs[0] || +ph.base_value || eq;
    let peak = -Infinity, maxDD = 0; for (const e of eqs) { peak = Math.max(peak, e); if (peak > 0) maxDD = Math.max(maxDD, (peak - e) / peak * 100); }
    const totalPL = eq - base;
    console.log(`Account: equity $${eq.toFixed(0)} | since start ${$(totalPL)} (${(totalPL / base * 100).toFixed(2)}%) | peak-to-trough drawdown ${maxDD.toFixed(1)}%`);
    console.log(`Tracking window: ${eqs.length} days`);
  } catch (e) { console.log(`(portfolio history unavailable: ${e.message})`); }

  // positions (unrealized) + fills (realized) by bot
  const positions = await get("/v2/positions");
  const fills = await allFills();
  console.log(`\nTotal fills recorded: ${fills.length}`);

  // per-symbol: buyCost, sellProceeds, count; + current market value
  const sym = {};
  for (const f of fills) {
    const b = botOf(f.symbol, "");
    const mult = b === "OPTIONS" ? 100 : 1;   // option contracts represent 100 shares — must scale price*qty
    const s = sym[f.symbol] ||= { buy: 0, sell: 0, nBuy: 0, nSell: 0, bot: b };
    const val = +f.price * +f.qty * mult;
    if (f.side === "buy") { s.buy += val; s.nBuy++; } else { s.sell += val; s.nSell++; }
  }
  for (const p of positions) { const s = sym[p.symbol] ||= { buy: 0, sell: 0, nBuy: 0, nSell: 0, bot: botOf(p.symbol, p.asset_class) }; s.mv = +p.market_value; s.bot = botOf(p.symbol, p.asset_class); }

  const bots = { SWING: [], OPTIONS: [], BTC: [] };
  for (const [s, d] of Object.entries(sym)) { const pl = (d.sell + (d.mv || 0)) - d.buy; bots[d.bot].push({ s, pl, ...d }); }

  for (const bot of ["SWING", "OPTIONS", "BTC"]) {
    const rows = bots[bot].filter(r => r.nBuy || r.nSell || r.mv);
    const total = rows.reduce((a, r) => a + r.pl, 0);
    const closed = rows.filter(r => !r.mv && (r.nBuy && r.nSell));
    const wins = closed.filter(r => r.pl > 0).length;
    console.log(`\n=== ${bot} BOT === total P/L ${$(total)} | ${rows.length} symbols traded${closed.length ? ` | closed ${closed.length} (${(wins / closed.length * 100).toFixed(0)}% win)` : ""}`);
    rows.sort((a, b) => b.pl - a.pl);
    for (const r of rows) console.log(`   ${r.s.padEnd(22)} ${$(r.pl).padStart(11)}  ${r.mv ? "(open)" : "(closed)"}  buys ${r.nBuy} sells ${r.nSell}`);
    if (!rows.length) console.log(`   (no trades yet)`);
  }
  console.log(`\n==========================================================`);
})();
