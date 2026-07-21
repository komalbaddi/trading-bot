// 30-MINUTE AAPL strategy lab. Pulls 5m from Alpaca (2020+), resamples to 30m.
// Tries several indicator-based archetypes, OPTIMIZES on 2020-2023 (in-sample),
// then FORWARD-TESTS the winner on 2024-2026 (out-of-sample). Realistic slippage.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(fs.readFileSync(path.join(__dir, "alpaca_keys.json"), "utf8"));
const H = { "APCA-API-KEY-ID": j.keyId, "APCA-API-SECRET-KEY": j.secretKey };
const FEED = j.feed || "iex";
const SYMBOL = "AAPL";
const IS_TO = Date.parse("2024-01-01T00:00:00Z") / 1000;   // in-sample: 2020..2023
const OOS_FROM = IS_TO;                                      // out-of-sample: 2024..now
const SLIP = 0.03;                                           // $/share per side (30m, conservative)

async function fetch5m() {
  const bars = []; let token = null, pages = 0;
  do {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars`);
    u.searchParams.set("timeframe", "5Min"); u.searchParams.set("start", "2020-01-01T00:00:00Z");
    u.searchParams.set("limit", "10000"); u.searchParams.set("adjustment", "split"); u.searchParams.set("feed", FEED);
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
    const d = await r.json();
    for (const b of d.bars || []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    token = d.next_page_token; pages++;
    if (pages % 10 === 0) process.stdout.write(`.${bars.length}`);
  } while (token && pages < 80);
  return bars;
}
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };
function resample30(raw) {
  const rth = raw.filter(b => { const m = etMin(b.t); return m >= 570 && m < 960; });
  const m = new Map();
  for (const b of rth) { const k = Math.floor(b.t / 1800) * 1800; const c = m.get(k); if (!c) m.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); else { c.h = Math.max(c.h, b.h); c.l = Math.min(c.l, b.l); c.c = b.c; c.v += b.v; } }
  return [...m.values()].sort((a, b) => a.t - b.t);
}
// ---- indicators ----
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { e = s / p; o[i] = e; } } else { e = v[i] * k + e * (1 - k); o[i] = e; } } return o; }
function rsiW(c, p) { const o = Array(c.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = 100 - 100 / (1 + (al === 0 ? 999 : ag / al)); } } return o; }
function atrArr(b, p = 14) { const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))); const o = Array(b.length).fill(null); let a = 0, pr = null; for (let i = 0; i < b.length; i++) { if (i < p) { a += tr[i]; if (i === p - 1) { pr = a / p; o[i] = pr; } } else { pr = (pr * (p - 1) + tr[i]) / p; o[i] = pr; } } return o; }
function adxArr(b, p = 14) { const n = b.length, pdm = Array(n).fill(0), ndm = Array(n).fill(0), tr = Array(n).fill(0); for (let i = 1; i < n; i++) { const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l; pdm[i] = (up > dn && up > 0) ? up : 0; ndm[i] = (dn > up && dn > 0) ? dn : 0; tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); } const sm = a => { const o = Array(n).fill(null); let s = 0; for (let i = 1; i <= p; i++) s += a[i]; let pr = s; for (let i = p + 1; i < n; i++) { pr = pr - pr / p + a[i]; o[i] = pr; } o[p] = s; return o; }; const str = sm(tr), sp = sm(pdm), sn = sm(ndm), adx = Array(n).fill(null); const dx = Array(n).fill(null); for (let i = p; i < n; i++) { if (!str[i]) continue; const pdi = 100 * sp[i] / str[i], ndi = 100 * sn[i] / str[i]; dx[i] = 100 * Math.abs(pdi - ndi) / (pdi + ndi || 1); } let s = 0, cnt = 0; for (let i = p; i < 2 * p && i < n; i++) { if (dx[i] != null) { s += dx[i]; cnt++; } } let prev = cnt ? s / cnt : null; for (let i = 2 * p; i < n; i++) { if (dx[i] != null && prev != null) { prev = (prev * (p - 1) + dx[i]) / p; adx[i] = prev; } } return adx; }
function highest(b, i, n) { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, b[k].h); return m; }

// ---- generic long-only engine ----
function engine(b, atr, { entry, exit, initMult, trailMult }, from, to) {
  let eq = 10000, peak = 10000, dd = 0, pos = null; const tr = [];
  for (let i = 205; i < b.length; i++) {
    if (b[i].t < from || b[i].t > to) continue;
    if (pos) {
      if (trailMult > 0) { pos.hi = Math.max(pos.hi, b[i].h); pos.stop = Math.max(pos.stop, pos.hi - atr[i] * trailMult); }
      let ex = null;
      if (b[i].l <= pos.stop) ex = Math.min(b[i].o, pos.stop);
      else if (exit(i)) ex = b[i].c;
      if (ex != null) { const pnl = ((ex - SLIP) - (pos.entry + SLIP)) * pos.qty; eq += pnl; tr.push(pnl); pos = null; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100); }
    }
    if (!pos && entry(i) && atr[i] > 0) {
      const sd = atr[i] * initMult, qty = Math.min((eq * 0.01) / sd, eq / b[i].c);
      pos = { entry: b[i].c, qty, stop: b[i].c - sd, hi: b[i].h };
    }
    peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100);
  }
  const w = tr.filter(x => x > 0), gW = w.reduce((a, x) => a + x, 0), gL = -tr.filter(x => x < 0).reduce((a, x) => a + x, 0);
  return { net: (eq / 10000 - 1) * 100, n: tr.length, win: tr.length ? w.length / tr.length * 100 : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0), dd };
}

(async () => {
  process.stdout.write("Fetching 5m 2020+ from Alpaca");
  const raw = await fetch5m(); const b = resample30(raw);
  console.log(`\n30m bars: ${b.length} (${new Date(b[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(b[b.length - 1].t * 1000).toISOString().slice(0, 10)})`);
  const c = b.map(x => x.c);
  const ind = { atr: atrArr(b), adx: adxArr(b), rsi2: rsiW(c, 2), rsi5: rsiW(c, 5), rsi14: rsiW(c, 14), ema200: ema(c, 200), e10: ema(c, 10), e20: ema(c, 20), e50: ema(c, 50), e100: ema(c, 100) };

  // strategy archetypes -> array of {label, cfg}
  const archetypes = {
    "Trend EMA+ADX": () => { const out = []; for (const f of [10, 20]) for (const s of [50, 100]) for (const adxMin of [0, 20]) for (const tr of [3, 4]) { const ef = ema(c, f), es = ema(c, s); out.push({ p: { f, s, adxMin, tr }, cfg: { entry: i => ef[i] > es[i] && ef[i - 1] <= es[i - 1] && (adxMin === 0 || ind.adx[i] > adxMin), exit: i => ef[i] < es[i], initMult: 2, trailMult: tr } }); } return out; },
    "RSI reversion (uptrend)": () => { const out = []; for (const [rl, rs] of [[2, ind.rsi2], [5, ind.rsi5], [14, ind.rsi14]]) for (const os of [10, 20, 30]) for (const im of [2, 3]) out.push({ p: { rl, os, im }, cfg: { entry: i => c[i] > ind.ema200[i] && rs[i] < os, exit: i => rs[i] > 55, initMult: im, trailMult: 0 } }); return out; },
    "Breakout (uptrend)": () => { const out = []; for (const look of [20, 40, 60]) for (const tr of [3, 4]) out.push({ p: { look, tr }, cfg: { entry: i => c[i] > ind.ema200[i] && c[i] > highest(b, i, look), exit: () => false, initMult: 2, trailMult: tr } }); return out; },
  };

  for (const [name, gen] of Object.entries(archetypes)) {
    const grid = gen();
    const scored = grid.map(g => ({ g, is: engine(b, ind.atr, g.cfg, 0, IS_TO) }))
      .filter(x => x.is.n >= 20)                                   // need a real sample in-sample
      .sort((a, x) => (Math.min(x.is.pf, 5) + x.is.net / (x.is.dd || 1) / 20) - (Math.min(a.is.pf, 5) + a.is.net / (a.is.dd || 1) / 20));
    if (!scored.length) { console.log(`\n### ${name}: no config with enough trades`); continue; }
    const best = scored[0];
    const oos = engine(b, ind.atr, best.g.cfg, OOS_FROM, 9e18);
    console.log(`\n### ${name}`);
    console.log(`   best IS params: ${JSON.stringify(best.g.p)}`);
    console.log(`   IN-SAMPLE  2020-2023: net ${best.is.net.toFixed(1)}%  trades ${best.is.n}  win ${best.is.win.toFixed(0)}%  PF ${Math.min(best.is.pf, 9).toFixed(2)}  maxDD ${best.is.dd.toFixed(1)}%`);
    console.log(`   OUT-SAMPLE 2024-2026: net ${oos.net.toFixed(1)}%  trades ${oos.n}  win ${oos.win.toFixed(0)}%  PF ${Math.min(oos.pf, 9).toFixed(2)}  maxDD ${oos.dd.toFixed(1)}%`);
    console.log(`   -> ${oos.pf > 1.2 && oos.n >= 10 ? "HOLDS UP out-of-sample ✅" : "FAILS out-of-sample ❌ (edge didn't carry)"}`);
  }
  console.log("\nVerdict rule: an archetype is only real if OOS profit factor > 1.2 with enough trades.");
})();
