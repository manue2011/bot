// Mantener Fly.io contento
const http = require('http');
http.createServer((req, res) => res.end('Bot activo')).listen(8080);

const config = require('./config/settings');
const { getCandles, getPrecio, getBalance, comprar, vender } = require('./services/binanceService');
const { getNoticiasScore } = require('./services/newsService');
const { getFearGreed, evaluarFearGreed } = require('./services/fearGreedService');
const telegram = require('./services/telegramService');
const { calcRSI } = require('./indicators/rsi');
const { calcSMA } = require('./indicators/sma');
const { calcMACD } = require('./indicators/macd');
const { calcBollinger } = require('./indicators/bollinger');
const {
  calcTakeProfit,
  calcStopLoss,
  calcResultado,
  validarMinNotional,
  superaPerdidaMaxima,
  generarResumenDiario,
  guardarTrade
} = require('./risk/riskManager');

// ── Estado del bot en memoria ──
// Guarda las posiciones abiertas por par
const posicionesAbiertas = {};
// { BTCUSDT: { precioEntrada, cantidad, stopLoss, takeProfit, timestamp } }

let botActivo = true;
let capitalActual = config.CAPITAL_TOTAL;

// ── Analizar y operar un par ──
async function procesarPar(symbol) {
  if (!botActivo) return;
console.log(`🔍 Procesando ${symbol}...`);
  try {
    // 1. Obtener datos de precio
    const closes = await getCandles(symbol);
    const precio = closes[closes.length - 1];

    // 2. Calcular indicadores
    const rsi = calcRSI(closes, 14);
    const sma20 = calcSMA(closes, 20);
    const macd = calcMACD(closes);
    const bollinger = calcBollinger(closes, 20, 2);

    if (!rsi || !sma20 || !macd || !bollinger) {
      console.log(`⚠️ ${symbol}: datos insuficientes para calcular indicadores`);
      return;
    }

    // 3. Obtener datos externos
    const { valor: fgValor, clasificacion: fgClasificacion } = await getFearGreed();
    const { señal: fgSeñal } = evaluarFearGreed(fgValor);
    const { sentimiento, titular } = await getNoticiasScore(symbol);

    console.log(`\n📊 ${symbol} | $${precio}`);
    console.log(`   RSI: ${rsi} | SMA20: $${sma20} | MACD: ${macd.alcista ? '↑ alcista' : '↓ bajista'}`);
    console.log(`   Bollinger inf: ${bollinger.enBandaInferior} | sup: ${bollinger.enBandaSuperior}`);
    console.log(`   Fear&Greed: ${fgValor} (${fgClasificacion}) | Noticias: ${sentimiento}`);

    // ── LÓGICA DE VENTA (primero comprobamos si hay posición abierta) ──
    if (posicionesAbiertas[symbol]) {
      const pos = posicionesAbiertas[symbol];

      const debeVender =
        precio >= pos.takeProfit ||    // Take-Profit alcanzado
        precio <= pos.stopLoss  ||     // Stop-Loss tocado
        (rsi > 65 && precio > sma20) || // Señal técnica de venta
        sentimiento === 'NEGATIVO';    // Noticias muy negativas

      if (debeVender) {
        const motivo =
          precio >= pos.takeProfit ? '🎯 Take-Profit alcanzado' :
          precio <= pos.stopLoss   ? '🛡️ Stop-Loss activado'   :
          sentimiento === 'NEGATIVO' ? '📰 Noticia negativa'    :
          '📊 Señal técnica de venta';

        const orden = await vender(symbol, pos.cantidad);
        const { neto, pct } = calcResultado(pos.precioEntrada, orden.precio, pos.cantidad);

        capitalActual = parseFloat((capitalActual + neto).toFixed(4));

        // Guardar en historial
        guardarTrade({
          lado: 'VENTA',
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          cantidad: pos.cantidad,
          resultado: neto,
          pct,
          motivo,
          timestamp: new Date().toISOString()
        });

        // Notificar por Telegram
        await telegram.mensajeVenta({
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          resultado: neto,
          pct,
          capitalActual,
          motivo
        });

        delete posicionesAbiertas[symbol];

        // Verificar pérdida máxima diaria
        const { supera, perdidaHoy, maxPermitida } = superaPerdidaMaxima();
        if (supera) {
          botActivo = false;
          await telegram.mensajeAlertaCritica(
            'Pérdida diaria máxima alcanzada',
            perdidaHoy,
            capitalActual
          );
          console.log('🚨 Bot pausado — pérdida máxima diaria alcanzada');
        }
      }

      return; // Si hay posición abierta, no buscamos compra
    }

    // ── LÓGICA DE COMPRA ──
    const señalesCompra = [
      rsi < 35,                    // RSI sobrevendido
      precio < sma20,              // Precio bajo media
      macd.alcista === true,       // MACD alcista
      bollinger.enBandaInferior    // Precio en banda inferior
    ];

    const señalesConfirmadas = señalesCompra.filter(Boolean).length;
    const noticiasBloqueantes = sentimiento === 'NEGATIVO';
    const fearGreedBloqueante =fgSeñal === 'PELIGRO';
    const capitalSuficiente = capitalActual - config.CAPITAL_RESERVA >= config.CAPITAL_POR_PAR;
    const operacionesAbiertas = Object.keys(posicionesAbiertas).length;

    console.log(`   Señales confirmadas: ${señalesCompra.filter(Boolean).length}/4`);

    const puedeComprar =
      señalesConfirmadas >= 3 &&          // mínimo 3 de 4 indicadores
      !noticiasBloqueantes &&             // sin noticias negativas
      !fearGreedBloqueante &&             // sin codicia extrema
      capitalSuficiente &&                // capital suficiente
      operacionesAbiertas < config.MAX_OPEN_TRADES && // máx operaciones
      validarMinNotional(config.CAPITAL_POR_PAR);     // mínimo Binance


    if (puedeComprar) {
        console.log(`🟢 Intentando comprar ${symbol}...`)
      const orden = await comprar(symbol, config.CAPITAL_POR_PAR);
      const stopLoss = calcStopLoss(orden.precio);
      const takeProfit = calcTakeProfit(orden.precio);

      posicionesAbiertas[symbol] = {
        precioEntrada: orden.precio,
        cantidad: orden.cantidad,
        stopLoss,
        takeProfit,
        timestamp: new Date().toISOString()
      };

      capitalActual = parseFloat((capitalActual - config.CAPITAL_POR_PAR).toFixed(4));

      guardarTrade({
        lado: 'COMPRA',
        symbol,
        precioEntrada: orden.precio,
        cantidad: orden.cantidad,
        usdt: config.CAPITAL_POR_PAR,
        stopLoss,
        takeProfit,
        timestamp: new Date().toISOString()
      });

      await telegram.mensajeCompra({
        symbol,
        precioEntrada: orden.precio,
        cantidad: orden.cantidad,
        usdt: config.CAPITAL_POR_PAR,
        stopLoss,
        takeProfit,
        rsi,
        macd: macd.alcista,
        bollinger: bollinger.enBandaInferior ? 'banda inf.' : 'normal',
        noticias: sentimiento,
        fearGreed: `${fgValor} (${fgClasificacion})`
      });

    } else {
      console.log(`   ⏳ Sin señal de compra — esperando...`);
    }

  } catch (err) {
  console.error(`❌ Error procesando ${symbol}:`, err.message);
  if (err.body) console.error('   Binance body:', err.body);
  if (err.response) console.error('   Binance response:', JSON.stringify(err.response));
  console.error(err);

  }
}

// ── Bucle principal ──
async function tick() {
  if (!botActivo) return;
  console.log(`\n⏰ ${new Date().toLocaleTimeString('es-ES')} — Analizando mercado...`);

  // Procesar todos los pares en paralelo
  await Promise.all(config.SYMBOLS.map(symbol => procesarPar(symbol)));
}

// ── Resumen diario a las 23:59 ──
function programarResumenDiario() {
  const ahora = new Date();
  const medianoche = new Date();
  medianoche.setHours(23, 59, 0, 0);

  const msHasta = medianoche.getTime() - ahora.getTime();
  const delay = msHasta > 0 ? msHasta : msHasta + 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    const resumen = generarResumenDiario(capitalActual);
    await telegram.mensajeResumenDiario(resumen);
    programarResumenDiario(); // programa el siguiente día
  }, delay);
}

// ── Arrancar el bot ──
async function iniciar() {
  console.log('🤖 Crypto Bot Ultra arrancando...');
  console.log(`   Modo: ${config.BINANCE_TESTNET ? 'TESTNET' : '🔴 REAL'}`);
  console.log(`   Pares: ${config.SYMBOLS.join(', ')}`);
  console.log(`   Capital: ${config.CAPITAL_TOTAL} USDT`);

  await telegram.mensajeInicio();
  programarResumenDiario();

  // Primera ejecución inmediata
  await tick();

  // Bucle cada X segundos
  setInterval(tick, config.INTERVALO_SEGUNDOS * 1000);
}

iniciar();
