const axios = require('axios');
const config = require('../config/settings');

let cacheNoticias = {};
let ultimaActualizacion = 0;
let actualizando = false;

const NOMBRES_LARGOS = {
  AVAX: 'avalanche', SOL: 'solana', NEAR: 'near protocol',
  LINK: 'chainlink', DOT: 'polkadot', MATIC: 'polygon',
  ADA: 'cardano', ETH: 'ethereum', BNB: 'binance'
};

function extraerMoneda(symbol) {
  return symbol.replace('USDT', '');
}

async function actualizarNoticias() {
  const ahora = Date.now();
  if (ahora - ultimaActualizacion < 5 * 60 * 1000 && Object.keys(cacheNoticias).length > 0) return;
  if (actualizando) return;
  actualizando = true;

  try {
    console.log("📰 Actualizando noticias desde Finnhub...");
    const { data } = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category: 'crypto', token: config.FINNHUB_API_KEY },
      timeout: 5000
    });

    if (!Array.isArray(data)) throw new Error("Respuesta de noticias no válida");

    config.SYMBOLS.forEach(symbol => {
      const moneda = extraerMoneda(symbol);
      const nombreLargo = NOMBRES_LARGOS[moneda] || moneda.toLowerCase();

      const noticiasMoneda = data.filter(n => {
        const texto = (n.headline + ' ' + n.summary).toLowerCase();
        return texto.includes(moneda.toLowerCase()) || texto.includes(nombreLargo);
      }).slice(0, 5);

      const palabrasPositivas = ['surge', 'rally', 'breakout', 'bullish', 'adoption', 'partnership', 'upgrade', 'record high'];
      const palabrasNegativas = ['crash', 'hack', 'exploit', 'ban', 'lawsuit', 'bankrupt', 'rug', 'scam', 'plunge', 'collapse'];

      let score = 0;
      noticiasMoneda.forEach(n => {
        const texto = (n.headline + ' ' + n.summary).toLowerCase();
        palabrasPositivas.forEach(p => { if (texto.includes(p)) score++; });
        palabrasNegativas.forEach(p => { if (texto.includes(p)) score--; });
      });

      cacheNoticias[symbol] = {
        sentimiento: score > 1 ? 'POSITIVO' : score < -2 ? 'NEGATIVO' : 'NEUTRO',
        score,
        titular: noticiasMoneda[0]?.headline || 'Sin noticias recientes'
      };
    });

    ultimaActualizacion = ahora;

    const status = config.SYMBOLS.map(s =>
      `${s.replace('USDT', '')}: ${cacheNoticias[s]?.sentimiento || '??'}`
    ).join(' | ');
    console.log(`📰 Noticias → ${status}`);

  } catch (err) {
    console.error('❌ Error noticias:', err.message);
    config.SYMBOLS.forEach(s => {
      if (!cacheNoticias[s]) cacheNoticias[s] = { sentimiento: 'NEUTRO', score: 0, titular: 'Error API' };
    });
  } finally {
    actualizando = false;
  }
}

async function getNoticiasScore(symbol) {
  await actualizarNoticias();
  return cacheNoticias[symbol] || { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
}

module.exports = { getNoticiasScore };