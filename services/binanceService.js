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

// Velas completas con highs, lows y closes
async function getCandles(symbol, interval = '1h', limit = 60) {
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit },
      timeout: 8000
    });
    return data;
  } catch (err) {
    throw new Error(`Error candles ${symbol}: ${err.message}`);
  }
}

async function getBalance() {
  try {
    const data = await signedRequest({ method: 'GET', endpoint: '/api/v3/account' });
    const asset = data.balances.find(b => b.asset === 'USDT');
    return parseFloat(asset?.free || 0);
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

  const fills = order.fills || [];
  const precioEjecucion = fills.length > 0
    ? parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty)
    : 0;

  console.log(`✅ Compra exitosa: ${order.executedQty} ${symbol} a $${precioEjecucion.toFixed(4)}`);

  return {
    orderId: order.orderId,
    symbol,
    cantidad: parseFloat(order.executedQty),
    precio: precioEjecucion,
    usdt: parseFloat(order.cummulativeQuoteQty),
    timestamp: new Date().toISOString()
  };
}

async function vender(symbol, cantidad) {
  console.log(`🔴 Vendiendo ${cantidad} ${symbol}...`);
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

module.exports = { getCandles, getBalance, comprar, vender };