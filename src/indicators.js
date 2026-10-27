function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function simpleMean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;

  const alpha = 2 / (period + 1);
  let previous = simpleMean(values.slice(0, period));
  result[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    result[index] = previous;
  }
  return result;
}

function emaNullableSeries(values, period) {
  const result = Array(values.length).fill(null);
  let firstValid = values.findIndex(isFiniteNumber);
  if (firstValid < 0) return result;
  const contiguous = values.slice(firstValid).every(isFiniteNumber);
  if (!contiguous) return result;
  const local = emaSeries(values.slice(firstValid), period);
  local.forEach((value, index) => { result[firstValid + index] = value; });
  return result;
}

function latestRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function latestAtr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }
  if (ranges.length < period) return null;
  let atr = simpleMean(ranges.slice(0, period));
  for (let index = period; index < ranges.length; index += 1) {
    atr = (atr * (period - 1) + ranges[index]) / period;
  }
  return atr;
}

export function calculateIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 51) return null;
  const closes = candles.map((candle) => candle.close);
  if (!closes.every(isFiniteNumber)) return null;

  const ema20Series = emaSeries(closes, 20);
  const ema50Series = emaSeries(closes, 50);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, index) => (
    isFiniteNumber(ema12[index]) && isFiniteNumber(ema26[index]) ? ema12[index] - ema26[index] : null
  ));
  const macdSignal = emaNullableSeries(macdLine, 9);
  const previousVolumes = candles.slice(-21, -1).map((candle) => candle.volume);
  if (previousVolumes.length !== 20 || !previousVolumes.every(isFiniteNumber)) return null;

  const lastIndex = candles.length - 1;
  const indicators = {
    ema20: ema20Series[lastIndex],
    ema50: ema50Series[lastIndex],
    rsi14: latestRsi(closes, 14),
    macdLine: macdLine[lastIndex],
    macdSignal: macdSignal[lastIndex],
    atr14: latestAtr(candles, 14),
    volumeSma20: simpleMean(previousVolumes),
    ema20Series,
    ema50Series,
  };
  const latestValues = [indicators.ema20, indicators.ema50, indicators.rsi14, indicators.macdLine, indicators.macdSignal, indicators.atr14, indicators.volumeSma20];
  return latestValues.every(isFiniteNumber) ? indicators : null;
}

export function classifySignal(candles, indicators) {
  if (!Array.isArray(candles) || candles.length === 0 || !indicators) {
    return { direction: 'WAIT', candleStart: null, reasons: ['Esperando suficientes velas cerradas para calcular indicadores.'] };
  }
  const candle = candles.at(-1);
  if (!candle.confirmed) {
    return { direction: 'WAIT', candleStart: candle.start, reasons: ['La vela aún está abierta; la señal se confirma al cierre.'] };
  }

  const trendLong = indicators.ema20 > indicators.ema50 && candle.close > indicators.ema20;
  const trendShort = indicators.ema20 < indicators.ema50 && candle.close < indicators.ema20;
  const momentumLong = indicators.rsi14 >= 50 && indicators.rsi14 < 70 && indicators.macdLine > indicators.macdSignal;
  const momentumShort = indicators.rsi14 > 30 && indicators.rsi14 <= 50 && indicators.macdLine < indicators.macdSignal;
  const volumeConfirmed = candle.volume > indicators.volumeSma20;

  let direction = 'WAIT';
  if (trendLong && momentumLong && volumeConfirmed) direction = 'LONG';
  if (trendShort && momentumShort && volumeConfirmed) direction = 'SHORT';

  const reasons = [
    `${trendLong ? '✓' : trendShort ? '✓' : '·'} Tendencia: EMA 20 ${indicators.ema20 > indicators.ema50 ? 'sobre' : 'bajo'} EMA 50.`,
    `${momentumLong || momentumShort ? '✓' : '·'} Momentum: RSI ${indicators.rsi14.toFixed(1)}; MACD ${indicators.macdLine > indicators.macdSignal ? 'sobre' : 'bajo'} su señal.`,
    `${volumeConfirmed ? '✓' : '·'} Volumen ${volumeConfirmed ? 'superior' : 'sin confirmación'} al promedio de 20 velas previas.`,
  ];
  return { direction, candleStart: candle.start, closePrice: candle.close, reasons };
}

export function estimateNextClose(candles, referencePrice, atr14) {
  const sample = Array.isArray(candles) ? candles.filter((candle) => candle.confirmed).slice(-12) : [];
  if (sample.length !== 12 || !isFiniteNumber(referencePrice) || !isFiniteNumber(atr14) || atr14 <= 0) return null;

  const values = sample.map((candle) => candle.close);
  if (!values.every(isFiniteNumber)) return null;
  const meanX = (values.length - 1) / 2;
  const meanY = simpleMean(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const centeredX = index - meanX;
    numerator += centeredX * (values[index] - meanY);
    denominator += centeredX * centeredX;
  }

  if (denominator === 0) return null;
  const rawSlope = numerator / denominator;
  const projectedMove = Math.max(-atr14, Math.min(atr14, rawSlope));
  const estimatedClose = referencePrice + projectedMove;
  return {
    referencePrice,
    estimatedClose,
    rangeLow: estimatedClose - atr14,
    rangeHigh: estimatedClose + atr14,
    rawSlope,
    projectedMove,
  };
}
