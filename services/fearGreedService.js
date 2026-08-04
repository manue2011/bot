const axios = require('axios');

let cache = null;
let ultimaActualizacion = 0;

async function getFearGreed() {
  const ahora = Date.now();
  if (cache && ahora - ultimaActualizacion < 5 * 60 * 1000) return cache;

  try {
    const { data } = await axios.get('https://api.alternative.me/fng/?limit=1');
    const valor = parseInt(data.data[0].value);
    const clasificacion = data.data[0].value_classification;
    cache = { valor, clasificacion };
    ultimaActualizacion = ahora;
    console.log(`😱 Fear & Greed: ${valor} — ${clasificacion}`);
    return cache;
  } catch (err) {
    console.error('Error Fear & Greed:', err.message);
    return { valor: 50, clasificacion: 'Neutral' };
  }
}

function evaluarFearGreed(valor) {
  if (valor < 25) return { señal: 'COMPRA_FUERTE', emoji: '🟢' };
  if (valor < 45) return { señal: 'FAVORABLE', emoji: '🟡' };
  if (valor <= 75) return { señal: 'NEUTRAL', emoji: '⚪' };
  return { señal: 'PELIGRO', emoji: '🔴' };
}

module.exports = { getFearGreed, evaluarFearGreed };