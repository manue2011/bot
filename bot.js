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
const { evaluarTendencia, stopInicial, actualizarStop } = require('./strategy/tendencia');
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
let comprasEnCurso = 0;      // compras lanzadas y aún sin confirmar (los pares se procesan en paralelo)

const redondear = x => parseFloat(x.toPrecision(8)); // vale para BTC (80000) y para PEPE (0.00001)
const guardarEstado = () => guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });

// ── VELAS CON CACHÉ (4h y 1d solo cambian al cerrar vela) ──
const MS_INTERVALO = { '4h': 4 * 3600000, '1d': 86400000 };
const cacheVelas = {};
async function velasCerradas(symbol, intervalo, limite) {
  const clave = `${symbol}_${intervalo}`;
  const c = cacheVelas[clave];
  // Se refresca cuando ya ha cerrado la vela siguiente (+15 s de margen para que Binance la publique)
  if (c && Date.now() < c.ultimoCierre + MS_INTERVALO[intervalo] + 15000) return c.velas;
  const raw = await getCandles(symbol, intervalo, limite);
  const velas = raw.map(v => [v[0], +v[1], +v[2], +v[3], +v[4], +v[5], v[6]]);
  cacheVelas[clave] = { velas, ultimoCierre: velas[velas.length - 1][6] };
  return velas;
}

// ── ABRIR / CERRAR POSICIONES (comunes a las dos estrategias) ──
// Llamar solo tras comprobar huecos y capital; reserva ambos antes del primer await
async function abrirPosicion(symbol, calcularNiveles, extra, detalleTelegram) {
  comprasEnCurso++;
  capitalActual -= config.CAPITAL_POR_PAR;
  try {
    const orden = await comprar(symbol, config.CAPITAL_POR_PAR);
    const { stopLoss, takeProfit, ...resto } = calcularNiveles(orden.precio);

    posicionesAbiertas[symbol] = {
      precioEntrada: orden.precio,
      cantidad: orden.cantidad,
      stopLoss: redondear(stopLoss),
      takeProfit: takeProfit ? redondear(takeProfit) : null,
      usdt: config.CAPITAL_POR_PAR,
      ...resto, ...extra,
      timestamp: new Date().toISOString()
    };
    const pos = posicionesAbiertas[symbol];
    guardarEstado();
    capitalActual = parseFloat(capitalActual.toFixed(4));

    guardarTrade({
      lado: 'COMPRA', symbol,
      precioEntrada: orden.precio, cantidad: orden.cantidad, usdt: config.CAPITAL_POR_PAR,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, estrategia: pos.estrategia,
      timestamp: pos.timestamp
    });

    await telegram.mensajeCompra({
      symbol, precioEntrada: orden.precio, cantidad: orden.cantidad, usdt: config.CAPITAL_POR_PAR,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, detalle: detalleTelegram
    });
  } catch (err) {
    console.error(`❌ Falló compra ${symbol}:`, err.message);
    capitalActual = parseFloat((capitalActual + config.CAPITAL_POR_PAR).toFixed(4));
    await telegram.mensajeAlertaCritica(`Error compra ${symbol}`, err.message, capitalActual);
  } finally {
    comprasEnCurso--;
  }
}

async function cerrarPosicion(symbol, pos, motivo) {
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
        guardarEstado();
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
  guardarEstado();

  guardarTrade({
    lado: 'VENTA', symbol,
    precioEntrada: pos.precioEntrada,
    precioSalida: orden.precio,
    cantidad: orden.cantidad,
    resultado: neto, pct, motivo,
    estrategia: pos.estrategia,
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
    estadoMacro: pos.estrategia === 'Tendencia' ? 'TENDENCIA_4H' : `${pos.macro} | ${pos.tendencia4h}`,
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

// Comprobaciones de capital y riesgo comunes. Devuelve la razón por la que NO se puede comprar, o null.
function bloqueoCompra() {
  if (capitalActual < config.CAPITAL_POR_PAR) return `💰 Capital insuficiente ($${capitalActual})`;
  if (Object.keys(posicionesAbiertas).length + comprasEnCurso >= config.MAX_OPEN_TRADES) return `📦 Máximo trades abiertos`;
  if (!validarMinNotional(config.CAPITAL_POR_PAR)) return `❌ Mínimo Binance no alcanzado`;
  if (superaPerdidaMaxima().supera) return `🛑 Pérdida máxima diaria alcanzada`;
  return null;
}

// ══════════════ ESTRATEGIA TENDENCIA (4h) ══════════════
const ultimaVelaEvaluada = {};

async function procesarParTendencia(symbol, btc) {
  try {
    const precio = await getPrecio(symbol);
    const pos = posicionesAbiertas[symbol];

    // ── Posición abierta: stop revisado cada minuto, actualizado al cerrar cada vela de 4h ──
    if (pos) {
      if (pos.estrategia !== 'Tendencia') {
        // Posición antigua de la estrategia SWING: se gestiona con sus propios SL/TP
        const motivo = motivoSalida(pos, precio);
        if (motivo) await cerrarPosicion(symbol, pos, motivo);
        return;
      }
      const velas4h = await velasCerradas(symbol, '4h', 100);
      const ultimoCierre = velas4h[velas4h.length - 1][6];
      if (pos.ultimaVela !== ultimoCierre) {
        const nuevo = redondear(actualizarStop(pos.stopLoss, velas4h));
        if (nuevo > pos.stopLoss) console.log(`📈 [STOP] ${symbol} sube a $${nuevo}`);
        pos.stopLoss = nuevo;
        pos.ultimaVela = ultimoCierre;
        guardarEstado();
      }
      if (precio <= pos.stopLoss) {
        const motivo = pos.stopLoss > pos.precioEntrada ? '📉 Fin de tendencia' : '🛡️ Stop-Loss';
        await cerrarPosicion(symbol, pos, motivo);
      }
      return;
    }

    if (!config.SYMBOLS.includes(symbol)) return;

    // ── Sin posición: señal solo una vez por vela de 4h recién cerrada ──
    const velas4h = await velasCerradas(symbol, '4h', 100);
    const ultimoCierre = velas4h[velas4h.length - 1][6];
    if (ultimaVelaEvaluada[symbol] === ultimoCierre) return;
    ultimaVelaEvaluada[symbol] = ultimoCierre;

    const velas1d = await velasCerradas(symbol, '1d', config.TENDENCIA.SMA_DIAS);
    const r = evaluarTendencia({ velas4h, velas1d, btc4h: btc.velas4h, btc1d: btc.velas1d });
    if (!r) return;
    console.log(`📊 ${symbol} cierre 4h $${r.cierre.toPrecision(6)} | máx ${config.TENDENCIA.N} velas $${r.maxPrevio.toPrecision(6)} | régimen moneda ${r.regimenMoneda ? '✅' : '❌'} BTC ${r.regimenBtc ? '✅' : '❌'}`);
    if (!r.entrar) return;

    // Solo si la vela acaba de cerrar: tras un reinicio no se compra una ruptura de hace horas
    const minutos = (Date.now() - ultimoCierre) / 60000;
    if (minutos > 30) return console.log(`   ⏳ ${symbol}: ruptura de hace ${minutos.toFixed(0)} min, se ignora`);

    const bloqueo = bloqueoCompra();
    if (bloqueo) return console.log(`   ⏳ ${symbol}: ruptura pero ${bloqueo}`);

    console.log(`🟢 COMPRANDO ${symbol} (Tendencia) ruptura de $${r.maxPrevio.toPrecision(6)}`);
    await abrirPosicion(
      symbol,
      precioEntrada => ({ stopLoss: stopInicial(precioEntrada, r.atr), takeProfit: null }),
      { estrategia: 'Tendencia', atr: r.atr, ultimaVela: ultimoCierre },
      `📈 Ruptura del máximo de ${config.TENDENCIA.N} velas de 4h ($${r.maxPrevio.toPrecision(6)})\n🎯 Sin take-profit: el stop sube con la tendencia`
    );
  } catch (err) {
    console.error(`❌ Error general ${symbol}:`, err.message);
    await telegram.mensajeAlertaCritica(`Fallo grave ${symbol}`, err.message, capitalActual);
  }
}

// ══════════════ ESTRATEGIA SWING (1h) ══════════════
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

async function obtenerMacro() {
  try {
    const candles = await getCandles('BTCUSDT', '1d', 30);
    const precioBtc = await getPrecio('BTCUSDT');
    return macroDesde(candles.map(c => parseFloat(c[4])), precioBtc);
  } catch (e) {
    return 'ERROR_MACRO';
  }
}

async function procesarParSwing(symbol, fgValor, fgSeñal, macro) {
  try {
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

    const señal = evaluarEntrada({ closes, highs, lows, volumenes, precio, tendencia4h, macro, sentimiento });
    if (!señal) {
      console.log(`⚠️ ${symbol}: error calculando indicadores`);
      return;
    }
    const { rsi, sma20, macd, atr, puntuacion, estrategia } = señal;

    console.log(`\n📊 ${symbol} | $${precio.toPrecision(6)}`);
    console.log(`   RSI: ${rsi} | SMA20: $${sma20.toPrecision(6)} | MACD: ${macd.alcista ? '↑' : '↓'} | ATR: ${atr.toPrecision(4)}`);
    console.log(`   F&G: ${fgValor} | Noticias: ${sentimiento} | Macro: ${macro} | 4H: ${tendencia4h} | Nota: ${puntuacion}/12`);

    // ── VENTA ──
    const pos = posicionesAbiertas[symbol];
    if (pos) {
      const gananciaActualPct = ((precio - pos.precioEntrada) / pos.precioEntrada) * 100;
      const nuevoStop = nuevoStopTrailing(pos, precio);
      if (nuevoStop) {
        pos.stopLoss = redondear(nuevoStop);
        guardarEstado();
        console.log(`📈 [TRAILING] ${symbol} → suelo $${pos.stopLoss} (+${gananciaActualPct.toFixed(2)}%)`);
      }
      const motivo = motivoSalida(pos, precio, sentimiento);
      if (motivo) await cerrarPosicion(symbol, pos, motivo);
      return;
    }
    if (!config.SYMBOLS.includes(symbol)) return;

    // ── COMPRA ──
    const horaUTC = new Date().getUTCHours();
    const horaActiva = horaUTC >= config.HORA_INICIO_UTC && horaUTC <= config.HORA_FIN_UTC;
    const tiempoDesdeVenta = Date.now() - (ultimoVentaTime[symbol] || 0);

    let razon = null;
    if (!estrategia) razon = `Sin señal (RSI:${rsi} MACD:${macd.alcista ? '↑' : '↓'} 4H:${tendencia4h} Macro:${macro})`;
    else if (!horaActiva) razon = `🌙 Hora inactiva (${horaUTC}h UTC)`;
    else if (puntuacion < config.ESTRATEGIA.MIN_NOTA) razon = `🧠 Nota insuficiente (${puntuacion}/12)`;
    else if (estaMonedaBloqueada(symbol, 3)) razon = `🛡️ Kill Switch activo`;
    else if (tiempoDesdeVenta <= 300000) razon = `⏳ Enfriamiento (${Math.ceil((300000 - tiempoDesdeVenta) / 1000)}s)`;
    else if (sentimiento === 'NEGATIVO') razon = `📰 Noticias negativas`;
    else if (fgSeñal === 'PELIGRO') razon = `😱 Codicia extrema (${fgValor})`;
    else razon = bloqueoCompra();

    if (razon) return console.log(`   ⏳ ${razon}`);

    console.log(`🟢 COMPRANDO ${symbol} (${estrategia}) Nota:${puntuacion}/12`);
    await abrirPosicion(
      symbol,
      precioEntrada => nivelesSalida(precioEntrada, atr),
      { estrategia, atr, notaIA: puntuacion, tendencia4h, macro },
      `📊 RSI: ${rsi.toFixed(2)} | MACD: ${macd.alcista ? '↑' : '↓'} | Tendencia 4H: ${tendencia4h}\n😱 Fear&Greed: ${fgValor}`
    );
  } catch (err) {
    console.error(`❌ Error general ${symbol}:`, err.message);
    await telegram.mensajeAlertaCritica(`Fallo grave ${symbol}`, err.message, capitalActual);
  }
}

// ── CICLO PRINCIPAL ──
async function tick() {
  console.log(`\n⏰ ${new Date().toLocaleTimeString('es-ES')} — Ciclo de mercado (${config.MODO})...`);

  // También las posiciones abiertas de monedas que ya no están en SYMBOLS, para poder cerrarlas
  const simbolos = [...new Set([...config.SYMBOLS, ...Object.keys(posicionesAbiertas)])];

  if (config.MODO === 'TENDENCIA') {
    let btc;
    try {
      btc = { velas4h: await velasCerradas('BTCUSDT', '4h', 100), velas1d: await velasCerradas('BTCUSDT', '1d', config.TENDENCIA.SMA_DIAS) };
    } catch (err) {
      return console.error('❌ No se pudieron obtener velas de BTC:', err.message);
    }
    await Promise.all(simbolos.map(symbol => procesarParTendencia(symbol, btc)));
    return;
  }

  const { valor: fgValor } = await getFearGreed();
  const { señal: fgSeñal } = evaluarFearGreed(fgValor);
  const macro = await obtenerMacro();
  await Promise.all(simbolos.map(symbol => procesarParSwing(symbol, fgValor, fgSeñal, macro)));
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
  console.log(`🤖 Crypto Bot v6.0 — ${config.MODO} | ${config.SYMBOLS.length} pares`);
  console.log(`   Capital: $${capitalActual.toFixed(2)} USDT | $${config.CAPITAL_POR_PAR} por operación | máx ${config.MAX_OPEN_TRADES} abiertas`);
  console.log(`   Modo: ${config.BINANCE_TESTNET ? 'TESTNET' : '🔴 REAL'}`);

  if (telegram.bot) {
    telegram.bot.onText(/\/status/, async (msg) => {
      const inv = Object.values(posicionesAbiertas).reduce((acc, p) => acc + (p.usdt || 0), 0);
      let txt = `📊 <b>ESTADO BOT v6.0</b> (${config.MODO})\n━━━━━━━━━━━━━━━━━━━━\n`;
      txt += `💰 Total: <b>$${(capitalActual + inv).toFixed(2)}</b>\n`;
      txt += `💵 Libre: $${capitalActual.toFixed(2)}\n`;
      txt += `📦 Posiciones: ${Object.keys(posicionesAbiertas).length}/${config.MAX_OPEN_TRADES}\n\n`;
      if (Object.keys(posicionesAbiertas).length > 0) {
        txt += `📝 <b>DETALLE:</b>\n`;
        for (const [sym, p] of Object.entries(posicionesAbiertas)) {
          let actual = '';
          try { const pr = await getPrecio(sym); actual = ` | ahora ${(((pr / p.precioEntrada) - 1) * 100).toFixed(1)}%`; } catch {}
          txt += `• <b>${sym}</b>: entrada $${p.precioEntrada.toPrecision(6)} | SL $${p.stopLoss}${p.takeProfit ? ` | TP $${p.takeProfit}` : ''}${actual}\n`;
        }
      } else {
        txt += `<i>Sin posiciones abiertas.</i>`;
      }
      telegram.bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
    });
  }

  await telegram.mensajeInicio();
  programarResumenDiario();

  (async function loop() {
    try {
      await tick();
    } catch (err) {
      console.error('❌ Error en el ciclo:', err.message); // el bucle nunca debe pararse
    }
    setTimeout(loop, config.INTERVALO_SEGUNDOS * 1000);
  })();
}

iniciar();
