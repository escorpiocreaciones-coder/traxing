import { getCandles, getLinearInstrument, subscribeCandles } from './bybit.js';
import { calculateIndicators, classifySignal, estimateNextClose } from './indicators.js';
import { drawCandles } from './chart.js';
import { getPendingSeries, listForecasts, recordForecast, resolvePendingForecasts } from './forecast-journal.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'XMRUSDT'];
const INTERVALS = Object.freeze({
  '60': { label: '1H', durationMs: 60 * 60 * 1000 },
  '240': { label: '4H', durationMs: 4 * 60 * 60 * 1000 },
});
const DAY_MS = 24 * 60 * 60 * 1000;
const HIGHER_INTERVAL = '240';

const state = {
  symbol: 'BTCUSDT',
  interval: '60',
  marketStatus: 'loading',
  statusMessage: '',
  candles: [],
  contextCandles: [],
  contextError: '',
  currentPrice: null,
  lastUpdated: null,
  indicators: null,
  signal: null,
  forecast: null,
  context: null,
};

const ui = {
  symbol: document.querySelector('#active-symbol'),
  interval: document.querySelector('#active-timeframe'),
  picker: document.querySelector('#symbol-picker'),
  timeframePicker: document.querySelector('#timeframe-picker'),
  marketStatus: document.querySelector('#market-status'),
  lastUpdated: document.querySelector('#last-updated'),
  currentPrice: document.querySelector('#current-price'),
  priceChange: document.querySelector('#price-change'),
  chartEmpty: document.querySelector('#chart-empty'),
  candleState: document.querySelector('#candle-state'),
  signalStatus: document.querySelector('#signal-status'),
  signalTimeframe: document.querySelector('#signal-timeframe'),
  signalLabel: document.querySelector('#signal-label'),
  signalSummary: document.querySelector('#signal-summary'),
  forecastBase: document.querySelector('#forecast-base'),
  forecastClose: document.querySelector('#forecast-close'),
  forecastRange: document.querySelector('#forecast-range'),
  forecastSummary: document.querySelector('#forecast-summary'),
  signalReasons: document.querySelector('#signal-reasons'),
  signalCandleTime: document.querySelector('#signal-candle-time'),
  trendValue: document.querySelector('#trend-value'),
  rsiValue: document.querySelector('#rsi-value'),
  macdValue: document.querySelector('#macd-value'),
  volumeValue: document.querySelector('#volume-value'),
  contextCard: document.querySelector('#context-card'),
  contextValue: document.querySelector('#context-value'),
  contextNote: document.querySelector('#context-note'),
  chart: document.querySelector('#chart'),
  journal: document.querySelector('#forecast-journal'),
  journalCount: document.querySelector('#journal-count'),
};

let unsubscribeMarket = null;
let activeRequest = 0;
let catchupTimer = null;

function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 1 ? 3 : 5;
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '—';
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(timestamp);
}

function setStatus(message, kind = 'loading') {
  state.marketStatus = kind;
  state.statusMessage = message;
  renderStatus();
}

function renderStatus() {
  const labels = {
    loading: 'Conectando con Bybit',
    connecting: 'Abriendo flujo de mercado',
    connected: 'Mercado en vivo',
    reconnecting: 'Reconectando · señal pausada',
    error: 'Error de conexión',
    unavailable: 'Contrato no disponible',
    'no-data': 'Sin datos',
  };
  ui.marketStatus.classList.remove('is-connected', 'is-error');
  if (state.marketStatus === 'connected') ui.marketStatus.classList.add('is-connected');
  if (['error', 'unavailable', 'no-data', 'reconnecting'].includes(state.marketStatus)) ui.marketStatus.classList.add('is-error');
  ui.marketStatus.querySelector('span:last-child').textContent = state.statusMessage || labels[state.marketStatus] || 'Preparando mercado';
}

function getClosedFourHourContext(signalCandleStart) {
  if (state.interval !== '60') return null;
  const signalEnd = signalCandleStart + INTERVALS['60'].durationMs;

  // Mirrors Freqtrade's merge_informative_pair shift: a higher-timeframe close
  // is available only to base candles whose close is at or after that close.
  const eligibleCandles = state.contextCandles.filter((candle) => (
    candle.confirmed && candle.start + INTERVALS[HIGHER_INTERVAL].durationMs <= signalEnd
  ));
  const indicators = calculateIndicators(eligibleCandles);
  if (!indicators) return { direction: 'WAIT', indicators: null, candle: eligibleCandles.at(-1) || null };

  const candle = eligibleCandles.at(-1);
  const direction = indicators.ema20 > indicators.ema50 && candle.close > indicators.ema20
    ? 'LONG'
    : indicators.ema20 < indicators.ema50 && candle.close < indicators.ema20
      ? 'SHORT'
      : 'WAIT';
  return { direction, indicators, candle };
}

function applyHigherTimeframeConfirmation(signal, context) {
  if (!signal) return signal;
  if (signal.direction === 'WAIT') {
    if (context?.direction === 'LONG' || context?.direction === 'SHORT') {
      const bias = context.direction === 'LONG' ? 'alcista' : 'bajista';
      return { ...signal, reasons: [...signal.reasons, `Tendencia 4H ${bias}; los requisitos de 1H aún no coinciden.`] };
    }
    return signal;
  }

  if (!context?.indicators || !context.candle) {
    return {
      ...signal,
      direction: 'WAIT',
      reasons: [...signal.reasons, 'Sin una vela 4H cerrada disponible; se retira el sesgo direccional 1H.'],
    };
  }

  const aligned = signal.direction === context.direction;
  const contextLabel = context.direction === 'LONG' ? 'alcista' : context.direction === 'SHORT' ? 'bajista' : 'lateral';
  return {
    ...signal,
    direction: aligned ? signal.direction : 'WAIT',
    reasons: [...signal.reasons, aligned
      ? `✓ Tendencia 4H ${contextLabel}; confirma el sesgo 1H.`
      : `Tendencia 4H ${contextLabel}; no confirma el sesgo 1H, se muestra ESPERAR.`],
  };
}

function findLatestAnalysis() {
  const closedCandles = state.candles.filter((candle) => candle.confirmed);
  const indicators = calculateIndicators(closedCandles);
  if (!indicators) return { indicators: null, signal: null, forecast: null, nextCandle: null, context: null };

  const rawSignal = classifySignal(closedCandles, indicators);
  const context = state.interval === '60' ? getClosedFourHourContext(rawSignal.candleStart) : null;
  const signal = applyHigherTimeframeConfirmation(rawSignal, context);
  const nextCandle = state.candles.find((candle) => candle.start > rawSignal.candleStart);
  const forecast = nextCandle ? estimateNextClose(closedCandles, nextCandle.open, indicators.atr14) : null;
  return {
    indicators,
    signal: { ...signal, symbol: state.symbol, interval: state.interval },
    forecast,
    nextCandle,
    context,
  };
}

function renderPrice() {
  const price = state.currentPrice;
  ui.currentPrice.textContent = formatPrice(price);
  if (!Number.isFinite(price) || state.candles.length < 2) {
    ui.priceChange.textContent = '—';
    ui.priceChange.className = 'price-change';
    return;
  }
  const currentStart = state.candles.at(-1).start;
  const dayAgo = currentStart - DAY_MS;
  const prior = [...state.candles].reverse().find((candle) => candle.start <= dayAgo);
  if (!prior || prior.close === 0) {
    ui.priceChange.textContent = 'Cambio 24 h —';
    ui.priceChange.className = 'price-change';
    return;
  }
  const change = ((price - prior.close) / prior.close) * 100;
  ui.priceChange.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% · 24 h`;
  ui.priceChange.className = `price-change ${change > 0 ? 'positive' : change < 0 ? 'negative' : ''}`;
}

function renderContext(context) {
  ui.contextCard.hidden = state.interval !== '60';
  if (state.interval !== '60') return;
  if (!context?.indicators || !context.candle) {
    ui.contextValue.textContent = 'SIN DATOS';
    ui.contextValue.className = '';
    ui.contextNote.textContent = state.contextError || 'Faltan velas 4H cerradas para calcular el contexto.';
    return;
  }

  const label = context.direction === 'LONG' ? 'ALCISTA' : context.direction === 'SHORT' ? 'BAJISTA' : 'LATERAL';
  ui.contextValue.textContent = label;
  ui.contextValue.className = context.direction === 'LONG' ? 'positive' : context.direction === 'SHORT' ? 'negative' : '';
  ui.contextNote.textContent = `Vela 4H cerrada · ${formatTime(context.candle.start + INTERVALS[HIGHER_INTERVAL].durationMs)}; se compara con el sesgo 1H.`;
}

function renderSignal() {
  const isStale = ['reconnecting', 'error'].includes(state.marketStatus);
  ui.signalStatus.className = 'signal-status status-wait';
  ui.signalTimeframe.textContent = INTERVALS[state.interval].label;
  ui.forecastBase.textContent = '—';
  ui.forecastClose.textContent = '—';
  ui.forecastRange.textContent = '—';
  ui.forecastSummary.textContent = '';
  state.forecast = null;

  if (isStale) {
    ui.signalLabel.textContent = 'DATOS PAUSADOS';
    ui.signalSummary.textContent = 'La conexión no está actualizando el mercado; esta lectura no se considera vigente.';
    ui.signalReasons.innerHTML = '<p>La señal volverá a calcularse cuando lleguen datos nuevos.</p>';
    renderContext(state.context);
    return;
  }

  const { signal, indicators, forecast, nextCandle, context } = findLatestAnalysis();
  state.indicators = indicators;
  state.signal = signal;
  state.forecast = forecast;
  state.context = context;
  if (!signal || !indicators) {
    ui.signalLabel.textContent = state.marketStatus === 'unavailable' || state.marketStatus === 'no-data' ? 'SIN DATOS' : 'ESPERAR';
    ui.signalSummary.textContent = state.statusMessage || 'Se necesitan más velas cerradas para calcular los indicadores.';
    ui.signalReasons.innerHTML = '<p>El análisis aparecerá cuando haya historial suficiente del contrato.</p>';
    renderIndicators(null, null, context);
    renderContext(context);
    return;
  }

  const directionClass = signal.direction === 'LONG' ? 'status-long' : signal.direction === 'SHORT' ? 'status-short' : 'status-wait';
  ui.signalStatus.className = `signal-status ${directionClass}`;
  ui.signalTimeframe.textContent = INTERVALS[state.interval].label;
  ui.signalLabel.textContent = signal.direction === 'LONG' ? 'ALCISTA' : signal.direction === 'SHORT' ? 'BAJISTA' : 'ESPERAR';
  ui.signalSummary.textContent = signal.direction === 'WAIT'
    ? `Sin sesgo confirmado en ${INTERVALS[state.interval].label}; la estimación usa la tendencia lineal reciente.`
    : state.interval === '60'
      ? `Sesgo ${signal.direction === 'LONG' ? 'alcista' : 'bajista'} en 1H, confirmado por la tendencia 4H.`
      : `Sesgo ${signal.direction === 'LONG' ? 'alcista' : 'bajista'} en 4H a partir de velas cerradas.`;

  if (forecast && nextCandle) {
    ui.forecastBase.textContent = `${formatPrice(forecast.referencePrice)} USDT`;
    ui.forecastClose.textContent = `${formatPrice(forecast.estimatedClose)} USDT`;
    ui.forecastRange.textContent = `${formatPrice(forecast.rangeLow)} – ${formatPrice(forecast.rangeHigh)} USDT`;
    const closeAt = nextCandle.start + INTERVALS[state.interval].durationMs;
    ui.forecastSummary.textContent = `Estimación para el cierre de la vela ${INTERVALS[state.interval].label} a las ${formatTime(closeAt)}.`;
  } else {
    ui.forecastSummary.textContent = `Esperando la próxima vela ${INTERVALS[state.interval].label} y suficiente historial cerrado.`;
  }
  ui.signalCandleTime.textContent = `Última vela ${INTERVALS[state.interval].label} cerrada · ${formatTime(signal.candleStart + INTERVALS[state.interval].durationMs)}`;
  ui.signalReasons.innerHTML = signal.reasons.map((reason) => (
    `<div class="reason-row"><span class="reason-check">${reason.startsWith('✓') ? '✓' : '·'}</span><span>${reason.replace(/^[✓·]\s*/, '')}</span></div>`
  )).join('');
  renderIndicators(indicators, signal, context);
  renderContext(context);
}

function renderChart() {
  const overlays = {
    ema20Series: state.indicators?.ema20Series || [],
    ema50Series: state.indicators?.ema50Series || [],
    forecastBase: state.marketStatus === 'connected' ? state.forecast?.referencePrice : null,
    forecastClose: state.marketStatus === 'connected' ? state.forecast?.estimatedClose : null,
    rangeLow: state.marketStatus === 'connected' ? state.forecast?.rangeLow : null,
    rangeHigh: state.marketStatus === 'connected' ? state.forecast?.rangeHigh : null,
  };
  drawCandles(ui.chart, state.candles, overlays);
}

function makeCell(text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderJournal() {
  const forecasts = listForecasts();
  ui.journalCount.textContent = `${forecasts.length} ${forecasts.length === 1 ? 'registro' : 'registros'}`;
  ui.journal.replaceChildren();
  if (forecasts.length === 0) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = makeCell('Los pronósticos se guardarán aquí mientras la app esté abierta.');
    cell.colSpan = 8;
    row.append(cell);
    ui.journal.append(row);
    return;
  }

  for (const forecast of forecasts.slice(0, 50)) {
    const row = document.createElement('tr');
    row.append(makeCell(formatTime(forecast.signalCandleStart + INTERVALS[forecast.interval].durationMs)));
    row.append(makeCell(forecast.symbol));
    row.append(makeCell(INTERVALS[forecast.interval].label));
    if (forecast.resolutionStatus === 'resolved') {
      const errorText = `${formatPrice(forecast.absoluteError)} USDT · ${formatPercent(forecast.errorPct)}%`;
      row.append(makeCell(errorText, forecast.errorPct <= 1 ? 'error-low' : 'error-high'));
    } else {
      const errorLabel = forecast.resolutionStatus === 'unavailable' ? '—' : 'Pendiente';
      row.append(makeCell(errorLabel, 'movement-flat'));
    }
    const direction = document.createElement('td');
    const pill = document.createElement('span');
    const directionClass = forecast.direction === 'LONG' ? 'long' : forecast.direction === 'SHORT' ? 'short' : 'neutral';
    pill.className = `direction-pill ${directionClass}`;
    pill.textContent = forecast.direction === 'LONG' ? 'ALCISTA' : forecast.direction === 'SHORT' ? 'BAJISTA' : 'ESPERAR';
    direction.append(pill);
    row.append(direction);
    row.append(makeCell(`${formatPrice(forecast.referencePrice)} USDT`));
    row.append(makeCell(`${formatPrice(forecast.estimatedClose)} USDT`));

    if (forecast.resolutionStatus === 'resolved') {
      row.append(makeCell(`${formatPrice(forecast.actualClose)} USDT`));
    } else {
      const actualLabel = forecast.resolutionStatus === 'unavailable'
        ? 'Histórico no disponible'
        : forecast.resolutionStatus === 'rechecking' ? 'Revisando histórico' : 'Pendiente';
      row.append(makeCell(actualLabel));
    }
    ui.journal.append(row);
  }
}

function resolveAvailableSeries() {
  if (state.candles.length > 0) resolvePendingForecasts(state.symbol, state.interval, state.candles);
  if (state.interval === '60' && state.contextCandles.length > 0) {
    resolvePendingForecasts(state.symbol, HIGHER_INTERVAL, state.contextCandles);
  }
}

function updateForecastJournal() {
  resolveAvailableSeries();
  const { signal, nextCandle, forecast } = findLatestAnalysis();
  if (signal && nextCandle && !nextCandle.confirmed && forecast) {
    recordForecast(signal, nextCandle, forecast, state.interval);
  }
  renderJournal();
}

async function restorePendingForecasts(exceptSeries = []) {
  const skipped = new Set(exceptSeries.map(({ symbol, interval }) => `${symbol}:${interval}`));
  const pendingSeries = getPendingSeries().filter(({ symbol, interval }) => (
    SYMBOLS.includes(symbol) && !skipped.has(`${symbol}:${interval}`)
  ));
  await Promise.all(pendingSeries.map(async ({ symbol, interval }) => {
    try {
      const candles = await getCandles(symbol, interval, 200);
      resolvePendingForecasts(symbol, interval, candles);
    } catch (error) {
      console.warn(`No se pudieron recuperar pronósticos de ${symbol} ${INTERVALS[interval].label}:`, error);
    }
  }));
  renderJournal();
}

function renderIndicators(indicators, signal, context) {
  if (!indicators) {
    ui.trendValue.textContent = '—';
    ui.rsiValue.textContent = '—';
    ui.macdValue.textContent = '—';
    ui.volumeValue.textContent = '—';
    ui.contextValue.textContent = '—';
    ui.contextNote.textContent = 'Esperando datos';
    return;
  }
  const isLong = indicators.ema20 > indicators.ema50;
  const macdLong = indicators.macdLine > indicators.macdSignal;
  const latestClosed = state.candles.filter((candle) => candle.confirmed).at(-1);
  const volumeStrong = latestClosed && latestClosed.volume > indicators.volumeSma20;
  ui.trendValue.textContent = isLong ? 'ALCISTA' : 'BAJISTA';
  ui.trendValue.className = isLong ? 'positive' : 'negative';
  ui.rsiValue.textContent = indicators.rsi14.toFixed(1);
  ui.rsiValue.className = indicators.rsi14 >= 50 ? 'positive' : 'negative';
  ui.macdValue.textContent = macdLong ? 'ALCISTA' : 'BAJISTA';
  ui.macdValue.className = macdLong ? 'positive' : 'negative';
  ui.volumeValue.textContent = volumeStrong ? 'CONFIRMA' : 'BAJO';
  ui.volumeValue.className = volumeStrong ? 'positive' : 'negative';
  void signal;
  void context;
}

function updateControlState() {
  ui.picker.querySelectorAll('[data-symbol]').forEach((button) => {
    const selected = button.dataset.symbol === state.symbol;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  ui.timeframePicker.querySelectorAll('[data-timeframe]').forEach((button) => {
    const selected = button.dataset.timeframe === state.interval;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderApp() {
  ui.symbol.textContent = state.symbol;
  ui.interval.textContent = INTERVALS[state.interval].label;
  ui.chartEmpty.classList.toggle('is-hidden', state.candles.length > 0);
  ui.chartEmpty.querySelector('strong').textContent = state.candles.length > 0 ? '' : state.statusMessage || 'Conectando con el mercado';
  ui.chartEmpty.querySelector('span:last-child').textContent = state.candles.length > 0 ? '' : `Las velas ${INTERVALS[state.interval].label} aparecerán aquí.`;
  ui.lastUpdated.textContent = state.lastUpdated ? `Actualizado ${formatTime(state.lastUpdated)}` : 'Esperando datos';
  const latest = state.candles.at(-1);
  ui.candleState.textContent = latest
    ? (latest.confirmed ? `Última vela ${INTERVALS[state.interval].label} cerrada ${formatTime(latest.start + INTERVALS[state.interval].durationMs)}` : `Vela ${INTERVALS[state.interval].label} en formación`)
    : `Velas de ${INTERVALS[state.interval].label}`;
  renderStatus();
  renderPrice();
  renderSignal();
  renderChart();
  renderJournal();
}

function mergeCandle(candle) {
  const target = candle.interval === state.interval
    ? state.candles
    : state.interval === '60' && candle.interval === HIGHER_INTERVAL ? state.contextCandles : null;
  if (!target) return;
  const index = target.findIndex((item) => item.start === candle.start);
  const updatedCandle = { ...(index >= 0 ? target[index] : {}), ...candle, streamUpdatedAt: Date.now() };
  if (index >= 0) target[index] = updatedCandle;
  else target.push(updatedCandle);
  target.sort((left, right) => left.start - right.start);
  if (target.length > 240) target.splice(0, target.length - 240);
  if (candle.interval === state.interval) state.currentPrice = candle.close;
  state.lastUpdated = Date.now();
}

function mergeHistoricalCandles(existingCandles, fetchedCandles, requestStartedAt) {
  const candlesByStart = new Map(fetchedCandles.map((candle) => [candle.start, candle]));
  for (const candle of existingCandles) {
    const fetched = candlesByStart.get(candle.start);
    if (!fetched || (candle.streamUpdatedAt || 0) > requestStartedAt) {
      candlesByStart.set(candle.start, candle);
    }
  }
  return [...candlesByStart.values()]
    .sort((left, right) => left.start - right.start)
    .slice(-240);
}

async function loadMarket(symbol, interval = state.interval) {
  activeRequest += 1;
  const requestId = activeRequest;
  unsubscribeMarket?.();
  unsubscribeMarket = null;
  clearInterval(catchupTimer);
  catchupTimer = null;
  state.symbol = symbol;
  state.interval = interval;
  state.candles = [];
  state.contextCandles = [];
  state.contextError = '';
  state.currentPrice = null;
  state.lastUpdated = null;
  state.statusMessage = '';
  updateControlState();
  setStatus('Conectando con Bybit', 'loading');
  renderApp();

  try {
    const instrument = await getLinearInstrument(symbol);
    if (requestId !== activeRequest) return;
    if (!instrument) {
      setStatus(`El contrato ${symbol} no está activo en este mercado.`, 'unavailable');
      renderApp();
      return;
    }

    const candles = await getCandles(symbol, interval, 200);
    if (requestId !== activeRequest) return;
    if (candles.length === 0) {
      setStatus('El exchange no devolvió velas para este contrato.', 'no-data');
      renderApp();
      return;
    }
    state.candles = candles;
    state.currentPrice = candles.at(-1).close;
    state.lastUpdated = Date.now();

    let contextCandles = [];
    let contextError = '';
    if (interval === '60') {
      try {
        contextCandles = await getCandles(symbol, HIGHER_INTERVAL, 200);
      } catch (error) {
        contextError = 'No se pudo cargar la confirmación 4H.';
        console.warn(`No se pudo cargar contexto 4H de ${symbol}:`, error);
      }
      if (requestId !== activeRequest) return;
    }
    state.contextCandles = contextCandles;
    state.contextError = contextError;

    setStatus('Abriendo flujo de mercado', 'connecting');
    resolveAvailableSeries();
    updateForecastJournal();
    const activeSeries = [{ symbol, interval }];
    if (interval === '60' && state.contextCandles.length > 0) activeSeries.push({ symbol, interval: HIGHER_INTERVAL });
    void restorePendingForecasts(activeSeries);
    renderApp();

    const subscribedIntervals = interval === '60' ? ['60', HIGHER_INTERVAL] : [interval];
    let historySyncRunning = false;
    let hasConnectedOnce = false;
    const refreshHistory = async () => {
      if (historySyncRunning || requestId !== activeRequest) return;
      historySyncRunning = true;
      const requestStartedAt = Date.now();
      const series = [{ symbol, interval }];
      if (interval === '60') series.push({ symbol, interval: HIGHER_INTERVAL });

      try {
        const results = await Promise.allSettled(series.map(({ symbol: pair, interval: timeframe }) => (
          getCandles(pair, timeframe, 200)
        )));
        if (requestId !== activeRequest) return;

        let receivedHistory = false;
        results.forEach((result, index) => {
          const timeframe = series[index].interval;
          if (result.status !== 'fulfilled') {
            if (timeframe === HIGHER_INTERVAL && interval === '60') {
              state.contextError = 'No se pudo actualizar la confirmación 4H; se conserva el último historial cargado.';
            }
            console.warn(`No se pudieron sincronizar velas de ${symbol} ${INTERVALS[timeframe].label}:`, result.reason);
            return;
          }

          const candles = result.value;
          if (candles.length === 0) return;
          if (timeframe === state.interval) {
            state.candles = mergeHistoricalCandles(state.candles, candles, requestStartedAt);
            state.currentPrice = state.candles.at(-1)?.close ?? state.currentPrice;
          } else if (timeframe === HIGHER_INTERVAL && state.interval === '60') {
            state.contextCandles = mergeHistoricalCandles(state.contextCandles, candles, requestStartedAt);
            state.contextError = '';
          }
          receivedHistory = true;
        });

        if (receivedHistory) {
          state.lastUpdated = Date.now();
          updateForecastJournal();
          renderApp();
        }
      } finally {
        historySyncRunning = false;
      }
    };

    unsubscribeMarket = subscribeCandles(symbol, subscribedIntervals, (candle) => {
      if (requestId !== activeRequest) return;
      mergeCandle(candle);
      state.marketStatus = 'connected';
      state.statusMessage = 'Mercado en vivo';
      updateForecastJournal();
      renderApp();
    }, (status, detail) => {
      if (requestId !== activeRequest) return;
      const labels = {
        connected: 'Mercado en vivo',
        connecting: 'Abriendo flujo de mercado',
        reconnecting: 'Reconectando · señal pausada',
        error: detail || 'Error de conexión',
      };
      state.marketStatus = status;
      state.statusMessage = labels[status] || detail || 'Conexión de mercado';
      if (status === 'connected') {
        if (hasConnectedOnce) void refreshHistory();
        hasConnectedOnce = true;
        updateForecastJournal();
      }
      renderApp();
    });
    catchupTimer = setInterval(() => { void refreshHistory(); }, 60_000);
  } catch (error) {
    if (requestId !== activeRequest) return;
    setStatus(`No se pudieron cargar datos: ${error.message}`, 'error');
    renderApp();
  }
}

ui.picker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-symbol]');
  if (!button || !SYMBOLS.includes(button.dataset.symbol)) return;
  loadMarket(button.dataset.symbol);
});

ui.timeframePicker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-timeframe]');
  const interval = button?.dataset.timeframe;
  if (!interval || !Object.hasOwn(INTERVALS, interval) || interval === state.interval) return;
  loadMarket(state.symbol, interval);
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .catch((error) => console.warn('No se pudo registrar el modo instalable de TRAXING:', error));
}

loadMarket(state.symbol, state.interval);
