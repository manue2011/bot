const config = require('../config/settings');
const fs = require('fs');
const path = require('path');

const TRADES_PATH = path.join(__dirname, '../logs/trades.json');
const SUMMARY_PATH = path.join(__dirname, '../logs/daily_summary.json');

// ── Cargar historial de trades ──
function cargarTrades() {
  try {
    const data = fs.readFileSync(TRADES_PATH, 'utf8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

// ── Guardar trade en historial ──
function guardarTrade(trade) {
  const trades = cargarTrades();
  trades.push(trade);
  fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
}

// ── Calcular Take-Profit neto (descontando fees) ──
function calcTakeProfit(precioEntrada) {
  const feeTotal = config.FEE_PCT * 2; // compra + venta
  const pctNeto = config.TAKE_PROFIT_PCT - feeTotal;
  return parseFloat((precioEntrada * (1 + pctNeto / 100)).toFixed(2));
}

// ── Calcular Stop-Loss ──
function calcStopLoss(precioEntrada) {
  return parseFloat((precioEntrada * (1 - config.STOP_LOSS_PCT / 100)).toFixed(2));
}

// ── Calcular resultado de una operación ──
function calcResultado(precioEntrada, precioSalida, cantidad) {
  const bruto = (precioSalida - precioEntrada) * cantidad;
  const feeCompra = precioEntrada * cantidad * (config.FEE_PCT / 100);
  const feeVenta = precioSalida * cantidad * (config.FEE_PCT / 100);
  const neto = parseFloat((bruto - feeCompra - feeVenta).toFixed(4));
  const pct = parseFloat(((neto / (precioEntrada * cantidad)) * 100).toFixed(2));
  return { neto, pct };
}

// ── Verificar si la orden supera el mínimo de Binance ──
function validarMinNotional(cantidadUSDT) {
  return cantidadUSDT >= config.MIN_ORDER_USDT;
}

// ── Calcular pérdida total del día ──
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

// ── Verificar si se alcanzó la pérdida máxima diaria ──
function superaPerdidaMaxima() {
  const perdidaHoy = calcPerdidaDiaria();
  const maxPermitida = config.CAPITAL_TOTAL * (config.MAX_PERDIDA_DIARIA_PCT / 100);
  return {
    supera: perdidaHoy >= maxPermitida,
    perdidaHoy: parseFloat(perdidaHoy.toFixed(4)),
    maxPermitida: parseFloat(maxPermitida.toFixed(4))
  };
}

// ── Generar resumen diario ──
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
  const pctAciertos = total > 0
    ? parseFloat(((ganadoras / total) * 100).toFixed(1))
    : 0;

  const resumen = {
    fecha: new Date().toLocaleDateString('es-ES'),
    ganadoras,
    perdedoras,
    total,
    gananciaDia,
    capitalActual,
    pctAciertos
  };

  // Guardar resumen
  let summaries = [];
  try {
    summaries = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8')) || [];
  } catch { }
  summaries.push(resumen);
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summaries, null, 2));

  return resumen;
}

module.exports = {
  calcTakeProfit,
  calcStopLoss,
  calcResultado,
  validarMinNotional,
  superaPerdidaMaxima,
  calcPerdidaDiaria,
  generarResumenDiario,
  guardarTrade,
  cargarTrades
};
