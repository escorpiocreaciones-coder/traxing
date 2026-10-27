function priceLabel(value) {
  if (!Number.isFinite(value)) return '';
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 4;
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(value);
}

function drawLine(context, values, startIndex, xFor, yFor, color, width, plotTop, plotBottom) {
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = width;
  let drawing = false;
  values.forEach((value, index) => {
    if (index < startIndex || !Number.isFinite(value)) return;
    const x = xFor(index - startIndex);
    const y = yFor(value);
    if (y < plotTop || y > plotBottom) {
      drawing = false;
      return;
    }
    if (!drawing) {
      context.moveTo(x, y);
      drawing = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

export function drawCandles(canvas, candles, overlays = {}) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  const context = canvas.getContext('2d');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!Array.isArray(candles) || candles.length === 0) return;

  const visible = candles.slice(-48);
  const startIndex = candles.length - visible.length;
  const width = bounds.width;
  const height = bounds.height;
  const padding = { left: 8, right: 60, top: 12, bottom: 55 };
  const plotTop = padding.top;
  const volumeHeight = 31;
  const plotBottom = height - padding.bottom - volumeHeight;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = plotBottom - plotTop;
  const candleSlot = plotWidth / visible.length;
  const highs = visible.map((candle) => candle.high);
  const lows = visible.map((candle) => candle.low);
  [overlays.forecastBase, overlays.forecastClose, overlays.rangeLow, overlays.rangeHigh].forEach((price) => {
    if (Number.isFinite(price)) {
      highs.push(price);
      lows.push(price);
    }
  });
  let maxPrice = Math.max(...highs);
  let minPrice = Math.min(...lows);
  if (maxPrice === minPrice) { maxPrice += 1; minPrice -= 1; }
  const paddingPrice = (maxPrice - minPrice) * 0.06;
  maxPrice += paddingPrice;
  minPrice -= paddingPrice;

  const xFor = (index) => padding.left + candleSlot * (index + 0.5);
  const yFor = (price) => plotTop + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
  const gridLines = 4;
  context.font = '9px "DM Mono", Consolas, monospace';
  context.textBaseline = 'middle';
  for (let index = 0; index <= gridLines; index += 1) {
    const ratio = index / gridLines;
    const y = plotTop + ratio * plotHeight;
    const value = maxPrice - ratio * (maxPrice - minPrice);
    context.strokeStyle = '#edf0f5';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right + 5, y);
    context.stroke();
    context.fillStyle = '#97a1b1';
    context.textAlign = 'left';
    context.fillText(priceLabel(value), width - padding.right + 11, y);
  }

  const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
  visible.forEach((candle, index) => {
    const x = xFor(index);
    const rising = candle.close >= candle.open;
    const color = rising ? '#21a37c' : '#dc6573';
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const candleWidth = Math.max(2, Math.min(10, candleSlot * 0.58));
    context.strokeStyle = color;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();
    context.fillStyle = color;
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
    context.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

    const volumeTop = plotBottom + 8 + (1 - candle.volume / maxVolume) * volumeHeight;
    context.globalAlpha = 0.34;
    context.fillRect(x - candleWidth / 2, volumeTop, candleWidth, plotBottom + 8 + volumeHeight - volumeTop);
    context.globalAlpha = 1;
  });

  drawLine(context, overlays.ema20Series || [], startIndex, xFor, yFor, '#7166d8', 1.4, plotTop, plotBottom);
  drawLine(context, overlays.ema50Series || [], startIndex, xFor, yFor, '#d59a43', 1.3, plotTop, plotBottom);

  const drawMarker = (price, color, label) => {
    if (!Number.isFinite(price)) return;
    const y = yFor(price);
    context.strokeStyle = color;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right + 3, y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = color;
    context.textAlign = 'left';
    context.fillText(`${label} ${priceLabel(price)}`, width - padding.right + 9, y - 7);
  };
  drawMarker(overlays.forecastBase, '#667fe2', 'Base');
  drawMarker(overlays.rangeLow, '#a5b2c6', 'Mín. ATR');
  drawMarker(overlays.rangeHigh, '#a5b2c6', 'Máx. ATR');
  drawMarker(overlays.forecastClose, '#27a27a', 'Cierre est.');

  context.fillStyle = '#9ba5b3';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const tickStep = Math.max(1, Math.ceil(visible.length / 4));
  for (let index = 0; index < visible.length; index += tickStep) {
    const time = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit' }).format(visible[index].start);
    context.fillText(time, xFor(index), plotBottom + volumeHeight + 14);
  }
}
