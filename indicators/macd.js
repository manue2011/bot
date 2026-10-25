function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 35) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;

  const macdLine = ema12 - ema26;

  const macdHistory = [];
  for (let i = closes.length - 9; i < closes.length; i++) { // < no <=
    const slice = closes.slice(0, i);
    const e12 = calcEMA(slice, 12);
    const e26 = calcEMA(slice, 26);
    if (e12 && e26) macdHistory.push(e12 - e26);
  }

  if (macdHistory.length < 9) return null;

  const signalLine = calcEMA(macdHistory, 9);
  const histogram = signalLine
    ? macdLine - signalLine
    : null;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
    alcista: histogram !== null && histogram > 0
  };
}

module.exports = { calcMACD };