// ============================================================
// js/core.js — La conexión con el servidor y las variables que usan todos los archivos
// (Los archivos js/ se cargan en el orden que figura en index.html y comparten estas variables.)
// ============================================================

// Conectamos al servidor que está en Render.
// "autoConnect: false" = todavía NO se conecta: lo hace js/main.js al final, cuando ya están
// listos todos los "oyentes" de los demás archivos (así no se pierde ningún mensaje del servidor).
const socket = io('https://gangstercity.onrender.com', { autoConnect: false });

// Usuario y contraseña, SOLO en memoria, para reconectar solos si se corta internet.
let credentials = null;
let myName = null;          // nombre del jugador logueado.
let lastState = null;       // último estado personal que mandó el servidor (dinero, energía, nivel...).
let gameConfig = null;      // configuración del juego que manda el servidor.
let statsConfig = [];       // lista de estadísticas (id, nombre, icono).
let itemsCatalog = {};      // catálogo de objetos (id → { name, emoji, img, w, h... }).
let chatTtlMs = 30 * 60 * 1000; // cuánto dura un mensaje del chat global.
