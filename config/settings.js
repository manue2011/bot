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
  MIN_ORDER_USDT: 10,
  MAX_OPEN_TRADES: 2,

  // Risk — Ratio 2:1 (ganamos el doble de lo que perdemos)
  TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT || 4),
  STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT || 2),
  MAX_PERDIDA_DIARIA_PCT: parseFloat(process.env.MAX_PERDIDA_DIARIA_PCT || 6),
  FEE_PCT: parseFloat(process.env.FEE_PCT || 0.1),
  TRAILING_ACTIVACION_PCT: 2.0,
  TRAILING_DISTANCIA_PCT: 1.5,

  // APIs
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: parseInt(process.env.TELEGRAM_CHAT_ID),

  // Timing
  INTERVALO_SEGUNDOS: parseInt(process.env.INTERVALO_SEGUNDOS || 60),

  // Horario — Solo operar en horas de mercado activo
  HORA_INICIO_UTC: 7,
  HORA_FIN_UTC: 22,
};