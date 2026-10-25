// Reglas de entrada y salida, compartidas por bot.js y backtest.js
// para que el backtest pruebe exactamente la misma lógica que opera en vivo.
const config = require('../config/settings');
const { calcRSI } = require('../indicators/rsi');
const { calcSMA } = require('../indicators/sma');
const { calcMACD } = require('../indicators/macd');
const { calcATR } = require('../indicators/atr');

// ── TENDENCIAS (a partir de velas cerradas) ──
function tendencia4HDesde(closes4h, precio) {
  const sma50 = calcSMA(closes4h, 50);
  if (!sma50) return 'ERROR';
  return precio > sma50 ? 'ALCISTA_4H' : 'BAJISTA_4H';
}

function macroDesde(closesDiarios, precio) {
  const sma20 = calcSMA(closesDiarios, 20);
  if (!sma20) return 'ERROR_MACRO';
  return precio > sma20 ? 'BTC_ALCISTA' : 'BTC_BAJISTA';
}

// ── ENTRADA ──
// Devuelve null si no se pueden calcular los indicadores
function evaluarEntrada({ closes, highs, lows, volumenes, precio, tendencia4h, macro, sentimiento }, p = config.ESTRATEGIA) {
  const rsi = calcRSI(closes, 14);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const macd = calcMACD(closes);
  const atr = calcATR(highs, lows, closes);
  if (!rsi || !sma20 || !sma50 || !macd || !atr) return null;

  const volActual = volumenes[volumenes.length - 1];
  const volMedio = volumenes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  let puntuacion = 0;
  if (tendencia4h === 'ALCISTA_4H') puntuacion += 3;
  if (macro === 'BTC_ALCISTA') puntuacion += 2;
  if (precio > sma20) puntuacion += 2;
  if (rsi > 45 && rsi < 68) puntuacion += 2;           // zona Momentum
  else if (rsi < (p.MR_RSI_MAX ?? 38) && precio < sma20) puntuacion += 2; // zona MeanReversion (sobreventa)
  if (macd.alcista) puntuacion += 2;
  if (sentimiento === 'POSITIVO') puntuacion += 1;

  const esMomentum = p.MOMENTUM &&
    rsi > p.RSI_MOMENTUM_MIN && rsi < p.RSI_MOMENTUM_MAX &&
    precio > sma20 &&
    precio > sma50 &&
    macd.alcista &&
    volActual > volMedio * p.VOLUMEN_MIN &&
    tendencia4h === 'ALCISTA_4H' &&
    macro === 'BTC_ALCISTA';

  const esMeanReversion = p.MEAN_REVERSION &&
    rsi < (p.MR_RSI_MAX ?? 38) &&
    precio < sma20 &&
    (p.MR_MACD === false || macd.alcista) &&
    (!p.MR_SOBRE_SMA50 || precio > sma50) &&
    tendencia4h === 'ALCISTA_4H' &&
    macro === 'BTC_ALCISTA';

  const estrategia = esMomentum ? 'Momentum' : esMeanReversion ? 'MeanReversion' : null;
  return { rsi, sma20, sma50, macd, atr, puntuacion, estrategia };
}

// ── NIVELES DE SALIDA AL ABRIR ──
function nivelesSalida(precioEntrada, atr, p = config.ESTRATEGIA) {
  // Stop: ATR × multiplicador, acotado entre SL_MIN_PCT y SL_MAX_PCT del precio
  const distATR = atr * p.SL_ATR_MULT;
  const distMin = precioEntrada * (p.SL_MIN_PCT / 100);
  const distMax = precioEntrada * (p.SL_MAX_PCT / 100);
  const distStop = Math.min(Math.max(distATR, distMin), distMax);
  const stopLoss = precioEntrada - distStop;
  // Take-profit: % fijo (TP_PCT) o múltiplo R del riesgo asumido (TP_R)
  const takeProfit = p.TP_PCT
    ? precioEntrada * (1 + p.TP_PCT / 100)
    : precioEntrada + distStop * p.TP_R;
  return { stopLoss, takeProfit, riesgo: distStop };
}

// ── TRAILING ──
// Devuelve el nuevo stop si mejora el actual, o null
function nuevoStopTrailing(pos, precio, p = config.ESTRATEGIA) {
  const ganancia = precio - pos.precioEntrada;
  const riesgo = pos.riesgo || pos.precioEntrada * (p.SL_MAX_PCT / 100);
  let candidato = null;

  // Breakeven: al alcanzar BE_R veces el riesgo, el stop pasa a entrada + comisiones
  if (p.BE_R && ganancia / riesgo >= p.BE_R) {
    candidato = pos.precioEntrada * (1 + (config.FEE_PCT * 2 + 0.1) / 100);
  }
  // Trailing por %: activa al +TRAIL_ACT_PCT y persigue a TRAIL_DIST_PCT (suelo entrada +0.5%)
  if (p.TRAIL_ACT_PCT && (ganancia / pos.precioEntrada) * 100 >= p.TRAIL_ACT_PCT) {
    candidato = Math.max(candidato || 0, precio * (1 - p.TRAIL_DIST_PCT / 100), pos.precioEntrada * 1.005);
  }
  // Trailing por ATR: a partir de TRAIL_R veces el riesgo, persigue a TRAIL_ATR_MULT × ATR
  if (p.TRAIL_R && pos.atr && ganancia / riesgo >= p.TRAIL_R) {
    candidato = Math.max(candidato || 0, precio - pos.atr * p.TRAIL_ATR_MULT);
  }
  return candidato && candidato > pos.stopLoss ? candidato : null;
}

function motivoSalida(pos, precio, sentimiento) {
  if (pos.takeProfit && precio >= pos.takeProfit) return '🎯 Take-Profit';
  if (precio <= pos.stopLoss) return pos.stopLoss > pos.precioEntrada ? '📈 Trailing' : '🛡️ Stop-Loss';
  if (sentimiento === 'NEGATIVO') return '📰 Noticias';
  return null;
}

module.exports = { tendencia4HDesde, macroDesde, evaluarEntrada, nivelesSalida, nuevoStopTrailing, motivoSalida };
