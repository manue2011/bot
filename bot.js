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
  guardarTrade,
  guardarPosiciones,
  cargarPosiciones
} = require('./risk/riskManager');

// ── ESTADO DEL BOT CON PERSISTENCIA ──
let posicionesAbiertas = cargarPosiciones(); 

// Cálculo inteligente del capital disponible al arrancar
const invertido = Object.values(posicionesAbiertas).reduce((acc, pos) => acc + (pos.usdt || 0), 0);
let capitalActual = parseFloat((config.CAPITAL_TOTAL - invertido).toFixed(4));

let botActivo = true;

async function procesarPar(symbol, fgValor, fgClasificacion, fgSeñal) {
  if (!botActivo) return;
  console.log(`🔍 Procesando ${symbol}...`);

  try {
    const closes = await getCandles(symbol);
    const precio = closes[closes.length - 1];

    const rsi = calcRSI(closes, 14);
    const sma20 = calcSMA(closes, 20);
    const macd = calcMACD(closes);
    const bollinger = calcBollinger(closes, 20, 2);

    if (!rsi || !sma20 || !macd || !bollinger) {
      console.log(`⚠️ ${symbol}: datos insuficientes para indicadores`);
      return;
    }

    const { sentimiento, titular } = await getNoticiasScore(symbol);

    console.log(`\n📊 ${symbol} | $${precio}`);
    console.log(`   RSI: ${rsi.toFixed(2)} | SMA20: $${sma20.toFixed(2)} | MACD: ${macd.alcista ? '↑ alcista' : '↓ bajista'}`);
    console.log(`   Fear&Greed: ${fgValor} (${fgClasificacion}) | Noticias: ${sentimiento}`);

    // ── LÓGICA DE VENTA ──
    if (posicionesAbiertas[symbol]) {
      const pos = posicionesAbiertas[symbol];

      const debeVender =
        precio >= pos.takeProfit ||          
        precio <= pos.stopLoss  ||           
        (rsi > 75 && precio > sma20) ||      
        sentimiento === 'NEGATIVO';          

      if (debeVender) {
        const motivo =
          precio >= pos.takeProfit ? '🎯 Take-Profit' :
          precio <= pos.stopLoss ? '🛡️ Stop-Loss' :
          sentimiento === 'NEGATIVO' ? '📰 Noticias' :
          '📊 RSI>75';

        const orden = await vender(symbol, pos.cantidad);
        const { neto, pct } = calcResultado(pos.precioEntrada, orden.precio, pos.cantidad);

        // Al vender, sumamos el neto ganado y recuperamos el USDT invertido
        capitalActual = parseFloat((capitalActual + neto + (pos.usdt || 0)).toFixed(4));

        delete posicionesAbiertas[symbol];
        guardarPosiciones(posicionesAbiertas); 

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

        await telegram.mensajeVenta({
          symbol,
          precioEntrada: pos.precioEntrada,
          precioSalida: orden.precio,
          resultado: neto,
          pct,
          capitalActual,
          motivo
        });

        const { supera, perdidaHoy } = superaPerdidaMaxima();
        if (supera) {
          botActivo = false;
          await telegram.mensajeAlertaCritica('Pérdida máxima', perdidaHoy, capitalActual);
        }
      }
      return; 
    }

    // ── LÓGICA DE COMPRA ──
    const esMeanReversion = rsi < 40 && precio < sma20 && bollinger.enBandaInferior && macd.alcista;
    const esMomentum = rsi > 50 && rsi < 70 && precio > sma20 && (macd.alcista || fgValor < 20);
    const estrategia = esMeanReversion ? 'MeanReversion' : esMomentum ? 'Momentum' : null;

    // ── DIAGNÓSTICO DE FILTROS ──
    const noticiasBloqueantes = sentimiento === 'NEGATIVO';
    const fearGreedBloqueante = fgSeñal === 'PELIGRO';
    const capitalSuficiente = capitalActual >= config.CAPITAL_POR_PAR;
    const operacionesAbiertas = Object.keys(posicionesAbiertas).length;
    const minNotionalOk = validarMinNotional(config.CAPITAL_POR_PAR);

    let razonNoCompra = "";
    if (estrategia === null) {
      razonNoCompra = "Esperando señal técnica (RSI/SMA/MACD)";
    } else if (noticiasBloqueantes) {
      razonNoCompra = `Noticias NEGATIVAS detectadas`;
    } else if (fearGreedBloqueante) {
      razonNoCompra = `Mercado en Codicia Extrema (${fgValor})`;
    } else if (!capitalSuficiente) {
      razonNoCompra = `Saldo insuficiente en bot ($${capitalActual.toFixed(2)})`;
    } else if (operacionesAbiertas >= config.MAX_OPEN_TRADES) {
      razonNoCompra = `Máximo de trades alcanzado (${config.MAX_OPEN_TRADES})`;
    } else if (!minNotionalOk) {
      razonNoCompra = `Monto $${config.CAPITAL_POR_PAR} por debajo del mínimo de Binance`;
    }

    const puedeComprar = 
      estrategia !== null && 
      !noticiasBloqueantes && 
      !fearGreedBloqueante && 
      capitalSuficiente && 
      operacionesAbiertas < config.MAX_OPEN_TRADES && 
      minNotionalOk;

    if (puedeComprar) {
      console.log(`🟢 COMPRANDO ${symbol} (${estrategia})...`);
      const orden = await comprar(symbol, config.CAPITAL_POR_PAR);
      const stopLoss = calcStopLoss(orden.precio);
      const takeProfit = calcTakeProfit(orden.precio);

      posicionesAbiertas[symbol] = {
        precioEntrada: orden.precio,
        cantidad: orden.cantidad,
        stopLoss,
        takeProfit,
        estrategia,
        usdt: config.CAPITAL_POR_PAR, 
        timestamp: new Date().toISOString()
      };

      guardarPosiciones(posicionesAbiertas); 
      capitalActual = parseFloat((capitalActual - config.CAPITAL_POR_PAR).toFixed(4));

      guardarTrade({
        lado: 'COMPRA',
        symbol,
        precioEntrada: orden.precio,
        cantidad: orden.cantidad,
        usdt: config.CAPITAL_POR_PAR,
        stopLoss,
        takeProfit,
        estrategia,
        timestamp: new Date().toISOString()
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
        bollinger: bollinger.enBandaInferior ? 'inf' : (bollinger.enBandaSuperior ? 'sup' : 'normal'),
        noticias: sentimiento,
        fearGreed: `${fgValor} (${fgClasificacion})`,
        estrategia
      });
    } else {
      console.log(`   ⏳ Estado: ${razonNoCompra}`);
    }

  } catch (err) {
    console.error(`❌ Error en ${symbol}:`, err.message);
  }
}

async function tick() {
  if (!botActivo) return;
  console.log(`\n⏰ ${new Date().toLocaleTimeString('es-ES')} — Iniciando ciclo de mercado...`);
  const { valor: fgValor, clasificacion: fgClasificacion } = await getFearGreed();
  const { señal: fgSeñal } = evaluarFearGreed(fgValor);
  await Promise.all(config.SYMBOLS.map(symbol => procesarPar(symbol, fgValor, fgClasificacion, fgSeñal)));
}

function programarResumenDiario() {
  const ahora = new Date();
  const medianoche = new Date(ahora);
  medianoche.setHours(23, 59, 0, 0);
  const msHasta = medianoche.getTime() - ahora.getTime();
  const delay = msHasta > 0 ? msHasta : msHasta + 24*60*60*1000;
  setTimeout(async () => {
    const resumen = generarResumenDiario(capitalActual);
    await telegram.mensajeResumenDiario(resumen);
    programarResumenDiario();
  }, delay);
}

async function iniciar() {
  console.log('🤖 Crypto Bot Ultra v3.1 - MODO DIAGNÓSTICO COMPLETO');
  console.log(`   Capital Disponible: $${capitalActual.toFixed(2)} USDT`);

  // COMANDO STATUS
 if (telegram.bot) {
    telegram.bot.onText(/\/status/, (msg) => {
      const inv = Object.values(posicionesAbiertas).reduce((acc, p) => acc + (p.usdt || 0), 0);
      let txt = `📊 <b>ESTADO DEL BOT</b>\n`;
      txt += `━━━━━━━━━━━━━━━━━━━━\n`;
      txt += `💰 Total: <b>$${(capitalActual + inv).toFixed(2)}</b>\n`;
      txt += `💵 Libre: $${capitalActual.toFixed(2)}\n`;
      txt += `📦 Abiertas: ${Object.keys(posicionesAbiertas).length}/3\n\n`;

      // ESTA ES LA PARTE QUE FALTABA: Listar cada moneda
      if (Object.keys(posicionesAbiertas).length > 0) {
        txt += `📝 <b>DETALLE:</b>\n`;
        Object.entries(posicionesAbiertas).forEach(([sym, p]) => {
          txt += `• <b>${sym}</b>: $${p.precioEntrada} (Inv: $${p.usdt})\n`;
        });
      } else {
        txt += `<i>No hay posiciones abiertas actualmente.</i>`;
      }

      telegram.bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
    });
  }

  await telegram.mensajeInicio();
  programarResumenDiario();

  async function loop() {
    await tick();
    setTimeout(loop, config.INTERVALO_SEGUNDOS * 1000);
  }
  loop();
}

iniciar();