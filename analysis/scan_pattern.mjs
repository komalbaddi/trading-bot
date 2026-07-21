// Scan recent AAPL intraday sessions for the "rise -> sharp drop -> V-recovery" pattern.
// Yahoo 5m, 60 days. Ranks days by drop size x how much of it was recovered into the close.
const SYMBOL = process.argv[2] || "AAPL";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };

async function fetchY() {
  for (const h of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${h}/v8/finance/chart/${SYMBOL}?interval=5m&range=60d&includePrePost=false`;
      const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), R = j.chart.result[0], ts = R.timestamp, q = R.indicators.quote[0];
      const b = []; for (let i = 0; i < ts.length; i++) if (q.close[i] != null) b.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      return b;
    } catch {}
  }
  return null;
}
const etDate = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const etMin = t => { const s = new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }); const [H, M] = s.split(":").map(Number); return H * 60 + M; };

(async () => {
  const bars = (await fetchY()).filter(b => { const m = etMin(b.t); return m >= 570 && m < 960; });
  const map = new Map();
  for (const b of bars) { const d = etDate(b.t); if (!map.has(d)) map.set(d, []); map.get(d).push(b); }
  const rows = [];
  for (const [d, bs] of map) {
    if (bs.length < 20) continue;
    bs.sort((a, b) => a.t - b.t);
    const open = bs[0].o, close = bs[bs.length - 1].c;
    // find the intraday peak (needs to come after some rise), then the low AFTER the peak
    let peak = -Infinity, pI = 0;
    for (let i = 0; i < bs.length; i++) if (bs[i].h > peak) { peak = bs[i].h; pI = i; }
    let low = Infinity, lI = pI;
    for (let i = pI; i < bs.length; i++) if (bs[i].l < low) { low = bs[i].l; lI = i; }
    const riseToPeak = (peak - open) / open * 100;
    const drop = (peak - low) / peak * 100;
    const recov = peak > low ? (close - low) / (peak - low) * 100 : 0;
    const dayChg = (close - open) / open * 100;
    rows.push({ d, riseToPeak, drop, recov, dayChg, peak, low, close, peakTime: etMin(bs[pI].t), lowTime: etMin(bs[lI].t) });
  }
  // pattern = rose into a peak, then a sharp drop, then recovered a good chunk into the close
  const matches = rows.filter(r => r.riseToPeak > 0.15 && r.drop > 1.0 && r.recov > 25 && r.lowTime > r.peakTime)
    .map(r => ({ ...r, score: r.drop * (r.recov / 100) }))
    .sort((a, b) => b.score - a.score);
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  console.log(`\n${SYMBOL} 5m, last 60 days — days matching "rise -> sharp drop -> recovery":\n`);
  console.log("date        rise% drop%  recovered%  dayChg%  peak@   low@    (peak->low->close)");
  for (const r of matches.slice(0, 8))
    console.log(`${r.d.padEnd(11)} +${r.riseToPeak.toFixed(1)}  -${r.drop.toFixed(1)}   ${r.recov.toFixed(0)}%        ${r.dayChg >= 0 ? "+" : ""}${r.dayChg.toFixed(1)}    ${hm(r.peakTime)}   ${hm(r.lowTime)}   ${r.peak.toFixed(1)}->${r.low.toFixed(1)}->${r.close.toFixed(1)}`);
  console.log(`\n(${matches.length} similar days found in the window)`);
})();
