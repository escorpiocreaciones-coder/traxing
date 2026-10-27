# HoraTrade: pares, marcos de tiempo y pronóstico

**Fecha:** 2026-10-27  
**Estado:** implementación solicitada por el usuario

## Intención

Mejorar la HoraTrade existente para seguir siete contratos perpetuos USDT y pronosticar el cierre de la siguiente vela en 1H o 4H. Corregir el diario para que el error porcentual corresponda al par y marco temporal que originó cada pronóstico.

La aplicación seguirá siendo HoraTrade; no se crea una segunda app. La interfaz y el sistema de datos actuales se amplían en el sitio.

## Problema confirmado en el código

`resolvePendingForecasts(hourlyCandles)` indexa velas solo por hora y resuelve todos los registros pendientes sin filtrar símbolo. Al cargar otro par, una vela con la misma hora puede sustituir el cierre real del par pronosticado y crear un error porcentual falso. La misma rutina también compara la confirmación de Bybit con el reloj local, por lo que una diferencia de reloj puede retrasar el resultado.

## Alcance

- Pares: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT y XMRUSDT.
- Marcos seleccionables: 1H (`60`) y 4H (`240`). Cada modo analiza velas cerradas y estima el cierre de la vela que ya está en formación.
- En modo 1H, mostrar la tendencia 4H como confirmación. Una lectura alcista/bajista de 1H solo conserva ese sesgo si coincide con la tendencia 4H cerrada; en desacuerdo se muestra `ESPERAR`. En modo 4H se analiza la tendencia y el pronóstico del marco seleccionado.
- Mostrar en el diario el error absoluto en USDT y el error porcentual absoluto: `abs(real - estimado)` y `abs(real - estimado) / abs(real) * 100`.
- Conservar en localStorage los registros 1H existentes, migrando los registros antiguos al marco `60`.
- Validar dinámicamente cada contrato en Bybit; los contratos no activos muestran `SIN DATOS`.
- Seguir como app local informativa sin credenciales ni órdenes. El alojamiento móvil queda para otra etapa.

## Uso de Freqtrade

Tomar como referencia `freqtrade/strategy/strategy_helper.py::merge_informative_pair`. Freqtrade desplaza la marca temporal de un marco superior hasta que su vela haya cerrado antes de incorporarla al marco menor. HoraTrade aplicará la misma regla con tiempos de cierre explícitos: solo usar una vela 4H confirmada cuyo cierre sea igual o anterior al cierre de la vela 1H analizada. Esto previene el sesgo de futuro; la confirmación no se debe presentar como certeza estadística.

La muestra `freqtrade/templates/sample_strategy.py` usa indicadores de tendencia y momentum, pero el motor de Freqtrade y sus dependencias no están disponibles para ejecutar aquí. Esta mejora reusa el patrón de alineación del código local; no reportará métricas de backtest que no se hayan medido.

## Enfoques

1. **Modo 1H/4H seleccionable, con tendencia 4H como filtro del sesgo 1H (elegido).** Cumple ambos horizontes, aprovecha la alineación de marcos de Freqtrade y evita consumir un dato superior antes de su cierre.
2. **Mostrar dos pronósticos paralelos sin filtro de confluencia.** Menos restrictivo, pero no responde a la petición de mayor confirmación.
3. **Conectar la app con un bot Freqtrade en ejecución.** Agrega instalación, backend y configuración de cuenta; no mejora por sí solo la estimación puntual y no encaja con HoraTrade informativa.

## Límites

El sesgo 4H puede reducir señales contradictorias, pero no demuestra que el pronóstico de precio sea más exacto. La regresión de 12 cierres y la banda ATR continúan siendo heurísticas, no probabilidades ni garantías. El usuario indicó que la publicación en nube se hará después; esta etapa no publica la app.
