// Backtest de la estrategia con datos históricos reales de Binance.
// Uso: node backtest.js [dias=365]
// Usa la MISMA lógica que bot.js (strategy/estrategia.js). No modela noticias ni Fear&Greed.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config/settings');
const { tendencia4HDesde, macroDesde, evaluarEntrada, nivelesSalida, nuevoStopTrailing, motivoSalida } = require('./strategy/estrategia');

const DIAS = parseInt(process.argv[2] || 365);
const DATA_DIR = path.join(__dirname, 'backtest_data');
const FEE = config.FEE_PCT / 100;
const SLIPPAGE = 0.0005; // 0.05% por orden de mercado
const MS = { '5m': 300000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };

// ── DATOS ──
async function descargar(symbol, interval, desde, hasta) {
  const archivo = path.join(DATA_DIR, `${symbol}_${interval}_${DIAS}.json`);
  if (fs.existsSync(archivo)) return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const velas = [];
  let start = desde;
  while (start < hasta) {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, startTime: start, endTime: hasta, limit: 1000 }, timeout: 15000
    });
    if (!data.length) break;
    velas.push(...data.map(c => [c[0], +c[1], +c[2], +c[3], +c[4], +c[5], c[6]]));
    start = data[data.length - 1][0] + MS[interval];
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(velas));
  return velas;
}

// Devuelve las últimas n velas cerradas antes de t (avanza un puntero, t es creciente)
function ventana(velas) {
  let i = 0;
  return (t, n) => {
    while (i < velas.length && velas[i][6] < t) i++;
    return velas.slice(Math.max(0, i - n), i);
  };
}

// ── SIMULACIÓN DE UN PAR ──
function simular(symbol, d, btc5mPorTiempo, btc1d, p, desde) {
  const v1h = ventana(d['1h']), v4h = ventana(d['4h']), vBtc1d = ventana(btc1d);
  const trades = [];
  let pos = null;
  let perdidasSeguidas = 0, bloqueadoHasta = 0, ultimaVenta = 0;

  for (const vela of d['5m']) {
    const t = vela[6] + 1; // instante de cierre de la vela de 5m
    if (t < desde) continue;
    const [, , alto, bajo, cierre] = vela;

    if (pos) {
      // Dentro de la vela: primero el stop (pesimista), luego el TP
      let salida = null, motivo = null;
      if (bajo <= pos.stopLoss) { salida = pos.stopLoss; motivo = motivoSalida(pos, pos.stopLoss); }
      else if (alto >= pos.takeProfit) { salida = pos.takeProfit; motivo = '🎯 Take-Profit'; }
      if (salida) {
        const precioSalida = salida * (1 - SLIPPAGE);
        const pct = ((precioSalida * (1 - FEE)) / (pos.precioEntrada * (1 + FEE)) - 1) * 100;
        trades.push({ t, symbol, estrategia: pos.estrategia, pct, motivo, horas: (t - pos.t) / 3.6e6 });
        if (pct < 0) { if (++perdidasSeguidas >= 3) bloqueadoHasta = t + 4 * 3.6e6; }
        else perdidasSeguidas = 0;
        ultimaVenta = t;
        pos = null;
      } else {
        const ns = nuevoStopTrailing(pos, cierre, p);
        if (ns) pos.stopLoss = ns;
      }
      continue;
    }

    const hora = new Date(t).getUTCHours();
    if (hora < config.HORA_INICIO_UTC || hora > config.HORA_FIN_UTC) continue;
    if (t - ultimaVenta < 300000 || t < bloqueadoHasta) continue;
    if (bloqueadoHasta && t >= bloqueadoHasta) { perdidasSeguidas = 0; bloqueadoHasta = 0; }

    const c1h = v1h(t, 60), c4h = v4h(t, 60), cBtc1d = vBtc1d(t, 30);
    if (c1h.length < 60 || c4h.length < 50 || cBtc1d.length < 20) continue;
    const precioBtc = btc5mPorTiempo.get(vela[0]);
    if (!precioBtc) continue;

    const s = evaluarEntrada({
      closes: c1h.map(c => c[4]), highs: c1h.map(c => c[2]), lows: c1h.map(c => c[3]),
      volumenes: c1h.map(c => c[5]), precio: cierre,
      tendencia4h: tendencia4HDesde(c4h.map(c => c[4]), cierre),
      macro: macroDesde(cBtc1d.map(c => c[4]), precioBtc),
      sentimiento: 'NEUTRO'
    }, p);
    if (!s || !s.estrategia || s.puntuacion < p.MIN_NOTA) continue;

    const precioEntrada = cierre * (1 + SLIPPAGE);
    const niveles = nivelesSalida(precioEntrada, s.atr, p);
    pos = { t, precioEntrada, estrategia: s.estrategia, atr: s.atr, ...niveles };
  }
  return trades;
}

// ── MÉTRICAS ──
function metricas(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const g = trades.filter(x => x.pct > 0), pd = trades.filter(x => x.pct <= 0);
  const sumG = g.reduce((a, x) => a + x.pct, 0), sumP = -pd.reduce((a, x) => a + x.pct, 0);
  let acum = 0, pico = 0, dd = 0;
  trades.slice().sort((a, b) => a.t - b.t).forEach(x => { acum += x.pct; pico = Math.max(pico, acum); dd = Math.max(dd, pico - acum); });
  return {
    n, aciertos: (g.length / n * 100).toFixed(0) + '%',
    ganMedia: g.length ? (sumG / g.length).toFixed(2) : '0', perdMedia: pd.length ? (-sumP / pd.length).toFixed(2) : '0',
    total: (sumG - sumP).toFixed(1), pf: sumP ? (sumG / sumP).toFixed(2) : '∞', maxDD: dd.toFixed(1)
  };
}

// ── VARIANTES ──
const ACTUAL = {
  MOMENTUM: true, MEAN_REVERSION: true, MIN_NOTA: 8,
  RSI_MOMENTUM_MIN: 50, RSI_MOMENTUM_MAX: 70, VOLUMEN_MIN: 1.1,
  SL_ATR_MULT: 1.5, SL_MIN_PCT: 0, SL_MAX_PCT: 2, TP_PCT: 3.8,
  TRAIL_ACT_PCT: 2, TRAIL_DIST_PCT: 1.5
};
const VARIANTES = {
  actual: ACTUAL,
  configurada: config.ESTRATEGIA,
  // VARIANTES=ruta/a/archivo.js exporta (ACTUAL) => ({ nombre: params, ... }) para comparar más
  ...(process.env.VARIANTES ? require(path.resolve(process.env.VARIANTES))(ACTUAL) : {})
};

(async () => {
  const hasta = Date.now();
  const desde = hasta - DIAS * MS['1d'];
  const calentamiento = 60 * MS['1d']; // historia previa para indicadores
  const corte = desde + (hasta - desde) * 2 / 3; // 2/3 entrenamiento, 1/3 validación

  console.log(`⏬ Descargando ${DIAS} días de velas...`);
  const datos = {};
  for (const s of config.SYMBOLS) {
    datos[s] = {};
    for (const iv of ['5m', '1h', '4h', '1d']) datos[s][iv] = await descargar(s, iv, desde - calentamiento, hasta);
  }
  const btc5m = new Map(datos.BTCUSDT['5m'].map(c => [c[0], c[4]]));
  console.log(`   Desde ${new Date(desde).toISOString().slice(0, 10)} | corte validación ${new Date(corte).toISOString().slice(0, 10)}\n`);

  const filas = [];
  for (const [nombre, p] of Object.entries(VARIANTES)) {
    if (!p) continue;
    const trades = config.SYMBOLS.flatMap(s => simular(s, datos[s], btc5m, datos.BTCUSDT['1d'], p, desde));
    const fila = { variante: nombre };
    const tr = metricas(trades.filter(x => x.t < corte)), va = metricas(trades.filter(x => x.t >= corte));
    Object.assign(fila, { 'n(entr)': tr.n, 'acierto(entr)': tr.aciertos, 'total%(entr)': tr.total, 'pf(entr)': tr.pf,
      'n(valid)': va.n, 'acierto(valid)': va.aciertos, 'gan/perd media(valid)': `${va.ganMedia}/${va.perdMedia}`,
      'total%(valid)': va.total, 'pf(valid)': va.pf, 'maxDD%(valid)': va.maxDD });
    for (const s of config.SYMBOLS) fila[`total%${s.replace('USDT', '')}`] = metricas(trades.filter(x => x.symbol === s)).total;
    filas.push(fila);
    if (process.env.DETALLE === nombre) {
      const porMotivo = {};
      trades.forEach(x => { const k = `${x.estrategia} ${x.motivo}`; (porMotivo[k] = porMotivo[k] || []).push(x); });
      console.log(nombre, Object.fromEntries(Object.entries(porMotivo).map(([k, v]) => [k, metricas(v)])));
    }
  }
  console.table(filas);
  console.log('total% = suma del % neto de cada operación (tras comisiones). pf = ganancias/pérdidas (>1 es rentable).');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
