const express = require('express');
const http = require('http');
const crypto = require('crypto');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v2 ranking global'));
const client = new MongoClient(process.env.MONGODB_URI);
let users, messages;

const online = {};   // { socketId: { key, name, score, lastMsg } }
let topCache = [];   // top 50 guardado en la base (incluye desconectados)

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// recarga el top 50 desde la base
async function refreshTop() {
    try {
        topCache = await users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 })
            .limit(50)
            .toArray();
    } catch (e) { console.error(e); }
}

// arma el ranking: conectados (puntaje en vivo) + desconectados (de la base)
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

function broadcast() {
    io.emit('players', buildRanking());
}

async function saveScores(list) {
    if (!list.length) return;
    await users.bulkWrite(list.map(p => ({
        updateOne: { filter: { _id: p.key }, update: { $set: { score: p.score } } }
    })));
}

io.on('connection', (socket) => {
    // el ranking se ve apenas entrás, incluso antes de iniciar sesión
    socket.emit('players', buildRanking());

    socket.on('auth', async (data, cb) => {
        try {
            const name = String(data?.name || '').trim().slice(0, 20);
            const password = String(data?.password || '');

            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });

            const key = name.toLowerCase();

            if (Object.values(online).some(p => p.key === key)) {
                return cb({ ok: false, error: 'Ese usuario ya está conectado.' });
            }

            let user = await users.findOne({ _id: key });

            if (!user) {
                const salt = crypto.randomBytes(16).toString('hex');
                user = { _id: key, name, salt, hash: hashPassword(password, salt), score: 0 };
                await users.insertOne(user);
            } else {
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            }

            online[socket.id] = { key, name: user.name, score: user.score, lastMsg: 0 };
            cb({ ok: true, name: user.name });
            broadcast();

            const last = await messages.find().sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({
                name: m.name, text: m.text, ts: m.ts
            })));
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    socket.on('chat', async (text) => {
        const p = online[socket.id];
        if (!p) return;

        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return;

        const now = Date.now();
        if (now - p.lastMsg < 700) return;
        p.lastMsg = now;

        const msg = { name: p.name, text: clean, ts: now };
        io.emit('chat', msg);
        try { await messages.insertOne({ ...msg }); } catch (e) { console.error(e); }
    });

    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        if (p) {
            try { await saveScores([p]); } catch (e) { console.error(e); }
            await refreshTop();   // para que quede con su puntaje final
        }
        broadcast();
    });
});

// +1 punto por segundo a cada conectado; guarda y refresca el top cada 10 s
let ticks = 0;
setInterval(async () => {
    const list = Object.values(online);
    list.forEach(p => p.score++);
    broadcast();

    ticks++;
    if (ticks % 10 === 0) {
        try { await saveScores(list); } catch (e) { console.error(e); }
        await refreshTop();
    }
}, 1000);

async function start() {
    await client.connect();
    const db = client.db('juego');
    users = db.collection('users');
    messages = db.collection('messages');
    await refreshTop();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();