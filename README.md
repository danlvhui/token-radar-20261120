# token-radar-20261120

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/danlvhui/token-radar-20261120/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/danlvhui/token-radar-20261120/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a program that reads a sealed DefiLlama snapshot (758 protocols, 14 November 2026), ranks 200 protocols by an implied value derived only from the snapshot's own figures — TVL, seven-day growth, and how long the protocol has run with no token recorded — and shows a reader how to farm each one. All 40 watchlist protocols are covered; protocols whose token already trades are ranked below the pre-token board and labelled as such. `main.ts` (Node 22, standard library only) writes `board.json`, the dashboard data, and `dossier.json`; it runs twice with byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=1n9dedzn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
