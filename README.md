# Intraday Algo Trading — Strategy Pack (TradingView + Alpaca)

> **Read this first.** Day trading is hard and most beginners lose money. Backtests
> always look better than reality because of slippage, commissions, and curve-fitting.
> Use this to **learn** and to **paper-trade** (fake money) first. Do not risk real
> money until a strategy survives weeks/months of paper trading and you understand
> exactly why it wins and loses. Nothing here is financial advice.

## What's in here

```
pinescript/
  01_trend_ema_adx.pine          Trend-following: EMA crossover + ADX strength filter
  02_meanrev_rsi_bb.pine         Mean-reversion: RSI + Bollinger Bands (+200-EMA filter)
  03_opening_range_breakout.pine Opening Range Breakout (classic intraday stock play)
  04_vwap_pullback.pine          Trend + pullback to VWAP
  05_alligator_volume.pine       Williams Alligator fan + volume confirmation
alpaca/
  trend_ema_adx_bot.py           Paper-trading bot that mirrors strategy 01
```

All five are **Pine Script v5 `strategy()` scripts**, so TradingView's **Strategy Tester**
gives you real performance stats. They share the same risk model:
- Position size is calculated so each trade risks **~1.5% of equity** (moderate).
- ATR-based stop-loss, fixed Reward:Risk take-profit.
- Intraday only: positions auto-flatten at session end (no overnight gap risk).
- Designed for **5-minute** charts on **US stocks** and **crypto**.

---

## How to backtest each one in TradingView (5 minutes per strategy)

1. Open [tradingview.com](https://www.tradingview.com) → **Chart**.
2. Pick a symbol and set the timeframe to **5m** (top toolbar).
   - Stocks: `AAPL`, `MSFT`, `NVDA`, `SPY`, `QQQ`
   - Crypto: `BTCUSD`, `ETHUSD` (for crypto, in each script's settings turn **"Intraday only"** OFF, since crypto trades 24/7).
3. Bottom panel → **Pine Editor** → paste the contents of one `.pine` file → click **Add to chart**.
4. Open the **Strategy Tester** tab (next to Pine Editor) → read the **Overview / Performance / List of Trades**.
5. Click the gear ⚙️ on the strategy to tweak inputs (EMA lengths, ATR stop, RR, session, longs/shorts).
6. Repeat for all five, on the **same symbol and same date range**, so the comparison is fair.

> **Free-plan note:** TradingView's free tier limits how much intraday history it
> backtests (often only the most recent ~few thousand bars). That's fine for a first
> pass. For longer/cleaner tests you'd want a paid plan or backtest in Python.

### ⚠️ Two rules that prevent garbage results

1. **Only test on the 5-minute chart.** These are intraday strategies — their session
   filter, ATR stops and end-of-day flatten only make sense on intraday bars. Running
   them on the **Daily** chart produces meaningless results (this is what caused a
   `-94%`-type number on a first test).
2. **Leverage is now capped (`Max leverage = 1.0`).** Earlier versions sized positions
   purely from the stop distance, which on a 5-min chart could buy 4–5× your account
   value and blow up the equity curve. The new `Max leverage` input (in each script's
   *Risk* group) keeps position notional ≤ your equity. Keep it at **1.0** (a cash
   account). Raising it = real leverage = bigger gains *and* bigger blow-ups.

If a strategy still loses after these fixes, that's a real (and common) result: it
simply has no edge on that symbol/period. That's the system working — not a bug.

---

## Scorecard — fill this in and send it back to me

Run each strategy on the **same symbol + same period**, then copy these numbers from
the Strategy Tester "Performance Summary":

| Strategy            | Net Profit % | Total Trades | % Profitable | Profit Factor | Max Drawdown % | Avg Trade |
|---------------------|-------------:|-------------:|-------------:|--------------:|---------------:|----------:|
| 01 Trend EMA+ADX    |              |              |              |               |                |           |
| 02 MeanRev RSI+BB   |              |              |              |               |                |           |
| 03 ORB              |              |              |              |               |                |           |
| 04 VWAP Pullback    |              |              |              |               |                |           |
| 05 Alligator+Volume |              |              |              |               |                |           |

**How to read it (what "best" actually means):**
- **Profit Factor** > 1.5 is decent, > 2 is good (gross profit ÷ gross loss).
- **Max Drawdown** — lower is better; this is the worst peak-to-trough pain you'd feel.
- **% Profitable** can be low and still great *if* winners are bigger than losers (that's the RR).
- **Total Trades** — need at least ~50–100 for the result to mean anything. A 70% win
  rate over 6 trades is luck, not edge.
- Ignore a high Net Profit if it came with a huge drawdown or only a handful of trades.

Paste your filled table to me and I'll tell you which strategy wins for your symbol,
whether it's overfit, and what to tune next.

---

## Running the Alpaca paper bot

```powershell
py -m pip install "alpaca-py>=0.20" pandas numpy
$env:ALPACA_API_KEY    = "your_PAPER_key"
$env:ALPACA_SECRET_KEY = "your_PAPER_secret"
py alpaca\trend_ema_adx_bot.py
```

Get **paper** keys from the Alpaca dashboard (toggle to *Paper Trading*, then
*Generate API Keys*). The bot keeps `PAPER = True` — leave it there. It checks once a
minute, acts on closed 5-min bars, sends bracket orders (entry + stop + target), and
flattens before the close.

---

## Suggested path for a beginner

1. Backtest all 5 on `SPY` and `AAPL` (5m). Fill the scorecard.
2. Send me the numbers → I help you pick + tune one strategy.
3. Paper-trade that one strategy on Alpaca for several weeks.
4. Only then, with a written plan and tiny size, consider real money — or decide it's
   not worth it (a perfectly valid, money-saving conclusion).
```
