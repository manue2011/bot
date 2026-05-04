function calcEMA(closes, period) {
  if (closes.length < period) return null;

  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }

  return parseFloat(ema.toFixed(4)); // más precisión que .toFixed(2)
}

function calcMACD(closes) {
  if (closes.length < 35) return null;

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;

  const macdLine = ema12 - ema26;

  const macdHistory = [];
  for (let i = closes.length - 9; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e12 = calcEMA(slice, 12);
    const e26 = calcEMA(slice, 26);
    if (e12 && e26) macdHistory.push(e12 - e26);
  }

  if (macdHistory.length < 9) return null;

  const signalLine = calcEMA(macdHistory, 9);
  const histogram = signalLine ? macdLine - signalLine : null;

  // 🔥 MEJORADO: alcista si histograma positivo Y subiendo respecto al anterior
  const histAnterior = macdHistory.length >= 2
    ? macdHistory[macdHistory.length - 2] - (signalLine || 0)
    : null;

  const alcista = histogram !== null && histogram > 0 &&
    (histAnterior === null || histogram > histAnterior);

  return {
    macd: parseFloat(macdLine.toFixed(4)),
    signal: signalLine ? parseFloat(signalLine.toFixed(4)) : null,
    histogram: histogram ? parseFloat(histogram.toFixed(4)) : null,
    alcista
  };
}

module.exports = { calcMACD };