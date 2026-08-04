require('dotenv').config();
const http = require('http');

// Servidor para Fly.io
http.createServer((req, res) => res.end('Bot activo')).listen(8080);

const config = require('./config/settings');
const { getCandles, comprar, vender } = require('./services/binanceService');
const { getNoticiasScore } = require('./services/newsService');
const { getFearGreed, evaluarFearGreed } = require('./services/fearGreedService');
const telegram = require('./services/telegramService');
const { calcRSI } = require('./indicators/rsi');
const { calcSMA } = require('./indicators/sma');
const { calcMACD } = require('./indicators/macd');
const { calcATR } = require('./indicators/atr');
const {
  calcTakeProfit, calcStopLoss, calcResultado,
  validarMinNotional, superaPerdidaMaxima,
  generarResumenDiario, guardarTrade,
  guardarPosiciones, cargarPosiciones,
  registrarResultadoKillSwitch, estaMonedaBloqueada
} = require('./risk/riskManager');

// ── ESTADO ──
const datosGuardados = cargarPosiciones();
let posicionesAbiertas = datosGuardados.posiciones || {};
let ultimoVentaTime = datosGuardados.ultimoVentaTime || {};

const invertido = Object.values(posicionesAbiertas).reduce((acc, pos) => acc + (pos.usdt || 0), 0);
let capitalActual = parseFloat((config.CAPITAL_TOTAL - invertido).toFixed(4));
let botActivo = true;

// ── TENDENCIA 4H ──
async function obtenerTendencia4H(symbol) {
  try {
    const candles4h = await getCandles(symbol, '4h', 60);
    if (!candles4h || candles4h.length < 50) return 'ERROR';
    const closes4h = candles4h.map(c => parseFloat(c[4]));
    const sma50 = calcSMA(closes4h, 50);
    const precioActual = closes4h[closes4h.length - 1];
    return precioActual > sma50 ? 'ALCISTA_4H' : 'BAJISTA_4H';
  } catch (e) {
    console.error(`❌ Error tendencia 4H ${symbol}:`, e.message);
    return 'ERROR';
  }
}

// ── MACRO BTC ──
async function obtenerMacro() {
  try {
    const candles = await getCandles('BTCUSDT', '1d', 30);
    const closes = candles.map(c => parseFloat(c[4]));
    const sma20 = calcSMA(closes, 20);
    const precioActual = closes[closes.length - 1];
    return precioActual > sma20 ? 'BTC_ALCISTA' : 'BTC_BAJISTA';
  } catch (e) {
    return 'ERROR_MACRO';
  }
}

// ── PROCESADO POR PAR ──
async function procesarPar(symbol, fgValor, fgClasificacion, fgSeñal, macro) {
  if (!botActivo) return;
  console.log(`🔍 Procesando ${symbol}...`);

  try {
    // 1. DATOS
    const candles = await getCandles(symbol, '1h', 60);
    if (!candles || candles.length < 40) {
      console.log(`⚠️ ${symbol}: datos insuficientes`);
      return;
    }

    const highs = candles.map(c => parseFloat(c[2]));
    const lows = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const volumenes = candles.map(c => parseFloat(c[5]));

    const precio = closes[closes.length - 1];
    const volActual = volumenes[volumenes.length - 1];
    const volMedio = volumenes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    // 2. INDICADORES
    const rsi = calcRSI(closes, 14);
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const macd = calcMACD(closes);
    const atr = calcATR(highs, lows, closes);

    if (!rsi || !sma20 || !sma50 || !macd || !atr) {
      console.log(`⚠️ ${symbol}: error calculando indicadores`);
      return;
    }

    const { sentimiento } = await getNoticiasScore(symbol);
    const tendencia4h = await obtenerTendencia4H(symbol);

    // 3. PUNTUACIÓN IA
    let puntuacion = 0;
    if (tendencia4h === 'ALCISTA_4H') puntuacion += 3;
    if (macro === 'BTC_ALCISTA') puntuacion += 2;
    if (precio > sma20) puntuacion += 2;
    if (rsi > 45 && rsi < 68) puntuacion += 2;
    if (macd.alcista) puntuacion += 2;
    if (sentimiento === 'POSITIVO') puntuacion += 1;

    console.log(`\n📊 ${symbol} | $${precio.toFixed(2)}`);
    console.log(`   RSI: ${rsi} | SMA20: $${sma20} | MACD: ${macd.alcista ? '↑' : '↓'} | ATR: ${atr}`);
    console.log(`   F&G: ${fgValor} | Noticias: ${sentimiento} | Macro: ${macro} | 4H: ${tendencia4h} | Nota: ${puntuacion}/12`);

    // ── LÓGICA DE VENTA ──
    if (posicionesAbiertas[symbol]) {
      const pos = posicionesAbiertas[symbol];
      const gananciaActualPct = ((precio - pos.precioEntrada) / pos.precioEntrada) * 100;

      // TRAILING STOP
      if (gananciaActualPct >= config.TRAILING_ACTIVACION_PCT) {
        const nuevoStop = precio * (1 - config.TRAILING_DISTANCIA_PCT / 100);
        const stopAsegurado = pos.precioEntrada * 1.005;
        const mejorStop = Math.max(nuevoStop, stopAsegurado);

        if (mejorStop > pos.stopLoss) {
          pos.stopLoss = parseFloat(mejorStop.toFixed(2));
          guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
          console.log(`📈 [TRAILING] ${symbol} → suelo $${pos.stopLoss} (+${gananciaActualPct.toFixed(2)}%)`);
        }
      }

      const debeVender =
        precio >= pos.takeProfit ||
        precio <= pos.stopLoss ||
        sentimiento === 'NEGATIVO';

      if (debeVender) {
        const motivo =
          precio >= pos.takeProfit ? '🎯 Take-Profit' :
          precio <= pos.stopLoss ? '🛡️ Stop-Loss' :
          '📰 Noticias';

        // Reintento x3
        let orden;
        for (let intento = 1; intento <= 3; intento++) {
          try {
            orden = await vender(symbol, pos.cantidad);
            break;
          } catch (err) {
            console.error(`⚠️ Intento ${intento}/3 fallido ${symbol}: ${err.message}`);
            if (intento === 3) throw err;
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        const { neto, pct } = calcResultado(pos.precioEntrada, orden.precio, pos.cantidad);

        registrarResultadoKillSwitch(symbol, neto);
        capitalActual = parseFloat((capitalActual + neto + (pos.usdt || 0)).toFixed(4));
        ultimoVentaTime[symbol] = Date.now();

        delete posicionesAbiertas[symbol];
        guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });

        guardarTrade({
          lado: 'VENTA', symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          cantidad: pos.cantidad,
          resultado: neto, pct, motivo,
          timestamp: new Date().toISOString()
        });

        await telegram.mensajeVenta({
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          resultado: neto, pct,
          capitalActual, motivo
        });

        const { supera, perdidaHoy } = superaPerdidaMaxima();
        if (supera) {
          botActivo = false;
          await telegram.mensajeAlertaCritica('Pérdida máxima diaria', perdidaHoy, capitalActual);
        }
      }
      return;
    }

    // ── LÓGICA DE COMPRA ──
    const horaUTC = new Date().getUTCHours();
    const horaActiva = horaUTC >= config.HORA_INICIO_UTC && horaUTC <= config.HORA_FIN_UTC;

    const esMomentum =
      rsi > 50 && rsi < 70 &&
      precio > sma20 &&
      precio > sma50 &&
      macd.alcista &&
      volActual > volMedio * 1.1 &&
      tendencia4h === 'ALCISTA_4H' &&
      macro === 'BTC_ALCISTA';

    const esMeanReversion =
      rsi < 38 &&
      precio < sma20 &&
      macd.alcista &&
      tendencia4h === 'ALCISTA_4H' &&
      macro === 'BTC_ALCISTA';

    const estrategia = esMomentum ? 'Momentum' : esMeanReversion ? 'MeanReversion' : null;

    const tiempoDesdeVenta = Date.now() - (ultimoVentaTime[symbol] || 0);
    const enfriamientoOk = tiempoDesdeVenta > 300000; // 5 minutos
    const monedaBloqueada = estaMonedaBloqueada(symbol, 3);
    const capitalSuficiente = capitalActual >= config.CAPITAL_POR_PAR;
    const maxTradesOk = Object.keys(posicionesAbiertas).length < config.MAX_OPEN_TRADES;
    const minNotionalOk = validarMinNotional(config.CAPITAL_POR_PAR);

    let razon = '';
    if (!estrategia) razon = `Sin señal (RSI:${rsi} MACD:${macd.alcista ? '↑' : '↓'} 4H:${tendencia4h} Macro:${macro})`;
    else if (!horaActiva) razon = `🌙 Hora inactiva (${horaUTC}h UTC)`;
    else if (puntuacion < 8) razon = `🧠 Nota insuficiente (${puntuacion}/12)`;
    else if (monedaBloqueada) razon = `🛡️ Kill Switch activo`;
    else if (!enfriamientoOk) razon = `⏳ Enfriamiento (${Math.ceil((300000 - tiempoDesdeVenta) / 1000)}s)`;
    else if (sentimiento === 'NEGATIVO') razon = `📰 Noticias negativas`;
    else if (fgSeñal === 'PELIGRO') razon = `😱 Codicia extrema (${fgValor})`;
    else if (!capitalSuficiente) razon = `💰 Capital insuficiente ($${capitalActual})`;
    else if (!maxTradesOk) razon = `📦 Máximo trades abiertos`;
    else if (!minNotionalOk) razon = `❌ Mínimo Binance no alcanzado`;

    const puedeComprar =
      estrategia !== null &&
      horaActiva &&
      puntuacion >= 8 &&
      !monedaBloqueada &&
      enfriamientoOk &&
      sentimiento !== 'NEGATIVO' &&
      fgSeñal !== 'PELIGRO' &&
      capitalSuficiente &&
      maxTradesOk &&
      minNotionalOk;

    if (puedeComprar) {
      console.log(`🟢 COMPRANDO ${symbol} (${estrategia}) Nota:${puntuacion}/12`);
      capitalActual -= config.CAPITAL_POR_PAR;

      try {
        const orden = await comprar(symbol, config.CAPITAL_POR_PAR);
        const stopLoss = calcStopLoss(orden.precio, atr);
        const takeProfit = calcTakeProfit(orden.precio);

        posicionesAbiertas[symbol] = {
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          stopLoss, takeProfit, estrategia,
          notaIA: puntuacion,
          usdt: config.CAPITAL_POR_PAR,
          tendencia4h, macro,
          timestamp: new Date().toISOString()
        };

        guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
        capitalActual = parseFloat(capitalActual.toFixed(4));

        guardarTrade({
          lado: 'COMPRA', symbol,
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          usdt: config.CAPITAL_POR_PAR,
          stopLoss, takeProfit, estrategia,
          timestamp: new Date().toISOString()
        });

        await telegram.mensajeCompra({
          symbol,
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          usdt: config.CAPITAL_POR_PAR,
          stopLoss, takeProfit,
          rsi: rsi.toFixed(2),
          macd: macd.alcista,
          tendencia4h, fgValor
        });

      } catch (err) {
        console.error(`❌ Falló compra ${symbol}:`, err.message);
        capitalActual += config.CAPITAL_POR_PAR;
        capitalActual = parseFloat(capitalActual.toFixed(4));
        await telegram.mensajeAlertaCritica(`Error compra ${symbol}`, err.message, capitalActual);
      }

      } catch (err) {
        // 🔴 FIX 1 (Recuperación) y FIX 3 (Alertas Silenciosas)
        console.error(`❌ Falló la compra de ${symbol}, devolviendo capital. Error:`, err.message);
        capitalActual += config.CAPITAL_POR_PAR;
        capitalActual = parseFloat(capitalActual.toFixed(4));
        // Añadimos el aviso por Telegram si falla la compra
        await telegram.mensajeAlertaCritica(`Error en compra ${symbol}`, err.message, capitalActual);
      } // <-- ESTA ES LA LLAVE QUE FALTABA (Cierra el catch)
    } else {
      console.log(`   ⏳ ${razon}`);
    }

  } catch (err) {
    console.error(`❌ Error general ${symbol}:`, err.message);
    await telegram.mensajeAlertaCritica(`Fallo grave ${symbol}`, err.message, capitalActual);
  }
}

// ── CICLO PRINCIPAL ──
async function tick() {
  if (!botActivo) return;
  console.log(`\n⏰ ${new Date().toLocaleTimeString('es-ES')} — Ciclo de mercado...`);

  const { valor: fgValor, clasificacion: fgClasificacion } = await getFearGreed();
  const { señal: fgSeñal } = evaluarFearGreed(fgValor);
  const macro = await obtenerMacro();

  await Promise.all(
    config.SYMBOLS.map(symbol =>
      procesarPar(symbol, fgValor, fgClasificacion, fgSeñal, macro)
    )
  );
}

// ── RESUMEN DIARIO ──
function programarResumenDiario() {
  const ahora = new Date();
  const medianoche = new Date(ahora);
  medianoche.setHours(23, 59, 0, 0);
  const msHasta = medianoche.getTime() - ahora.getTime();
  const delay = msHasta > 0 ? msHasta : msHasta + 24 * 60 * 60 * 1000;
  setTimeout(async () => {
    const resumen = generarResumenDiario(capitalActual);
    await telegram.mensajeResumenDiario(resumen);
    programarResumenDiario();
  }, delay);
}

// ── ARRANQUE ──
async function iniciar() {
  console.log('🤖 Crypto Bot v5.0 — BTC/ETH Edition');
  console.log(`   Capital: $${capitalActual.toFixed(2)} USDT`);
  console.log(`   Modo: ${config.BINANCE_TESTNET ? 'TESTNET' : '🔴 REAL'}`);

  if (telegram.bot) {
    telegram.bot.onText(/\/status/, (msg) => {
      const inv = Object.values(posicionesAbiertas).reduce((acc, p) => acc + (p.usdt || 0), 0);
      let txt = `📊 <b>ESTADO BOT v5.0</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      txt += `💰 Total: <b>$${(capitalActual + inv).toFixed(2)}</b>\n`;
      txt += `💵 Libre: $${capitalActual.toFixed(2)}\n`;
      txt += `📦 Posiciones: ${Object.keys(posicionesAbiertas).length}/${config.MAX_OPEN_TRADES}\n\n`;
      if (Object.keys(posicionesAbiertas).length > 0) {
        txt += `📝 <b>DETALLE:</b>\n`;
        Object.entries(posicionesAbiertas).forEach(([sym, p]) => {
          txt += `• <b>${sym}</b>: entrada $${p.precioEntrada} | SL $${p.stopLoss} | TP $${p.takeProfit}\n`;
        });
      } else {
        txt += `<i>Sin posiciones abiertas.</i>`;
      }
      telegram.bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
    });
  }

  await telegram.mensajeInicio();
  programarResumenDiario();

  (async function loop() {
    await tick();
    setTimeout(loop, config.INTERVALO_SEGUNDOS * 1000);
  })();
}

iniciar();