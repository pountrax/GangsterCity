// ============================================================
// players.js — El jugador en memoria: crearlo, actualizarlo, guardarlo y mandarle su estado
// ============================================================

const { io } = require('./core');
const { db, online } = require('./state');
const {
    MAX_ENERGY, ENERGY_REGEN_MS, POINTS_PER_LEVEL, SEARCH_MAX, STAT_IDS, CLASSES, DEFAULT_CLASS,
    MISSIONS, HP_PER_VIDA, ARMOR_CAP, EXTRA_TURN_CAP, DODGE_CAP, CRIT_CAP, pct
} = require('./config');
const { xpNeeded, resetCost } = require('./utils');
const { sanitizeBag, sanitizeCase, gearOfItems, caseSize, rollDrops } = require('./items');

// Suma experiencia y sube de nivel las veces que haga falta (sirve para cualquier objeto con
// xp, level, statPoints y fame). Cada nivel da puntos de estadística y +1 de fama.
// Devuelve cuántos niveles subió.
function addXp(p, amount) {
    p.xp += amount;
    let gained = 0;
    while (p.xp >= xpNeeded(p.level)) {
        p.xp -= xpNeeded(p.level);
        p.level++;
        p.statPoints += POINTS_PER_LEVEL;
        p.fame += 1;
        gained++;
    }
    return gained;
}

// Completa las estadísticas de un documento de la base (los usuarios viejos reciben las de su clase).
function resolveStats(user) {
    const cls = CLASSES[user.class] ? user.class : DEFAULT_CLASS;
    const base = CLASSES[cls].stats;
    const stats = {};
    STAT_IDS.forEach(id => { stats[id] = user.stats?.[id] ?? base[id]; });
    return { cls, stats };
}

// Rivales atacados hace poco.
function sanitizeRecent(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(r => r && typeof r.key === 'string' && Number.isFinite(r.at)).map(r => ({ key: r.key, at: r.at }));
}

// Rival guardado: si le falta algo, se descarta.
function sanitizeRival(r) {
    return r && r.key && r.name && r.stats && r.gear && Number.isFinite(r.reward) ? r : null;
}

// Arma el objeto "jugador" en memoria a partir del documento de la base.
function buildPlayer(key, user, now) {
    const { cls, stats } = resolveStats(user);
    return {
        key, name: user.name, score: user.score ?? 0, lastMsg: 0, lastClanMsg: 0,
        money: user.money ?? 0,
        pouch: Math.max(0, user.pouch ?? 0),     // bolsa de dinero (ganancias de gangster).
        statResets: user.statResets ?? 0,        // cuántas veces reinició sus estadísticas.
        energy: user.energy ?? MAX_ENERGY,
        energyAt: user.energyAt ?? now,
        mission: user.mission ?? null,
        level: user.level ?? 1,
        xp: user.xp ?? 0,
        fame: user.fame ?? 0,
        statPoints: user.statPoints ?? 0,
        stats, cls,
        clanId: user.clanId ?? null,
        clanName: null,                          // se completa al iniciar sesión.
        clanRole: user.clanRole ?? 'miembro',
        busy: false,                             // evita que dos acciones de clan/nombre se ejecuten a la vez.
        rival: sanitizeRival(user.rival),        // rival buscado (sobrevive a recargar la página).
        fight: null,                             // pelea en curso.
        searching: false,                        // true mientras se busca rival.
        lastSearch: 0,
        lastLookup: 0,
        searchCharges: Math.max(0, Math.min(SEARCH_MAX, user.searchCharges ?? SEARCH_MAX)),
        searchRechargeAt: user.searchRechargeAt ?? 0,
        nameChangedAt: user.nameChangedAt ?? 0,
        bag: sanitizeBag(user.bag),
        briefcase: sanitizeCase(user.briefcase),
        caseExpanded: !!user.caseExpanded,
        shop: user.shop ?? null,
        recentAttacks: sanitizeRecent(user.recentAttacks)
    };
}

// Busca a un jugador CONECTADO por su key (ID interno). Devuelve { id (del socket), p } o null.
function findOnlineByKey(key) {
    const entry = Object.entries(online).find(([, p]) => p.key === key);
    return entry ? { id: entry[0], p: entry[1] } : null;
}

// Manda un evento a TODOS los conectados que pertenecen a un clan.
function emitToClan(clanId, event, data) {
    Object.entries(online).forEach(([id, p]) => {
        if (p.clanId === clanId) io.to(id).emit(event, data);
    });
}

// Guarda en MongoDB TODO el progreso de una lista de jugadores, en una sola llamada.
async function saveProgress(list) {
    if (!list.length) return;
    await db.users.bulkWrite(list.map(p => ({
        updateOne: {
            filter: { _id: p.key },
            update: { $set: {
                score: p.score,
                money: p.money,
                pouch: p.pouch,
                statResets: p.statResets,
                energy: p.energy,
                energyAt: p.energyAt,
                mission: p.mission,
                level: p.level,
                xp: p.xp,
                fame: p.fame,
                statPoints: p.statPoints,
                stats: p.stats,
                class: p.cls,
                clanId: p.clanId,
                clanRole: p.clanRole,
                searchCharges: p.searchCharges,
                searchRechargeAt: p.searchRechargeAt,
                bag: p.bag,
                briefcase: p.briefcase,
                caseExpanded: p.caseExpanded,
                shop: p.shop,
                rival: p.rival,
                recentAttacks: p.recentAttacks
            } }
        }
    })));
}

// ENERGÍA: se calcula según el tiempo pasado, no con un contador (se recarga aunque estés desconectado).
function refreshEnergy(p, now) {
    if (p.energy >= MAX_ENERGY) {
        p.energy = MAX_ENERGY;
        p.energyAt = now;
        return;
    }
    const gained = Math.floor((now - p.energyAt) / ENERGY_REGEN_MS);
    if (gained > 0) {
        p.energy = Math.min(MAX_ENERGY, p.energy + gained);
        p.energyAt = p.energy >= MAX_ENERGY ? now : p.energyAt + gained * ENERGY_REGEN_MS;
    }
}

// MISIÓN: si ya pasó la hora de fin, la completa y paga dinero, XP, fama y posibles objetos.
function finishMissionIfDone(p, now) {
    if (!p.mission || now < p.mission.endsAt) return null;
    const mission = MISSIONS.find(m => m.id === p.mission.id);
    p.mission = null;
    if (!mission) return null;

    p.money += mission.reward;
    p.fame += mission.fame;
    const levelsGained = addXp(p, mission.xp);
    const items = rollDrops(p, mission);   // objetos raros (casi siempre vacío).

    return { name: mission.name, reward: mission.reward, xp: mission.xp, fame: mission.fame, levelsGained, level: p.level, items };
}

// Texto que explica qué hace cada estadística con su valor TOTAL y nivel actuales.
function describeStats(s, level) {
    const pc = (v) => Math.round(v * 100);
    return {
        vida: `${s.vida * HP_PER_VIDA} HP en combate`,
        dano: `${s.dano} de daño por golpe`,
        aguante: `Reduce ${pc(pct(s.aguante, ARMOR_CAP, level))}% el daño recibido`,
        velocidad: `${pc(pct(s.velocidad, EXTRA_TURN_CAP, level))}% de turno extra`,
        inteligencia: `${pc(pct(s.inteligencia, DODGE_CAP, level))}% de esquivar`,
        suerte: `${pc(pct(s.suerte, CRIT_CAP, level))}% de crítico`
    };
}

// Arma el "estado personal" que se le manda a UN jugador (solo suyo).
function buildState(p, now) {
    const mission = p.mission ? MISSIONS.find(m => m.id === p.mission.id) : null;
    const gear = gearOfItems(p.briefcase);                       // ventajas del maletín.
    const total = { ...p.stats, dano: p.stats.dano + gear.dmg };  // estadísticas con el equipo sumado.
    return {
        money: p.money,
        pouch: p.pouch,                          // bolsa de dinero reclamable.
        resetCost: resetCost(p),                 // precio del próximo reinicio de estadísticas.
        energy: p.energy,
        maxEnergy: MAX_ENERGY,
        nextEnergyMs: p.energy >= MAX_ENERGY ? 0 : Math.max(0, ENERGY_REGEN_MS - (now - p.energyAt)),
        level: p.level,
        xp: p.xp,
        xpNeeded: xpNeeded(p.level),
        fame: p.fame,
        statPoints: p.statPoints,
        stats: p.stats,                          // base (la que se compra y se sube).
        bonus: gear.dmg ? { dano: gear.dmg } : {}, // extra que da el maletín.
        totalStats: total,                       // base + extra (la que se usa para pelear).
        effects: describeStats(total, p.level),
        maxHp: total.vida * HP_PER_VIDA,
        className: CLASSES[p.cls].name,
        clan: p.clanName,
        searchCharges: p.searchCharges,
        searchMax: SEARCH_MAX,
        searchRechargeMs: p.searchCharges > 0 ? 0 : Math.max(0, p.searchRechargeAt - now),
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

// Manda al jugador su mochila y su maletín.
function sendInventory(socketId, p) {
    io.to(socketId).emit('inventory', {
        bag: p.bag, briefcase: p.briefcase, caseSize: caseSize(p), expanded: p.caseExpanded
    });
}

// Después de cualquier cambio de objetos: avisamos, actualizamos el estado y guardamos.
function afterInventoryChange(socketId, p) {
    sendInventory(socketId, p);
    sendState(socketId, p, Date.now());
    saveProgress([p]).catch(console.error);
}

module.exports = {
    addXp, resolveStats, sanitizeRecent, sanitizeRival, buildPlayer, findOnlineByKey, emitToClan,
    saveProgress, refreshEnergy, finishMissionIfDone, describeStats, buildState, sendState,
    sendInventory, afterInventoryChange
};
