# Hourly Crypto Futures Signals Implementation Plan

> Superseded for ongoing changes by [`2026-10-27-horatrade-multi-timeframe.md`](2026-10-27-horatrade-multi-timeframe.md), which adds pair/timeframe expansion and the journal attribution correction.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Build a Spanish microapp that evaluates one-hour futures candles for ETHUSDT, BNBUSDT, and SOLUSDT, estimates the next hourly candle close, and compares each forecast with the observed close.

**Architecture:** A dependency-free static web app reads public Bybit V5 market data in the browser, calculates technical bias and a linear-trend close estimate locally, draws the chart on canvas, and stores forecast records in localStorage. A small Node.js static server supports local viewing; the static app can later be hosted on Cloudflare Pages from the free-for-dev catalog.

**Tech Stack:** HTML, CSS, vanilla JavaScript modules, Canvas 2D, browser WebSocket and Fetch APIs, Node.js built-in `http` server, localStorage.

**Spec:** `C:\Users\sergio\Desktop\crypto-futures-hourly-app-design.md`

## Global Constraints

- UI text is Spanish.
- Initial instruments are ETHUSDT, BNBUSDT, and SOLUSDT under Bybit linear USDT contracts.
- Generate signals only from closed 60-minute candles.
- Use EMA 20/50, RSI 14, MACD 12/26/9, ATR 14, and a 20-candle volume average.
- Bullish and bearish bias require aligned trend, momentum, and above-average volume; otherwise display `ESPERAR`.
- Forecasting only: no API keys, account data, or exchange order endpoints.
- Base price is the next interval's open; forecast close adds the 12-candle linear-regression slope, capped to ±1×ATR; the orientative range is ±1×ATR around the forecast.
- Store forecasts locally; recover pending observed closes from historical candles when the app reopens.
- Show data timestamps, connection state, and `SIN DATOS` rather than stale signals on unavailable data.
- Label the forecast as an estimate that is not a guaranteed price; the ATR band is not a calibrated probability interval.
- Keep the app independent from the free-for-dev catalog repository.

## Review Focus

- **Open candle update:** keep showing its live price while withholding new signals until close; use WebSocket `confirm=true` or, for REST history, include only rows whose end time is at or before the response's server time.
- **Unsupported or inactive symbol:** render `SIN DATOS` for that pair and continue displaying other valid pairs.
- **Network interruption or malformed API response:** show connection error and never leave an old signal looking current.
- **Insufficient candle history for indicators:** show a waiting state until the indicator lookback is available.
- **Browser closed across an hourly boundary:** restore pending journal entries from historical candles on the next open without duplicating them.

---

### Task 1: Create the app shell and local preview server

**Files:**
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\index.html`
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\styles.css`
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\app.js`
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\server.mjs`

**Interfaces:**
- `server.mjs` serves the app directory on `127.0.0.1:4173` using Node's built-in `http` module.
- `app.js` owns the selected symbol, connection status, and rendering entry point `renderApp(state)`.
- DOM regions: `#symbol-picker`, `#market-status`, `#chart`, `#signal-card`, and `#forecast-journal`.

- [x] Create a responsive Spanish dashboard with selector buttons for ETHUSDT, BNBUSDT, and SOLUSDT; an OHLC candle canvas; signal panel; and forecast journal table.
- [x] Create the dependency-free static server with correct content types for HTML, CSS, and JavaScript modules; reject paths outside the app directory.
- [ ] Open the local preview and manually inspect desktop and narrow-screen layout; verify each symbol button updates the selected-symbol label.

### Task 2: Add Bybit market data and indicator signal engine

**Files:**
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\bybit.js`
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\indicators.js`
- Modify: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\app.js`

**Interfaces:**
- `getLinearInstrument(symbol) -> Promise<Instrument | null>` validates the contract is active.
- `Instrument = { symbol: string, status: string }`.
- `Candle = { start: number, open: number, high: number, low: number, close: number, volume: number, confirmed: boolean }`.
- `getHourlyCandles(symbol, limit = 200) -> Promise<Candle[]>` returns ascending candles with the fields above.
- `subscribeHourlyCandles(symbol, onCandle, onStatus) -> () => void` connects to the public linear WebSocket and returns an unsubscribe function.
- `IndicatorSnapshot = { ema20: number, ema50: number, rsi14: number, macdLine: number, macdSignal: number, atr14: number, volumeSma20: number, ema20Series: (number|null)[], ema50Series: (number|null)[] }`.
- `calculateIndicators(candles) -> IndicatorSnapshot` uses EMA 20/50, Wilder RSI 14, MACD 12/26/9, Wilder ATR 14, and the arithmetic mean of the previous 20 closed candle volumes.
- `Signal = { direction: 'LONG' | 'SHORT' | 'WAIT', symbol: string, candleStart: number, closePrice: number, reasons: string[] }`.
- `classifySignal(candles, indicators) -> Signal` returns direction and reason strings; the app adds symbol and price levels. Only confirmed candles may be passed to classification. Long requires EMA20 > EMA50, close > EMA20, RSI14 >= 50 and < 70, MACD line > signal, and closed-candle volume > the previous 20-candle volume mean. Short uses EMA20 < EMA50, close < EMA20, RSI14 > 30 and <= 50, MACD line < signal, and the same volume confirmation. Otherwise return `WAIT`.
- `estimateNextClose(candles, referencePrice, atr14) -> Forecast` projects the least-squares slope of the last 12 closed closes one interval forward, caps the move to ±ATR14, and returns an orientative range of estimated close ±ATR14.

- [x] Implement active-instrument lookup and hourly candle retrieval with `category=linear`, `interval=60`; normalize and sort API rows into `Candle[]`.
- [x] Implement the public WebSocket candle subscription; pass the `confirm` value through to UI state and prevent open-candle signal generation.
- [x] Implement the exact EMA, Wilder RSI, MACD, Wilder ATR, and previous-20-candle volume rules above, with explicit `WAIT` on missing history or non-finite results.
- [x] Connect selected-symbol state to REST history, WebSocket updates, candle chart, timestamps, and status text.

### Task 3: Add next-close forecast and persistent forecast journal

**Files:**
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\forecast-journal.js`
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\chart.js`
- Modify: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\src\app.js`
- Modify: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\styles.css`

**Interfaces:**
- `estimateNextClose(candles, referencePrice, atr14) -> Forecast` projects the least-squares slope of the last 12 closed closes one interval forward, capped to ±ATR14, and returns an orientative range of estimate ±ATR14.
- `recordForecast(signal, nextCandle, forecast) -> ForecastRecord` stores one record per symbol and source candle.
- `resolvePendingForecasts(hourlyCandles) -> ForecastRecord[]` sets actual close from the forecast candle's closed hourly candle and calculates absolute percentage error.
- `listForecasts() -> ForecastRecord[]` reads and validates localStorage data.
- `drawCandles(canvas, candles, overlays) -> void` draws OHLC candles, EMA20/50 overlays, and forecast/base/range markers.
- `ForecastRecord` fields: `id, symbol, direction, signalCandleStart, forecastCandleStart, referencePrice, estimatedClose, rangeLow, rangeHigh, resolvedAt, actualClose, errorPct, reasons`.

- [x] Draw candle bodies/wicks, EMA overlays, volume bars, and next-close estimate/range markers on the canvas.
- [x] Record each next-close forecast once, store it in localStorage, and display it separately from the observed hourly close.
- [x] Show a visible note that the projected close and ATR band are approximate and do not guarantee future prices.
- [x] On app reopen, resolve pending forecasts from Bybit history and avoid duplicate journal rows for the same symbol/candle.
- [ ] Manually inspect a full forecast lifecycle from confirmed source candle through next-candle estimate, observed close, error, and journal persistence after reload.

### Task 4: Prepare the free-tier hosting handoff

**Files:**
- Create: `C:\Users\sergio\Desktop\crypto-futures-hourly-app\README.md`

**Interfaces:**
- README documents local launch with `node server.mjs`, app data limitations, and a deployment path for static hosting on Cloudflare Pages.

- [ ] Document the local launch command and clarify that the app uses public price data and local forecast records only.
- [ ] Document Cloudflare Pages as an optional hosting choice from the catalog; do not publish or connect an account as part of this implementation.

