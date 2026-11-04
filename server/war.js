// ============================================================
// war.js — Guerra 1 contra 1: buscar rival, premios, cooldowns y el desarrollo de la pelea
// (Los eventos que pide el navegador están en events/war.js)
// ============================================================

const { io } = require('./core');
const { db } = require('./state');
const {
    WAR_REWARD, REWARD_PER_LEVEL, REWARD_MIN_MULT, REWARD_MAX_MULT, SEARCH_MAX, SEARCH_RECHARGE_MS,
    RIVAL_COOLDOWN_MS, MATCH_RANGES, HP_PER_VIDA, CLASSES
} = require('./config');
const { resolveStats, sendState, saveProgress } = require('./players');
const { sanitizeCase, gearOfItems } = require('./items');
const { notifyDefender } = require('./notify');

// Premio según la diferencia de nivel: contra alguien más alto, más; contra alguien más bajo, menos.
function warReward(myLevel, rivalLevel) {
    const mult = Math.max(REWARD_MIN_MULT, Math.min(REWARD_MAX_MULT, 1 + (rivalLevel - myLevel) * REWARD_PER_LEVEL));
    return Math.round(WAR_REWARD * mult);
}

// BÚSQUEDAS: si pasó el tiempo de espera, vuelven las cargas.
function refreshSearch(p, now) {
    if (p.searchCharges > 0) return;
    if (!p.searchRechargeAt) {
        p.searchRechargeAt = now + SEARCH_RECHARGE_MS;
    } else if (now >= p.searchRechargeAt) {
        p.searchCharges = SEARCH_MAX;
        p.searchRechargeAt = 0;
    }
}

// Gasta una carga de búsqueda. Si era la última, arranca la espera de 10 minutos.
function useSearch(p, now) {
    p.searchCharges = Math.max(0, p.searchCharges - 1);
    if (p.searchCharges === 0) p.searchRechargeAt = now + SEARCH_RECHARGE_MS;
}

// Rivales que no se pueden atacar todavía (los de los últimos 20 minutos). Limpia los vencidos.
function recentKeys(p, now) {
    p.recentAttacks = p.recentAttacks.filter(r => now - r.at < RIVAL_COOLDOWN_MS);
    return p.recentAttacks.map(r => r.key);
}

// Cuánto falta para poder volver a atacar a ese rival (0 = ya se puede).
function cooldownLeft(p, key, now) {
    const r = p.recentAttacks.find(x => x.key === key);
    return r ? Math.max(0, r.at + RIVAL_COOLDOWN_MS - now) : 0;
}

// Busca un rival al azar cerca del nivel del jugador, ampliando el rango si no hay nadie.
// Nunca devuelve a uno mismo ni a alguien atacado hace menos de 20 minutos.
async function findRival(p, now) {
    const exclude = [p.key, ...recentKeys(p, now)];
    for (let i = 0; i < MATCH_RANGES.length; i++) {
        const range = MATCH_RANGES[i];
        const match = { _id: { $nin: exclude } };
        if (Number.isFinite(range)) {
            match.$expr = { $and: [
                { $gte: [{ $ifNull: ['$level', 1] }, p.level - range] },
                { $lte: [{ $ifNull: ['$level', 1] }, p.level + range] }
            ] };
        }
        const found = await db.users.aggregate([
            { $match: match },
            { $sample: { size: 1 } },
            { $project: { name: 1, level: 1, class: 1, stats: 1, briefcase: 1 } }
        ]).toArray();
        if (found.length) return { doc: found[0], expanded: i > 0 };
    }
    return null;
}

// Guarda en el jugador una "foto" del rival (con eso se va a pelear), con su equipo del maletín.
function setRival(p, doc) {
    const { cls, stats } = resolveStats(doc);
    const level = doc.level ?? 1;
    p.rival = {
        key: doc._id, name: doc.name, level, cls, stats,
        gear: gearOfItems(sanitizeCase(doc.briefcase)),
        reward: warReward(p.level, level)   // el premio queda fijado desde acá.
    };
}

// Lo que se le muestra al jugador de su rival (con el daño del arma ya sumado).
function rivalPayload(p, expanded) {
    const r = p.rival;
    return {
        name: r.name,
        level: r.level,
        className: CLASSES[r.cls].name,
        stats: { ...r.stats, dano: r.stats.dano + r.gear.dmg },
        pistol: r.gear.pistol,
        maxHp: r.stats.vida * HP_PER_VIDA,
        reward: r.reward,
        levelDiff: r.level - p.level,   // positivo: está por encima tuyo.
        expanded: !!expanded            // true si no había nadie cerca de tu nivel.
    };
}

// Cada WAR_TURN_MS manda UN golpe al jugador. Cuando se acaban, cierra la pelea.
function stepFight(socketId, p) {
    const f = p.fight;
    if (!f) return;
    if (f.index < f.events.length) {
        io.to(socketId).emit('warEvent', f.events[f.index++]);
        return;
    }
    endFight(socketId, p, false);
}

// Cierra la pelea, paga el premio si ganó y avisa al rival.
// "instant" = true cuando el jugador se desconectó (no hay a quién mostrarle el final).
function endFight(socketId, p, instant) {
    const f = p.fight;
    if (!f) return;
    clearInterval(f.timer);
    const rv = p.rival;
    p.fight = null;
    p.rival = null;

    const reward = f.result === 'win' ? f.reward : 0;
    p.money += reward;

    // El rival recibe una notificación con el registro de la pelea (esté conectado o no).
    if (rv) notifyDefender(p, rv, f).catch(console.error);

    if (!instant) {
        io.to(socketId).emit('warEnd', { result: f.result, reward, rivalName: rv ? rv.name : '' });
        sendState(socketId, p, Date.now());
        saveProgress([p]).catch(console.error);
    }
}

module.exports = {
    warReward, refreshSearch, useSearch, recentKeys, cooldownLeft, findRival, setRival,
    rivalPayload, stepFight, endFight
};
