// Test the hypothesis: after a 52-day HIGH breakout, price pulls back, then rebounds.
// Strategy: on a new 52d high, WAIT for a pullback, buy the dip, target a rebound to the high.
// Compare vs buying the breakout directly. Walk-forward (IS 2015-2021, OOS after). Yahoo daily.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const UNIVERSE = (process.argv[2] || "AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,JPM,V,UNH,JNJ,WMT,HD,COST,LLY,SPY,QQQ,NFLX,CRM,TSLA,XOM").split(",");
const SPLIT = Date.parse("2021-07-01") / 1000;
const LOOK = 52, WAIT = 10, DIP = 1.5, STOPATR = 2.0, MAXHOLD = 20, SLIP = 0.05;

async function fetchDaily(sym) {
  const p1 = Math.floor(Date.parse("2015-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`https://${h}/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`, { headers: UA });
      if (!r.ok) continue; const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
function sma(v, p, i) { if (i < p - 1) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += v[k]; return s / p; }
function atr(b, p, i) { if (i < p) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += Math.max(b[k].h - b[k].l, Math.abs(b[k].h - b[k - 1].c), Math.abs(b[k].l - b[k - 1].c)); return s / p; }
const hh = (b, i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) m = Math.max(m, b[k].h); return m; };

// strategy A: buy the PULLBACK after a 52d-high breakout, target rebound to the breakout high
function pullback(b) {
  const c = b.map(x => x.c); const trades = []; let i = LOOK + 1;
  while (i < b.length - 2) {
    const broke = c[i] > hh(b, i, LOOK);                 // new 52-day high today
    if (broke) {
      const bHigh = b[i].h; let entered = false;
      for (let j = i + 1; j <= Math.min(i + WAIT, b.length - 2); j++) {
        const s200 = sma(c, 200, j);
        if (s200 && c[j] > s200 && c[j] <= bHigh * (1 - DIP / 100)) {   // pulled back >=DIP% but trend intact
          const entry = b[j + 1].o, aa = atr(b, 14, j), stop = entry - aa * STOPATR;
          let k = j + 1, px = null, hold = 0;
          const target = entry * 1.05;                             // same +5% target as baseline (fair test)
          while (k < b.length - 1) { hold = k - (j + 1) + 1;
            if (b[k].l <= stop) { px = stop; break; }              // stopped
            if (b[k].h >= target) { px = target; break; }          // rebound runner (+5%)
            if (hold >= MAXHOLD) { px = b[k].c; break; }
            k++;
          }
          if (px == null) px = c[b.length - 1];
          trades.push({ t: b[j + 1].t, ret: ((px - SLIP) / (entry + SLIP) - 1) * 100 });
          entered = true; i = k + 1; break;
        }
      }
      if (!entered) i = i + WAIT; else continue;
    } else i++;
  }
  return trades;
}
// strategy B (baseline): buy the breakout directly, exit +targetPct or stop
function direct(b) {
  const c = b.map(x => x.c); const trades = []; let i = LOOK + 1;
  while (i < b.length - 2) {
    if (c[i] > hh(b, i, LOOK)) {
      const entry = b[i + 1].o, aa = atr(b, 14, i), stop = entry - aa * STOPATR, target = entry * 1.05;
      let k = i + 1, px = null, hold = 0;
      while (k < b.length - 1) { hold = k - (i + 1) + 1; if (b[k].l <= stop) { px = stop; break; } if (b[k].h >= target) { px = target; break; } if (hold >= MAXHOLD) { px = b[k].c; break; } k++; }
      if (px == null) px = c[b.length - 1];
      trades.push({ t: b[i + 1].t, ret: ((px - SLIP) / (entry + SLIP) - 1) * 100 }); i = k + 1;
    } else i++;
  }
  return trades;
}
function stats(tr, from, to) { const t = tr.filter(x => x.t >= from && x.t <= to); const w = t.filter(x => x.ret > 0), gW = w.reduce((a, x) => a + x.ret, 0), gL = -t.filter(x => x.ret < 0).reduce((a, x) => a + x.ret, 0); return { n: t.length, win: t.length ? w.length / t.length * 100 : 0, avg: t.length ? t.reduce((a, x) => a + x.ret, 0) / t.length : 0, pf: gL ? gW / gL : (gW > 0 ? 9 : 0) }; }

(async () => {
  let pb = [], dr = [];
  for (const s of UNIVERSE) { const b = await fetchDaily(s); if (b && b.length > 260) { pb.push(...pullback(b)); dr.push(...direct(b)); } process.stdout.write("."); }
  console.log(`\n\nHYPOTHESIS: after a ${LOOK}-day high breakout, price pulls back ${DIP}%+ then rebounds to the high.\n`);
  const show = (name, tr) => { const is = stats(tr, 0, SPLIT), o = stats(tr, SPLIT, 9e18); console.log(`${name.padEnd(34)} | IS: n${is.n} win${is.win.toFixed(0)}% avg${is.avg.toFixed(2)}% PF${is.pf.toFixed(2)} | OOS: n${o.n} win${o.win.toFixed(0)}% avg${o.avg.toFixed(2)}% PF${o.pf.toFixed(2)}`); };
  show("PULLBACK after breakout (dip only)", pb);
  show("DIRECT breakout buy (baseline)", dr);
  show("COMBINED (buy breakout + add on pullback)", [...dr, ...pb]);
  console.log("\nEdge is real only if OOS PF > 1 with a decent sample. Combined = take both entries (half-size each).");
})();
