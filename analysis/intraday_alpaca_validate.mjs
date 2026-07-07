// Deep intraday validation using ALPACA data (years of 5m/15m, not Yahoo's 60 days).
// Walk-forward: in-sample (older) vs out-of-sample (newer). Realistic slippage.
// Strategies: ORB+VWAP (strat 10) and EMA triple-stack (strat 11). NO orders placed.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const SYMBOL = process.argv[2] || "AAPL";
const j = JSON.parse(fs.readFileSync(path.join(__dir, "alpaca_keys.json"), "utf8"));
const H = { "APCA-API-KEY-ID": j.keyId, "APCA-API-SECRET-KEY": j.secretKey };
const FEED = j.feed || "iex";
const START = "2019-01-01T00:00:00Z";

async function fetchBars(tf) {
  const bars = []; let token = null, pages = 0;
  do {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars`);
    u.searchParams.set("timeframe", tf); u.searchParams.set("start", START);
    u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", FEED);
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`${tf}: HTTP ${r.status} ${await r.text()}`);
    const d = await r.json();
    for (const b of d.bars || []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    token = d.next_page_token; pages++;
  } while (token && pages < 60);
  return bars;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function atr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }

function prep(raw) {           // filter to regular hours, annotate day + session VWAP
  const rth = raw.filter(b => { const m = etMin(b.t); return m >= 570 && m < 960; });
  let day = null, pv = 0, vv = 0;
  return rth.map(b => { const d = etDate(b.t), m = etMin(b.t); const nd = d !== day; if (nd) { day = d; pv = 0; vv = 0; } const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; return { ...b, day: d, min: m, newDay: nd, vwap: vv ? pv / vv : b.c }; });
}

function stats(tr, eq, maxDD, days) { const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0); return { net: (eq / 10000 - 1) * 100, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), maxDD, perYr: (eq / 10000 - 1) * 100 / (days / 252) }; }

function runORB(bars, from, to, { orbMin = 15, rr = 2, slip = 0.02 }) {
  const a = atr(bars, 14); let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = [];
  let orH = null, orL = null, done = false, traded = 0, startMin = 0, dcount = 0;
  const cls = (px) => { const pnl = ((px - slip) - (pos.entry + slip)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = 20; i < bars.length; i++) {
    const b = bars[i]; if (b.t < from || b.t > to) continue;
    if (b.newDay) { orH = b.h; orL = b.l; done = false; traded = 0; startMin = b.min; dcount++; }
    else if (!done && b.min < startMin + orbMin) { orH = Math.max(orH, b.h); orL = Math.min(orL, b.l); }
    else done = true;
    const last = (i + 1 >= bars.length) || bars[i + 1].newDay;
    if (pos) { if (b.l <= pos.stop) cls(pos.stop); else if (pos && b.h >= pos.tp) cls(pos.tp); else if (pos && last) cls(b.c); }
    if (!pos && done && traded < 1 && !last && orH != null && b.c > orH && b.c > b.vwap && b.c > orL) {
      const risk = b.c - orL; const qty = Math.min((eq * 0.01) / risk, eq / b.c); pos = { entry: b.c, qty, stop: orL, tp: b.c + risk * rr }; traded++;
    }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  return stats(tr, eq, maxDD, dcount);
}

function runStack(bars, from, to, { f = 9, m = 21, s = 50, atrStop = 2.5, slip = 0.02 }) {
  const c = bars.map(x => x.c), eF = ema(c, f), eM = ema(c, m), eS = ema(c, s), a = atr(bars, 14);
  let eq = 10000, peak = 10000, maxDD = 0, pos = null; const tr = []; let dcount = 0, lastDay = null;
  const cls = (px) => { const pnl = ((px - slip) - (pos.entry + slip)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100); };
  for (let i = s + 1; i < bars.length; i++) {
    const b = bars[i]; if (b.t < from || b.t > to) continue; if (b.day !== lastDay) { lastDay = b.day; dcount++; }
    const last = (i + 1 >= bars.length) || bars[i + 1].newDay;
    const stack = eF[i] > eM[i] && eM[i] > eS[i], stackPrev = eF[i - 1] > eM[i - 1] && eM[i - 1] > eS[i - 1];
    if (pos) { if (b.l <= pos.stop) cls(pos.stop); else if (pos && !stack) cls(b.c); else if (pos && last) cls(b.c); }
    if (!pos && !last && b.min >= 600 && stack && !stackPrev && b.c > eF[i]) { const sd = a[i] * atrStop; const qty = Math.min((eq * 0.01) / sd, eq / b.c); pos = { entry: b.c, qty, stop: b.c - sd }; }
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
  }
  return stats(tr, eq, maxDD, dcount);
}

const show = (n, r) => console.log(`  ${n.padEnd(20)} net ${r.net.toFixed(1).padStart(7)}%  (~${r.perYr.toFixed(1)}%/yr)  trades ${String(r.n).padStart(4)}  win ${r.win.toFixed(0).padStart(3)}%  PF ${Math.min(r.pf, 9).toFixed(2)}  maxDD ${r.maxDD.toFixed(1)}%`);

(async () => {
  for (const tf of ["5Min", "15Min"]) {
    let raw; try { raw = await fetchBars(tf); } catch (e) { console.log(`\n${tf}: fetch failed — ${e.message}`); continue; }
    const bars = prep(raw); if (bars.length < 500) { console.log(`\n${tf}: only ${bars.length} RTH bars — insufficient`); continue; }
    const t0 = bars[0].t, t1 = bars[bars.length - 1].t, mid = t0 + (t1 - t0) * 0.6;
    const days = new Set(bars.map(b => b.day)).size;
    console.log(`\n===== ${SYMBOL} ${tf}: ${bars.length} RTH bars, ${days} days, ${etDate(t0)} -> ${etDate(t1)} (feed=${FEED}) =====`);
    console.log(` IN-SAMPLE (${etDate(t0)} -> ${etDate(mid)}):`);
    show("ORB+VWAP", runORB(bars, t0, mid, {}));
    show("EMA stack 9/21/50", runStack(bars, t0, mid, {}));
    console.log(` OUT-OF-SAMPLE (${etDate(mid)} -> ${etDate(t1)}):`);
    show("ORB+VWAP", runORB(bars, mid, t1, {}));
    show("EMA stack 9/21/50", runStack(bars, mid, t1, {}));
  }
})();
