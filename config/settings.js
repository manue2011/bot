require('dotenv').config();

module.exports = {
  // ── Binance ──
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_SECRET: process.env.BINANCE_SECRET,
  BINANCE_TESTNET: process.env.BINANCE_TESTNET === 'true',

  // ── Pares de trading ──
  SYMBOLS: process.env.SYMBOLS
    ? process.env.SYMBOLS.split(',')
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],

  // ── Capital ──
  CAPITAL_TOTAL: parseFloat(process.env.CAPITAL_TOTAL) || 20,
  CAPITAL_RESERVA: parseFloat(process.env.CAPITAL_RESERVA) || 2,
  CAPITAL_POR_PAR: parseFloat(process.env.CAPITAL_POR_PAR) || 6,
  MAX_OPEN_TRADES: parseInt(process.env.MAX_OPEN_TRADES) || 3,
  MIN_ORDER_USDT: parseFloat(process.env.MIN_ORDER_USDT) || 6,

  // ── Risk Management ──
  TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT) || 4,
  STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT) || 2,
  MAX_PERDIDA_DIARIA_PCT: parseFloat(process.env.MAX_PERDIDA_DIARIA_PCT) || 10,
  FEE_PCT: parseFloat(process.env.FEE_PCT) || 0.1,

  // ── APIs externas ──
  CRYPTOPANIC_KEY: process.env.CRYPTOPANIC_KEY,
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,

  // ── Telegram ──
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // ── Timing ──
  INTERVALO_SEGUNDOS: parseInt(process.env.INTERVALO_SEGUNDOS) || 60,
  FEAR_GREED_INTERVALO: parseInt(process.env.FEAR_GREED_INTERVALO) || 300,
};
