// ============================================================
// server.js — Servidor del juego
// Qué hace este archivo, en una frase:
// Es el "cerebro" del juego. Recibe conexiones de jugadores, valida
// usuarios contra la base de datos, suma 1 punto por segundo a cada
// uno, y reparte el ranking y el chat en tiempo real a todos.
// ============================================================

// express: librería para crear un servidor web (rutas HTTP tipo GET /).
const express = require('express');
// http: módulo nativo de Node para crear el servidor HTTP "de base".
// Lo necesitamos aparte porque Socket.IO se "engancha" a ese servidor.
const http = require('http');
// crypto: módulo nativo de Node para criptografía (hashear contraseñas, etc.).
const crypto = require('crypto');
// socketIo: librería para comunicación bidireccional en tiempo real
// (el servidor puede mandar mensajes al cliente sin que este los pida).
const socketIo = require('socket.io');
// MongoClient: cliente oficial para conectarse a una base de datos MongoDB.
const { MongoClient } = require('mongodb');
// Creamos la "app" de Express: acá se definen las rutas HTTP normales.
const app = express();
// Creamos el servidor HTTP "real" (el que escucha el puerto) usando la app.
const server = http.createServer(app);
// Enganchamos Socket.IO a ese servidor. El "cors: { origin: '*' }" permite
// que CUALQUIER página web (como tu GitHub Pages) se conecte al socket. CAMBIAR PARA QUE SOLO SEA DESDE GITHUB PAGES
const io = socketIo(server, { cors: { origin: "*" } });
// Ruta HTTP simple: si alguien entra a la URL raíz "/", devuelve este texto.
// Sirve para verificar que el servidor está vivo (health check).
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v2 ranking global'));
// Creamos el cliente de MongoDB usando la URL secreta que está en la variable
// de entorno MONGODB_URI (configurada en Render, NO en el código). 
const client = new MongoClient(process.env.MONGODB_URI);
// Variables globales que se llenan en start(): colecciones de la base.
let users, messages;
// "online" guarda a los jugadores conectados AHORA MISMO, en memoria.
// Formato: { socketId: { key, name, score, lastMsg } }
// - socketId: identificador único de cada conexión (lo da Socket.IO).
// - key: nombre en minúsculas (sirve como ID del usuario en la base).
// - name: nombre tal cual lo escribió el usuario.
// - score: puntaje en vivo (se guarda a la base cada 10s).
// - lastMsg: timestamp del último mensaje (para el anti-spam del chat).
const online = {};   // { socketId: { key, name, score, lastMsg } }
// "topCache" guarda los 50 mejores puntajes LEÍDOS de la base.
// Incluye jugadores desconectados, así el ranking muestra a todos.
let topCache = [];  
// Función que convierte una contraseña + salt en un "hash" (texto ilegible).
// Usamos scrypt, que es lento a propósito: así un atacante no puede probar
// millones de contraseñas por segundo. Devuelve el hash en hexadecimal.
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Recarga el top 50 desde MongoDB a la variable topCache.
// "projection" significa "traeme solo estos campos" (name y score).
// "sort({ score: -1 })" ordena de mayor a menor.
// "limit(50)" trae solo los 50 primeros.
async function refreshTop() {
    try {
        topCache = await users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 })
            .limit(50)
            .toArray();
    } catch (e) { console.error(e); }
}

// Arma la lista del ranking combinando:
// 1) jugadores conectados (con su puntaje EN VIVO, que sube cada segundo).
// 2) jugadores desconectados (con el puntaje guardado en la base).
function buildRanking() {
        // Object.values(online) convierte el objeto {id: {...}} en un array de jugadores.
    const onlineList = Object.values(online);
    // Creamos un Set con las "key" (nombres en minúscula) de los conectados.
    // Un Set es como un array pero sin duplicados y muy rápido para buscar.
    const onlineKeys = new Set(onlineList.map(p => p.key));
    // Filtramos topCache para quedarnos SOLO con los que NO están online.
    // (Si están online, ya los mostramos con su puntaje en vivo.)
    const offline = topCache
        .filter(u => !onlineKeys.has(u._id))
        .map(u => ({ name: u.name, score: u.score, online: false }));
    // Unimos online + offline y ordenamos de mayor a menor puntaje.
    return [
        ...onlineList.map(p => ({ name: p.name, score: p.score, online: true })),
        ...offline
    ].sort((a, b) => b.score - a.score);
}
// Función que envía el ranking actualizado a TODOS los clientes conectados.
// "io.emit" = broadcast: manda el evento "players" a todos.
function broadcast() {
    io.emit('players', buildRanking());
}
// Guarda en MongoDB los puntajes de una lista de jugadores.
// Usa "bulkWrite" = hacer muchas actualizaciones en una sola llamada
// (mucho más eficiente que hacer 50 updates separados).
async function saveScores(list) {
    if (!list.length) return; // si la lista está vacía, no hacemos nada
    await users.bulkWrite(list.map(p => ({
        // updateOne: busca por _id y actualiza el campo score.
        updateOne: { filter: { _id: p.key }, update: { $set: { score: p.score } } }
    })));
}
// ============================================================
// ACÁ EMPIEZA LA LÓGICA DE SOCKET.IO (tiempo real)
// "io.on('connection')" se dispara CADA VEZ que un cliente se conecta.
// ============================================================
io.on('connection', (socket) => {
    // Apenas se conecta (incluso antes de loguearse), le mandamos el ranking
    // para que vea la tabla aunque todavía no haya entrado.
    socket.emit('players', buildRanking());
    // Evento "auth": el cliente lo emite cuando aprieta "Entrar".
    // Recibe "data" (nombre y contraseña) y "cb" (callback para responder).
    socket.on('auth', async (data, cb) => {
        try {
             // Sanitizamos el nombre: lo convertimos a string, sacamos espacios
            // de los costados y lo cortamos a 20 caracteres máximo.
            const name = String(data?.name || '').trim().slice(0, 20);
            // Convertimos la contraseña a string (sin cortar)
            const password = String(data?.password || '');
            // Validaciones básicas: nombre >= 3 letras, contraseña >= 4.
            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });
            // La "key" es el nombre en minúsculas: así "Juan" y "juan" son el mismo.
            const key = name.toLowerCase();
            // Verificamos que ese usuario no esté ya conectado desde otro lado.
            if (Object.values(online).some(p => p.key === key)) {
                return cb({ ok: false, error: 'Ese usuario ya está conectado.' });
            }
            
            // Buscamos el usuario en MongoDB por su _id (= key).
            let user = await users.findOne({ _id: key });

            // Si no existe, lo creamos (registro automático)
            if (!user) {
                // Generamos un "salt" aleatorio: texto único por usuario que se
                // mezcla con la contraseña antes de hashear (evita que dos
                // usuarios con la misma contraseña tengan el mismo hash).
                const salt = crypto.randomBytes(16).toString('hex');
                user = { _id: key, name, salt, hash: hashPassword(password, salt), score: 0 };
                await users.insertOne(user);
            } else {
                // Si existe, verificamos la contraseña.
                // Comparamos el hash guardado con el hash de la contraseña ingresada.
                // timingSafeEqual evita "timing attacks" (que midan cuánto tarda
                // la comparación para adivinar la contraseña).
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            }
            // Login OK: agregamos al jugador al objeto "online" con su socketId.
            // El puntaje arranca desde el que tenía guardado en la base.
            online[socket.id] = { key, name: user.name, score: user.score, lastMsg: 0 };
            // Respondemos al cliente: login exitoso + nombre confirmado.
            cb({ ok: true, name: user.name });
            // Avisamos a todos que hay un jugador nuevo en el ranking.
            broadcast();
             // Le mandamos los últimos 50 mensajes del chat (historial).
            // "sort({ ts: -1 })" trae los más nuevos primero.
            // "reverse()" los da vuelta para mostrarlos en orden cronológico.
            const last = await messages.find().sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({
                name: m.name, text: m.text, ts: m.ts
            })));
        } catch (err) {
            // Si algo falla (Mongo caído, etc.), mostramos el error y avisamos al cliente.
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });
    // Evento "chat": el cliente manda un mensaje de texto.
    socket.on('chat', async (text) => {
            // Buscamos al jugador en "online" usando su socketId.
        // Si no existe (no está logueado), ignoramos el mensaje.
        const p = online[socket.id];
        if (!p) return;
        // Limpiamos el texto: string, sin espacios al borde, máx 200 caracteres.
        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return; // si quedó vacío, no hacemos nada.
        // Anti-spam: si pasaron menos de 700ms desde su último mensaje, lo ignoramos.
        const now = Date.now();
        if (now - p.lastMsg < 700) return;
        p.lastMsg = now;
        // Armamos el mensaje con nombre, texto y timestamp.
        const msg = { name: p.name, text: clean, ts: now };
        // Lo mandamos a todos los conectados en tiempo real.
        io.emit('chat', msg);
        // Y lo guardamos en MongoDB para que persista el historial.
        try { await messages.insertOne({ ...msg }); } catch (e) { console.error(e); }
    });

    // Evento "disconnect": se dispara cuando el jugador cierra la pestaña,
    // pierde internet, o el servidor lo desconecta.
    socket.on('disconnect', async () => {
        const p = online[socket.id]; // guardamos sus datos antes de borrarlo.
        delete online[socket.id];  // lo sacamos de la lista de conectados.
        if (p) {
            // Guardamos su puntaje final en MongoDB.
            try { await saveScores([p]); } catch (e) { console.error(e); }
            // Recargamos el top para que aparezca como "desconectado" con su puntaje final.
            await refreshTop();   // para que quede con su puntaje final
        }
        // Actualizamos el ranking para todos (ya no aparece como online).
        broadcast();
    });
});

// ============================================================
// TICK DEL JUEGO: cada 1 segundo suma 1 punto a cada conectado.
// ============================================================
let ticks = 0; // contador de ticks (para saber cuándo guardar cada 10s)
setInterval(async () => {
    const list = Object.values(online);
    // Sumamos 1 punto a cada jugador conectado.
    list.forEach(p => p.score++); 
    // Mandamos el ranking actualizado a todos (puntajes en vivo).
    broadcast();
    
    ticks++;
    // Cada 10 ticks (= cada 10 segundos) guardamos en la base y recargamos el top.
    if (ticks % 10 === 0) {
        try { await saveScores(list); } catch (e) { console.error(e); }
        await refreshTop();
    }
}, 1000); // 1000 milisegundos = 1 segundo.

async function start() {
    // Nos conectamos a MongoDB usando la URI secreta.
    await client.connect();
    // Elegimos la base de datos llamada "juego".
    const db = client.db('juego');
    // Obtenemos las dos colecciones (como "tablas" en SQL):
    users = db.collection('users');    // guarda usuarios y puntajes.
    messages = db.collection('messages'); // guarda el historial del chat
    // Cargamos el top 50 inicial a memoria.
    await refreshTop();
    // Ponemos el servidor a escuchar. process.env.PORT lo da Render
    // automáticamente (si no, usa 3000 para desarrollo local).
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
// Ejecutamos la función de arranque.
start();
