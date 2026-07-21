// Daily summary of all 3 bots on the Alpaca account. Attributes positions/fills to
// each bot by ASSET CLASS: stocks=Swing, options=Options basket, crypto=BTC.
// Read-only. Run daily (e.g., each morning) to see what happened.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
let id = process.env.APCA_API_KEY_ID || "", sec = process.env.APCA_API_SECRET_KEY || "";
{ const f = path.join(__dir, "..", "analysis", "alpaca_keys.json"); if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = j.keyId; sec = j.secretKey; } }
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec };
const TRADE = "https://paper-api.alpaca.markets";
const get = async p => { const r = await fetch(TRADE + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
const $ = n => (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2);

function botOf(sym, assetClass) {
  if (assetClass === "crypto" || /USD$/.test(sym) || sym.includes("/")) return "BTC";
  if (assetClass === "us_option" || /\d{6}[CP]\d{5,}/.test(sym)) return "OPTIONS";
  return "SWING";
}

(async () => {
  const acct = await get("/v2/account");
  const eq = +acct.equity, last = +acct.last_equity, dayPL = eq - last;
  const positions = await get("/v2/positions");
  const today = new Date().toISOString().slice(0, 10);
  let fills = [];
  try { fills = await get(`/v2/account/activities?activity_types=FILL&after=${today}T00:00:00Z`); } catch {}

  console.log(`\n================ DAILY BOT REPORT — ${today} ================`);
  console.log(`Account equity: $${eq.toFixed(2)}   |   Today: ${$(dayPL)} (${(dayPL / last * 100).toFixed(2)}%)`);

  const groups = { SWING: [], OPTIONS: [], BTC: [] };
  for (const p of positions) groups[botOf(p.symbol, p.asset_class)].push(p);
  const label = { SWING: "SWING BOT (stocks)", OPTIONS: "OPTIONS BOT (options)", BTC: "BTC BOT (crypto)" };

  for (const bot of ["SWING", "OPTIONS", "BTC"]) {
    const ps = groups[bot];
    const upl = ps.reduce((a, p) => a + (+p.unrealized_pl), 0);
    const mv = ps.reduce((a, p) => a + (+p.market_value), 0);
    console.log(`\n--- ${label[bot]} --- ${ps.length} position(s), value $${mv.toFixed(0)}, unrealized ${$(upl)}`);
    for (const p of ps) {
      const plpc = (+p.unrealized_plpc * 100).toFixed(1);
      console.log(`   ${p.symbol.padEnd(22)} qty ${p.qty}  entry ${(+p.avg_entry_price).toFixed(2)}  now ${(+p.current_price).toFixed(2)}  ${$(+p.unrealized_pl)} (${plpc}%)`);
    }
    if (!ps.length) console.log(`   (flat — no positions)`);
  }

  console.log(`\n--- TODAY'S ACTIVITY (fills) ---`);
  if (!fills.length) console.log(`   No fills today.`);
  else for (const f of fills) console.log(`   ${botOf(f.symbol, f.asset_class || "").padEnd(7)} ${f.side.toUpperCase().padEnd(4)} ${f.symbol.padEnd(22)} ${f.qty} @ ${(+f.price).toFixed(2)}`);

  console.log(`\n============================================================`);
})();
