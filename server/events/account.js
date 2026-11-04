// ============================================================
// events/account.js — La cuenta del jugador: login/registro, cambio de nombre,
// notificaciones leídas y desconexión.
// ============================================================

const crypto = require('crypto');
const { db, online } = require('../state');
const {
    MAX_ENERGY, SEARCH_MAX, CLASSES, DEFAULT_CLASS, MISSIONS, CLIENT_CONFIG,
    CHAT_TTL_SECONDS, NOTIF_MAX, NAME_COOLDOWN_MS, NAME_ERROR
} = require('../config');
const { hashPassword, fmtWait, cleanName, findUserByNameKey } = require('../utils');
const {
    buildPlayer, refreshEnergy, finishMissionIfDone, sendState, sendInventory, saveProgress, emitToClan
} = require('../players');
const { refreshSearch, rivalPayload, endFight } = require('../war');
const { refreshShop, shopPayload } = require('../shop');
const { formatNote } = require('../notify');
const { warPayload } = require('../clanwar');
const { refreshTop, broadcast, broadcastSlow } = require('../rankings');

module.exports = function registerAccount(socket) {

    // ---------- LOGIN / REGISTRO ----------
    // "data.noCreate" lo manda la página al RECONECTAR: así nunca se crea una cuenta por error.
    socket.on('auth', async (data, cb) => {
        try {
            const name = String(data?.name || '').trim().slice(0, 20);
            const password = String(data?.password || '');

            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });

            const nameKey = name.toLowerCase();
            const now = Date.now();
            let user = await findUserByNameKey(nameKey);

            if (user) {
                if (Object.values(online).some(p => p.key === user._id)) {
                    return cb({ ok: false, code: 'online', error: 'Ese usuario ya está conectado.' });
                }
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            } else {
                if (data?.noCreate) {
                    return cb({ ok: false, error: 'No encontramos tu usuario. Iniciá sesión de nuevo.' });
                }
                // Usuario nuevo: ID interno aleatorio (fijo para siempre) + nombre aparte.
                const salt = crypto.randomBytes(16).toString('hex');
                user = {
                    _id: crypto.randomBytes(8).toString('hex'),
                    nameKey, name, salt, hash: hashPassword(password, salt),
                    score: 0, money: 0, pouch: 0, statResets: 0,
                    energy: MAX_ENERGY, energyAt: now, mission: null,
                    level: 1, xp: 0, fame: 0, statPoints: 0,
                    class: DEFAULT_CLASS,
                    stats: { ...CLASSES[DEFAULT_CLASS].stats },
                    clanId: null, clanRole: 'miembro',
                    searchCharges: SEARCH_MAX, searchRechargeAt: 0,
                    bag: [], briefcase: [], caseExpanded: false,
                    shop: null, rival: null, recentAttacks: []
                };
                try {
                    await db.users.insertOne(user);
                } catch (e) {
                    if (e.code === 11000) return cb({ ok: false, error: 'Ese nombre se acaba de ocupar, probá de nuevo.' });
                    throw e;
                }
            }

            const player = buildPlayer(user._id, user, now);

            // Si tiene clan, buscamos su nombre. Si el clan ya no existe, lo sacamos.
            if (player.clanId) {
                const clan = await db.clans.findOne({ _id: player.clanId });
                if (clan) player.clanName = clan.name;
                else player.clanId = null;
            }

            // Volvemos a chequear justo antes de entrar (por si dos sockets entraron a la vez).
            if (Object.values(online).some(p => p.key === player.key)) {
                return cb({ ok: false, code: 'online', error: 'Ese usuario ya está conectado.' });
            }
            online[socket.id] = player;

            // Ponemos al día lo que pasó mientras estaba desconectado:
            refreshEnergy(player, now);
            refreshSearch(player, now);
            refreshShop(player, now);
            const finished = finishMissionIfDone(player, now);

            cb({ ok: true, name: user.name });  // login correcto.

            socket.emit('config', CLIENT_CONFIG);   // lo que necesita el navegador para dibujar la interfaz.
            socket.emit('missions', MISSIONS);
            sendState(socket.id, player, now);
            sendInventory(socket.id, player);
            socket.emit('shop', shopPayload(player, now));
            // Si había buscado un rival antes de recargar la página, se lo mostramos de nuevo.
            if (player.rival) socket.emit('rivalFound', rivalPayload(player, false));

            // Si su clan está en plena cuenta regresiva de una guerra, se lo avisamos.
            if (player.clanId) {
                const prep = await db.clanWars.findOne({
                    status: 'prep', $or: [{ attackerId: player.clanId }, { defenderId: player.clanId }]
                });
                if (prep) socket.emit('clanWarUpdate', warPayload(prep));
            }

            if (finished) {
                socket.emit('missionDone', finished);
                try { await saveProgress([player]); } catch (e) { console.error(e); }
            }
            broadcast();

            // Notificaciones (ataques recibidos y resultados de guerras de clanes).
            const notes = await db.notifications.find({ userId: player.key }).sort({ createdAt: -1 }).limit(NOTIF_MAX).toArray();
            socket.emit('notifications', notes.map(formatNote));

            // Historial del chat global: solo los últimos 30 minutos (máximo 50 mensajes).
            const since = Date.now() - CHAT_TTL_SECONDS * 1000;
            const last = await db.messages.find({ ts: { $gte: since } }).sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({ name: m.name, text: m.text, ts: m.ts })));
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- MARCAR NOTIFICACIONES COMO LEÍDAS ----------
    socket.on('readNotifications', async () => {
        const p = online[socket.id];
        if (!p) return;
        try {
            await db.notifications.updateMany({ userId: p.key, read: false }, { $set: { read: true } });
        } catch (e) { console.error(e); }
    });

    // ---------- CAMBIAR MI NOMBRE DE USUARIO ----------
    // El nombre se guarda aparte del ID interno, así que no se pierde nada al cambiarlo.
    // OJO: es también el nombre con el que se inicia sesión.
    socket.on('changeName', async (rawName, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const now = Date.now();
            const wait = p.nameChangedAt + NAME_COOLDOWN_MS - now;
            if (wait > 0) return reply({ ok: false, error: `Podés cambiar tu nombre de nuevo en ${fmtWait(wait)}.` });

            const name = cleanName(rawName);
            if (!name) return reply({ ok: false, error: NAME_ERROR });
            if (name === p.name) return reply({ ok: false, error: 'Ese ya es tu nombre.' });

            const nameKey = name.toLowerCase();
            const existing = await findUserByNameKey(nameKey);
            if (existing && existing._id !== p.key) return reply({ ok: false, error: 'Ese nombre ya está en uso.' });

            try {
                await db.users.updateOne({ _id: p.key }, { $set: { name, nameKey, nameChangedAt: now } });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ese nombre ya está en uso.' });
                throw e;
            }

            p.name = name;
            p.nameChangedAt = now;
            await refreshTop();
            broadcast();
            broadcastSlow();
            if (p.clanId) emitToClan(p.clanId, 'clanChanged');
            reply({ ok: true, name });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // ---------- DESCONEXIÓN ----------
    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        if (p) {
            // Si estaba peleando, resolvemos la pelea YA para que cerrar la página no sirva para escapar de una derrota.
            if (p.fight) endFight(socket.id, p, true);
            try { await saveProgress([p]); } catch (e) { console.error(e); }
            await refreshTop();
            broadcastSlow();
        }
        broadcast();
    });
};
