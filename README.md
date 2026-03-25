# 🤖 CryptoBot Ultra 🚀

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Binance](https://img.shields.io/badge/Binance-F3BA2F?style=for-the-badge&logo=binance&logoColor=black)
![Fly.io](https://img.shields.io/badge/Fly.io-243350?style=for-the-badge&logo=flydotio&logoColor=white)
![Status](https://img.shields.io/badge/Status-En%20Desarrollo-orange?style=for-the-badge)

> **Bot de Trading Algorítmico diseñado para cazar tendencias masivas (Momentum) con inteligencia artificial y gestión de riesgo profesional.**
> ⚠️ *Proyecto en desarrollo activo y mejora continua.*

---

## 🧠 El "Cerebrito": Estrategia & Lógica

Este bot utiliza un sistema de **puntuación multivariable** para entrar solo en las mejores oportunidades del mercado:

| Indicador | Función |
| :--- | :--- |
| **RSI & SMA20** | Detecta el momentum y la fuerza del precio. |
| **MACD** | Confirma la dirección de la tendencia (Alcista/Bajista). |
| **Fear & Greed Index** | Mide el sentimiento psicológico del mercado. |
| **IA News Sentiment** | Analiza noticias en tiempo real para evitar trampas. |
| **Bitcoin Macro** | Filtro de seguridad: solo opera si la tendencia de BTC es sana. |

---

## 🛡️ Gestión de Riesgo "Modo Valiente"

A diferencia de los bots convencionales, **CryptoBot Ultra** ha sido optimizado para no tener límites y maximizar los beneficios en grandes rallies:

* **🚀 Sin Techo de Cristal:** Se ha eliminado el filtro de venta por RSI alto. El bot acompaña la tendencia mientras el precio siga subiendo.
* **📈 Trailing Stop Dinámico:** Se activa automáticamente al **+1.5%**. Una vez en marcha, protege la entrada (Break-even +0.5%) y persigue el precio con un margen del **2%**.
* **🚫 Kill Switch Diario:** Protección total. Si se alcanza una pérdida máxima definida, el bot se detiene para salvar el capital.
* **📰 Escudo de Noticias:** Capacidad de venta instantánea si el análisis de sentimiento detecta noticias críticas negativas.

---

## 📊 Notificaciones & Control

* **Telegram:** Alertas instantáneas de compras, ventas y actualizaciones del Trailing Stop.
* **Google Sheets:** Registro detallado de cada operación para auditoría y mejora continua.

---

## 🚀 Instalación y Uso

Si quieres desplegar tu propia instancia del bot, sigue estos pasos:

1. **Clonar el repositorio:**
   ```bash
   git clone [https://github.com/manue2011/bot.git](https://github.com/manue2011/bot.git)
Instalar las dependencias:

Bash
npm install
Configurar variables de entorno:
Crea un archivo .env con tus API Keys de Binance, Telegram y News.

Desplegar en Fly.io:

Bash
fly deploy

🛠️ Estado del Proyecto y Mejoras
Este bot se encuentra en fase de desarrollo activo. Actualmente se trabaja en:

[ ] Optimización de los tiempos de respuesta de la API de noticias.

[ ] Implementación de nuevos filtros basados en volumen.

[ ] Refinamiento del algoritmo de Trailing Stop para reducir el drawdown.

⚠️ Descargo de Responsabilidad
Este proyecto es una herramienta de experimentación y aprendizaje. El trading de criptomonedas conlleva un riesgo real. No inviertas capital que no estés dispuesto a perder.

Creado  por manue2011

