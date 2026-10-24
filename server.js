const express = require('express');
const http = require('http');
const crypto = require('crypto');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('Servidor funcionando 🎉'));

const client = new MongoClient(process.env.MONGODB_URI);
let users;

const online = {}; // { socketId: { key, name, score } }

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function broadcast() {
    io.emit('players', Object.values(online).map(p => ({ name: p.name, score: p.score })));
}

async function saveScores(list) {
    if (!list.length) return;
    await users.bulkWrite(list.map(p => ({
        updateOne: { filter: { _id: p.key }, update: { $set: { score: p.score } } }
    })));
}

io.on('connection', (socket) => {
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

            online[socket.id] = { key, name: user.name, score: user.score };
            cb({ ok: true, name: user.name });
            broadcast();
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        broadcast();
        if (p) {
            try { await saveScores([p]); } catch (e) { console.error(e); }
        }
    });
});

// +1 punto por segundo a cada conectado; guarda en la base cada 10 segundos
let ticks = 0;
setInterval(async () => {
    const list = Object.values(online);
    list.forEach(p => p.score++);
    broadcast();

    ticks++;
    if (ticks % 10 === 0) {
        try { await saveScores(list); } catch (e) { console.error(e); }
    }
}, 1000);

async function start() {
    await client.connect();
    users = client.db('juego').collection('users');
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();