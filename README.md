# GangsterCity — mapa del proyecto

El juego tiene dos partes que se publican por separado:

- **Navegador** (GitHub Pages): `index.html`, `css/`, `js/`, `img/`
- **Servidor** (Render): `server.js` y la carpeta `server/`

## Navegador

`index.html` carga los archivos **en orden**. Cada archivo de `js/` puede usar lo que está arriba de él.

| Archivo | Para qué sirve |
|---|---|
| `js/core.js` | Conexión con el servidor y variables compartidas |
| `js/utils.js` | Funciones de ayuda (botón de dos toques, tiempos, iconos, animaciones) |
| `js/profile.js` | Recuadro del personaje y "Editar perfil" |
| `js/session.js` | Iniciar sesión y reconectar |
| `js/nav.js` | Menú entre secciones |
| `js/rankings.js` | Rankings (actividad, clanes, fama) |
| `js/stats.js` | Estadísticas y reinicio |
| `js/inventory.js` | Mochila y maletín (arrastrar y soltar) |
| `js/shop.js` | Tienda |
| `js/missions.js` | Misiones y bolsa de dinero |
| `js/fx.js` | Animaciones de combate (pistola, granada, golpes) |
| `js/war.js` | Guerra 1 contra 1 |
| `js/notifications.js` | Campanita |
| `js/chat.js` | Chat global |
| `js/clan.js` | Clan: miembros, rangos, reglas, chat del clan |
| `js/clanwar.js` | Guerra de clanes: elegir rival, historial, aviso |
| `js/replay.js` | Repetición de la guerra de clanes |
| `js/main.js` | Arranque (**siempre el último**) |

Los estilos están en `css/`, un archivo por tema (`base.css` primero).
Las imágenes de objetos van en `img/items/` (`pistola.png`, `granada.png`, `chocolate.png`).

## Servidor

| Archivo | Para qué sirve |
|---|---|
| `server.js` | Punto de entrada (Render ejecuta este con `npm start`) |
| `server/config.js` | **Todos los números del juego** (precios, tiempos, premios, misiones, objetos) |
| `server/core.js` | Servidor web y Socket.IO |
| `server/state.js` | Datos compartidos: base de datos, jugadores conectados, rankings |
| `server/utils.js` | Contraseñas, nombres, tiempos, niveles |
| `server/items.js` | Mochila, maletín y objetos que caen en misiones |
| `server/players.js` | El jugador en memoria: crear, guardar, estado |
| `server/shop.js` | Tienda |
| `server/combat.js` | Reglas del combate |
| `server/war.js` | Guerra 1 contra 1 (rival, premios, cooldowns) |
| `server/clans.js` | Ayudas de rangos y permisos |
| `server/clanwar.js` | Guerra de clanes |
| `server/notify.js` | Notificaciones |
| `server/rankings.js` | Rankings |
| `server/tick.js` | Reloj del juego (cada segundo) |
| `server/socket.js` | Qué pasa al conectarse un jugador |
| `server/start.js` | Arranque: base de datos, índices, escuchar |
| `server/events/*.js` | Lo que el navegador puede pedir, agrupado por tema |

## Cómo agregar cosas

- **Cambiar un precio, tiempo o premio:** `server/config.js`.
- **Nuevo objeto:** agregarlo a `ITEMS` en `server/config.js` (y a `SHOP_ITEMS` si se vende).
- **Nueva misión:** agregarla a `MISSIONS` en `server/config.js`.
- **Nueva función con su propia pantalla:** un archivo en `server/events/` + un archivo en `js/`
  (agregarlo en `server/socket.js` y en `index.html`, antes de `js/main.js`).
