const API_BASE = 'https://api.bybit.com';
const LINEAR_STREAM = 'wss://stream.bybit.com/v5/public/linear';
const INTERVAL_MS = Object.freeze({ '60': 60 * 60 * 1000, '240': 4 * 60 * 60 * 1000 });

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.retCode !== 0) throw new Error(payload.retMsg || 'Respuesta inválida del exchange');
  return payload;
}

function normalizeInterval(interval) {
  const value = String(interval);
  if (!Object.hasOwn(INTERVAL_MS, value)) throw new RangeError(`Marco temporal no admitido: ${value}`);
  return value;
}

export async function getLinearInstrument(symbol) {
  const url = new URL('/v5/market/instruments-info', API_BASE);
  url.search = new URLSearchParams({ category: 'linear', symbol }).toString();
  const payload = await getJson(url);
  const instrument = payload.result?.list?.find((item) => item.symbol === symbol);
  if (!instrument || instrument.status !== 'Trading' || instrument.quoteCoin !== 'USDT') return null;
  return { symbol: instrument.symbol, status: instrument.status, quoteCoin: instrument.quoteCoin };
}

function normalizeRestCandle(row, serverTime, interval) {
  const [start, open, high, low, close, volume] = row;
  const candleStart = Number(start);
  return {
    start: candleStart,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    interval,
    confirmed: candleStart + INTERVAL_MS[interval] <= serverTime,
  };
}

export async function getCandles(symbol, interval, limit = 200) {
  const normalizedInterval = normalizeInterval(interval);
  const url = new URL('/v5/market/kline', API_BASE);
  url.search = new URLSearchParams({
    category: 'linear',
    symbol,
    interval: normalizedInterval,
    limit: String(limit),
  }).toString();
  const payload = await getJson(url);
  const serverTime = Number(payload.time);
  const rows = payload.result?.list;
  if (!Array.isArray(rows) || !Number.isFinite(serverTime)) throw new Error('No se recibieron velas válidas');

  return rows
    .map((row) => normalizeRestCandle(row, serverTime, normalizedInterval))
    .filter((candle) => [candle.start, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite))
    .sort((left, right) => left.start - right.start);
}

function normalizeStreamCandle(candle, interval) {
  return {
    start: Number(candle.start),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
    interval,
    confirmed: candle.confirm === true,
  };
}

export function subscribeCandles(symbol, intervals, onCandle, onStatus) {
  const requestedIntervals = [...new Set(intervals.map(normalizeInterval))];
  if (requestedIntervals.length === 0) throw new RangeError('Se requiere al menos un marco temporal');

  let socket;
  let stopped = false;
  let retryTimer;
  let pingTimer;
  let subscribeTimer;
  let retryDelay = 1500;

  const clearSocketTimers = () => {
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    clearTimeout(subscribeTimer);
  };

  const connect = () => {
    if (stopped) return;
    if (typeof WebSocket === 'undefined') {
      onStatus('error', 'Este navegador no admite WebSocket');
      return;
    }

    onStatus('connecting');
    socket = new WebSocket(LINEAR_STREAM);
    socket.addEventListener('open', () => {
      const args = requestedIntervals.map((interval) => `kline.${interval}.${symbol}`);
      socket.send(JSON.stringify({ op: 'subscribe', args }));
      subscribeTimer = setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          onStatus('error', 'Bybit no confirmó la suscripción de velas');
          socket.close();
        }
      }, 10000);
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'ping' }));
      }, 20000);
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.op === 'subscribe') {
          clearTimeout(subscribeTimer);
          if (message.success === true) {
            retryDelay = 1500;
            onStatus('connected');
          } else {
            onStatus('error', message.ret_msg || 'Bybit rechazó la suscripción de velas');
            socket?.close();
          }
          return;
        }

        const match = /^kline\.(60|240)\./.exec(message.topic || '');
        if (!match || !Array.isArray(message.data)) return;
        const interval = match[1];
        if (!requestedIntervals.includes(interval)) return;
        for (const rawCandle of message.data) {
          const candle = normalizeStreamCandle(rawCandle, interval);
          if ([candle.start, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) {
            onCandle(candle);
          }
        }
      } catch {
        onStatus('error', 'No se pudo leer una actualización del mercado');
      }
    });

    socket.addEventListener('close', () => {
      clearSocketTimers();
      if (stopped) return;
      onStatus('reconnecting');
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    });

    socket.addEventListener('error', () => {
      onStatus('reconnecting');
      socket?.close();
    });
  };

  connect();
  return () => {
    stopped = true;
    clearSocketTimers();
    socket?.close();
  };
}
