const axios = require('axios');
const config = require('../config/settings');

let cacheNoticias = {};
let ultimaActualizacion = 0;

function extraerMoneda(symbol) {
  return symbol.replace('USDT', '');
}

async function actualizarNoticias() {
  const ahora = Date.now();
  // 1. Si los datos tienen menos de 5 minutos, usamos la caché
  if (ahora - ultimaActualizacion < 5 * 60 * 1000 && Object.keys(cacheNoticias).length > 0) return;

  try {
    console.log("📰 Actualizando noticias desde Finnhub...");
    
    // 2. PEDIMOS LAS NOTICIAS SOLO UNA VEZ (Mucho más eficiente)
    const { data } = await axios.get('https://finnhub.io/api/v1/news', {
      params: {
        category: 'crypto',
        token: config.FINNHUB_API_KEY
      },
      timeout: 5000
    });

    if (!Array.isArray(data)) throw new Error("Respuesta de noticias no es válida");

    // 3. PROCESAMOS CADA MONEDA USANDO LA MISMA LISTA
    config.SYMBOLS.forEach(symbol => {
      const moneda = extraerMoneda(symbol);
      
      // Filtramos noticias que mencionen la moneda (ej: "SOL" o "Solana")
      const noticiasMoneda = data.filter(n => {
        const texto = (n.headline + ' ' + n.summary).toLowerCase();
        // Añadimos nombres completos por si acaso (Avalanche, Ethereum, etc)
        const nombreLargo = moneda === 'AVAX' ? 'avalanche' : moneda === 'ETH' ? 'ethereum' : moneda === 'SOL' ? 'solana' : moneda.toLowerCase();
        return texto.includes(moneda.toLowerCase()) || texto.includes(nombreLargo);
      }).slice(0, 5);

      let score = 0;
      const palabrasPositivas = ['surge', 'rally', 'breakout', 'bullish', 'adoption', 'partnership', 'upgrade', 'record high'];
      const palabrasNegativas = ['crash', 'hack', 'exploit', 'ban', 'lawsuit', 'bankrupt', 'rug', 'scam', 'plunge', 'collapse'];

      noticiasMoneda.forEach(n => {
        const texto = (n.headline + ' ' + n.summary).toLowerCase();
        palabrasPositivas.forEach(p => { if (texto.includes(p)) score++; });
        palabrasNegativas.forEach(p => { if (texto.includes(p)) score--; });
      });

      let sentimiento = 'NEUTRO';
      if (score > 1) sentimiento = 'POSITIVO'; // Bajamos el umbral a 1 para ser más sensibles
      else if (score < -2) sentimiento = 'NEGATIVO';

      cacheNoticias[symbol] = {
        sentimiento,
        score,
        titular: noticiasMoneda[0]?.headline || 'Sin noticias recientes'
      };
    });

    ultimaActualizacion = ahora;

  } catch (err) {
    console.error(`❌ Error general noticias:`, err.message);
    // En caso de error, inicializamos la caché para evitar el "undefined"
    config.SYMBOLS.forEach(s => {
      if (!cacheNoticias[s]) cacheNoticias[s] = { sentimiento: 'NEUTRO', score: 0, titular: 'Error API' };
    });
  }

  // Log de control
// ✅ LOG DINÁMICO: Mostrará las monedas que tú tengas en tu config automáticamente
  const status = config.SYMBOLS.map(s => {
    const moneda = s.replace('USDT', '');
    return `${moneda}: ${cacheNoticias[s]?.sentimiento || '??'}`;
  }).join(' | ');

  console.log(`📰 Noticias → ${status}`);
  ultimaActualizacion = Date.now();
}

async function getNoticiasScore(symbol) {
  await actualizarNoticias();
  return cacheNoticias[symbol] || { sentimiento: 'NEUTRO', score: 0, titular: 'Sin datos' };
}

module.exports = { getNoticiasScore };