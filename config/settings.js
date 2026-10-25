module.exports = {
  // Binance
  BINANCE_TESTNET: process.env.BINANCE_TESTNET === 'true',
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_SECRET: process.env.BINANCE_SECRET,

  // Pares — Solo BTC y ETH, más estables
  SYMBOLS: ['BTCUSDT', 'ETHUSDT'],

  // Capital
  CAPITAL_TOTAL: parseFloat(process.env.CAPITAL_TOTAL || 50),
  CAPITAL_POR_PAR: parseFloat(process.env.CAPITAL_POR_PAR || 20),
  MIN_ORDER_USDT: parseFloat(process.env.MIN_ORDER_USDT || 5), // mínimo real de Binance: 5 USDT
  MAX_OPEN_TRADES: 2,

  // Risk — Ratio 2:1 (ganamos el doble de lo que perdemos)
  TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT || 4),
  STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT || 2),
  MAX_PERDIDA_DIARIA_PCT: parseFloat(process.env.MAX_PERDIDA_DIARIA_PCT || 6),
  FEE_PCT: parseFloat(process.env.FEE_PCT || 0.1),

  // Parámetros de la estrategia (strategy/estrategia.js). Compáralos con: node backtest.js
  ESTRATEGIA: {
    MOMENTUM: true,
    MEAN_REVERSION: true,
    MIN_NOTA: 8,
    RSI_MOMENTUM_MIN: 50,
    RSI_MOMENTUM_MAX: 70,
    VOLUMEN_MIN: 1.1,
    // Stop = ATR × SL_ATR_MULT, acotado entre SL_MIN_PCT y SL_MAX_PCT.
    // Backtest oct-2025/oct-2026: el stop de 1.5×ATR saltaba por ruido (70% de stops);
    // 3×ATR con TP 2R y sin trailing mejoró todos los cortes (ver backtest.js).
    SL_ATR_MULT: 3,
    SL_MIN_PCT: 0.8,
    SL_MAX_PCT: 5,
    // Take-profit fijo en % (TP_PCT) o TP_R × riesgo si TP_PCT es null
    TP_PCT: null,
    TP_R: 2,
    // Trailing desactivado: cortaba las ganadoras antes de llegar al TP
    TRAIL_ACT_PCT: null,
    BE_R: null,
    TRAIL_R: null,
  },

  // APIs
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: parseInt(process.env.TELEGRAM_CHAT_ID),

  // Registro de operaciones en Google Sheets (Apps Script)
  GOOGLE_SHEET_URL: process.env.GOOGLE_SHEET_URL || 'https://script.google.com/macros/s/AKfycbx-Enj-nl9WOzTmV60jjllg7BZqFo7RgpFwSy5ofyhKM04TTzgV2IhgWv5Rwi4qFMI/exec',

  // Timing
  INTERVALO_SEGUNDOS: parseInt(process.env.INTERVALO_SEGUNDOS || 60),

  // Horario — Solo operar en horas de mercado activo
  HORA_INICIO_UTC: 7,
  HORA_FIN_UTC: 22,
};
