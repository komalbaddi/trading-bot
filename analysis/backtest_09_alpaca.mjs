// Final backtest of STRATEGY 09 (the swing bot's exact logic) on ALPACA daily data,
// across the bot's watchlist, with walk-forward IS/OOS split. Realistic slippage.
// Params match swing_bot.mjs: 50-day breakout, 200-EMA regime, init 2.5 ATR,
// chandelier trail 6 ATR (highest-since-entry), risk 1.5%, leverage cap 1x.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(fs.readFileSync(path.join(__dir, "alpaca_keys.json"), "utf8"));
const H = { "APCA-API-KEY-ID": j.keyId, "APCA-API-SECRET-KEY": j.secretKey };
const FEED = j.feed || "iex";
const SYMBOLS = (process.argv[2] || "AAPL,MSFT,NVDA,SPY,QQQ").split(",");

// strategy 09 params
const P = { brk: 50, init: 2.5, ch: 6.0, riskPct: 1.5, maxLev: 1.0, slip: 0.02 };
const IS_TO = Date.parse("2021-06-30") / 1000;   // in-sample ends mid-2021
const OOS_FROM = IS_TO;

async function fetchDaily(sym) {
  const bars = []; let token = null, pages = 0;
  do {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${sym}/bars`);
    u.searchParams.set("timeframe", "1Day"); u.searchParams.set("start", "2016-01-01T00:00:00Z");
    u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", FEED);
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`${sym}: HTTP ${r.status} ${await r.text()}`);
    const d = await r.json();
    for (const b of d.bars || []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c });
    token = d.next_page_token; pages++;
  } while (token && pages < 20);
  return bars;
}
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let s = 0; for (let i = 0; i < p; i++) s += v[i]; let e = s / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr14(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0; for (let i = 0; i < p; i++) a += tr[i]; let pr = a / p; o[p - 1] = pr; for (let i = p; i < b.length; i++) { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } return o; }
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);

function run(bars, from, to) {
  const c = bars.map(b => b.c), eF = ema(c, 20), eM = ema(c, 50), eT = ema(c, 200), atr = atr14(bars);
  const hp = (i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, bars[k].h); return m; };
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  let s = 201; while (s < bars.length && bars[s].t < from) s++;
  let startC = null, endIdx = s;
  for (let i = s; i < bars.length && bars[i].t <= to; i++) {
    const b = bars[i]; endIdx = i; if (startC == null) startC = b.c;
    if (pos) {
      pos.hi = Math.max(pos.hi, b.h); pos.stop = Math.max(pos.stop, pos.hi - atr[i] * P.ch);
      let ex = null;
      if (b.l <= pos.stop) ex = Math.min(b.o, pos.stop);
      else if (b.c < eT[i]) ex = b.c;                       // regime flip
      if (ex != null) { const pnl = ((ex - P.slip) - (pos.entry + P.slip)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); }
    }
    if (!pos) {
      const up = b.c > eT[i] && eF[i] > eM[i];
      if (up && b.c > hp(i, P.brk)) { const sd = atr[i] * P.init; const qty = Math.min((eq * P.riskPct / 100) / sd, (eq * P.maxLev) / b.c); pos = { entry: b.c, qty, stop: b.c - sd, hi: b.h }; }
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  if (pos) { eq += ((c[endIdx] - P.slip) - (pos.entry + P.slip)) * pos.qty; }
  const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0);
  return { net: (eq / 10000 - 1) * 100, bh: startC ? (c[endIdx] / startC - 1) * 100 : 0, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD, from: dstr(bars[s].t), to: dstr(bars[endIdx].t) };
}

(async () => {
  const data = {}; for (const sfull of SYMBOLS) { try { const b = await fetchDaily(sfull); if (b.length > 210) data[sfull] = b; else console.log(`${sfull}: only ${b.length} bars, skipped`); } catch (e) { console.log(`${sfull}: ${e.message}`); } }
  const syms = Object.keys(data);
  console.log(`\nSTRATEGY 09 on ALPACA daily (${FEED}) — ${syms.join(", ")}\n`);

  const period = (label, from, to) => {
    console.log(`===== ${label} =====`);
    console.log("symbol | net%   buy&hold%  trades win%  PF    maxDD%   period");
    let sN = 0, sPF = 0, sDD = 0, beat = 0;
    for (const s of syms) { const r = run(data[s], from, to); sN += r.net; sPF += Math.min(r.pf, 5); sDD += r.maxDD; if (r.net > r.bh) beat++;
      console.log(`${s.padEnd(6)} | ${r.net.toFixed(0).padStart(5)}  ${r.bh.toFixed(0).padStart(7)}   ${String(r.n).padStart(4)}  ${r.win.toFixed(0).padStart(3)}   ${Math.min(r.pf,9).toFixed(2)}  ${r.maxDD.toFixed(1).padStart(5)}   ${r.from}->${r.to}`); }
    console.log(`AVG    | net ${(sN/syms.length).toFixed(1)}%  PF ${(sPF/syms.length).toFixed(2)}  maxDD ${(sDD/syms.length).toFixed(1)}%  beat B&H ${beat}/${syms.length}\n`);
  };
  period("FULL PERIOD (2016 -> now)", 0, Date.now() / 1000);
  period("IN-SAMPLE (2016 -> mid-2021)", 0, IS_TO);
  period("OUT-OF-SAMPLE (mid-2021 -> now)", OOS_FROM, Date.now() / 1000);
})();
