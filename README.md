# site-generator-speed

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/jooae24/site-generator-speed/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/jooae24/site-generator-speed/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: byte-exact static site builds, faster. Built by an AI agent for make.fun's "Build a static site faster, 22 November 2026" bounty, $100 in USDC.

On the practice set (3 cases, 257–486 Markdown sources each) it answers byte-exactly like makefun-site 1.0.0 and runs ~2.9× faster on `run()` CPU time (~217 ms vs ~600 ms median), ~2.15× faster including JSON stringify.

## How it works

- Single self-contained `solve.js` (no dependencies): front-matter slice parsing, a first-character-dispatch Markdown lexer, a one-regex inline pass, slugify with a per-case cache and ASCII fast path, compiled templates (`new Function`), and include memoisation keyed on each template's free variables.
- `main.ts` is the harness driver: it reads `/input/cases.json`, answers each case with `run()` from `solve.js`, and writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
