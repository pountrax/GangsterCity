// ============================================================
// core.js — Crea el servidor web y la conexión en tiempo real (Socket.IO)
// Lo usan los demás archivos para mandar mensajes a los jugadores ("io").
// ============================================================

const express = require('express');      // servidor web (rutas HTTP).
const http = require('http');            // servidor HTTP base (Socket.IO se engancha acá).
const socketIo = require('socket.io');   // comunicación en tiempo real.

const app = express();
const server = http.createServer(app);
// CORS "*" = acepta cualquier página. CAMBIAR más adelante para que sea solo GitHub Pages.
const io = socketIo(server, { cors: { origin: "*" } });

// Ruta de prueba: sirve para verificar qué versión corre en Render.
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v10 codigo dividido en modulos'));

module.exports = { app, server, io };
