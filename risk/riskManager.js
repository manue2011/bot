const config = require('../config/settings');
const fs = require('fs');
const path = require('path');

// Usamos process.cwd() para compatibilidad total con Fly.io
const TRADES_PATH = path.join(process.cwd(), 'logs/trades.json');
const SUMMARY_PATH = path.join(process.cwd(), 'logs/daily_summary.json');
const POSICIONES_PATH = path.join(process.cwd(), 'logs/posiciones.json');
const KILL_SWITCH_FILE = path.join(process.cwd(), 'logs/kill_switch_status.json');

// ── NUEVA LÓGICA DE MEMORIA ──

function guardarPosiciones(posiciones) {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  fs.writeFileSync(POSICIONES_PATH, JSON.stringify(posiciones, null, 2));
}

function cargarPosiciones() {
  try {
    if (fs.existsSync(POSICIONES_PATH)) {
      const data = fs.readFileSync(POSICIONES_PATH, 'utf8');
      return JSON.parse(data) || {};
    }
  } catch (err) {
    console.error("⚠️ Error cargando posiciones.json:", err.message);
  }
  return {};
}

// ── FUNCIONES EXISTENTES ──

function cargarTrades() {
  try {
    const data = fs.readFileSync(TRADES_PATH, 'utf8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

function guardarTrade(trade) {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const trades = cargarTrades();
  trades.push(trade);
  fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
}

function calcTakeProfit(precioEntrada) {
  const feeTotal = config.FEE_PCT * 2;
  const pctNeto = config.TAKE_PROFIT_PCT - feeTotal;
  return parseFloat((precioEntrada * (1 + pctNeto / 100)).toFixed(2));
}

function calcStopLoss(precioEntrada) {
  return parseFloat((precioEntrada * (1 - config.STOP_LOSS_PCT / 100)).toFixed(2));
}

function calcResultado(precioEntrada, precioSalida, cantidad) {
  const bruto = (precioSalida - precioEntrada) * cantidad;
  const feeCompra = precioEntrada * cantidad * (config.FEE_PCT / 100);
  const feeVenta = precioSalida * cantidad * (config.FEE_PCT / 100);
  const neto = parseFloat((bruto - feeCompra - feeVenta).toFixed(4));
  const pct = parseFloat(((neto / (precioEntrada * cantidad)) * 100).toFixed(2));
  return { neto, pct };
}

function validarMinNotional(cantidadUSDT) {
  return cantidadUSDT >= config.MIN_ORDER_USDT;
}

function calcPerdidaDiaria() {
  const trades = cargarTrades();
  const hoy = new Date().toDateString();
  const tradesHoy = trades.filter(t =>
    new Date(t.timestamp).toDateString() === hoy && t.lado === 'VENTA'
  );
  const perdida = tradesHoy
    .filter(t => t.resultado < 0)
    .reduce((acc, t) => acc + Math.abs(t.resultado), 0);
  return parseFloat(perdida.toFixed(4));
}

function superaPerdidaMaxima() {
  const perdidaHoy = calcPerdidaDiaria();
  const maxPermitida = config.CAPITAL_TOTAL * (config.MAX_PERDIDA_DIARIA_PCT / 100);
  return {
    supera: perdidaHoy >= maxPermitida,
    perdidaHoy: parseFloat(perdidaHoy.toFixed(4)),
    maxPermitida: parseFloat(maxPermitida.toFixed(4))
  };
}

function generarResumenDiario(capitalActual) {
  const trades = cargarTrades();
  const hoy = new Date().toDateString();
  const tradesHoy = trades.filter(t =>
    new Date(t.timestamp).toDateString() === hoy && t.lado === 'VENTA'
  );
  const ganadoras = tradesHoy.filter(t => t.resultado >= 0).length;
  const perdedoras = tradesHoy.filter(t => t.resultado < 0).length;
  const total = tradesHoy.length;
  const gananciaDia = parseFloat(
    tradesHoy.reduce((acc, t) => acc + t.resultado, 0).toFixed(4)
  );
  const pctAciertos = total > 0 ? parseFloat(((ganadoras / total) * 100).toFixed(1)) : 0;

  const resumen = {
    fecha: new Date().toLocaleDateString('es-ES'),
    ganadoras,
    perdedoras,
    total,
    gananciaDia,
    capitalActual,
    pctAciertos
  };

  let summaries = [];
  try {
    if (fs.existsSync(SUMMARY_PATH)) {
      summaries = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8')) || [];
    }
  } catch { }
  summaries.push(resumen);
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summaries, null, 2));
  return resumen;
}

// ── LÓGICA DEL KILL SWITCH (EL ESCUDO) ──

let rachasPerdidas = cargarRachas();

function cargarRachas() {
  try {
    if (fs.existsSync(KILL_SWITCH_FILE)) {
      const data = fs.readFileSync(KILL_SWITCH_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("❌ Error leyendo Kill Switch:", err.message);
  }
  return { 'SOLUSDT': 0, 'ETHUSDT': 0, 'BTCUSDT': 0 }; // Estado inicial
}

function guardarRachas() {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.writeFileSync(KILL_SWITCH_FILE, JSON.stringify(rachasPerdidas, null, 2));
  } catch (err) {
    console.error("❌ Error guardando Kill Switch:", err.message);
  }
}

function registrarResultadoKillSwitch(symbol, neto) {
  if (neto < 0) {
    rachasPerdidas[symbol] = (rachasPerdidas[symbol] || 0) + 1;
    console.log(`⚠️ Racha perdedora de ${symbol} aumentada a: ${rachasPerdidas[symbol]}`);
  } else if (neto > 0) {
    rachasPerdidas[symbol] = 0;
    console.log(`✅ Racha perdedora de ${symbol} reseteada a 0.`);
  }
  guardarRachas();
}

function estaMonedaBloqueada(symbol, limitePerdidas = 3) {
  return (rachasPerdidas[symbol] >= limitePerdidas);
}
function calcStopLoss(precioEntrada, atr) {
  // Usamos un multiplicador de 2 (estándar en trading profesional)
  // Si no hay ATR (raro), volvemos al 2% de seguridad por defecto
  const multiplicadorATR = 2;
  const distanciaSeguridad = atr ? (atr * multiplicadorATR) : (precioEntrada * 0.02);
  
  const stopLoss = precioEntrada - distanciaSeguridad;
  
  // Seguridad extra: que el stop nunca sea más del 3.5% (para no desangrarnos)
  const precioMinimoSeguro = precioEntrada * 0.965;
  return parseFloat(Math.max(stopLoss, precioMinimoSeguro).toFixed(2));
}

// ── EXPORTACIÓN FINAL UNIFICADA ──
module.exports = {
  calcTakeProfit,
  calcStopLoss,
  calcResultado,
  validarMinNotional,
  superaPerdidaMaxima,
  calcPerdidaDiaria,
  generarResumenDiario,
  guardarTrade,
  cargarTrades,
  guardarPosiciones, 
  cargarPosiciones,   
  registrarResultadoKillSwitch, 
  estaMonedaBloqueada
};