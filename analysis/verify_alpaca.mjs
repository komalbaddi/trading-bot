// Read-only Alpaca connection check. Places NO orders.
// Verifies: credentials work, account is reachable, market clock, and data access.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
let id = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || "";
let sec = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || "";
let feed = "iex";
const f = path.join(__dir, "alpaca_keys.json");
if ((!id || !sec) && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); id = j.keyId; sec = j.secretKey; feed = j.feed || feed; }
if (!id || !sec) { console.error("NO_CREDS"); process.exit(2); }
const H = { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": sec };
const mask = s => s.slice(0, 4) + "…" + s.slice(-2);

async function get(base, p, extraHeaders) {
  const r = await fetch(base + p, { headers: { ...H, ...extraHeaders } });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null };
}

(async () => {
  console.log(`Using key ${mask(id)} (paper endpoint)\n`);
  const acct = await get("https://paper-api.alpaca.markets", "/v2/account");
  if (!acct.ok) { console.error(`ACCOUNT CHECK FAILED: HTTP ${acct.status}`, acct.body); process.exit(1); }
  const a = acct.body;
  console.log("✅ Account connected");
  console.log(`   status:        ${a.status}`);
  console.log(`   equity:        $${(+a.equity).toLocaleString()}`);
  console.log(`   cash:          $${(+a.cash).toLocaleString()}`);
  console.log(`   buying power:   $${(+a.buying_power).toLocaleString()}`);
  console.log(`   pattern-day-trader: ${a.pattern_day_trader}`);

  const clk = await get("https://paper-api.alpaca.markets", "/v2/clock");
  console.log(`\n✅ Market clock: ${clk.body.is_open ? "OPEN" : "CLOSED"} (next open ${clk.body.next_open}, next close ${clk.body.next_close})`);

  const pos = await get("https://paper-api.alpaca.markets", "/v2/positions");
  console.log(`\n✅ Open positions: ${pos.body.length}`);
  for (const p of pos.body) console.log(`   ${p.symbol}: ${p.qty} @ ${p.avg_entry_price} (mkt ${p.market_value})`);

  // data access check
  const bars = await get("https://data.alpaca.markets", `/v2/stocks/AAPL/bars?timeframe=1Day&limit=3&feed=${feed}&adjustment=split`);
  if (bars.ok && bars.body.bars?.length) {
    const last = bars.body.bars[bars.body.bars.length - 1];
    console.log(`\n✅ Market data (${feed}): AAPL last daily bar ${last.t.slice(0,10)} close $${last.c}`);
  } else {
    console.log(`\n⚠️ Data check: HTTP ${bars.status} ${JSON.stringify(bars.body)} — free 'iex' feed may restrict recent data; historical still works.`);
  }
  console.log("\nAll good — credentials valid, no orders placed.");
})();
