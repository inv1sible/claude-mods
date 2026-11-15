# usage-meter

Claude Code mod that shows subscription rate-limit usage (5-hour and weekly windows, with reset countdown and a linear pace projection), context-window fill with a per-category breakdown and auto-compact headroom, session cost and burn rate, token totals with cache-hit ratio, turn count and average duration, and tool-call counts with failures.

- CLI: compact summary in the status line, e.g. `5h 23% ↻2h10 · Week 41% ↻3d4h · ctx 38% · $1.24`.
- App / CLI fullscreen: a "Usage" pane (opens at session start; reopen with `/usage-meter`). On the desktop app's minimized widget it shows just the bars.

Data comes from `$.session.usage()` / `session.measure` (the same figures the status line and `/context` use); the breakdown uses the free local `summary` estimate.
