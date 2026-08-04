const axios = require('axios');
const url = "https://script.google.com/macros/s/AKfycbx-Enj-nl9WOzTmV60jjllg7BZqFo7RgpFwSy5ofyhKM04TTzgV2IhgWv5Rwi4qFMI/exec";

axios.post(url, {
  symbol: "BTC-TEST-IA",
  signal: "Momentum",      // Columna C
  notaIA: 8.5,             // Columna D
  estadoMacro: "BTC_UP",   // Columna E
  type: "VENTA",           // Columna F
  price: 71500.50,         // Columna G
  amount: 0.002,           // Columna H
  profit: 1.25,            // Columna I
  profitPct: 1.8,          // Columna J
  reason: "TEST-MANUAL-IA" // Columna K
}).then(res => {
    console.log("✅ Respuesta de Google:", res.data);
    console.log("🚀 ¡Corre a mirar tu Excel! Debería haber una fila nueva completa.");
})
  .catch(err => console.log("❌ Error:", err.message));