const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/settings');

// 1. Polling en true para poder recibir mensajes
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true }); 
const CHAT_ID = config.TELEGRAM_CHAT_ID;

async function enviar(mensaje) {
  try {
    await bot.sendMessage(CHAT_ID, mensaje, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Error Telegram:', err.message);
  }
}

function mensajeInicio() {
  return enviar(`🤖 <b>Crypto Bot Ultra iniciado</b>
━━━━━━━━━━━━━━━━━━━━
💰 Capital total: <b>${config.CAPITAL_TOTAL} USDT</b>
📊 Pares: <b>BTC | ETH | SOL</b>
🔒 Modo: <b>${config.BINANCE_TESTNET ? 'TESTNET' : '🔴 REAL'}</b>
⏰ Intervalo: <b>${config.INTERVALO_SEGUNDOS}s</b>
━━━━━━━━━━━━━━━━━━━━
¡Bot en marcha! 🚀`);
}

function mensajeCompra(datos) {
  return enviar(`🟢 <b>COMPRA EJECUTADA</b>
━━━━━━━━━━━━━━━━━━━━
📌 Par: <b>${datos.symbol}</b>
💵 Precio entrada: <b>$${datos.precioEntrada}</b>
📦 Cantidad: <b>${datos.cantidad}</b>
💰 Invertido: <b>${datos.usdt} USDT</b>
━━━━━━━━━━━━━━━━━━━━
🛡️ Stop-Loss: <b>$${datos.stopLoss}</b> (-${config.STOP_LOSS_PCT}%)
🎯 Take-Profit: <b>$${datos.takeProfit}</b> (+${config.TAKE_PROFIT_PCT - config.FEE_PCT * 2}% neto)
━━━━━━━━━━━━━━━━━━━━
📊 RSI: ${datos.rsi} | MACD: ${datos.macd ? '↑' : '↓'} | Bollinger: ${datos.bollinger}
📰 Noticias: ${datos.noticias}
😱 Fear&Greed: ${datos.fearGreed}
⏰ ${new Date().toLocaleString('es-ES')}`);
}

function mensajeVenta(datos) {
  const esGanancia = datos.resultado >= 0;
  const emoji = esGanancia ? '✅' : '❌';
  const tipo = esGanancia ? 'GANANCIA' : 'PÉRDIDA';

  return enviar(`${emoji} <b>VENTA EJECUTADA — ${tipo}</b>
━━━━━━━━━━━━━━━━━━━━
📌 Par: <b>${datos.symbol}</b>
💵 Entrada: <b>$${datos.precioEntrada}</b>
💵 Salida: <b>$${datos.precioSalida}</b>
━━━━━━━━━━━━━━━━━━━━
${esGanancia ? '📈' : '📉'} Resultado: <b>${esGanancia ? '+' : ''}$${datos.resultado} (${datos.pct}%)</b>
💰 Capital ahora: <b>${datos.capitalActual} USDT</b>
⚡ Motivo: ${datos.motivo}
⏰ ${new Date().toLocaleString('es-ES')}`);
}

function mensajeResumenDiario(datos) {
  return enviar(`📊 <b>RESUMEN DEL DÍA</b>
━━━━━━━━━━━━━━━━━━━━
📅 ${new Date().toLocaleDateString('es-ES')}
━━━━━━━━━━━━━━━━━━━━
✅ Ganadoras: <b>${datos.ganadoras}</b>
❌ Perdedoras: <b>${datos.perdedoras}</b>
📊 Total: <b>${datos.total}</b>
━━━━━━━━━━━━━━━━━━━━
💰 Ganancia del día: <b>${datos.gananciaDia >= 0 ? '+' : ''}$${datos.gananciaDia}</b>
📈 Capital actual: <b>${datos.capitalActual} USDT</b>
🏆 % aciertos: <b>${datos.pctAciertos}%</b>`);
}

function mensajeAlertaCritica(motivo, perdida, capitalActual) {
  return enviar(`🚨 <b>ALERTA CRÍTICA</b>
━━━━━━━━━━━━━━━━━━━━
Bot pausado automáticamente
Motivo: ${motivo}
📉 Pérdida del día: <b>-$${perdida}</b>
💰 Capital actual: <b>${capitalActual} USDT</b>
━━━━━━━━━━━━━━━━━━━━
Revisa los logs en Railway antes de reactivar.`);
}

module.exports = {
  bot, // Exportamos el bot para que bot.js lo use
  enviar,
  mensajeInicio,
  mensajeCompra,
  mensajeVenta,
  mensajeResumenDiario,
  mensajeAlertaCritica
};