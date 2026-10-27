# HoraTrade Multi-Timeframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix forecast result attribution and support the requested futures pairs with selectable 1H and 4H analysis.

**Architecture:** Generalize Bybit REST/WebSocket subscriptions by symbol and interval. Keep local forecasts keyed to symbol, interval, and source candle; only resolve them from confirmed candles for that exact series. Apply a completed-4H trend filter to 1H directional bias, following Freqtrade's informative-candle close alignment.

**Tech Stack:** Dependency-free browser JavaScript, Bybit V5 public API, canvas chart, localStorage, existing Node static server.

**Spec:** `docs/superpowers/specs/2026-10-27-horatrade-multi-timeframe-design.md`

## Global Constraints

- Supported pairs: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, and XMRUSDT.
- Supported intervals: `60` and `240` minutes.
- Only exchange-confirmed candles may supply signals or observed forecast closes.
- A 4H confirmation for a 1H signal must close no later than the analyzed 1H candle close.
- No account credentials, order placement, or cloud publishing.
- Preserve existing local 1H forecast history.
- Error percentage is `abs(actual - estimate) / abs(actual) * 100` and must be paired to the same symbol and interval.

## Review Focus

- A result from one pair must never resolve another pair's journal entry; exact identity includes pair, interval, and forecast candle start.
- A 1H candle must never use an unfinished 4H candle as context.
- A 4H forecast must remain pending until that 4H candle is confirmed by the exchange.
- Legacy localStorage rows without an interval must remain readable as 1H.
- Inactive contracts must show a clear unavailable state without breaking other pairs.

---

### Task 1: Fix forecast attribution and error display

**Files:**
- Modify: `src/forecast-journal.js`
- Modify: `src/app.js`
- Modify: `index.html`

**Interfaces:**
- `resolvePendingForecasts(symbol, interval, candles)` resolves only records for the supplied pair and interval.
- Journal records carry `interval`, `absoluteError`, and `errorPct`.
- Existing version-1 rows without `interval` are treated as `60`.

- [x] Filter pending results by symbol and interval and trust the exchange-confirmed candle instead of local wall-clock time.
- [x] Calculate and persist absolute error in USDT and absolute percentage error from the actual close.
- [x] Render both quantities in the journal with an explicit formula label or accessible title.
- [x] Keep old 1H records visible and ensure a symbol/timeframe/candle has one journal row.

### Task 2: Generalize Bybit data by timeframe and expand pairs

**Files:**
- Modify: `src/bybit.js`
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- `getCandles(symbol, interval, limit = 200) -> Promise<Candle[]>`.
- `subscribeCandles(symbol, intervals, onCandle, onStatus) -> unsubscribe`.
- `Candle.start` remains the exchange candle start in milliseconds; confirmation uses the requested interval duration.

- [x] Add BTCUSDT, XRPUSDT, DOGEUSDT, and XMRUSDT to the selector; validate each contract dynamically.
- [x] Add 1H and 4H selectors and load the selected interval.
- [x] Subscribe to 1H and 4H streams while in 1H mode so closed 4H context refreshes live; use 4H only in 4H mode.
- [x] Make the pair and timeframe controls usable at narrow widths.

### Task 3: Add lookahead-safe 4H confirmation to 1H bias

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`

- [x] Select the latest confirmed 4H candle whose end time is at or before the analyzed 1H candle end.
- [x] Compute 4H trend from EMA20/EMA50 and 4H close; require agreement to retain LONG/SHORT in 1H mode, otherwise return WAIT with a reason.
- [x] Show the 4H confluence state and make the current horizon explicit in the forecast close time.
- [x] Keep the selected 4H mode based on 4H indicators and 4H ATR.

### Task 4: Make chart and journal timeframe-aware

**Files:**
- Modify: `src/forecast-journal.js`
- Modify: `src/app.js`

- [x] Include interval in forecast IDs and display it in the journal.
- [x] Resolve pending forecasts only from matching symbol/interval candles, including pending series restored after reload.
- [x] Use the selected interval duration for close time, chart state, and journal comparison.

### Task 5: Update product notes and perform static/manual review

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-27-horatrade-multi-timeframe-design.md`

- [x] Document available pairs, 1H/4H behavior, exact error calculation, and Freqtrade source pattern.
- [x] Review JavaScript syntax and inspect all symbol/timeframe resolution paths without running an automated test suite.
- [x] Confirm local-only behavior and that cloud deployment remains a later task.
