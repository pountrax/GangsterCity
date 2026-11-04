// ============================================================
// events/chat.js — Chat global y chat de clan
// ============================================================

const { io } = require('../core');
const { db, online } = require('../state');
const { emitToClan } = require('../players');

module.exports = function registerChat(socket) {

    // ---------- CHAT GLOBAL ----------
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
        // "createdAt" es una fecha real: MongoDB la usa para borrar el mensaje a los 30 minutos.
        try { await db.messages.insertOne({ ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });

    // ---------- CHAT DE CLAN: HISTORIAL (últimos 50 mensajes de MI clan) ----------
    socket.on('getClanChat', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p || !p.clanId) return reply({ ok: true, messages: [] });
        try {
            const last = await db.clanMessages.find({ clanId: p.clanId }).sort({ ts: -1 }).limit(50).toArray();
            reply({ ok: true, messages: last.reverse().map(m => ({ name: m.name, text: m.text, ts: m.ts })) });
        } catch (e) {
            console.error(e);
            reply({ ok: false, messages: [] });
        }
    });

    // ---------- CHAT DE CLAN: MENSAJE NUEVO (solo lo reciben los miembros de ese clan) ----------
    socket.on('clanChat', async (text) => {
        const p = online[socket.id];
        if (!p || !p.clanId) return; // hay que estar logueado y tener clan.

        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return;

        const now = Date.now();
        if (now - p.lastClanMsg < 700) return; // anti-spam.
        p.lastClanMsg = now;

        const clanId = p.clanId; // lo guardamos por si cambia mientras esperamos a la base.
        const msg = { name: p.name, text: clean, ts: now };
        emitToClan(clanId, 'clanChat', msg);
        // "createdAt" es una fecha real: el índice TTL la usa para borrar mensajes viejos.
        try { await db.clanMessages.insertOne({ clanId, ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });
};
