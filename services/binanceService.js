const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/settings');

// Configuración de URLs basada en el entorno
const BASE_URL = config.BINANCE_TESTNET 
  ? 'https://testnet.binance.vision' 
  : 'https://api.binance.com';

/**
 * 🔐 Función centralizada para peticiones firmadas a Binance
 */
async function signedRequest({ method, endpoint, params = {}, recvWindow = 10000 }) {
  const timestamp = Date.now();
  
  // Construir query string con parámetros obligatorios
  const queryString = new URLSearchParams({
    ...params,
    timestamp,
    recvWindow
  }).toString();

  // Generar firma HMAC SHA256
  const signature = crypto
    .createHmac('sha256', config.BINANCE_SECRET)
    .update(queryString)
    .digest('hex');

  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;

  try {
    const response = await axios({
      method,
      url,
      headers: {
        'X-MBX-APIKEY': config.BINANCE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Binance API Error (${endpoint}): ${errorData}`);
  }
}

/**
 * 📡 Obtener velas (API Pública - Datos reales para mejor precisión)
 */
async function getCandles(symbol) {
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval: '1h', limit: 50 },
      timeout: 8000
    });
    return data.map(t => parseFloat(t[4])); // Retorna precios de cierre
  } catch (err) {
    throw new Error(`Error al obtener candles ${symbol}: ${err.message}`);
  }
}

/**
 * 💵 Obtener precio actual (API Pública)
 */
async function getPrecio(symbol) {
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(data.price);
  } catch (err) {
    throw new Error(`Error al obtener precio ${symbol}: ${err.message}`);
  }
}

/**
 * 💰 Obtener balance de la cuenta
 */
async function getBalance() {
  try {
    const data = await signedRequest({
      method: 'GET',
      endpoint: '/api/v3/account'
    });
    const asset = data.balances.find(b => b.asset === 'USDT');
    return parseFloat(asset?.free || 0);
  } catch (err) {
    throw new Error(`Error al obtener balance: ${err.message}`);
  }
}

/**
 * 🟢 Ejecutar orden de COMPRA (Market) usando monto en USDT
 */
async function comprar(symbol, cantidadUSDT) {
  console.log(`🟢 Ejecutando COMPRA en ${symbol} por ${cantidadUSDT} USDT...`);
  
  const order = await signedRequest({
    method: 'POST',
    endpoint: '/api/v3/order',
    params: {
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: cantidadUSDT.toString() // Compra exactamente X USDT
    }
  });

  // Extraer precio real de los fills de la orden
  const precioEjecucion = parseFloat(order.fills[0]?.price || 0);
  const cantidadComprada = parseFloat(order.executedQty);

  console.log(`✅ COMPRA exitosa: ${cantidadComprada} ${symbol} a $${precioEjecucion}`);

  return {
    orderId: order.orderId,
    symbol,
    lado: 'COMPRA',
    cantidad: cantidadComprada,
    precio: precioEjecucion,
    usdt: parseFloat(order.cummulativeQuoteQty),
    timestamp: new Date().toISOString()
  };
}

/**
 * 🔴 Ejecutar orden de VENTA (Market)
 */
async function vender(symbol, cantidad) {
  console.log(`🔴 Ejecutando VENTA en ${symbol} de ${cantidad} unidades...`);

  const order = await signedRequest({
    method: 'POST',
    endpoint: '/api/v3/order',
    params: {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: cantidad.toString()
    }
  });

  const precioVenta = parseFloat(order.fills[0]?.price || 0);

  console.log(`✅ VENTA exitosa: ${symbol} a $${precioVenta}`);

  return {
    orderId: order.orderId,
    symbol,
    lado: 'VENTA',
    cantidad: parseFloat(order.executedQty),
    precio: precioVenta,
    timestamp: new Date().toISOString()
  };
}

module.exports = { 
  getCandles, 
  getPrecio, 
  getBalance, 
  comprar, 
  vender 
};