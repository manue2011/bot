require('dotenv').config();
const { getBalance, vender } = require('./services/binanceService');
const config = require('./config/settings');

async function limpiarCuenta() {
    console.log("🧹 Iniciando limpieza de cuenta Testnet...");
    try {
        const balances = await getBalance();
        // Filtramos solo las monedas que tengan saldo (BTC, ETH, SOL)
        const activos = balances.filter(b => (b.asset === 'BTC' || b.asset === 'ETH' || b.asset === 'SOL') && parseFloat(b.free) > 0);

        if (activos.length === 0) {
            console.log("✅ La cuenta ya está limpia. No hay operaciones antiguas.");
            return;
        }

        for (const activo of activos) {
            const symbol = `${activo.asset}USDT`;
            console.log(`- Vendiendo todo el ${activo.asset}...`);
            await vender(symbol, activo.free);
            console.log(`✅ ${activo.asset} vendido con éxito.`);
        }
        console.log("✨ Limpieza completada. Todo tu capital está ahora en USDT.");
    } catch (err) {
        console.error("❌ Error al limpiar:", err.message);
    }
}

limpiarCuenta();