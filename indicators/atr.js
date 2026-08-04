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

  // Media simple de los True Ranges
  const lastTRs = trs.slice(-period);
  const atr = lastTRs.reduce((a, b) => a + b, 0) / period;
  return parseFloat(atr.toFixed(4));
}

module.exports = { calcATR };