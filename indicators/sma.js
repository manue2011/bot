// sma.js
function calcSMA(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(4));
}

module.exports = { calcSMA };

