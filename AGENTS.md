# AGENTS.md

Guidance for AI coding agents working on `etf-replication-lab`.

## Project Overview

`etf-replication-lab` is a TypeScript + Node 24 quantitative research project comparing direct ownership of **159201 (华夏国证自由现金流 ETF)** against individual stock-replication baskets. The published artifact is a **single self-contained HTML file** (`dist/index.html`) deployed to GitHub Pages with zero runtime fetches, zero CDN dependencies, and no frontend framework.

## Non-Negotiable Invariants

1. **Two-Inputs-Only Contract**:
   - The web UI accepts only `capital` and `method` (`ReplicationMethod`). Do not add arbitrary user-tunable assumption sliders to the main controls; sensitivity analysis belongs in Panel ⑨ via `SensitivityKnobs`.
   - `buy_etf` is the baseline control group: its `totalEdgePct` must remain identically `0`, with `0` online IPO tickets and `0` fee/tax edge.
2. **Data Provenance Honesty**:
   - Every figure surfaced in the UI must carry an explicit provenance badge (`disclosed`, `statistical`, or `assumption`). Never present a model assumption or statistical estimate as a disclosed fact.
   - Panel ① (forward structural edge: tax + IPO + fees under stock-return neutrality) and Panel ⑥ (backward stock-only realized path excluding IPO/tax/fees) must stay clearly reconciled.
   - Tracking error is reported strictly as **risk**, never subtracted from expected return.
3. **Single Self-Contained Output**:
   - `dist/index.html` must open directly from disk (`file://`) and on GitHub Pages with no external network requests.
   - `dist/` must contain only `index.html` after `npm run build` (syntax checks run in `os.tmpdir()`).
   - Never break the `trimDataset()` whitelist contract tested in `test/build.test.ts`.

## Runtime & TypeScript Rules

- **Node.js `>= 24.0.0`** is required (native TypeScript execution for `src/cli/*.ts`, `scripts/*.ts`, and `test/*.test.ts`).
- `tsconfig.json` enforces:
  - `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
  - `verbatimModuleSyntax: true` — always use `import type` for type-only imports.
  - `erasableSyntaxOnly: true` — do not use `enum`, `namespace`, or parameter properties (`constructor(private x: number)`).
  - `allowImportingTsExtensions: true` — always include `.ts` extensions on relative imports.
- **Classic-script bundler (`src/cli/transpile.ts`)**:
  - `src/cli/bundle-model.ts` bundles `src/types.ts`, `src/domain/*.ts`, and `src/model.ts` into `globalThis.EtfLab`.
  - `src/cli/build.ts` bundles `web/format.ts`, `web/charts.ts`, `web/panels.ts`, and `web/app.ts` in dependency order inside an IIFE.
  - Because `delocalize()` strips ES `import`/`export` statements when concatenating files into one scope, **avoid top-level identifier collisions across files in the same bundle** and keep `WEB_SOURCES` in `src/cli/build.ts` topologically ordered whenever adding a new `web/*.ts` module.

## Architecture Map

- **Domain & Model (`src/domain/`, `src/model.ts`)**: Pure functions only (no filesystem or network I/O) so they bundle cleanly into the browser.
- **Derivation & Backtest (`src/derive.ts`, `src/backtest.ts`, `src/cli/derive.ts`)**: Offline Node pipeline turning `data/raw/` into `data/derived/dataset.json`.
- **Frontend (`web/`)**:
  - `web/types.ts`: Type-only declarations referencing `src/` types (zero runtime output).
  - `web/format.ts`: Formatting, provenance tags, `escapeHtml()`, and `CAPITAL_PRESETS`. Always escape dynamic strings before `innerHTML` interpolation.
  - `web/charts.ts`: Pure Canvas 2D renderer with O(N) drawdown computation and HiDPI scaling. Keep graceful fallbacks for headless DOM stubs (`scripts/smoke.ts`).
  - `web/panels.ts`: Panel renderers (`#fundLine`, `#verdict`, `#decomp`, `#portfolio`, `#ipo`, `#tax`, `#backtestTable`, `#sweep`, `#methods`, `#sensitivity`, `#dilution`, `#methodology`).
  - `web/app.ts`: State controller and selective re-rendering.

## Required Verification Commands

Before committing or opening a PR, run:

```bash
npm run typecheck
npm run test
npm run build
npm run smoke
```

If UI selectors, layout, or interactions changed and Chromium is installed, also run:

```bash
npm run test:e2e
```

Do not commit `dist/`, `web/vendor/`, `data/raw/`, `test-results/`, or `playwright-report/`.

## Git & Deployment Workflow

- Work on a dedicated feature branch (e.g. `feat/...`, `fix/...`, `refactor/...`) and open a Pull Request against `main`. Never push directly to `main`.
- `.github/workflows/ci.yml` validates PRs (`typecheck`, `test`, `build`, `smoke`) and uploads `dist/index.html` as a downloadable preview artifact.
- Merging to `main` triggers `.github/workflows/deploy-pages.yml`, which runs verification and deploys `dist/index.html` to GitHub Pages.
