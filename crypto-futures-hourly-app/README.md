# HoraTrade

Microapp en español para observar contratos perpetuos cripto liquidados en USDT mediante velas de 1 h y 4 h.

## Ejecutar localmente

Requiere Node.js y un navegador moderno. No hay dependencias externas que instalar.

```powershell
cd C:\Users\sergio\Desktop\crypto-futures-hourly-app
node server.mjs
```

Abre `http://127.0.0.1:4173` en el navegador. El servidor escucha solo en el equipo local.

## Qué muestra

- BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT y XMRUSDT de Bybit, cuando cada contrato lineal USDT está activo.
- Selector de velas de 1 h o 4 h; tendencia EMA 20/50, RSI 14, MACD 12/26/9, ATR 14 y volumen relativo del marco seleccionado.
- En modo 1 h, la tendencia 4 h cerrada confirma el sesgo; si no coincide, la app muestra `ESPERAR`.
- Si el flujo se reconecta, recupera el historial; también sincroniza velas cada 60 segundos y espera la confirmación de suscripción antes de indicar que el WebSocket está conectado.
- `ALCISTA`, `BAJISTA` o `ESPERAR` a partir de reglas técnicas visibles.
- Precio base (apertura de la vela en curso), cierre aproximado de la próxima vela 1 h/4 h y rango orientativo basado en ATR.
- Registro local por par y marco: compara cada cierre estimado con el cierre real, mostrando error absoluto en USDT y porcentaje.

## Límites

- La app lee datos públicos de mercado de Bybit. Si Bybit no responde, el contrato no está disponible o faltan velas, la señal se pausa.
- No pide API keys, no lee una cuenta y no coloca órdenes reales ni demo.
- El cierre estimado es una proyección técnica basada en la pendiente de 12 cierres, limitada por ATR; no predice con certeza el mercado ni promete rendimiento.
- La banda de ±ATR es orientativa, no un intervalo de probabilidad calibrado.
- El error porcentual absoluto se calcula como `abs(cierre real - estimado) / abs(cierre real) × 100`. Pronósticos guardados por versiones anteriores se vuelven a comprobar con velas del mismo par antes de mostrar resultados.
- La confirmación 4 h usa solo velas ya cerradas y sigue el alineamiento temporal de `merge_informative_pair` de Freqtrade para evitar usar información futura. Esto no demuestra que el pronóstico sea más preciso.
- El diario de pronósticos se guarda en localStorage del navegador de este equipo. La app calcula el cierre estimado para la próxima vela del marco seleccionado; al finalizarla compara la estimación con el cierre observado. Al volver, recupera resultados pendientes del historial de velas.
- Las reglas iniciales son una hipótesis para medir. El historial observado no demuestra rentabilidad futura.

## Alojamiento opcional

La app es estática y puede publicarse más adelante en una opción de hosting del catálogo free-for-dev, como Cloudflare Pages. El diario seguirá siendo local a cada navegador. La publicación para descargarla en el móvil queda para una etapa posterior.
