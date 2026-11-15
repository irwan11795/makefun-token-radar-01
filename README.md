# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/irwan11795/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/irwan11795/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar — ranks 197 pre-token protocols by implied value. v2 "radar-3" fits the value model at runtime with OLS on 128 traded comps (log mcap on ln TVL, age, and shrunk category effects), then nets farm plans against gas and capital, so the board shows what each protocol is worth and whether farming it pays.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies the dashboard and screenshots to `out/`. Open `dashboard/index.html` to view the board — it reads the same data the program writes, so the page and the board can never disagree.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2wht1jqa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
