const Binance = require('node-binance-api');
const axios = require('axios');
const config = require('../config/settings');

// Cliente para órdenes (testnet o real)
const binance = new Binance().options({
  APIKEY: config.BINANCE_API_KEY,
  APISECRET: config.BINANCE_SECRET,
  useServerTime: true,
  recvWindow: 60000,
  urls: {
    base: config.BINANCE_TESTNET
      ? 'https://testnet.binance.vision/api/'
      : 'https://api.binance.com/api/',
    stream: config.BINANCE_TESTNET
      ? 'wss://testnet.binance.vision/stream?streams='
      : 'wss://stream.binance.com:9443/stream?streams='
  }
});

// ── Obtener velas desde API pública de Binance (sin auth) ──
// Usamos la API pública real para datos de mercado — es estable y gratuita
async function getCandles(symbol) {
  console.log(`📡 Obteniendo candles para ${symbol}...`);
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: {
        symbol: symbol,
        interval: '1h',
        limit: 50
      },
      timeout: 8000
    });
    const closes = data.map(t => parseFloat(t[4]));
    console.log(`✅ Candles recibidas para ${symbol}`);
    return closes;
  } catch (err) {
    throw new Error(`Error candles ${symbol}: ${err.message}`);
  }
}

// ── Obtener precio actual desde API pública ──
async function getPrecio(symbol) {
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(data.price);
  } catch (err) {
    throw new Error(`Error precio ${symbol}: ${err.message}`);
  }
}

// ── Obtener balance (usa testnet o real según config) ──
async function getBalance() {
  return new Promise((resolve, reject) => {
    binance.balance((error, balances) => {
      if (error) return reject(new Error(`Error balance: ${JSON.stringify(error)}`));
      const usdt = parseFloat(balances['USDT']?.available || 0);
      resolve(usdt);
    });
  });
}

// ── Ejecutar orden de COMPRA ──
const crypto = require('crypto');

async function comprar(symbol, cantidadUSDT) {
  const precio = await getPrecio(symbol);

  const decimalesPorPar = { 'BTCUSDT': 5, 'ETHUSDT': 4, 'SOLUSDT': 2 };
  const decimales = decimalesPorPar[symbol] || 4;
  const cantidad = Math.floor((cantidadUSDT / precio) * Math.pow(10, decimales)) / Math.pow(10, decimales);

  console.log(`   💰 Comprando ${cantidad} ${symbol} a $${precio}`);

  const timestamp = Date.now();
  const params = `symbol=${symbol}&side=BUY&type=MARKET&quantity=${cantidad}&timestamp=${timestamp}&recvWindow=60000`;
  const signature = crypto.createHmac('sha256', config.BINANCE_SECRET).update(params).digest('hex');

  const { data } = await axios.post(
    'https://testnet.binance.vision/api/v3/order',
    params + `&signature=${signature}`,
    {
      headers: {
        'X-MBX-APIKEY': config.BINANCE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000  // 15 segundos máximo
    }
  );

  console.log(`   ✅ COMPRA ejecutada — orderId: ${data.orderId} | status: ${data.status}`);

  return {
    orderId: data.orderId,
    symbol,
    lado: 'COMPRA',
    cantidad,
    precio,
    usdt: cantidadUSDT,
    timestamp: new Date().toISOString()
  };
}
async function vender(symbol, cantidad) {
  const precio = await getPrecio(symbol);

  console.log(`   💸 Vendiendo ${cantidad} ${symbol} a $${precio}`);

  const timestamp = Date.now();
  const params = `symbol=${symbol}&side=SELL&type=MARKET&quantity=${cantidad}&timestamp=${timestamp}&recvWindow=60000`;
  const signature = crypto.createHmac('sha256', config.BINANCE_SECRET).update(params).digest('hex');

  const { data } = await axios.post(
    'https://testnet.binance.vision/api/v3/order',
    params + `&signature=${signature}`,
    {
      headers: {
        'X-MBX-APIKEY': config.BINANCE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    }
  );

  console.log(`   ✅ VENTA ejecutada — orderId: ${data.orderId} | status: ${data.status}`);

  return {
    orderId: data.orderId,
    symbol,
    lado: 'VENTA',
    cantidad,
    precio,
    usdt: parseFloat((cantidad * precio).toFixed(2)),
    timestamp: new Date().toISOString()
  };
}
module.exports = { getCandles, getPrecio, getBalance, comprar, vender };
