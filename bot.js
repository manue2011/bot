require("dotenv").config();
const http = require("http");
const axios = require("axios");

// Servidor para que Fly.io mantenga la app viva (Puerto 8080)
http.createServer((req, res) => res.end("Bot activo")).listen(8080);

const config = require("./config/settings");
const {
  getCandles,
  getPrecio,
  getBalance,
  comprar,
  vender,
} = require("./services/binanceService");
const { getNoticiasScore } = require("./services/newsService");
const {
  getFearGreed,
  evaluarFearGreed,
} = require("./services/fearGreedService");
const telegram = require("./services/telegramService");
const { calcRSI } = require("./indicators/rsi");
const { calcSMA } = require("./indicators/sma");
const { calcMACD } = require("./indicators/macd");
const { calcATR } = require("./indicators/atr");
const { calcBollinger } = require("./indicators/bollinger");
const {
  calcTakeProfit,
  calcStopLoss,
  calcResultado,
  validarMinNotional,
  superaPerdidaMaxima,
  generarResumenDiario,
  guardarTrade,
  guardarPosiciones,
  cargarPosiciones,
  registrarResultadoKillSwitch,
  estaMonedaBloqueada,
} = require("./risk/riskManager");

// ── ESTADO DEL BOT CON PERSISTENCIA ──
// 🟠 FIX 4: Cargar tanto posiciones como el tiempo de última venta
const datosGuardados = cargarPosiciones() || {};
let posicionesAbiertas = datosGuardados.posiciones || datosGuardados; // Compatible con tu JSON antiguo
let ultimoVentaTime = datosGuardados.ultimoVentaTime || {}; // Recuperamos la memoria de enfriamiento

// Cálculo del capital disponible restando lo ya invertido
const invertido = Object.values(posicionesAbiertas).reduce(
  (acc, pos) => acc + (pos.usdt || 0),
  0,
);
let capitalActual = parseFloat((config.CAPITAL_TOTAL - invertido).toFixed(4));
let botActivo = true;

// ── FUNCIÓN PARA ENVIAR DATOS AL EXCEL ──
async function enviarAExcel(datos) {
  const urlExcel =
    "https://script.google.com/macros/s/AKfycbx-Enj-nl9WOzTmV60jjllg7BZqFo7RgpFwSy5ofyhKM04TTzgV2IhgWv5Rwi4qFMI/exec";

  const payload = {
    symbol: datos.symbol,
    signal: datos.signal || "N/A",
    notaIA: datos.notaIA || 0,
    estadoMacro: datos.estadoMacro || "N/A",
    type: datos.tipo || "VENTA",
    price: datos.precio,
    amount: datos.cantidad || 0,
    profit: datos.ganancia || 0,
    profitPct: datos.porcentaje || 0,
    reason: datos.motivo || "Manual",
  };

  try {
    await axios.post(urlExcel, payload);
    console.log(
      `📊 [EXCEL] Datos completos de ${datos.symbol} enviados correctamente.`,
    );
  } catch (error) {
    console.error("❌ [EXCEL] Error al enviar datos al Excel:", error.message);
  }
}

// ── IA DE BOLSILLO: ANALISTA DE TENDENCIA 4H 🌊 ──
async function obtenerTendencia4H(symbol) {
  try {
    // Pedimos 60 velas de 4h usando tu súper función (que lee de la API real)
    const candles4h = await getCandles(symbol, "4h", 60);
    
    if (!candles4h || candles4h.length < 50) return "ERROR_TENDENCIA";

    const closes4h = candles4h.map((c) => parseFloat(c[4]));
    const precioActual = closes4h[closes4h.length - 1];
    
    const sma50_4h = calcSMA(closes4h, 50);

    return precioActual > sma50_4h ? "ALCISTA_4H" : "BAJISTA_4H";
  } catch (e) {
    console.error(`❌ Error en tendencia 4H para ${symbol}:`, e.message);
    return "ERROR_TENDENCIA";
  }
}
// ── IA DE BOLSILLO: ANALISTA MACRO ──
async function obtenerEstadoMacro() {
  try {
    const candlesBTC = await getCandles("BTCUSDT");
    const closesBTC = candlesBTC.map((c) => parseFloat(c[4]));
    const precioBTC = closesBTC[closesBTC.length - 1];
    const sma20BTC = calcSMA(closesBTC, 20);
    return precioBTC > sma20BTC ? "BTC_ALCISTA" : "BTC_BAJISTA";
  } catch (e) {
    return "ERROR_MACRO";
  }
}

// ── MOTOR PRINCIPAL ──
async function procesarPar(symbol, fgValor, fgClasificacion, fgSeñal, macro) {  if (!botActivo) return;
  console.log(`🔍 Procesando ${symbol}...`);

  try {
    // 1. DESCARGA DE DATOS
    const candles = await getCandles(symbol);
    if (!candles || candles.length < 30) {
      console.log(`⚠️ ${symbol}: datos insuficientes de Binance`);
      return;
    }

    // 2. EXTRACCIÓN DE PRECIOS
    const highs = candles.map((c) => parseFloat(c[2]));
    const lows = candles.map((c) => parseFloat(c[3]));
    const closes = candles.map((c) => parseFloat(c[4]));
    const volumenes = candles.map((c) => parseFloat(c[5]));
    const precio = closes[closes.length - 1];
    const volActual = volumenes[volumenes.length - 1]; // 🔥 VOLUMEN DE LA VELA ACTUAL
    const volMedio = volumenes.slice(-20).reduce((a, b) => a + b, 0) / 20; // 🔥 MEDIA DE 20 PERIODOS
    // 3. CÁLCULO DE INDICADORES
    const rsi = calcRSI(closes, 14);
    const sma20 = calcSMA(closes, 20);
    const macd = calcMACD(closes);
    const atr = calcATR(highs, lows, closes);
    const bollinger = calcBollinger(closes, 20, 2);

    // COMPROBACIÓN DE SEGURIDAD
    if (!rsi || !sma20 || !macd || !bollinger || !atr) {
      console.log(`⚠️ ${symbol}: Error calculando indicadores`);
      return;
    }

    const { sentimiento } = await getNoticiasScore(symbol);
    const tendencia4h = await obtenerTendencia4H(symbol);
    // ── CÁLCULO DE LA NOTA IA ──
    let puntuacionIA = 0;
    if (tendencia4h === "ALCISTA_4H") puntuacionIA += 3; // 🔥 Regla Pro
    if (precio > sma20) puntuacionIA += 2;
    if (rsi > 45 && rsi < 65) puntuacionIA += 2;
    if (macd.alcista) puntuacionIA += 2;
    if (sentimiento === "POSITIVO") puntuacionIA += 1;
    if (macro === "BTC_ALCISTA") puntuacionIA += 2;
    console.log(`\n📊 ${symbol} | $${precio}`);
    console.log(
      `   RSI: ${rsi.toFixed(2)} | SMA20: $${sma20.toFixed(2)} | MACD: ${macd.alcista ? "↑ alcista" : "↓ bajista"} | ATR: ${atr.toFixed(4)}`,
    );
    console.log(
      `   Fear&Greed: ${fgValor} (${fgClasificacion}) | Noticias: ${sentimiento} | Macro: ${macro} | 🌊 Marea 4H: ${tendencia4h}`,
    );

    // ── LÓGICA DE VENTA ──
    if (posicionesAbiertas[symbol]) {
      const pos = posicionesAbiertas[symbol];
      const gananciaActualPct =
        ((precio - pos.precioEntrada) / pos.precioEntrada) * 100;

      // 🛡️ TRAILING STOP DINÁMICO
      if (gananciaActualPct >= 1.5) {
        const distanciaSeguridad = 0.98; // Mantenemos un 2% de margen

        // 1. Calculamos el suelo que sigue al precio
        const nuevoStopSugerido = precio * distanciaSeguridad;
        // 2. Calculamos el mínimo para no perder (Entrada + 0.5%)
        const stopAsegurado = pos.precioEntrada * 1.005;

        // El bot elige el más alto de los dos para protegerte al máximo
        const mejorStop = Math.max(nuevoStopSugerido, stopAsegurado);

        // Solo actualizamos si el nuevo stop es realmente superior al que ya teníamos
        if (mejorStop > pos.stopLoss) {
          pos.stopLoss = mejorStop;
          guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
          console.log(
            `📈 [TRAILING] Subiendo suelo en ${symbol} a $${pos.stopLoss.toFixed(2)} (Profit: ${gananciaActualPct.toFixed(2)}%)`,
          );
        }
      }

      const debeVender =
        precio >= pos.takeProfit ||
        precio <= pos.stopLoss ||
       // (rsi > 75 && precio > sma20) ||
        sentimiento === "NEGATIVO";

      if (debeVender) {
        const motivo =
          precio >= pos.takeProfit
            ? "🎯 Take-Profit"
            : precio <= pos.stopLoss
              ? "🛡️ Stop-Loss"
              : sentimiento === "NEGATIVO"
                ? "📰 Noticias"
                : "📊 RSI>75";

        const orden = await vender(symbol, pos.cantidad);
        const { neto, pct } = calcResultado(
          pos.precioEntrada,
          orden.precio,
          pos.cantidad,
        );

        registrarResultadoKillSwitch(symbol, neto);
        capitalActual = parseFloat(
          (capitalActual + neto + (pos.usdt || 0)).toFixed(4),
        );
        ultimoVentaTime[symbol] = Date.now();

        // AQUÍ EL BOT RECUERDA Y ENVÍA LA NOTA AL EXCEL
        await enviarAExcel({
          symbol: symbol,
          signal: pos.estrategia,
          notaIA: pos.notaIA,
          estadoMacro: `${pos.estadoMacro} | ${pos.tendencia4h}`,
          tipo: "VENTA",
          precio: orden.precio,
          cantidad: pos.cantidad,
          ganancia: neto,
          porcentaje: pct,
          motivo: motivo,
        });

        delete posicionesAbiertas[symbol];
        guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });

        guardarTrade({
          lado: "VENTA",
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          cantidad: pos.cantidad,
          resultado: neto,
          pct,
          motivo,
          timestamp: new Date().toISOString(),
        });

        await telegram.mensajeVenta({
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          resultado: neto,
          pct,
          capitalActual,
          motivo,
        });

        const { supera, perdidaHoy } = superaPerdidaMaxima();
        if (supera) {
          botActivo = false;
          await telegram.mensajeAlertaCritica(
            "Pérdida máxima diaria",
            perdidaHoy,
            capitalActual,
          );
        }
      }
      return;
    }

    // ── LÓGICA DE COMPRA (IA DE BOLSILLO) ──
    const esMeanReversion =
      rsi < 40 && precio < sma20 && bollinger.enBandaInferior && macd.alcista;
 const esMomentum =
      rsi > 50 && 
      rsi < 75 && 
      precio > sma20 && 
      macd.alcista && 
      volActual > volMedio * 1.2 && // 🛡️ Exigimos un 20% más de volumen que la media
      tendencia4h === "ALCISTA_4H"; // 🌊 Marea 4H obligatoria
    const estrategia = esMeanReversion
      ? "MeanReversion"
      : esMomentum
        ? "Momentum"
        : null;

    const notaMinima = 8;
    const tiempoDesdeVenta = Date.now() - (ultimoVentaTime[symbol] || 0);
    const enfriamientoOk = tiempoDesdeVenta > 300000;
    const monedaBloqueada = estaMonedaBloqueada(symbol, 3);
    const capitalSuficiente = capitalActual >= config.CAPITAL_POR_PAR;
    const minNotionalOk = validarMinNotional(config.CAPITAL_POR_PAR);

    let razonNoCompra = "";
    if (estrategia === null) razonNoCompra = "Esperando señal técnica";
    else if (puntuacionIA < notaMinima)
      razonNoCompra = `🧠 IA Rechaza: Nota ${puntuacionIA}/12`;
    else if (monedaBloqueada) razonNoCompra = `🛡️ KILL SWITCH Activo`;
    else if (!enfriamientoOk)
      razonNoCompra = `Enfriamiento (${Math.ceil((300000 - tiempoDesdeVenta) / 1000)}s)`;
    else if (sentimiento === "NEGATIVO") razonNoCompra = `Noticias NEGATIVAS`;
    else if (fgSeñal === "PELIGRO")
      razonNoCompra = `Codicia Extrema (${fgValor})`;
    else if (!capitalSuficiente)
      razonNoCompra = `Saldo insuficiente ($${capitalActual})`;
    else if (Object.keys(posicionesAbiertas).length >= config.MAX_OPEN_TRADES)
      razonNoCompra = `Máximo de trades`;
    else if (!minNotionalOk) razonNoCompra = `Mínimo de Binance no alcanzado`;

    const puedeComprar =
      estrategia !== null &&
      puntuacionIA >= notaMinima &&
      !monedaBloqueada &&
      enfriamientoOk &&
      sentimiento !== "NEGATIVO" &&
      fgSeñal !== "PELIGRO" &&
      capitalSuficiente &&
      Object.keys(posicionesAbiertas).length < config.MAX_OPEN_TRADES &&
      minNotionalOk;

  if (puedeComprar) {
      console.log(`🟢 COMPRANDO ${symbol} (${estrategia})...`);
      
      // 🔴 FIX 1: RESERVA SÍNCRONA DE CAPITAL
      capitalActual -= config.CAPITAL_POR_PAR;

      try {
        const orden = await comprar(symbol, config.CAPITAL_POR_PAR);

        const stopLoss = calcStopLoss(orden.precio, atr);
        const takeProfit = calcTakeProfit(orden.precio);

        posicionesAbiertas[symbol] = {
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          stopLoss,
          takeProfit,
          estrategia,
          notaIA: puntuacionIA,
          estadoMacro: macro, 
          usdt: config.CAPITAL_POR_PAR,
          tendencia4h,
          timestamp: new Date().toISOString(),
        };

        guardarPosiciones({ posiciones: posicionesAbiertas, ultimoVentaTime });
        
        capitalActual = parseFloat(capitalActual.toFixed(4));

        guardarTrade({
          lado: "COMPRA",
          symbol,
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          usdt: config.CAPITAL_POR_PAR,
          stopLoss,
          takeProfit,
          estrategia,
          timestamp: new Date().toISOString(),
        });

        await telegram.mensajeCompra({
          symbol,
          precioEntrada: orden.precio,
          cantidad: orden.cantidad,
          usdt: config.CAPITAL_POR_PAR,
          stopLoss,
          takeProfit,
          rsi: rsi.toFixed(2),
          macd: macd.alcista,
          estrategia,
        });

      } catch (err) {
        // 🔴 FIX 1 (Recuperación) y FIX 3 (Alertas Silenciosas)
        console.error(`❌ Falló la compra de ${symbol}, devolviendo capital. Error:`, err.message);
        capitalActual += config.CAPITAL_POR_PAR;
        capitalActual = parseFloat(capitalActual.toFixed(4));
        // Añadimos el aviso por Telegram si falla la compra
        await telegram.mensajeAlertaCritica(`Error en compra ${symbol}`, err.message, capitalActual);
      } // <-- ESTA ES LA LLAVE QUE FALTABA (Cierra el catch)
    } else {
      console.log(`   ⏳ Estado: ${razonNoCompra}`);
    }
  } catch (err) { // <-- ESTE CATCH ES EL GENERAL DE LA FUNCIÓN procesarPar
    console.error(`❌ Error general en ${symbol}:`, err.message);
    // FIX 3: Avisar a Telegram si la función entera peta
    await telegram.mensajeAlertaCritica(`Fallo grave en ${symbol}`, err.message, capitalActual);
  }
}

// ── CICLOS DE MERCADO ──
async function tick() {
  if (!botActivo) return;
  console.log(
    `\n⏰ ${new Date().toLocaleTimeString("es-ES")} — Ciclo de mercado...`,
  );
  
  // 1. Obtenemos el Miedo/Codicia (1 llamada)
  const { valor: fgValor, clasificacion: fgClasificacion } = await getFearGreed();
  const { señal: fgSeñal } = evaluarFearGreed(fgValor);
  
  // 🟠 FIX 2: OBTENER MACRO UNA SOLA VEZ
  // Preguntamos a Binance por BTC una sola vez por ciclo, no por cada moneda.
  const macro = await obtenerEstadoMacro(); 

  // 2. Pasamos TODOS los datos a procesarPar
  await Promise.all(
    config.SYMBOLS.map((symbol) =>
      procesarPar(symbol, fgValor, fgClasificacion, fgSeñal, macro) // <-- Añadido macro aquí
    ),
  );
}

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

async function iniciar() {
  console.log("🤖 Crypto Bot Ultra v4.0 - IA de Bolsillo & Kill Switch READY");
  console.log(`   Capital Disponible: $${capitalActual.toFixed(2)} USDT`);

  if (telegram.bot) {
    telegram.bot.onText(/\/status/, (msg) => {
      const inv = Object.values(posicionesAbiertas).reduce(
        (acc, p) => acc + (p.usdt || 0),
        0,
      );
      let txt = `📊 <b>ESTADO DEL BOT</b>\n━━━━━━━━━━━━━━━━━━━━\n💰 Total: <b>$${(capitalActual + inv).toFixed(2)}</b>\n💵 Libre: $${capitalActual.toFixed(2)}\n📦 Abiertas: ${Object.keys(posicionesAbiertas).length}/3\n\n`;
      if (Object.keys(posicionesAbiertas).length > 0) {
        txt += `📝 <b>DETALLE:</b>\n`;
        Object.entries(posicionesAbiertas).forEach(([sym, p]) => {
          txt += `• <b>${sym}</b>: $${p.precioEntrada} (Inv: $${p.usdt})\n`;
        });
      } else {
        txt += `<i>No hay posiciones abiertas.</i>`;
      }
      telegram.bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
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
