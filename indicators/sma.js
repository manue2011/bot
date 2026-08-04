// sma.js
function calcSMA(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(4));
}
module.exports = { calcSMA };

// atr.js
function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  let trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  const lastTRs = trs.slice(-period);
  return parseFloat((lastTRs.reduce((a, b) => a + b, 0) / period).toFixed(4));
}
module.exports = { calcATR };