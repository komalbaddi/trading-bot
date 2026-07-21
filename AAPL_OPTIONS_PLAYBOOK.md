# AAPL Options Playbook — 1-4 Day Mean-Reversion Swing

A disciplined options strategy built on the **only short-term AAPL edge that survived
out-of-sample testing**: buying oversold dips inside an uptrend (RSI-2 pullback).
~58-62% win rate, ~4-day average hold. Pine signal: `pinescript/12_aapl_rsi2_options_signal.pine`.

> Honest scope: the STOCK signal is validated (~60% OOS win rate). The OPTION's own P&L
> is NOT backtested (no free options history). Rules below are designed to keep theta &
> spread from ruining a good signal. Still higher-risk than the swing bot. **Paper-trade first.**

---

## 1. The setup (technicals) — check on the AAPL DAILY chart
Enter only when ALL are true:
- **Uptrend:** AAPL close is **above its 200-day SMA** (only buy dips in an uptrend).
- **Oversold dip:** **RSI(2) < 10** (classic) — or **< 5** for fewer, higher-quality trades.
- (The Pine indicator prints a green **BUY** when both line up, and can send an alert.)

## 2. Pick the right CALL option (this is what tames the options risks)
When BUY triggers, buy a **call** — but structure it to minimize decay & spread:
- **Slightly IN-THE-MONEY** (delta ~**0.65-0.75**). It moves closely with the stock and
  a smaller % of its price is fragile time-value.
- **Expiry 2-4 weeks out (~20-30 DTE).** NOT weeklies, NOT 0DTE. You only hold ~4 days,
  so a further expiry means **theta decay is slow** during your hold.
- **Use a limit order at the mid-price.** AAPL options are very liquid (tight spreads) —
  don't pay the full ask.

*Why: ITM + 2-4wk expiry = your P&L tracks the stock bounce, not the clock. This is the
opposite of the 0DTE/weekly lottery tickets that destroy beginners.*

## 3. Exit rules (SHARPENED to 1-2 days — validated OOS: ~67-70% win, PF 1.5-2.0)
- **Primary (take profit):** sell on the **first GREEN daily close** (close > open) after entry.
  This is the bounce — usually **1-2 days**. Backtest held up out-of-sample with a faster,
  cleaner exit than the old 5-SMA rule, and less time for theta to bite.
- **Target override:** if the option hits **+50%** intraday, just take it.
- **Time stop:** exit no later than **2 trading days** regardless (keeps theta minimal).
- **Thesis-break stop:** if AAPL **closes below the entry-day's low**, or the option hits
  **-50%**, sell — cut the loss instead of riding toward zero.

## 4. Position sizing (critical — options can go to $0)
- Size so a **worst-case total loss = only 1-2% of your account.**
- With the thesis-break stop, a typical loss is ~30-50% of the premium. So premium paid
  should be small relative to your account.
- Example ($10k account, risk ~2% = $200): with a ~40% stop, max premium ≈ **$500/trade**.
  If one ITM AAPL call costs more than that, the trade is too big — use a smaller size,
  a cheaper strike, or paper-trade until the account is larger.
- **Never** put a large chunk of your account into one option.

## 5. About "day trading" this
The signal sometimes exits the same or next day on a fast bounce — that's as close to a
day-trade as makes sense here. **Do NOT** turn this into 0DTE/same-day direction bets:
our testing showed AAPL intraday direction is a coin flip, and 0DTE + spreads + leverage
is the fastest way to lose money. The 1-4 day version is the one with a real edge.

## 6. Honest expectations
- **~60% win rate means ~40% losers** — you WILL have losing streaks. That's normal.
- Options add spread + theta + IV risk on top of the direction call. Even with a good
  signal, the option can lose if IV drops (e.g., don't hold through earnings unprepared).
- This is unvalidated at the option-P&L level. **Paper-trade it on Alpaca** (options paper
  requires options approval on your account) for a couple of months before real money.
- It complements — does not replace — your validated daily swing strategy (09).

## Quick checklist per trade
1. AAPL > 200-SMA? and RSI(2) < 10 (or 5)?  → BUY signal
2. Buy call: ~0.70 delta (ITM), 2-4 weeks expiry, limit at mid
3. Set alerts: exit when close > 5-SMA, or 6-day time stop, or close < entry-day low
4. Size so total loss ≤ 1-2% of account
5. Log the trade; review win rate vs the ~60% expectation
