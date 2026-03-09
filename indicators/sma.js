function calcSMA(closes, period = 20) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return parseFloat((sum / period).toFixed(2));
}

module.exports = { calcSMA };
