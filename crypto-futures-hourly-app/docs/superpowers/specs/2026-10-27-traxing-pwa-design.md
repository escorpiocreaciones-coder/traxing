# TRAXING para Android mediante GitHub Pages

**Fecha:** 2026-10-27  
**Estado:** propuesta de diseño pendiente de aprobación

## Intención

Convertir la HoraTrade existente en **TRAXING**, una PWA instalable en Android y alojada como sitio estático en GitHub Pages. La app seguirá leyendo velas públicas de Bybit y guardando el diario localmente en cada navegador.

## Estado actual

- La app es HTML, CSS y módulos JavaScript estáticos; `server.mjs` solo sirve desarrollo local en `127.0.0.1`.
- No existe manifiesto PWA, icono de instalación ni service worker.
- `index.html` carga recursos con rutas desde `/`, que fallan al usar una GitHub Pages project site bajo `/traxing/`.
- Los precios dependen de internet para REST y WebSocket públicos de Bybit.
- El diario usa `localStorage` bajo el origen del navegador. `localhost` y `github.io` tienen almacenamiento separado.
- La carpeta del proyecto todavía no tiene repositorio Git y Git no está disponible en PATH. El acceso de GitHub no está vinculado en esta sesión.

## Objetivos

- Presentar nombre, título, metadatos e icono de instalación como **TRAXING**.
- Permitir instalación desde Chrome en Android como PWA independiente, sin desarrollar un cliente Android nativo.
- Publicar los archivos estáticos en GitHub Pages mediante GitHub Actions, sin paso de compilación.
- Hacer que estilos, módulos, manifiesto, iconos y service worker funcionen bajo la ruta `/<repositorio>/`.
- Permitir que el shell y el diario ya guardado localmente se abran desde caché cuando no haya red; mostrar el mercado pausado y suspender proyecciones/resoluciones hasta recuperar conexión.
- Conservar el modo local de desarrollo mediante `node server.mjs`.

## No objetivos

- Crear APK/AAB, integrar Capacitor/TWA o publicar en Play Store.
- Añadir un backend, iniciar sesión, sincronizar el diario entre dispositivos o enviar órdenes.
- Prometer precios en vivo sin conexión.
- Migrar automáticamente el diario que existe bajo `localhost`; no se comparte entre orígenes. El historial actual seguirá en el navegador local y el origen GitHub empezará su propio diario.

## Enfoques

1. **PWA estática en GitHub Pages (elegido por el usuario).** Ajustar los recursos a rutas relativas, añadir manifiesto/iconos/service worker y publicar la raíz del repositorio con Actions. Es la ruta directa para instalar la web en Android y mantiene la arquitectura actual.
2. **Capacitor con APK/AAB.** Reutiliza la interfaz web dentro de un proyecto Android Studio, pero agrega SDK, firma y mantenimiento de un paquete nativo. No hace falta para la elección actual de PWA.

## Decisiones de implementación

- Usar `TRAXING` en el título, encabezado, manifiesto, accesibilidad y documentación de producto.
- Proponer el repositorio `traxing` y la URL de Pages `https://<usuario>.github.io/traxing/`; el usuario tendrá que confirmar el nombre final después de conectar su cuenta.
- Usar rutas relativas y `start_url`/`scope` compatibles con una project site; las llamadas a Bybit seguirán apuntando a su API HTTPS y WebSocket públicos.
- El service worker manejará solo los archivos estáticos de la app. No interceptará ni almacenará datos de mercado/API. Sin conexión se podrá consultar el diario local, pero no actualizar precios, emitir nuevas proyecciones ni resolver cierres.
- Mantener `localStorage` como diario por navegador. Los registros no se sincronizan ni se copian desde `localhost` en esta etapa.
- No incluir credenciales: la app usa mercados públicos y no opera cuentas.

## Publicación y privacidad

GitHub Pages sirve el sitio públicamente. En cuentas GitHub Free, Pages requiere un repositorio público; con planes compatibles se puede usar un repositorio privado, pero el sitio sigue siendo público salvo que se configure control de acceso. Por tanto, el código y la web deben tratarse como públicos. No se subirá el proyecto ni se activará Pages hasta que el usuario revise el resultado y apruebe la publicación.

## Aprobación y acceso pendientes

- El usuario eligió PWA y GitHub; falta aprobar este diseño antes de tocar la implementación.
- El nombre tentativo del repositorio es `traxing`; puede corregirse antes de publicarlo.
- Para publicar desde esta sesión, el usuario tendrá que autorizar el acceso a GitHub o completar el envío manualmente.
- La instalación en Android se hará al abrir la URL HTTPS publicada en Chrome y elegir **Instalar app** o **Añadir a pantalla de inicio**.
