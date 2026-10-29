// ============================================================
// server.js — Servidor del juego (v3: energía, dinero y misiones)
// El servidor es el ÚNICO que decide cuánta energía y dinero tenés.
// El navegador solo pide acciones y muestra el resultado.
// ============================================================

const express = require('express');          // servidor web (rutas HTTP).
const http = require('http');                // servidor HTTP base (Socket.IO se engancha acá).
const crypto = require('crypto');            // para hashear contraseñas.
const socketIo = require('socket.io');       // comunicación en tiempo real.
const { MongoClient } = require('mongodb');  // cliente de la base de datos.

const app = express();
const server = http.createServer(app);
// CORS "*" = acepta cualquier página. CAMBIAR más adelante para que sea solo GitHub Pages.
const io = socketIo(server, { cors: { origin: "*" } });

// Ruta de prueba: sirve para verificar qué versión corre en Render.
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v3 energia y misiones'));

// La URL de MongoDB está en las variables de entorno de Render (nunca en el código).
const client = new MongoClient(process.env.MONGODB_URI);
let users, messages; // colecciones de la base, se llenan en start().

// ============================================================
// CONFIGURACIÓN DEL JUEGO (acá ajustás los números)
// ============================================================

const MAX_ENERGY = 100;          // energía máxima.
const ENERGY_REGEN_MS = 10000;   // cada cuántos ms se recupera 1 de energía (10000 = 10 s).

// Lista de misiones disponibles. Para agregar una, copiá una línea y cambiá los datos.
// - energy: energía que cuesta empezarla.
// - durationMs: cuánto tarda en terminar (en milisegundos).
// - reward: dinero que paga al terminar.
const MISSIONS = [
    { id: 'carteras', name: 'Robar carteras',    energy: 5,  durationMs: 10000, reward: 20  },
    { id: 'tienda',   name: 'Asaltar una tienda', energy: 15, durationMs: 30000, reward: 70  },
    { id: 'banco',    name: 'Golpe al banco',     energy: 40, durationMs: 60000, reward: 220 }
];

// ============================================================
// ESTADO EN MEMORIA
// ============================================================

// Jugadores conectados AHORA. Formato:
// { socketId: { key, name, score, lastMsg, money, energy, energyAt, mission } }
// - money: dinero actual.
// - energy: energía al momento "energyAt".
// - energyAt: hora (ms) desde la que se cuenta la recarga.
// - mission: null, o { id, endsAt } si está haciendo una misión (endsAt = hora de fin).
const online = {};
let topCache = []; // top 50 del ranking leído de la base (incluye desconectados).

// ============================================================
// FUNCIONES DE AYUDA
// ============================================================

// Convierte contraseña + salt en un hash ilegible (scrypt es lento a propósito).
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Recarga el top 50 desde MongoDB.
async function refreshTop() {
    try {
        topCache = await users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 })
            .limit(50)
            .toArray();
    } catch (e) { console.error(e); }
}

// Arma el ranking: conectados (puntaje en vivo) + desconectados (guardado en la base).
function buildRanking() {
    const onlineList = Object.values(online);
    const onlineKeys = new Set(onlineList.map(p => p.key));
    const offline = topCache
        .filter(u => !onlineKeys.has(u._id))
        .map(u => ({ name: u.name, score: u.score, online: false }));
    return [
        ...onlineList.map(p => ({ name: p.name, score: p.score, online: true })),
        ...offline
    ].sort((a, b) => b.score - a.score);
}

// Manda el ranking a TODOS los conectados.
function broadcast() {
    io.emit('players', buildRanking());
}

// Guarda en MongoDB TODO el progreso de una lista de jugadores
// (puntaje, dinero, energía y misión), en una sola llamada.
async function saveProgress(list) {
    if (!list.length) return;
    await users.bulkWrite(list.map(p => ({
        updateOne: {
            filter: { _id: p.key },
            update: { $set: {
                score: p.score,
                money: p.money,
                energy: p.energy,
                energyAt: p.energyAt,
                mission: p.mission
            } }
        }
    })));
}

// ------------------------------------------------------------
// ENERGÍA: se calcula según el tiempo pasado, no con un contador.
// Por eso se recarga aunque el jugador esté desconectado.
// ------------------------------------------------------------
function refreshEnergy(p, now) {
    // Si ya está llena, no hay nada que recargar. Dejamos energyAt = ahora
    // para que, cuando gaste energía, la recarga arranque desde ese momento.
    if (p.energy >= MAX_ENERGY) {
        p.energy = MAX_ENERGY;
        p.energyAt = now;
        return;
    }
    // Cuántos "puntos" de energía se recuperaron desde la última actualización.
    const gained = Math.floor((now - p.energyAt) / ENERGY_REGEN_MS);
    if (gained > 0) {
        p.energy = Math.min(MAX_ENERGY, p.energy + gained);
        // Si quedó llena, reiniciamos el reloj. Si no, avanzamos energyAt solo lo
        // que usamos, así no se pierde el tiempo parcial (ej: pasaron 15 s = 1 punto + 5 s sobrantes).
        p.energyAt = p.energy >= MAX_ENERGY ? now : p.energyAt + gained * ENERGY_REGEN_MS;
    }
}

// ------------------------------------------------------------
// MISIÓN: si ya pasó la hora de fin, la completa y paga la recompensa.
// Devuelve la misión completada (para avisarle al jugador) o null si no terminó nada.
// ------------------------------------------------------------
function finishMissionIfDone(p, now) {
    if (!p.mission || now < p.mission.endsAt) return null; // no hay misión o todavía no termina.
    const mission = MISSIONS.find(m => m.id === p.mission.id);
    p.mission = null; // la misión terminó, el jugador queda libre.
    if (!mission) return null; // por si una misión fue borrada de la lista.
    p.money += mission.reward; // pagamos la recompensa.
    return mission;
}

// Arma el "estado personal" que se le manda a UN jugador (solo suyo).
// Mandamos tiempos RESTANTES (no horas absolutas) para que no importe
// si el reloj de su compu está desfasado respecto al del servidor.
function buildState(p, now) {
    const mission = p.mission ? MISSIONS.find(m => m.id === p.mission.id) : null;
    return {
        money: p.money,
        energy: p.energy,
        maxEnergy: MAX_ENERGY,
        // ms que faltan para el próximo punto de energía (0 si está llena).
        nextEnergyMs: p.energy >= MAX_ENERGY ? 0 : Math.max(0, ENERGY_REGEN_MS - (now - p.energyAt)),
        mission: mission ? {
            id: mission.id,
            name: mission.name,
            remainingMs: Math.max(0, p.mission.endsAt - now),
            durationMs: mission.durationMs
        } : null
    };
}

// Envía el estado personal a un jugador puntual (por su socketId).
function sendState(socketId, p, now) {
    io.to(socketId).emit('state', buildState(p, now));
}

// ============================================================
// SOCKET.IO: se ejecuta cada vez que un cliente se conecta
// ============================================================
io.on('connection', (socket) => {
    // Apenas entra (aunque no se haya logueado) ve el ranking.
    socket.emit('players', buildRanking());

    // ---------- LOGIN / REGISTRO ----------
    socket.on('auth', async (data, cb) => {
        try {
            const name = String(data?.name || '').trim().slice(0, 20);
            const password = String(data?.password || '');

            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });

            const key = name.toLowerCase(); // "Juan" y "juan" son el mismo usuario.

            if (Object.values(online).some(p => p.key === key)) {
                return cb({ ok: false, error: 'Ese usuario ya está conectado.' });
            }

            const now = Date.now();
            let user = await users.findOne({ _id: key });

            if (!user) {
                // Usuario nuevo: lo creamos con los valores iniciales del juego.
                const salt = crypto.randomBytes(16).toString('hex');
                user = {
                    _id: key, name, salt, hash: hashPassword(password, salt),
                    score: 0,
                    money: 0,              // arranca sin dinero.
                    energy: MAX_ENERGY,    // arranca con la energía llena.
                    energyAt: now,
                    mission: null          // sin misión en curso.
                };
                await users.insertOne(user);
            } else {
                // Usuario existente: verificamos la contraseña.
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            }

            // Lo ponemos en "online". Los usuarios viejos (creados antes de esta
            // versión) no tienen money/energy: el "??" les pone un valor inicial.
            const player = {
                key, name: user.name, score: user.score, lastMsg: 0,
                money: user.money ?? 0,
                energy: user.energy ?? MAX_ENERGY,
                energyAt: user.energyAt ?? now,
                mission: user.mission ?? null
            };
            online[socket.id] = player;

            // Ponemos al día lo que pasó mientras estaba desconectado:
            refreshEnergy(player, now);                         // energía recuperada.
            const finished = finishMissionIfDone(player, now);  // misión que pudo terminar.

            cb({ ok: true, name: user.name });  // respondemos: login correcto.
            socket.emit('missions', MISSIONS);  // le mandamos la lista de misiones.
            sendState(socket.id, player, now);  // y su estado (dinero, energía, misión).
            if (finished) {
                // Avisamos que una misión terminó mientras no estaba.
                socket.emit('missionDone', { name: finished.name, reward: finished.reward });
                try { await saveProgress([player]); } catch (e) { console.error(e); }
            }
            broadcast(); // actualizamos el ranking de todos.

            // Historial del chat (últimos 50 mensajes).
            const last = await messages.find().sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({
                name: m.name, text: m.text, ts: m.ts
            })));
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- EMPEZAR UNA MISIÓN ----------
    // El cliente manda solo el ID de la misión. TODO se valida acá.
    socket.on('startMission', async (missionId, cb) => {
        // Si el cliente no mandó callback, usamos una función vacía para no romper.
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        // Buscamos la misión en NUESTRA lista (el cliente no puede inventar una).
        const mission = MISSIONS.find(m => m.id === missionId);
        if (!mission) return reply({ ok: false, error: 'Esa misión no existe.' });

        const now = Date.now();
        refreshEnergy(p, now); // primero actualizamos la energía real.

        if (p.mission) return reply({ ok: false, error: 'Ya estás haciendo una misión.' });
        if (p.energy < mission.energy) {
            return reply({ ok: false, error: 'No tenés suficiente energía.' });
        }

        // Todo OK: gastamos la energía y arrancamos la misión.
        // (No hay "await" antes de esto, así que no se puede empezar dos veces a la vez.)
        p.energy -= mission.energy;
        p.mission = { id: mission.id, endsAt: now + mission.durationMs };

        sendState(socket.id, p, now); // el jugador ve el cambio al instante.
        reply({ ok: true });

        // Guardamos ya mismo para no perder la misión si el servidor se reinicia.
        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- CHAT ----------
    socket.on('chat', async (text) => {
        const p = online[socket.id];
        if (!p) return; // solo escriben los logueados.

        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return;

        const now = Date.now();
        if (now - p.lastMsg < 700) return; // anti-spam.
        p.lastMsg = now;

        const msg = { name: p.name, text: clean, ts: now };
        io.emit('chat', msg);
        try { await messages.insertOne({ ...msg }); } catch (e) { console.error(e); }
    });

    // ---------- DESCONEXIÓN ----------
    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        if (p) {
            // Guardamos todo el progreso (la misión queda guardada con su hora de fin).
            try { await saveProgress([p]); } catch (e) { console.error(e); }
            await refreshTop();
        }
        broadcast();
    });
});

// ============================================================
// TICK DEL JUEGO: se ejecuta cada 1 segundo
// ============================================================
let ticks = 0;
setInterval(async () => {
    const now = Date.now();
    // Object.entries nos da pares [socketId, jugador] (necesitamos el socketId para escribirle a cada uno).
    const entries = Object.entries(online);

    entries.forEach(([id, p]) => {
        p.score++;                  // +1 punto por segundo (ranking de tiempo jugado).
        refreshEnergy(p, now);      // recarga de energía.

        // ¿Terminó su misión? Si sí, ya se pagó el dinero: avisamos y guardamos.
        const finished = finishMissionIfDone(p, now);
        if (finished) {
            io.to(id).emit('missionDone', { name: finished.name, reward: finished.reward });
            saveProgress([p]).catch(console.error);
        }

        sendState(id, p, now);      // le mandamos su estado actualizado.
    });

    broadcast(); // ranking para todos.

    ticks++;
    // Cada 10 segundos guardamos a todos y refrescamos el top.
    if (ticks % 10 === 0) {
        try { await saveProgress(entries.map(([, p]) => p)); } catch (e) { console.error(e); }
        await refreshTop();
    }
}, 1000);

// ============================================================
// ARRANQUE
// ============================================================
async function start() {
    await client.connect();                 // conecta a MongoDB.
    const db = client.db('juego');
    users = db.collection('users');         // usuarios, puntaje, dinero, energía, misión.
    messages = db.collection('messages');   // historial del chat.
    await refreshTop();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();
