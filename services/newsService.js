const axios = require('axios');
const config = require('../config/settings');

let cacheNoticias = {};
let ultimaActualizacion = 0;
let actualizando = null; // promesa compartida para no pedir dos veces a la vez

const NOMBRES = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'eth', 'ether']
};

const palabrasPositivas = ['surge', 'surges', 'rally', 'rallies', 'breakout', 'bullish', 'adoption', 'partnership', 'upgrade', 'record high', 'soars', 'jumps'];
const palabrasNegativas = ['crash', 'crashes', 'hack', 'hacked', 'exploit', 'ban', 'bans', 'lawsuit', 'bankrupt', 'bankruptcy', 'rug pull', 'scam', 'plunge', 'plunges', 'collapse', 'seized'];

// Coincidencia por palabra completa: "ban" no debe saltar con "bank" ni "eth" con "whether"
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexPalabra = p => new RegExp(`\\b${escapar(p)}\\b`, 'i');
const REGEX_POS = palabrasPositivas.map(regexPalabra);
const REGEX_NEG = palabrasNegativas.map(regexPalabra);

function analizarNoticias(data, symbol) {
  const moneda = symbol.replace('USDT', '');
  const terminos = (NOMBRES[moneda] || [moneda.toLowerCase()]).map(regexPalabra);

  const noticiasMoneda = data.filter(n => {
    const texto = `${n.headline} ${n.summary}`;
    return terminos.some(r => r.test(texto));
  }).slice(0, 5);

  let score = 0;
  noticiasMoneda.forEach(n => {
    const texto = `${n.headline} ${n.summary}`;
    REGEX_POS.forEach(r => { if (r.test(texto)) score++; });
    REGEX_NEG.forEach(r => { if (r.test(texto)) score--; });
  });

  return {
    sentimiento: score > 1 ? 'POSITIVO' : score < -2 ? 'NEGATIVO' : 'NEUTRO',
    score,
    titular: noticiasMoneda[0]?.headline || 'Sin noticias recientes'
  };
}

async function descargarNoticias() {
  try {
    console.log('📰 Actualizando noticias...');
    const { data } = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category: 'crypto', token: config.FINNHUB_API_KEY },
      timeout: 5000
    });

    if (!Array.isArray(data)) throw new Error('Respuesta inválida');

    config.SYMBOLS.forEach(symbol => {
      cacheNoticias[symbol] = analizarNoticias(data, symbol);
    });

    const status = config.SYMBOLS.map(s => `${s.replace('USDT', '')}: ${cacheNoticias[s]?.sentimiento}`).join(' | ');
    console.log(`📰 Noticias → ${status}`);

  } catch (err) {
    console.error('❌ Error noticias:', err.message);
    config.SYMBOLS.forEach(s => {
      if (!cacheNoticias[s]) cacheNoticias[s] = { sentimiento: 'NEUTRO', score: 0, titular: 'Error' };
    });
  }
  // También tras un error: así no se reintenta en cada ciclo y no se agota el límite de la API
  ultimaActualizacion = Date.now();
}

async function actualizarNoticias() {
  if (Date.now() - ultimaActualizacion < 5 * 60 * 1000 && Object.keys(cacheNoticias).length > 0) return;
  if (!actualizando) actualizando = descargarNoticias().finally(() => { actualizando = null; });
  await actualizando;
}

async function getNoticiasScore(symbol) {
  await actualizarNoticias();
  return cacheNoticias[symbol] || { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
}

module.exports = { getNoticiasScore, analizarNoticias };
