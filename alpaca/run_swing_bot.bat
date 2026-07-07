@echo off
REM Daily runner for the Alpaca swing bot. Logs output so you can review each run.
cd /d "C:\Claude Code\Trdaing"
echo ================ RUN %DATE% %TIME% ================ >> "C:\Claude Code\Trdaing\alpaca\swing_bot.log"
"C:\Program Files\nodejs\node.exe" "C:\Claude Code\Trdaing\alpaca\swing_bot.mjs" >> "C:\Claude Code\Trdaing\alpaca\swing_bot.log" 2>&1
