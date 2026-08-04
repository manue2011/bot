function calcBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;

  const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
  const avgSquared = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(avgSquared);

  const upper = parseFloat((sma + multiplier * stdDev).toFixed(4));
  const lower = parseFloat((sma - multiplier * stdDev).toFixed(4));
  const middle = parseFloat(sma.toFixed(4));

  const precio = closes[closes.length - 1];

  return {
    upper,
    middle,
    lower,
    enBandaInferior: precio <= lower,
    enBandaSuperior: precio >= upper
  };
}

module.exports = { calcBollinger };