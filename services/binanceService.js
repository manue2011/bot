const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/settings');

const BASE_URL = config.BINANCE_TESTNET
  ? 'https://testnet.binance.vision'
  : 'https://api.binance.com';

async function signedRequest({ method, endpoint, params = {} }) {
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    ...params,
    timestamp,
    recvWindow: 10000
  }).toString();

  const signature = crypto
    .createHmac('sha256', config.BINANCE_SECRET)
    .update(queryString)
    .digest('hex');

  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;

  try {
    const response = await axios({
      method,
      url,
      headers: { 'X-MBX-APIKEY': config.BINANCE_API_KEY },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    const msg = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    throw new Error(`Binance API Error (${endpoint}): ${msg}`);
  }
}

// GET con reintentos ante cortes de red (ECONNRESET, timeouts) o errores 5xx/429 del servidor.
// Solo para consultas: las órdenes NO se reintentan (podrían ejecutarse dos veces).
async function getConReintentos(url, opciones, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      return await axios.get(url, opciones);
    } catch (err) {
      const status = err.response?.status;
      const transitorio = !err.response || status >= 500 || status === 429;
      if (!transitorio || i >= intentos) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

// Velas CERRADAS del mercado real (señales). Se descarta la vela en curso:
// su cierre y volumen están a medias y falsean RSI, MACD y el filtro de volumen.
async function getCandles(symbol, interval = '1h', limit = 60) {
  try {
    const { data } = await getConReintentos('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit: limit + 1 },
      timeout: 8000
    });
    const ahora = Date.now();
    return data.filter(c => c[6] < ahora).slice(-limit);
  } catch (err) {
    throw new Error(`Error al obtener candles ${symbol}: ${err.message}`);
  }
}

// Precio actual en el MISMO exchange donde se ejecutan las órdenes
// (testnet en pruebas, real en producción), para comparar con TP/SL.
async function getPrecio(symbol) {
  try {
    const { data } = await getConReintentos(`${BASE_URL}/api/v3/ticker/price`, {
      params: { symbol },
      timeout: 8000
    });
    return parseFloat(data.price);
  } catch (err) {
    throw new Error(`Error al obtener precio ${symbol}: ${err.message}`);
  }
}

// stepSize del par (LOT_SIZE), cacheado
const cacheStep = {};
async function getStepSize(symbol) {
  if (cacheStep[symbol]) return cacheStep[symbol];
  const { data } = await axios.get(`${BASE_URL}/api/v3/exchangeInfo`, {
    params: { symbol },
    timeout: 8000
  });
  const lot = data.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
  cacheStep[symbol] = lot.stepSize;
  return lot.stepSize;
}

// Redondea hacia abajo al stepSize y devuelve string sin errores de coma flotante
function ajustarAStep(cantidad, stepSize) {
  const decimales = stepSize.includes('.')
    ? stepSize.replace(/0+$/, '').split('.')[1].length
    : 0;
  const factor = Math.pow(10, decimales);
  const pasos = Math.floor((cantidad * factor) / (parseFloat(stepSize) * factor) + 1e-9);
  return (pasos * parseFloat(stepSize)).toFixed(decimales);
}

async function getBalanceAsset(asset) {
  const data = await signedRequest({ method: 'GET', endpoint: '/api/v3/account' });
  const fila = data.balances.find(b => b.asset === asset);
  return parseFloat(fila?.free || 0);
}

async function getBalance() {
  try {
    return await getBalanceAsset('USDT');
  } catch (err) {
    throw new Error(`Error balance: ${err.message}`);
  }
}

async function comprar(symbol, cantidadUSDT) {
  console.log(`🟢 Comprando ${symbol} por $${cantidadUSDT}...`);
  const order = await signedRequest({
    method: 'POST',
    endpoint: '/api/v3/order',
    params: {
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: cantidadUSDT.toString()
    }
  });

  const executedQty = parseFloat(order.executedQty);
  if (!(executedQty > 0)) throw new Error(`Compra ${symbol} sin ejecutar (status ${order.status})`);
  const precioEjecucion = parseFloat(order.cummulativeQuoteQty) / executedQty;

  // Si la comisión se cobra en la moneda comprada, lo que realmente tenemos es menos
  const base = symbol.replace('USDT', '');
  const comisionBase = (order.fills || [])
    .filter(f => f.commissionAsset === base)
    .reduce((acc, f) => acc + parseFloat(f.commission), 0);
  const cantidadNeta = executedQty - comisionBase;

  console.log(`✅ Compra exitosa: ${cantidadNeta} ${symbol} a $${precioEjecucion.toFixed(4)}`);

  return {
    orderId: order.orderId,
    symbol,
    cantidad: cantidadNeta,
    precio: precioEjecucion,
    usdt: parseFloat(order.cummulativeQuoteQty),
    timestamp: new Date().toISOString()
  };
}

async function vender(symbol, cantidad) {
  // Nunca vender más de lo que hay libre, y respetar el stepSize del par
  const base = symbol.replace('USDT', '');
  const libre = await getBalanceAsset(base);
  const stepSize = await getStepSize(symbol);
  const cantidadVenta = ajustarAStep(Math.min(cantidad, libre), stepSize);
  if (!(parseFloat(cantidadVenta) > 0)) {
    const err = new Error(`Sin saldo para vender ${symbol} (pedido ${cantidad}, libre ${libre})`);
    err.sinSaldo = true;
    throw err;
  }

  console.log(`🔴 Vendiendo ${cantidadVenta} ${symbol}...`);
  const order = await signedRequest({
    method: 'POST',
    endpoint: '/api/v3/order',
    params: {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: cantidadVenta
    }
  });

  const precioVenta = parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty);
  console.log(`✅ Venta exitosa: ${symbol} a $${precioVenta.toFixed(4)}`);

  return {
    orderId: order.orderId,
    symbol,
    cantidad: parseFloat(order.executedQty),
    precio: precioVenta,
    timestamp: new Date().toISOString()
  };
}

module.exports = { getCandles, getPrecio, getBalance, getBalanceAsset, ajustarAStep, comprar, vender };
