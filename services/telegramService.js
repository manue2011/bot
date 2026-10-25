const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/settings');

const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = config.TELEGRAM_CHAT_ID;

async function enviar(mensaje) {
  try {
    await bot.sendMessage(CHAT_ID, String(mensaje), { parse_mode: 'HTML' });
  } catch (err) {
    try {
      const sinHTML = String(mensaje).replace(/<[^>]*>/g, '');
      await bot.sendMessage(CHAT_ID, sinHTML);
    } catch (err2) {
      console.error('Error Telegram:', err2.message);
    }
  }
}

function mensajeInicio() {
  return enviar(`🤖 <b>Crypto Bot v5.0 iniciado</b>
━━━━━━━━━━━━━━━━━━━━
💰 Capital: <b>$${config.CAPITAL_TOTAL} USDT</b>
📊 Pares: <b>${config.SYMBOLS.map(s => s.replace('USDT', '')).join(' | ')}</b>
🔒 Modo: <b>${config.BINANCE_TESTNET ? 'TESTNET' : '🔴 REAL'}</b>
🛡️ SL: <b>${config.ESTRATEGIA.SL_ATR_MULT}×ATR</b> (${config.ESTRATEGIA.SL_MIN_PCT}–${config.ESTRATEGIA.SL_MAX_PCT}%) | 🎯 TP: <b>${config.ESTRATEGIA.TP_PCT ? '+' + config.ESTRATEGIA.TP_PCT + '%' : config.ESTRATEGIA.TP_R + 'R'}</b>
⏰ Intervalo: <b>${config.INTERVALO_SEGUNDOS}s</b>
━━━━━━━━━━━━━━━━━━━━
¡Bot en marcha! 🚀`);
}

function mensajeCompra(datos) {
  return enviar(`🟢 <b>COMPRA EJECUTADA</b>
━━━━━━━━━━━━━━━━━━━━
📌 Par: <b>${datos.symbol}</b>
💵 Precio: <b>$${datos.precioEntrada.toPrecision(6)}</b>
📦 Cantidad: <b>${datos.cantidad}</b>
💰 Invertido: <b>$${datos.usdt} USDT</b>
━━━━━━━━━━━━━━━━━━━━
🛡️ Stop-Loss: <b>$${datos.stopLoss}</b>
🎯 Take-Profit: <b>$${datos.takeProfit}</b>
━━━━━━━━━━━━━━━━━━━━
📊 RSI: ${datos.rsi} | MACD: ${datos.macd ? '↑' : '↓'} | Tendencia 4H: ${datos.tendencia4h}
😱 Fear&Greed: ${datos.fgValor}
⏰ ${new Date().toLocaleString('es-ES')}`);
}

function mensajeVenta(datos) {
  const esGanancia = datos.resultado >= 0;
  return enviar(`${esGanancia ? '✅' : '❌'} <b>VENTA — ${esGanancia ? 'GANANCIA' : 'PÉRDIDA'}</b>
━━━━━━━━━━━━━━━━━━━━
📌 Par: <b>${datos.symbol}</b>
💵 Entrada: <b>$${datos.precioEntrada}</b> → Salida: <b>$${datos.precioSalida}</b>
━━━━━━━━━━━━━━━━━━━━
${esGanancia ? '📈' : '📉'} Resultado: <b>${esGanancia ? '+' : ''}$${datos.resultado} (${datos.pct}%)</b>
💰 Capital: <b>$${datos.capitalActual} USDT</b>
⚡ Motivo: ${datos.motivo}
⏰ ${new Date().toLocaleString('es-ES')}`);
}

function mensajeResumenDiario(datos) {
  return enviar(`📊 <b>RESUMEN DEL DÍA</b>
━━━━━━━━━━━━━━━━━━━━
📅 ${datos.fecha}
✅ Ganadoras: <b>${datos.ganadoras}</b> | ❌ Perdedoras: <b>${datos.perdedoras}</b>
📊 Total: <b>${datos.total}</b> | 🏆 Aciertos: <b>${datos.pctAciertos}%</b>
━━━━━━━━━━━━━━━━━━━━
💰 Ganancia: <b>${datos.gananciaDia >= 0 ? '+' : ''}$${datos.gananciaDia}</b>
📈 Capital: <b>$${datos.capitalActual} USDT</b>`);
}

function mensajeAlertaCritica(motivo, perdida, capitalActual) {
  const motivoLimpio = String(motivo).replace(/<[^>]*>/g, '').substring(0, 200);
  return enviar(`🚨 <b>ALERTA CRÍTICA</b>
━━━━━━━━━━━━━━━━━━━━
Motivo: ${motivoLimpio}
📉 Pérdida hoy: <b>-$${perdida}</b>
💰 Capital: <b>$${capitalActual} USDT</b>
━━━━━━━━━━━━━━━━━━━━
Revisa los logs en Fly.io`);
}

module.exports = { bot, enviar, mensajeInicio, mensajeCompra, mensajeVenta, mensajeResumenDiario, mensajeAlertaCritica };
