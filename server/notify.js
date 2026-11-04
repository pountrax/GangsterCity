// ============================================================
// notify.js — Notificaciones (la campanita del juego)
// Dos tipos: 'attack' (te atacaron, con el registro de la pelea) y 'clanwar' (resultado de una guerra de clanes).
// ============================================================

const { io } = require('./core');
const { db } = require('./state');
const { CLAN_WAR_REWARD, CLAN_WAR_FAME, CLAN_WAR_XP } = require('./config');
const { findOnlineByKey } = require('./players');

// Convierte una notificación de la base en lo que se le manda al navegador.
function formatNote(d) {
    return {
        id: String(d._id),
        type: d.type || 'attack',
        text: d.text || '',
        from: d.from || '',
        fromLevel: d.fromLevel || 0,
        result: d.result || '',
        log: d.log || [],
        ts: d.createdAt.getTime(),
        read: !!d.read
    };
}

// Crea la notificación para el defensor y, si está conectado, se la manda al instante.
// "f.result" está contado desde el punto de vista del ATACANTE ('win' = el atacante ganó).
async function notifyDefender(p, rv, f) {
    const doc = {
        userId: rv.key,
        type: 'attack',
        from: p.name,
        fromLevel: p.level,
        result: f.result,
        // Registro compacto: a = quién actuó, r = resultado, d = daño, x = turno extra, w = arma.
        log: f.events.map(e => ({ a: e.actor, r: e.result, d: e.dmg, x: e.extra ? 1 : 0, w: e.weapon || '' })),
        read: false,
        createdAt: new Date()
    };
    const res = await db.notifications.insertOne(doc);
    const live = findOnlineByKey(rv.key);
    if (live) io.to(live.id).emit('notification', formatNote({ ...doc, _id: res.insertedId }));
}

// Crea la notificación del resultado de una guerra de clanes para todos los miembros de los dos clanes.
async function notifyWarMembers(war, keysA, keysB, winner) {
    const winName = winner === 'a' ? war.attackerName : war.defenderName;
    const loseName = winner === 'a' ? war.defenderName : war.attackerName;
    const now = new Date();
    const base = { type: 'clanwar', warId: war._id, read: false, createdAt: now };
    const docs = [
        ...(winner === 'a' ? keysA : keysB).map(k => ({ ...base, userId: k,
            text: `🏆 ¡${winName} venció a ${loseName} en la guerra de clanes! Ganaste 💵 ${CLAN_WAR_REWARD}, ⭐ ${CLAN_WAR_FAME} de fama y ✨ ${CLAN_WAR_XP} XP.` })),
        ...(winner === 'a' ? keysB : keysA).map(k => ({ ...base, userId: k,
            text: `💀 ${loseName} perdió la guerra de clanes contra ${winName}.` }))
    ];
    if (!docs.length) return;
    const res = await db.notifications.insertMany(docs);
    docs.forEach((d, i) => {
        const live = findOnlineByKey(d.userId);
        if (live) io.to(live.id).emit('notification', formatNote({ ...d, _id: res.insertedIds[i] }));
    });
}

module.exports = { formatNote, notifyDefender, notifyWarMembers };
