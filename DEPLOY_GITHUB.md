# Deploy the swing bot to the cloud (GitHub Actions) — free, 24/7

This runs the bot automatically each weekday **in GitHub's cloud**, so your PC does not
need to be on. Your API keys stay in encrypted GitHub Secrets — never in the code.

## Step 0 — Rotate your Alpaca keys first (important)
Your old keys were shown in chat. In Alpaca: **Home → API Keys → Regenerate**.
Use the NEW key + secret in Step 3 below.

## Step 1 — Create a PRIVATE GitHub repo
1. Sign in at github.com (create a free account if needed).
2. Click **New repository** → name it e.g. `trading-bot` → set it to **Private** → Create.
   (Leave it empty — no README/gitignore, we already have them.)

## Step 2 — Push this project to the repo
Open a terminal in `C:\Claude Code\Trdaing` and run (replace YOUR-USER/REPO):
```powershell
cd "C:\Claude Code\Trdaing"
git init
git add .
git commit -m "Swing bot + GitHub Actions deploy"
git branch -M main
git remote add origin https://github.com/YOUR-USER/trading-bot.git
git push -u origin main
```
> The `.gitignore` already excludes `alpaca_keys.json` and the Python file with hardcoded
> keys, so **no secrets get pushed**. Double-check with `git status` before pushing —
> `alpaca_keys.json` should NOT appear in the list.

## Step 3 — Add your keys as GitHub Secrets
In the repo on github.com: **Settings → Secrets and variables → Actions → New repository secret**.
Add two secrets (use your NEW rotated keys):
- Name `APCA_API_KEY_ID`     → value = your paper key id
- Name `APCA_API_SECRET_KEY` → value = your paper secret

## Step 4 — Test it
1. Repo → **Actions** tab → enable workflows if prompted.
2. Click **Alpaca Swing Bot (paper)** → **Run workflow** → Run.
3. Open the run → view logs. You should see the same "equity … / no signal / ENTER …"
   output you saw locally. If keys are wrong you'll see an auth error.

## Step 5 — Turn OFF the local scheduled task (avoid double-trading!)
Now that the cloud runs it, delete the Windows task so it doesn't run twice and place
duplicate orders:
```powershell
schtasks /Delete /TN "AlpacaSwingBot" /F
```

## Done
- The bot now runs automatically at **21:30 UTC, Mon–Fri** (just after the US close).
- Each run commits `analysis/swing_state.json` back to the repo (persists trailing stops)
  and keeps the scheduled workflow alive.
- Review runs anytime in the **Actions** tab.

### Change the schedule
Edit `.github/workflows/swing_bot.yml`, the `cron:` line (times are UTC), commit & push.

### Notes / limits
- GitHub's free tier easily covers one short daily job. Scheduled runs can be delayed a
  few minutes under load — fine for a daily strategy.
- Everything stays on PAPER until you change `PAPER = true` in `alpaca/swing_bot.mjs`
  (don't, until it's proven for months).
