const STORAGE_KEY = 'horatrade.forecast-journal.v1';
const INTERVAL_MS = Object.freeze({ '60': 60 * 60 * 1000, '240': 4 * 60 * 60 * 1000 });

function makeId(symbol, interval, signalCandleStart) {
  return `${symbol}:${interval}:${signalCandleStart}`;
}

function normalizeRecord(record) {
  if (!record || typeof record.symbol !== 'string' || !Number.isFinite(record.signalCandleStart)) return null;
  if (!['LONG', 'SHORT', 'WAIT'].includes(record.direction)) return null;
  if (!Number.isFinite(record.referencePrice) || !Number.isFinite(record.estimatedClose)
    || !Number.isFinite(record.forecastCandleStart)) return null;

  const legacy = record.interval == null;
  const interval = String(legacy ? '60' : record.interval);
  if (!Object.hasOwn(INTERVAL_MS, interval)) return null;

  // Earlier builds resolved by timestamp alone; re-check their realized closes by exact pair.
  const legacyResolved = legacy && record.resolvedAt != null;
  const resolutionStatus = legacyResolved
    ? 'rechecking'
    : record.resolutionStatus || (record.resolvedAt != null ? 'resolved' : 'pending');
  const actualClose = legacyResolved ? null : record.actualClose;
  const resolvedAt = legacyResolved ? null : record.resolvedAt;
  const absoluteError = resolutionStatus === 'resolved' && Number.isFinite(actualClose)
    ? Math.abs(actualClose - record.estimatedClose)
    : null;
  const errorPct = resolutionStatus === 'resolved' && Number.isFinite(actualClose) && actualClose !== 0
    ? (absoluteError / Math.abs(actualClose)) * 100
    : null;

  return {
    ...record,
    id: makeId(record.symbol, interval, record.signalCandleStart),
    interval,
    resolutionStatus,
    actualClose: Number.isFinite(actualClose) ? actualClose : null,
    resolvedAt: Number.isFinite(resolvedAt) ? resolvedAt : null,
    absoluteError,
    errorPct,
  };
}

function readForecastState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { forecasts: [], needsMigration: false };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { forecasts: [], needsMigration: false };
    const normalized = parsed.map(normalizeRecord);
    const forecasts = normalized.filter(Boolean);
    const needsMigration = parsed.some((record, index) => {
      const migrated = normalized[index];
      return !migrated || record.id !== migrated.id
        || record.interval == null
        || record.resolutionStatus !== migrated.resolutionStatus
        || record.resolvedAt !== migrated.resolvedAt
        || record.actualClose !== migrated.actualClose
        || record.errorPct !== migrated.errorPct
        || record.absoluteError !== migrated.absoluteError;
    });
    return { forecasts, needsMigration };
  } catch (error) {
    console.warn('No se pudo leer el diario local de pronósticos:', error);
    return { forecasts: [], needsMigration: false };
  }
}

function writeForecasts(forecasts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(forecasts));
    return true;
  } catch (error) {
    console.warn('No se pudo guardar el diario local de pronósticos:', error);
    return false;
  }
}

export function listForecasts() {
  return readForecastState().forecasts.sort((left, right) => right.signalCandleStart - left.signalCandleStart);
}

export function getPendingSeries() {
  const series = readForecastState().forecasts
    .filter((forecast) => !['resolved', 'unavailable'].includes(forecast.resolutionStatus))
    .map(({ symbol, interval }) => ({ symbol, interval }));
  return [...new Map(series.map((item) => [`${item.symbol}:${item.interval}`, item])).values()];
}

export function recordForecast(signal, nextCandle, forecast, interval) {
  const normalizedInterval = String(interval);
  if (!signal?.symbol || !Number.isFinite(signal.candleStart) || !nextCandle || !forecast) return null;
  if (!Object.hasOwn(INTERVAL_MS, normalizedInterval) || nextCandle.confirmed) return null;
  if (!Number.isFinite(nextCandle.start) || !Number.isFinite(forecast.referencePrice)
    || !Number.isFinite(forecast.estimatedClose) || !Number.isFinite(forecast.rangeLow)
    || !Number.isFinite(forecast.rangeHigh)) return null;

  const { forecasts } = readForecastState();
  const id = makeId(signal.symbol, normalizedInterval, signal.candleStart);
  const existing = forecasts.find((record) => record.id === id);
  if (existing) return existing;

  const record = {
    id,
    symbol: signal.symbol,
    interval: normalizedInterval,
    direction: signal.direction || 'WAIT',
    signalCandleStart: signal.candleStart,
    forecastCandleStart: nextCandle.start,
    referencePrice: forecast.referencePrice,
    estimatedClose: forecast.estimatedClose,
    rangeLow: forecast.rangeLow,
    rangeHigh: forecast.rangeHigh,
    resolutionStatus: 'pending',
    resolvedAt: null,
    actualClose: null,
    absoluteError: null,
    errorPct: null,
    reasons: signal.reasons || [],
  };
  forecasts.push(record);
  return writeForecasts(forecasts) ? record : null;
}

export function resolvePendingForecasts(symbol, interval, candles) {
  const normalizedInterval = String(interval);
  if (!Object.hasOwn(INTERVAL_MS, normalizedInterval)) return listForecasts();
  const state = readForecastState();
  if (!Array.isArray(candles) || candles.length === 0) {
    if (state.needsMigration) writeForecasts(state.forecasts);
    return listForecasts();
  }

  const candlesByStart = new Map(
    candles.filter((candle) => candle.confirmed).map((candle) => [candle.start, candle]),
  );
  const earliestStart = Math.min(...candles.map((candle) => candle.start));
  let changed = state.needsMigration;

  for (const forecast of state.forecasts) {
    if (forecast.symbol !== symbol || forecast.interval !== normalizedInterval) continue;
    if (['resolved', 'unavailable'].includes(forecast.resolutionStatus)) continue;
    const closedCandle = candlesByStart.get(forecast.forecastCandleStart);
    if (closedCandle && Number.isFinite(closedCandle.close) && closedCandle.close > 0) {
      forecast.actualClose = closedCandle.close;
      forecast.resolvedAt = closedCandle.start + INTERVAL_MS[normalizedInterval];
      forecast.absoluteError = Math.abs(forecast.actualClose - forecast.estimatedClose);
      forecast.errorPct = (forecast.absoluteError / Math.abs(forecast.actualClose)) * 100;
      forecast.resolutionStatus = 'resolved';
      changed = true;
      continue;
    }

    if (forecast.forecastCandleStart < earliestStart
      && Date.now() >= forecast.forecastCandleStart + INTERVAL_MS[normalizedInterval]) {
      forecast.resolutionStatus = 'unavailable';
      forecast.actualClose = null;
      forecast.resolvedAt = null;
      forecast.absoluteError = null;
      forecast.errorPct = null;
      changed = true;
    }
  }

  if (changed) writeForecasts(state.forecasts);
  return state.forecasts.sort((left, right) => right.signalCandleStart - left.signalCandleStart);
}
