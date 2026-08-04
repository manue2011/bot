const axios = require('axios');
const config = require('../config/settings');

let cacheNoticias = {};
let ultimaActualizacion = 0;

const NOMBRES = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'eth']
};

const palabrasPositivas = ['surge', 'rally', 'breakout', 'bullish', 'adoption', 'partnership', 'upgrade', 'record high', 'soars', 'jumps'];
const palabrasNegativas = ['crash', 'hack', 'exploit', 'ban', 'lawsuit', 'bankrupt', 'rug', 'scam', 'plunge', 'collapse', 'seized'];

async function actualizarNoticias() {
  const ahora = Date.now();
  if (ahora - ultimaActualizacion < 5 * 60 * 1000 && Object.keys(cacheNoticias).length > 0) return;

  try {
    console.log('📰 Actualizando noticias...');
    const { data } = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category: 'crypto', token: config.FINNHUB_API_KEY },
      timeout: 5000
    });

    if (!Array.isArray(data)) throw new Error('Respuesta inválida');

    config.SYMBOLS.forEach(symbol => {
      const moneda = symbol.replace('USDT', '');
      const terminos = NOMBRES[moneda] || [moneda.toLowerCase()];

      const noticias = data.filter(n => {
        const texto = `${n.headline} ${n.summary}`.toLowerCase();
        return terminos.some(t => texto.includes(t));
      }).slice(0, 5);

      let score = 0;
      noticias.forEach(n => {
        const texto = `${n.headline} ${n.summary}`.toLowerCase();
        palabrasPositivas.forEach(p => { if (texto.includes(p)) score++; });
        palabrasNegativas.forEach(p => { if (texto.includes(p)) score--; });
      });

      cacheNoticias[symbol] = {
        sentimiento: score > 1 ? 'POSITIVO' : score < -2 ? 'NEGATIVO' : 'NEUTRO',
        score,
        titular: noticias[0]?.headline || 'Sin noticias'
      };
    });

    ultimaActualizacion = ahora;
    const status = config.SYMBOLS.map(s => `${s.replace('USDT', '')}: ${cacheNoticias[s]?.sentimiento}`).join(' | ');
    console.log(`📰 Noticias → ${status}`);

  } catch (err) {
    console.error('❌ Error noticias:', err.message);
    config.SYMBOLS.forEach(s => {
      if (!cacheNoticias[s]) cacheNoticias[s] = { sentimiento: 'NEUTRO', score: 0, titular: 'Error' };
    });
  }
}

async function getNoticiasScore(symbol) {
  await actualizarNoticias();
  return cacheNoticias[symbol] || { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
}

module.exports = { getNoticiasScore };