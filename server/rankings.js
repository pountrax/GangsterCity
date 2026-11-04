// ============================================================
// rankings.js — Los tres rankings (actividad, fama y clanes)
// Se leen de la base cada 10 segundos y se mezclan con los datos en vivo de los conectados.
// ============================================================

const { io } = require('./core');
const { db, online, cache } = require('./state');

// Recarga los rankings desde MongoDB (cada 10 s y cuando cambian los clanes o los nombres).
async function refreshTop() {
    try {
        cache.score = await db.users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 }).limit(50).toArray();

        cache.fame = await db.users
            .find({}, { projection: { name: 1, fame: 1, level: 1 } })
            .sort({ fame: -1, level: -1 }).limit(50).toArray();

        // Clanes: agrupamos a los usuarios por clan y sumamos miembros y fama.
        const groups = await db.users.aggregate([
            { $match: { clanId: { $exists: true, $ne: null } } },
            { $group: { _id: '$clanId', members: { $sum: 1 }, fame: { $sum: { $ifNull: ['$fame', 0] } } } },
            { $sort: { fame: -1, members: -1 } },
            { $limit: 50 }
        ]).toArray();
        const clanDocs = await db.clans.find({ _id: { $in: groups.map(g => g._id) } }).toArray();
        const names = new Map(clanDocs.map(c => [c._id, c.name]));
        cache.clans = groups
            .filter(g => names.has(g._id))
            .map(g => ({ id: g._id, name: names.get(g._id), members: g.members, fame: g.fame }));
    } catch (e) { console.error(e); }
}

// Ranking de ACTIVIDAD: conectados (puntaje en vivo) + desconectados (de la base).
function buildActivityRanking() {
    const onlineList = Object.values(online);
    const onlineKeys = new Set(onlineList.map(p => p.key));
    const offline = cache.score
        .filter(u => !onlineKeys.has(u._id))
        .map(u => ({ name: u.name, score: u.score, online: false }));
    return [
        ...onlineList.map(p => ({ name: p.name, score: p.score, online: true })),
        ...offline
    ].sort((a, b) => b.score - a.score);
}

// Ranking de FAMA: igual, mezclando valores en vivo y guardados.
function buildFameRanking() {
    const onlineList = Object.values(online);
    const onlineKeys = new Set(onlineList.map(p => p.key));
    const offline = cache.fame
        .filter(u => !onlineKeys.has(u._id))
        .map(u => ({ name: u.name, level: u.level ?? 1, fame: u.fame ?? 0, online: false }));
    return [
        ...onlineList.map(p => ({ name: p.name, level: p.level, fame: p.fame, online: true })),
        ...offline
    ].sort((a, b) => b.fame - a.fame || b.level - a.level).slice(0, 50);
}

// Manda el ranking de actividad a TODOS (cada segundo, porque el puntaje sube en vivo).
function broadcast() {
    io.emit('players', buildActivityRanking());
}

// Manda los rankings de fama y clanes a TODOS (cada 10 s, cambian más lento).
function broadcastSlow() {
    io.emit('fameRanking', buildFameRanking());
    io.emit('clanRanking', cache.clans);
}

module.exports = { refreshTop, buildActivityRanking, buildFameRanking, broadcast, broadcastSlow };
