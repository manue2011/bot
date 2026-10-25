// Backtest de la estrategia de tendencia (strategy/tendencia.js) con 3 años de velas reales de Binance.
// Uso: node backtest_tendencia.js            → configuración de config.TENDENCIA, monedas de SYMBOLS
//      SIMBOLOS=BTCUSDT,... HUECOS=10 node backtest_tendencia.js
// Revisa el stop con velas de 1h (en vivo se revisa cada minuto). Comisión 0.1% y slippage 0.05% por orden.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config/settings');
const { evaluarTendencia, stopInicial, actualizarStop } = require('./strategy/tendencia');

const SIMBOLOS = process.env.SIMBOLOS ? process.env.SIMBOLOS.split(',') : config.SYMBOLS;
const HUECOS = parseInt(process.env.HUECOS || config.MAX_OPEN_TRADES);
const P = { ...config.TENDENCIA, ...(process.env.PARAMS ? JSON.parse(process.env.PARAMS) : {}) };
const DIR = path.join(__dirname, 'backtest_data', '3y');
const FEE = config.FEE_PCT / 100, SLIP = 0.0005, DIA = 864e5;
const MS = { '1h': 3600000, '4h': 14400000, '1d': 86400000 };

async function descargar(s, iv, desde, hasta) {
  const f = path.join(DIR, `${s}_${iv}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const velas = [];
  for (let start = desde; start < hasta;) {
    let data;
    for (let i = 1; ; i++) {
      try { ({ data } = await axios.get('https://api.binance.com/api/v3/klines', { params: { symbol: s, interval: iv, startTime: start, endTime: hasta, limit: 1000 }, timeout: 30000 })); break; }
      catch (e) { if (i >= 5) throw e; await new Promise(r => setTimeout(r, 3000 * i)); }
    }
    if (!data.length) break;
    velas.push(...data.map(c => [c[0], +c[1], +c[2], +c[3], +c[4], +c[5], c[6]]));
    start = data[data.length - 1][0] + MS[iv];
  }
  fs.mkdirSync(DIR, { recursive: true });
  const cerradas = velas.filter(c => c[6] < hasta);
  fs.writeFileSync(f, JSON.stringify(cerradas));
  return cerradas;
}

// Últimas n velas cerradas antes de t (puntero creciente)
function ventana(velas) {
  let i = 0;
  return (t, n) => { while (i < velas.length && velas[i][6] < t) i++; return velas.slice(Math.max(0, i - n), i); };
}

function simular(s, D, INICIO) {
  const { h1, h4 } = D[s];
  const v1d = ventana(D[s].d1), vBtc1d = ventana(D.BTCUSDT.d1), vBtc4h = ventana(D.BTCUSDT.h4);
  const trades = []; let pos = null, j1 = 0;
  const cerrar = (precio, t, motivo) => {
    const salida = precio * (1 - SLIP);
    trades.push({ s, entrada: pos.t, t, motivo, precio: pos.precio, pct: ((salida * (1 - FEE)) / (pos.precio * (1 + FEE)) - 1) * 100 });
    pos = null;
  };

  for (let i = 100; i < h4.length; i++) {
    const [ab, , , , , , ct] = h4[i]; const t = ct + 1;
    // Stop dentro de la vela de 4h, con velas de 1h (si abre por debajo del stop, se vende a la apertura)
    while (j1 < h1.length && h1[j1][0] < ab) j1++;
    if (pos) {
      for (let k = j1; k < h1.length && h1[k][0] <= ct; k++) {
        if (h1[k][3] <= pos.stop) { cerrar(Math.min(h1[k][1], pos.stop), h1[k][6] + 1, pos.stop > pos.precio ? 'Fin tendencia' : 'Stop-Loss'); break; }
      }
    }
    const velas4h = h4.slice(i - 99, i + 1);
    if (pos) { pos.stop = actualizarStop(pos.stop, velas4h, P); continue; }
    if (t < INICIO) continue;
    const r = evaluarTendencia({ velas4h, velas1d: v1d(t, P.SMA_DIAS), btc4h: vBtc4h(t, 1), btc1d: vBtc1d(t, P.SMA_DIAS) }, P);
    if (!r || !r.entrar) continue;
    const precio = r.cierre * (1 + SLIP);
    pos = { t, precio, stop: stopInicial(precio, r.atr, P) };
  }
  return trades;
}

// Cartera con K huecos: cada operación usa 1/K del capital al entrar; sin hueco libre la señal se ignora
// La peor caída se mide a diario valorando las posiciones abiertas al cierre del día (lo que verías en la cuenta).
function cartera(trades, K, INICIO, D) {
  let caja = 1; const abiertas = [], curva = [[INICIO, 1]], tomadas = [];
  const eventos = [];
  trades.forEach(x => { eventos.push({ t: x.entrada, in: true, x }); eventos.push({ t: x.t, in: false, x }); });
  // Cierres diarios para valorar posiciones abiertas
  const ultimoT = Math.max(...trades.map(x => x.t), INICIO);
  for (let t = INICIO; t <= ultimoT; t += DIA) eventos.push({ t, diario: true });
  eventos.sort((a, b) => a.t - b.t || (a.diario ? 1 : 0) - (b.diario ? 1 : 0) || (a.in ? 1 : -1));
  const cierreDia = {};
  const precioEn = (s, t) => { const d = D[s].d1; let lo = 0, hi = d.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m][6] < t) { r = d[m][4]; lo = m + 1; } else hi = m - 1; } return r; };
  const equity = () => caja + abiertas.reduce((a, p) => a + p.monto, 0);
  let picoMtm = 1, ddMtm = 0;
  for (const e of eventos) {
    if (e.diario) {
      const v = caja + abiertas.reduce((a, p) => { const pr = precioEn(p.x.s, e.t); return a + p.monto * (pr ? pr / p.x.precio : 1); }, 0);
      picoMtm = Math.max(picoMtm, v); ddMtm = Math.max(ddMtm, 1 - v / picoMtm); cierreDia[e.t] = v;
      continue;
    }
    if (!e.in) {
      const i = abiertas.findIndex(p => p.x === e.x); if (i < 0) continue;
      caja += abiertas[i].monto * (1 + e.x.pct / 100); abiertas.splice(i, 1);
    } else if (abiertas.length < K && !abiertas.some(p => p.x.s === e.x.s)) {
      const monto = equity() / K; if (monto > caja + 1e-9) continue;
      caja -= monto; abiertas.push({ x: e.x, monto }); tomadas.push(e.x);
    }
    curva.push([e.t, equity()]);
  }
  let pico = 1, dd = 0; curva.forEach(([, v]) => { pico = Math.max(pico, v); dd = Math.max(dd, 1 - v / pico); });
  const valor = t => { let v = 1; for (const p of curva) { if (p[0] > t) break; v = p[1]; } return v; };
  const anios = [0, 1, 2].map(y => (valor(INICIO + (y + 1) * 365 * DIA) / valor(INICIO + y * 365 * DIA) - 1) * 100);
  const g = tomadas.filter(x => x.pct > 0).reduce((a, x) => a + x.pct, 0), pd = -tomadas.filter(x => x.pct <= 0).reduce((a, x) => a + x.pct, 0);
  return { total: (equity() - 1) * 100, anios, dd: Math.max(dd, ddMtm) * 100, n: tomadas.length, pf: pd ? g / pd : 99, acierto: tomadas.length ? tomadas.filter(x => x.pct > 0).length / tomadas.length * 100 : 0 };
}

(async () => {
  const hasta = Date.now(), desde = hasta - (3 * 365 + 300) * DIA;
  const D = {};
  for (const s of [...new Set(['BTCUSDT', ...SIMBOLOS])]) {
    D[s] = { h1: await descargar(s, '1h', desde, hasta), h4: await descargar(s, '4h', desde, hasta), d1: await descargar(s, '1d', desde, hasta) };
  }
  const FIN = Math.min(...Object.values(D).map(d => d.h4[d.h4.length - 1][6]));
  const INICIO = FIN - 3 * 365 * DIA;
  const trades = SIMBOLOS.flatMap(s => simular(s, D, INICIO));
  const fmt = x => (x >= 0 ? '+' : '') + x.toFixed(0) + '%';

  // Comprar y mantener (mismas monedas, a partes iguales) como referencia
  const bh = [0, 1, 2].map(y => {
    const ini = INICIO + y * 365 * DIA, fin = ini + 365 * DIA;
    const rets = SIMBOLOS.filter(s => D[s].d1[0][0] < ini).map(s => { const d = D[s].d1; return [...d].reverse().find(c => c[6] <= fin)[4] / d.find(c => c[0] >= ini)[1] - 1; });
    return rets.reduce((a, r) => a + r, 0) / rets.length * 100;
  });

  console.log(`Tendencia ${JSON.stringify(P)}`);
  console.log(`${new Date(INICIO).toISOString().slice(0, 10)} → ${new Date(FIN).toISOString().slice(0, 10)} | ${SIMBOLOS.length} monedas\n`);
  console.log(`Comprar y mantener      | por año ${bh.map(fmt).join(' / ')}`);
  for (const K of [...new Set([HUECOS, 5, 10, 20])].sort((a, b) => a - b)) {
    const r = cartera(trades, K, INICIO, D);
    console.log(`${String(K).padStart(2)} huecos${K === HUECOS ? ' (config)' : '         '}| por año ${r.anios.map(fmt).join(' / ').padEnd(20)} | 3 años ${fmt(r.total).padStart(6)} | peor caída -${r.dd.toFixed(0)}% | pf ${r.pf.toFixed(2)} | acierto ${r.acierto.toFixed(0)}% | ops ${r.n}`);
  }
  const porMoneda = {};
  trades.forEach(x => porMoneda[x.s] = (porMoneda[x.s] || 0) + x.pct);
  const orden = Object.entries(porMoneda).sort((a, b) => b[1] - a[1]);
  console.log('\nSuma % por moneda:', orden.map(([s, v]) => `${s.replace('USDT', '')} ${v.toFixed(0)}`).join(', '));
  if (SIMBOLOS.length > 5) {
    const fuera = orden.slice(0, 3).map(o => o[0]);
    const r = cartera(trades.filter(x => !fuera.includes(x.s)), HUECOS, INICIO, D);
    console.log(`Sin las 3 mejores (${fuera.map(s => s.replace('USDT', '')).join(', ')}): por año ${r.anios.map(fmt).join(' / ')} | peor caída -${r.dd.toFixed(0)}%`);
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
