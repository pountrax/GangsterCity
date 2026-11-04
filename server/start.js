// ============================================================
// start.js — Arranque del servidor
// Conecta a MongoDB, prepara los índices y migraciones, retoma las guerras de clanes
// que estaban en cuenta regresiva y pone el servidor a escuchar.
// ============================================================

const { MongoClient } = require('mongodb');
const { server } = require('./core');
const { db } = require('./state');
const {
    CHAT_TTL_SECONDS, CLAN_CHAT_TTL_SECONDS, NOTIF_TTL_SECONDS, CLAN_WAR_TTL_SECONDS
} = require('./config');
const { refreshTop } = require('./rankings');
const { scheduleClanWar } = require('./clanwar');
const { startTick } = require('./tick');
require('./socket'); // activa io.on('connection') con todos los eventos.

// Ejecuta una tarea de preparación; si falla, lo muestra pero no frena el servidor.
async function safely(label, fn) {
    try { await fn(); } catch (e) { console.error('Error en ' + label + ':', e); }
}

async function start() {
    // La URL de MongoDB está en las variables de entorno de Render (nunca en el código).
    if (!process.env.MONGODB_URI) {
        console.error('Falta la variable de entorno MONGODB_URI (en Render: Environment).');
        process.exit(1);
    }
    db.client = new MongoClient(process.env.MONGODB_URI);
    await db.client.connect();

    const base = db.client.db('juego');
    db.users = base.collection('users');
    db.messages = base.collection('messages');
    db.clans = base.collection('clans');
    db.clanMessages = base.collection('clanMessages');
    db.notifications = base.collection('notifications');
    db.clanWars = base.collection('clanWars');

    await safely('chat global', async () => {
        await db.messages.updateMany({ createdAt: { $exists: false } }, [{ $set: { createdAt: { $toDate: '$ts' } } }]);
        await db.messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CHAT_TTL_SECONDS });
    });
    await safely('chat de clan', async () => {
        await db.clanMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_CHAT_TTL_SECONDS });
        await db.clanMessages.createIndex({ clanId: 1, ts: -1 });
    });
    await safely('notificaciones', async () => {
        await db.notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: NOTIF_TTL_SECONDS });
        await db.notifications.createIndex({ userId: 1, createdAt: -1 });
    });

    // Nombres cambiables: a los usuarios y clanes viejos les agregamos "nameKey" (su nombre en minúsculas).
    await safely('migración de usuarios', async () => {
        await db.users.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        await db.users.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('migración de clanes', async () => {
        await db.clans.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        await db.clans.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('índice de clanId', () => db.users.createIndex({ clanId: 1 }));

    // Guerras de clanes: índices, limpieza de las que quedaron a medias y reprogramación de las que
    // estaban en cuenta regresiva cuando el servidor se reinició.
    await safely('guerras de clanes', async () => {
        await db.clanWars.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_WAR_TTL_SECONDS });
        await db.clanWars.createIndex({ attackerId: 1, createdAt: -1 });
        await db.clanWars.createIndex({ defenderId: 1, createdAt: -1 });
        await db.clanWars.updateMany({ status: 'running' }, { $set: { status: 'failed' } });
        const pending = await db.clanWars.find({ status: 'prep' }).toArray();
        pending.forEach(w => scheduleClanWar(w._id, w.startAt));
    });

    await refreshTop();
    startTick();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}

start();
