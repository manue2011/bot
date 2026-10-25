require('dotenv').config();
const http = require('http');

// Servidor para Fly.io
http.createServer((req, res) => res.end('Bot activo')).listen(8080);

const config = require('./config/settings');
const { getCandles, getPrecio, comprar, vender } = require('./services/binanceService');
const { enviarAHoja } = require('./services/sheetService');
const { getNoticiasScore } = require('./services/newsService');
const { getFearGreed, evaluarFearGreed } = require('./services/fearGreedService');
const telegram = require('./services/telegramService');
const {
  tendencia4HDesde, macroDesde, evaluarEntrada,
  nivelesSalida, nuevoStopTrailing, motivoSalida
} = require('./strategy/estrategia');
const {
  calcResultado,
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
let alertaPerdidaDia = null; // fecha en la que ya se avisó de la pérdida máxima

// ── TENDENCIA 4H ──
async function obtenerTendencia4H(symbol, precio) {
  try {
    const candles4h = await getCandles(symbol, '4h', 60);
    if (!candles4h || candles4h.length < 50) return 'ERROR';
    return tendencia4HDesde(candles4h.map(c => parseFloat(c[4])), precio);
  } catch (e) {
    console.error(`❌ Error tendencia 4H ${symbol}:`, e.message);
    return 'ERROR';
  }
}

// ── MACRO BTC ──
async function obtenerMacro() {
  try {
    const candles = await getCandles('BTCUSDT', '1d', 30);
    const precioBtc = await getPrecio('BTCUSDT');
    return macroDesde(candles.map(c => parseFloat(c[4])), precioBtc);
  } catch (e) {
    return 'ERROR_MACRO';
  }
}

// ── PROCESADO POR PAR ──
async function procesarPar(symbol, fgValor, fgClasificacion, fgSeñal, macro) {
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

    // Velas cerradas para indicadores; precio en vivo del exchange de ejecución para TP/SL
    const precio = await getPrecio(symbol);

    const { sentimiento } = await getNoticiasScore(symbol);
    const tendencia4h = await obtenerTendencia4H(symbol, precio);

    // 2. INDICADORES + PUNTUACIÓN (strategy/estrategia.js, la misma que usa backtest.js)
    const señal = evaluarEntrada({ closes, highs, lows, volumenes, precio, tendencia4h, macro, sentimiento });
    if (!señal) {
      console.log(`⚠️ ${symbol}: error calculando indicadores`);
      return;
    }
    const { rsi, sma20, macd, atr, puntuacion, estrategia } = señal;

    console.log(`\n📊 ${symbol} | $${precio.toPrecision(6)}`);
    console.log(`   RSI: ${rsi} | SMA20: $${sma20.toPrecision(6)} | MACD: ${macd.alcista ? '↑' : '↓'} | ATR: ${atr.toPrecision(4)}`);
    console.log(`   F&G: ${fgValor} | Noticias: ${sentimiento} | Macro: ${macro} | 4H: ${tendencia4h} | Nota: ${puntuacion}/12`);

    // ── LÓGICA DE VENTA ──
    if (posicionesAbiertas[symbol]) {
      const pos = posicionesAbiertas[symbol];
      const gananciaActualPct = ((precio - pos.precioEntrada) / pos.precioEntrada) * 100;

      // TRAILING STOP / BREAKEVEN
      const nuevoStop = nuevoStopTrailing(pos, precio);
      if (nuevoStop) {
        pos.stopLoss = parseFloat(nuevoStop.toPrecision(8));
        guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
        console.log(`📈 [TRAILING] ${symbol} → suelo $${pos.stopLoss} (+${gananciaActualPct.toFixed(2)}%)`);
      }

      const motivo = motivoSalida(pos, precio, sentimiento);

      if (motivo) {
        // Reintento x3
        let orden;
        for (let intento = 1; intento <= 3; intento++) {
          try {
            orden = await vender(symbol, pos.cantidad);
            break;
          } catch (err) {
            console.error(`⚠️ Intento ${intento}/3 fallido ${symbol}: ${err.message}`);
            if (err.sinSaldo) {
              // La moneda ya no está en la cuenta (p. ej. reinicio del testnet): no hay nada que vender
              delete posicionesAbiertas[symbol];
              capitalActual = parseFloat((capitalActual + (pos.usdt || 0)).toFixed(4));
              guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
              await telegram.mensajeAlertaCritica(`Posición ${symbol} eliminada: sin saldo en la cuenta`, 0, capitalActual);
              return;
            }
            if (intento === 3) throw err;
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        const { neto, pct } = calcResultado(pos.precioEntrada, orden.precio, orden.cantidad);

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

        await enviarAHoja({
          symbol, estrategia: pos.estrategia, notaIA: pos.notaIA,
          estadoMacro: `${pos.macro} | ${pos.tendencia4h}`,
          tipo: 'VENTA', precio: orden.precio, cantidad: orden.cantidad,
          ganancia: neto, porcentaje: pct, motivo
        });

        // Pérdida máxima: se pausan las COMPRAS hasta mañana; las ventas siguen protegiendo
        const { supera, perdidaHoy } = superaPerdidaMaxima();
        const hoy = new Date().toDateString();
        if (supera && alertaPerdidaDia !== hoy) {
          alertaPerdidaDia = hoy;
          await telegram.mensajeAlertaCritica('Pérdida máxima diaria — compras pausadas hasta mañana', perdidaHoy, capitalActual);
        }
      }
      return;
    }

    // ── LÓGICA DE COMPRA ──
    const horaUTC = new Date().getUTCHours();
    const horaActiva = horaUTC >= config.HORA_INICIO_UTC && horaUTC <= config.HORA_FIN_UTC;

    const notaMinima = config.ESTRATEGIA.MIN_NOTA;
    const tiempoDesdeVenta = Date.now() - (ultimoVentaTime[symbol] || 0);
    const enfriamientoOk = tiempoDesdeVenta > 300000; // 5 minutos
    const monedaBloqueada = estaMonedaBloqueada(symbol, 3);
    const capitalSuficiente = capitalActual >= config.CAPITAL_POR_PAR;
    const maxTradesOk = Object.keys(posicionesAbiertas).length < config.MAX_OPEN_TRADES;
    const minNotionalOk = validarMinNotional(config.CAPITAL_POR_PAR);
    const perdidaDiariaOk = !superaPerdidaMaxima().supera;

    let razon = '';
    if (!estrategia) razon = `Sin señal (RSI:${rsi} MACD:${macd.alcista ? '↑' : '↓'} 4H:${tendencia4h} Macro:${macro})`;
    else if (!horaActiva) razon = `🌙 Hora inactiva (${horaUTC}h UTC)`;
    else if (puntuacion < notaMinima) razon = `🧠 Nota insuficiente (${puntuacion}/12)`;
    else if (monedaBloqueada) razon = `🛡️ Kill Switch activo`;
    else if (!enfriamientoOk) razon = `⏳ Enfriamiento (${Math.ceil((300000 - tiempoDesdeVenta) / 1000)}s)`;
    else if (sentimiento === 'NEGATIVO') razon = `📰 Noticias negativas`;
    else if (fgSeñal === 'PELIGRO') razon = `😱 Codicia extrema (${fgValor})`;
    else if (!capitalSuficiente) razon = `💰 Capital insuficiente ($${capitalActual})`;
    else if (!maxTradesOk) razon = `📦 Máximo trades abiertos`;
    else if (!minNotionalOk) razon = `❌ Mínimo Binance no alcanzado`;
    else if (!perdidaDiariaOk) razon = `🛑 Pérdida máxima diaria alcanzada`;

    const puedeComprar =
      estrategia !== null &&
      horaActiva &&
      puntuacion >= notaMinima &&
      !monedaBloqueada &&
      enfriamientoOk &&
      sentimiento !== 'NEGATIVO' &&
      fgSeñal !== 'PELIGRO' &&
      capitalSuficiente &&
      maxTradesOk &&
      minNotionalOk &&
      perdidaDiariaOk;

    if (puedeComprar) {
      console.log(`🟢 COMPRANDO ${symbol} (${estrategia}) Nota:${puntuacion}/12`);
      capitalActual -= config.CAPITAL_POR_PAR;

      try {
        const orden = await comprar(symbol, config.CAPITAL_POR_PAR);
        const niveles = nivelesSalida(orden.precio, atr);
        // 8 cifras significativas: vale igual para BTC (80000) que para DOGE (0.2) o PEPE (0.00001)
        const stopLoss = parseFloat(niveles.stopLoss.toPrecision(8));
        const takeProfit = parseFloat(niveles.takeProfit.toPrecision(8));

        posicionesAbiertas[symbol] = {
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          stopLoss, takeProfit, estrategia,
          atr, riesgo: niveles.riesgo,
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
  console.log(`\n⏰ ${new Date().toLocaleTimeString('es-ES')} — Ciclo de mercado...`);

  const { valor: fgValor, clasificacion: fgClasificacion } = await getFearGreed();
  const { señal: fgSeñal } = evaluarFearGreed(fgValor);
  const macro = await obtenerMacro();

  // También las posiciones abiertas de monedas que ya no están en SYMBOLS, para poder cerrarlas
  const simbolos = [...new Set([...config.SYMBOLS, ...Object.keys(posicionesAbiertas)])];
  await Promise.all(
    simbolos.map(symbol =>
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