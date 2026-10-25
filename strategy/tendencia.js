// Estrategia de seguimiento de tendencia en velas de 4h (ruptura de Donchian).
// Compartida por bot.js y backtest_tendencia.js para que el backtest pruebe exactamente la lógica en vivo.
//
// Entrada: el cierre de 4h supera el máximo de las N velas anteriores, con filtro de régimen
//          (precio de la moneda y/o de BTC por encima de su media diaria de SMA_DIAS días).
// Salida:  stop inicial a STOP_ATR × ATR(14, 4h); después sube al mínimo de las últimas M velas de 4h
//          (nunca baja). Sin take-profit: se deja correr la tendencia.
const config = require('../config/settings');

const VENTANA_ATR = 100; // velas usadas para el ATR (mismo tamaño en vivo y en backtest)

// ATR de Wilder sobre una ventana de velas [abre, alto, bajo, cierre]
function atrWilder(velas, n = 14) {
  let atr = null;
  for (let i = 1; i < velas.length; i++) {
    const tr = Math.max(velas[i][2] - velas[i][3], Math.abs(velas[i][2] - velas[i - 1][4]), Math.abs(velas[i][3] - velas[i - 1][4]));
    atr = atr === null ? tr : (atr * (n - 1) + tr) / n;
  }
  return velas.length > n ? atr : null;
}

function smaCierres(velas, n) {
  if (velas.length < n) return null;
  return velas.slice(-n).reduce((a, c) => a + c[4], 0) / n;
}

// velas4h / velas1d: solo velas CERRADAS, la última de velas4h es la vela de la señal.
// btc4h / btc1d: lo mismo para BTC (para el filtro de régimen).
function evaluarTendencia({ velas4h, velas1d, btc4h, btc1d }, p = config.TENDENCIA) {
  if (velas4h.length < Math.max(p.N + 1, 30)) return null;
  const i = velas4h.length - 1;
  const cierre = velas4h[i][4];
  const maxPrevio = Math.max(...velas4h.slice(i - p.N, i).map(c => c[2]));
  const atr = atrWilder(velas4h.slice(-VENTANA_ATR));
  if (!atr) return null;

  const smaMoneda = smaCierres(velas1d, p.SMA_DIAS);
  const smaBtc = smaCierres(btc1d, p.SMA_DIAS);
  const cierreBtc = btc4h.length ? btc4h[btc4h.length - 1][4] : null;
  const regimenMoneda = !!smaMoneda && cierre > smaMoneda;
  const regimenBtc = !!smaBtc && !!cierreBtc && cierreBtc > smaBtc;
  const filtroOk =
    p.FILTRO === 'ninguno' ? true :
    p.FILTRO === 'btc' ? regimenBtc :
    p.FILTRO === 'moneda' ? regimenMoneda :
    regimenMoneda && regimenBtc;

  const ruptura = cierre > maxPrevio;
  return { entrar: ruptura && filtroOk, ruptura, regimenMoneda, regimenBtc, cierre, maxPrevio, atr };
}

function stopInicial(precioEntrada, atr, p = config.TENDENCIA) {
  return precioEntrada - p.STOP_ATR * atr;
}

// Nuevo stop tras cerrar una vela de 4h: mínimo de las últimas M velas, sin bajar nunca
function actualizarStop(stopActual, velas4h, p = config.TENDENCIA) {
  const minimo = Math.min(...velas4h.slice(-p.M).map(c => c[3]));
  return Math.max(stopActual, minimo);
}

module.exports = { evaluarTendencia, stopInicial, actualizarStop, atrWilder, smaCierres };
