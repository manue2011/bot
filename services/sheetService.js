const axios = require('axios');
const config = require('../config/settings');

// Envía una operación cerrada a la hoja Crypto_Bot_Stats (mismo formato que test.js)
async function enviarAHoja(datos) {
  if (!config.GOOGLE_SHEET_URL) return;

  const payload = {
    symbol: datos.symbol,
    signal: datos.estrategia || 'N/A',
    notaIA: datos.notaIA || 0,
    estadoMacro: datos.estadoMacro || 'N/A',
    type: datos.tipo || 'VENTA',
    price: datos.precio,
    amount: datos.cantidad || 0,
    profit: datos.ganancia || 0,
    profitPct: datos.porcentaje || 0,
    reason: datos.motivo || 'N/A'
  };

  try {
    await axios.post(config.GOOGLE_SHEET_URL, payload, { timeout: 10000 });
    console.log(`📊 [HOJA] ${datos.symbol} registrado`);
  } catch (err) {
    console.error('❌ [HOJA] Error enviando a Google Sheets:', err.message);
  }
}

module.exports = { enviarAHoja };
