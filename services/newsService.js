const axios = require('axios');
const config = require('../config/settings');

let cacheNoticias = {};
let ultimaActualizacion = 0;

function extraerMoneda(symbol) {
  return symbol.replace('USDT', '');
}

async function actualizarNoticias() {
  const ahora = Date.now();
  if (ahora - ultimaActualizacion < 5 * 60 * 1000) return;

  for (const symbol of config.SYMBOLS) {
    const moneda = extraerMoneda(symbol);

    try {
      const { data } = await axios.get('https://finnhub.io/api/v1/news', {
        params: {
          category: 'crypto',
          token: config.FINNHUB_API_KEY
        },
        timeout: 5000
      });

      const noticias = data.filter(n =>
        n.headline?.toLowerCase().includes(moneda.toLowerCase()) ||
        n.summary?.toLowerCase().includes(moneda.toLowerCase())
      ).slice(0, 5);

      let score = 0;
      const palabrasPositivas = ['surge', 'rally', 'gain', 'bull', 'rise', 'up', 'high', 'record', 'growth', 'adoption'];
      const palabrasNegativas = ['crash', 'drop', 'fall', 'bear', 'down', 'low', 'hack', 'ban', 'fear', 'sell'];

      noticias.forEach(n => {
        const texto = (n.headline + ' ' + n.summary).toLowerCase();
        palabrasPositivas.forEach(p => { if (texto.includes(p)) score++; });
        palabrasNegativas.forEach(p => { if (texto.includes(p)) score--; });
      });

      let sentimiento;
      if (score > 2)       sentimiento = 'POSITIVO';
      else if (score < -2) sentimiento = 'NEGATIVO';
      else                 sentimiento = 'NEUTRO';

      cacheNoticias[symbol] = {
        sentimiento,
        score,
        titular: noticias[0]?.headline || 'Sin noticias'
      };

    } catch (err) {
      console.error(`Error noticias ${moneda}:`, err.message);
      cacheNoticias[symbol] = { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
    }
  }

  // ← Log único al final, no dentro del bucle
  console.log(`📰 Noticias → BTC: ${cacheNoticias['BTCUSDT']?.sentimiento} | ETH: ${cacheNoticias['ETHUSDT']?.sentimiento} | SOL: ${cacheNoticias['SOLUSDT']?.sentimiento}`);
  ultimaActualizacion = Date.now();
}

async function getNoticiasScore(symbol) {
  await actualizarNoticias();
  return cacheNoticias[symbol] || { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
}

module.exports = { getNoticiasScore };
