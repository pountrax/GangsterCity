// ============================================================
// server.js — Servidor del juego (v7: emparejamiento por nivel,
// cargas de búsqueda, premio según nivel, cambio de nombres,
// rango de Colíder y reglas del clan)
// El servidor es el ÚNICO que decide niveles, dinero, energía,
// estadísticas, clanes y peleas. El navegador solo pide acciones
// y muestra el resultado.
// ============================================================

const express = require('express');          // servidor web (rutas HTTP).
const http = require('http');                // servidor HTTP base (Socket.IO se engancha acá).
const crypto = require('crypto');            // para hashear contraseñas y crear IDs.
const socketIo = require('socket.io');       // comunicación en tiempo real.
const { MongoClient } = require('mongodb');  // cliente de la base de datos.

const app = express();
const server = http.createServer(app);
// CORS "*" = acepta cualquier página. CAMBIAR más adelante para que sea solo GitHub Pages.
const io = socketIo(server, { cors: { origin: "*" } });

// Ruta de prueba: sirve para verificar qué versión corre en Render.
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v7 familia, rangos y busquedas'));

// La URL de MongoDB está en las variables de entorno de Render (nunca en el código).
const client = new MongoClient(process.env.MONGODB_URI);
let users, messages, clans, clanMessages; // colecciones de la base, se llenan en start().

// ============================================================
// CONFIGURACIÓN DEL JUEGO (acá ajustás los números)
// ============================================================

const MAX_ENERGY = 100;          // energía máxima.
const ENERGY_REGEN_MS = 60000;   // cada cuántos ms se recupera 1 de energía (60000 = 1 minuto).

const POINTS_PER_LEVEL = 5;      // puntos de estadística que da cada nivel.
const XP_BASE = 100;             // XP necesaria para pasar del nivel 1 al 2.
const XP_GROWTH = 1.1;           // cada nivel pide 10% más XP que el anterior.
const STAT_COST = 1500;          // dinero que cuesta comprar 1 punto de estadística.

const CLAN_JOIN_LEVEL = 5;       // nivel mínimo para unirse a un clan.
const CLAN_CREATE_LEVEL = 10;    // nivel mínimo para crear un clan.
const CLAN_MAX_MEMBERS = 30;     // máximo de miembros por clan.
const CLAN_RULES_MAX = 1000;     // máximo de caracteres de las reglas del clan.

// Rangos del clan, de menor a mayor. El "lider" no se guarda en el jugador:
// se sabe porque su ID está en el campo "owner" del clan.
const ROLE_RANK = { miembro: 0, oficial: 1, colider: 2, lider: 3 };
const MANAGER_ROLES = ['lider', 'colider']; // rangos que pueden expulsar y editar las reglas.

// Cambio de nombre (de usuario y de clan): tiempo de espera entre un cambio y otro.
const NAME_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos.
// Nombres válidos: 3 a 20 caracteres entre letras, números, espacios, guion bajo, guion y punto.
const NAME_REGEX = /^[\p{L}\p{N} _.-]{3,20}$/u;
const NAME_ERROR = 'Nombre inválido: usá entre 3 y 20 letras, números, espacios, guiones o puntos.';

// Cuánto viven los mensajes antes de que MongoDB los borre solo.
const CHAT_TTL_SECONDS = 30 * 60;               // chat global: 30 minutos.
const CLAN_CHAT_TTL_SECONDS = 7 * 24 * 60 * 60; // chat de clan: 7 días.

// ---------- Guerra ----------
const WAR_ENERGY = 15;       // energía que cuesta pelear.
const WAR_REWARD = 300;      // dinero base al vencer (se ajusta según la diferencia de nivel).
const WAR_TURN_MS = 1400;    // cada cuánto se muestra un golpe (milisegundos).
const WAR_MAX_ACTIONS = 60;  // tope de golpes por pelea (evita peleas eternas).
const HP_PER_VIDA = 5;       // cada punto de Vida da 5 HP en combate.
const CRIT_MULT = 2;         // un crítico pega el doble.

// Búsqueda de rival: cargas.
const SEARCH_MAX = 3;                         // cargas de búsqueda.
const SEARCH_RECHARGE_MS = 10 * 60 * 1000;    // al gastar la última, se recargan todas tras 10 minutos.

// Emparejamiento: se busca primero a ±5 niveles; si no hay nadie, se amplía el rango.
// El último valor (Infinity) significa "cualquier nivel".
// Si no querés que se amplíe nunca, dejá solo [5].
const MATCH_RANGES = [5, 10, 25, Infinity];

// Premio según la diferencia de nivel: ±10% por cada nivel de diferencia,
// con un mínimo de 30% y un máximo de 200% del premio base.
const REWARD_PER_LEVEL = 0.1;
const REWARD_MIN_MULT = 0.3;
const REWARD_MAX_MULT = 2;

// Los porcentajes de combate dependen del nivel: cuanto más nivel tenés, más puntos
// hacen falta para el mismo porcentaje. En nivel 1 es la fórmula de siempre.
const PCT_BASE = 100;
const PCT_PER_LEVEL = 4;

// Topes de los porcentajes (para que ninguna estadística haga invencible a nadie).
const ARMOR_CAP = 0.75;      // aguante: máximo 75% menos de daño.
const EXTRA_TURN_CAP = 0.5;  // velocidad: máximo 50% de turno extra.
const DODGE_CAP = 0.5;       // inteligencia: máximo 50% de esquivar.
const CRIT_CAP = 0.6;        // suerte: máximo 60% de crítico.

// Convierte una estadística en un porcentaje (0 a 1) con rendimientos decrecientes,
// teniendo en cuenta el NIVEL del personaje. Nunca pasa del tope "cap".
function pct(stat, cap, level) {
    return Math.min(cap, stat / (stat + PCT_BASE + (level - 1) * PCT_PER_LEVEL));
}

// Estadísticas del personaje (el "id" es el nombre interno, el "label" el que se ve).
const STATS = [
    { id: 'vida',         label: 'Vida',         icon: '❤️' },
    { id: 'dano',         label: 'Daño',         icon: '💥' },
    { id: 'aguante',      label: 'Aguante',      icon: '🛡️' },
    { id: 'velocidad',    label: 'Velocidad',    icon: '🏃' },
    { id: 'inteligencia', label: 'Inteligencia', icon: '🧠' },
    { id: 'suerte',       label: 'Suerte',       icon: '🍀' }
];
const STAT_IDS = STATS.map(s => s.id); // lista de IDs válidos (para validar lo que manda el cliente).

// Clases de personaje: cada una define sus estadísticas iniciales.
const CLASSES = {
    maton:     { name: 'Matón',     stats: { vida: 20, dano: 15, aguante: 25, velocidad: 13, inteligencia: 11, suerte: 15 } },
    estafador: { name: 'Estafador', stats: { vida: 14, dano: 15, aguante: 12, velocidad: 18, inteligencia: 24, suerte: 16 } },
    ladron:    { name: 'Ladrón',    stats: { vida: 15, dano: 15, aguante: 13, velocidad: 26, inteligencia: 14, suerte: 16 } },
    apostador: { name: 'Apostador', stats: { vida: 16, dano: 15, aguante: 14, velocidad: 14, inteligencia: 14, suerte: 26 } },
    sicario:   { name: 'Sicario',   stats: { vida: 18, dano: 15, aguante: 16, velocidad: 20, inteligencia: 14, suerte: 16 } }
};
const DEFAULT_CLASS = 'maton'; // clase que reciben todos los personajes por ahora.

// Lista de misiones. Para agregar una, copiá una línea y cambiá los datos.
// - energy: energía que cuesta.   - durationMs: cuánto tarda (ms).
// - reward: dinero que paga.      - xp: experiencia.   - fame: fama que da.
const MISSIONS = [
    { id: 'carteras', name: 'Robar carteras',     energy: 5,  durationMs: 10000, reward: 20,  xp: 20,  fame: 1 },
    { id: 'tienda',   name: 'Asaltar una tienda', energy: 15, durationMs: 30000, reward: 70,  xp: 60,  fame: 2 },
    { id: 'banco',    name: 'Golpe al banco',     energy: 40, durationMs: 60000, reward: 220, xp: 180, fame: 3 }
];

// ============================================================
// ESTADO EN MEMORIA
// ============================================================

// Jugadores conectados AHORA. Formato:
// { socketId: { key, name, score, lastMsg, lastClanMsg, money, energy, energyAt, mission,
//               level, xp, fame, statPoints, stats, cls, clanId, clanName, clanRole, busy,
//               rival, fight, searching, lastSearch, searchCharges, searchRechargeAt, nameChangedAt } }
// "key" es el ID interno FIJO del usuario en la base (no cambia aunque cambie su nombre).
const online = {};

// Cachés leídos de la base cada 10 segundos (incluyen jugadores desconectados):
let topScoreCache = []; // top 50 por tiempo jugado.
let topFameCache = [];  // top 50 por fama.
let clanCache = [];     // ranking de clanes.

// ============================================================
// FUNCIONES DE AYUDA
// ============================================================

// Convierte contraseña + salt en un hash ilegible (scrypt es lento a propósito).
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Convierte milisegundos en un texto corto: "9 min 30 s" o "45 s".
function fmtWait(ms) {
    const total = Math.max(1, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    return m > 0 ? `${m} min ${total % 60} s` : `${total} s`;
}

// Limpia y valida un nombre (de usuario o de clan). Devuelve el nombre limpio o null si no sirve.
function cleanName(raw) {
    // Sacamos espacios de los costados y dobles espacios, cortamos a 20 y volvemos a recortar.
    const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20).trim();
    return NAME_REGEX.test(name) ? name : null;
}

// Busca un usuario por su nombre (en minúsculas = "nameKey").
// Los usuarios viejos todavía sin nameKey se encuentran por su _id (que era el nombre en minúsculas).
function findUserByNameKey(nameKey) {
    return users.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}

// Igual, pero para clanes.
function findClanByNameKey(nameKey) {
    return clans.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}

// XP necesaria para pasar del nivel "level" al siguiente.
function xpNeeded(level) {
    return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

// Suma experiencia y sube de nivel las veces que haga falta.
// Cada nivel da puntos de estadística y +1 de fama. Devuelve cuántos niveles subió.
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

// Completa las estadísticas de un documento de la base.
// Los usuarios viejos no tienen las nuevas: se les pone el valor base de su clase.
function resolveStats(user) {
    const cls = CLASSES[user.class] ? user.class : DEFAULT_CLASS;
    const base = CLASSES[cls].stats;
    const stats = {};
    STAT_IDS.forEach(id => { stats[id] = user.stats?.[id] ?? base[id]; });
    return { cls, stats };
}

// Arma el objeto "jugador" en memoria a partir del documento de la base.
function buildPlayer(key, user, now) {
    const { cls, stats } = resolveStats(user);
    return {
        key, name: user.name, score: user.score ?? 0, lastMsg: 0, lastClanMsg: 0,
        money: user.money ?? 0,
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
        clanRole: user.clanRole ?? 'miembro',    // 'miembro', 'oficial' o 'colider' (el líder se sabe por clan.owner).
        busy: false,                             // evita que dos acciones de clan/nombre se ejecuten a la vez.
        rival: null,                             // rival encontrado en Guerra (todavía sin pelear).
        fight: null,                             // pelea en curso (null si no está peleando).
        searching: false,                        // true mientras se busca rival.
        lastSearch: 0,                           // hora de la última búsqueda (límite de velocidad).
        searchCharges: Math.max(0, Math.min(SEARCH_MAX, user.searchCharges ?? SEARCH_MAX)), // cargas de búsqueda.
        searchRechargeAt: user.searchRechargeAt ?? 0,  // hora en que vuelven las cargas (0 = no hay espera).
        nameChangedAt: user.nameChangedAt ?? 0         // hora del último cambio de nombre.
    };
}

// Texto que explica qué hace cada estadística con su valor y nivel actuales (se muestra en Inventario).
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

// Busca a un jugador CONECTADO por su key (ID interno).
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

// Devuelve { clan, role } con el clan del jugador y su rango REAL, o null si no tiene clan.
// El rango se verifica contra la base (el líder es quien figura como "owner").
async function getClanAndRole(p) {
    if (!p.clanId) return null;
    const clan = await clans.findOne({ _id: p.clanId });
    if (!clan) return null;
    return { clan, role: clan.owner === p.key ? 'lider' : p.clanRole };
}

// ¿Puede alguien con el rango "actorRole" expulsar o cambiar el rango de alguien con "targetRole"?
// - El líder puede con todos menos con otro líder.
// - El colíder solo con Oficiales y Miembros.
function canManage(actorRole, targetRole) {
    if (actorRole === 'lider') return targetRole !== 'lider';
    if (actorRole === 'colider') return targetRole === 'miembro' || targetRole === 'oficial';
    return false;
}

// Busca a un miembro de un clan y devuelve su rango real y si está conectado.
// Devuelve null si ese jugador no pertenece al clan.
async function findClanMember(clan, key) {
    const doc = await users.findOne({ _id: key, clanId: clan._id }, { projection: { clanRole: 1 } });
    if (!doc) return null;
    const live = findOnlineByKey(key);
    const stored = live ? live.p.clanRole : doc.clanRole;
    const role = clan.owner === key ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro');
    return { live, role };
}

// ============================================================
// GUERRA
// ============================================================

// Premio según la diferencia de nivel: contra alguien más alto, más; contra alguien más bajo, menos.
function warReward(myLevel, rivalLevel) {
    const mult = Math.max(REWARD_MIN_MULT, Math.min(REWARD_MAX_MULT, 1 + (rivalLevel - myLevel) * REWARD_PER_LEVEL));
    return Math.round(WAR_REWARD * mult);
}

// BÚSQUEDAS: si pasó el tiempo de espera, vuelven las cargas.
function refreshSearch(p, now) {
    if (p.searchCharges > 0) return;
    if (!p.searchRechargeAt) {
        p.searchRechargeAt = now + SEARCH_RECHARGE_MS;   // (por si faltaba el reloj, lo arrancamos)
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

// Busca un rival al azar cerca del nivel del jugador, ampliando el rango si no hay nadie.
// Devuelve { doc, expanded } o null si no hay ningún otro jugador.
async function findRival(p) {
    for (let i = 0; i < MATCH_RANGES.length; i++) {
        const range = MATCH_RANGES[i];
        const match = { _id: { $ne: p.key } }; // nunca uno mismo.
        if (Number.isFinite(range)) {
            // Nivel entre (mío - rango) y (mío + rango). $ifNull: los usuarios sin nivel cuentan como nivel 1.
            match.$expr = { $and: [
                { $gte: [{ $ifNull: ['$level', 1] }, p.level - range] },
                { $lte: [{ $ifNull: ['$level', 1] }, p.level + range] }
            ] };
        }
        const found = await users.aggregate([
            { $match: match },
            { $sample: { size: 1 } },  // uno al azar entre los que cumplen.
            { $project: { name: 1, level: 1, class: 1, stats: 1 } }
        ]).toArray();
        if (found.length) return { doc: found[0], expanded: i > 0 };
    }
    return null;
}

// Convierte las estadísticas de un personaje en un "luchador" con sus valores de combate.
function makeFighter(name, level, cls, stats) {
    const maxHp = stats.vida * HP_PER_VIDA;
    return {
        name, level, className: CLASSES[cls].name,
        maxHp, hp: maxHp,
        dano: stats.dano, aguante: stats.aguante, velocidad: stats.velocidad,
        inteligencia: stats.inteligencia, suerte: stats.suerte
    };
}

// Un golpe de "att" (atacante) contra "def" (defensor). Modifica la vida del defensor.
// Los porcentajes de cada uno dependen de SU propio nivel.
// Devuelve { result: 'hit' | 'crit' | 'dodge', dmg }.
function resolveHit(att, def) {
    // 1) ¿El defensor esquiva? (inteligencia)
    if (Math.random() < pct(def.inteligencia, DODGE_CAP, def.level)) return { result: 'dodge', dmg: 0 };

    // 2) Daño base con una variación de ±15%.
    let dmg = att.dano * (0.85 + Math.random() * 0.3);

    // 3) ¿Es crítico? (suerte del atacante)
    const crit = Math.random() < pct(att.suerte, CRIT_CAP, att.level);
    if (crit) dmg *= CRIT_MULT;

    // 4) El aguante del defensor reduce el daño.
    dmg *= 1 - pct(def.aguante, ARMOR_CAP, def.level);

    dmg = Math.max(1, Math.round(dmg)); // mínimo 1 de daño.
    def.hp = Math.max(0, def.hp - dmg);
    return { result: crit ? 'crit' : 'hit', dmg };
}

// Simula la pelea COMPLETA de una vez y devuelve la lista de golpes y el resultado.
// Después se los mandamos al jugador de a uno para que los vea en vivo.
function simulateFight(me, rival) {
    const events = [];
    let actions = 0;

    // Empieza el más veloz; si empatan, se sortea.
    let meTurn = me.velocidad !== rival.velocidad ? me.velocidad > rival.velocidad : Math.random() < 0.5;

    // Un golpe: lo resuelve y lo anota con la vida de ambos DESPUÉS del golpe.
    const act = (att, def, actor, extra) => {
        const r = resolveHit(att, def);
        actions++;
        events.push({ actor, result: r.result, dmg: r.dmg, extra, hpMe: me.hp, hpRival: rival.hp });
    };

    while (me.hp > 0 && rival.hp > 0 && actions < WAR_MAX_ACTIONS) {
        const att = meTurn ? me : rival;
        const def = meTurn ? rival : me;
        const actor = meTurn ? 'me' : 'rival';

        act(att, def, actor, false);

        // Turno extra (velocidad): una sola vez por turno, y solo si el rival sigue en pie.
        if (def.hp > 0 && actions < WAR_MAX_ACTIONS && Math.random() < pct(att.velocidad, EXTRA_TURN_CAP, att.level)) {
            act(att, def, actor, true);
        }
        meTurn = !meTurn; // le toca al otro.
    }

    // Resultado: gana quien dejó al otro sin vida. Si se acabaron los golpes, gana quien
    // tiene más vida (en porcentaje); si empatan, es empate.
    let result;
    if (rival.hp <= 0) result = 'win';
    else if (me.hp <= 0) result = 'lose';
    else {
        const a = me.hp / me.maxHp;
        const b = rival.hp / rival.maxHp;
        result = a > b ? 'win' : a < b ? 'lose' : 'draw';
    }
    return { events, result };
}

// Cada WAR_TURN_MS manda UN golpe al jugador. Cuando se acaban, cierra la pelea.
function stepFight(socketId, p) {
    const f = p.fight;
    if (!f) return;
    if (f.index < f.events.length) {
        io.to(socketId).emit('warEvent', f.events[f.index++]);
        return;
    }
    endFight(socketId, p, false); // ya se mostraron todos los golpes.
}

// Cierra la pelea y paga el premio si ganó.
// "instant" = true cuando el jugador se desconectó (no hay a quién avisarle).
function endFight(socketId, p, instant) {
    const f = p.fight;
    if (!f) return;
    clearInterval(f.timer);
    const rivalName = p.rival ? p.rival.name : '';
    p.fight = null;
    p.rival = null;

    const reward = f.result === 'win' ? f.reward : 0; // el premio se fijó al buscar al rival.
    p.money += reward;

    if (!instant) {
        io.to(socketId).emit('warEnd', { result: f.result, reward, rivalName });
        sendState(socketId, p, Date.now());
        saveProgress([p]).catch(console.error);
    }
}

// ============================================================
// RANKINGS Y GUARDADO
// ============================================================

// Recarga los rankings desde MongoDB (cada 10 s y cuando cambian los clanes o nombres).
async function refreshTop() {
    try {
        topScoreCache = await users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 }).limit(50).toArray();

        topFameCache = await users
            .find({}, { projection: { name: 1, fame: 1, level: 1 } })
            .sort({ fame: -1, level: -1 }).limit(50).toArray();

        // Clanes: agrupamos a los usuarios por clan y sumamos miembros y fama.
        const groups = await users.aggregate([
            { $match: { clanId: { $exists: true, $ne: null } } },
            { $group: { _id: '$clanId', members: { $sum: 1 }, fame: { $sum: { $ifNull: ['$fame', 0] } } } },
            { $sort: { fame: -1, members: -1 } },
            { $limit: 50 }
        ]).toArray();
        const clanDocs = await clans.find({ _id: { $in: groups.map(g => g._id) } }).toArray();
        const names = new Map(clanDocs.map(c => [c._id, c.name]));
        clanCache = groups
            .filter(g => names.has(g._id))
            .map(g => ({ id: g._id, name: names.get(g._id), members: g.members, fame: g.fame }));
    } catch (e) { console.error(e); }
}

// Ranking de ACTIVIDAD: conectados (puntaje en vivo) + desconectados (de la base).
function buildActivityRanking() {
    const onlineList = Object.values(online);
    const onlineKeys = new Set(onlineList.map(p => p.key));
    const offline = topScoreCache
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
    const offline = topFameCache
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
    io.emit('clanRanking', clanCache);
}

// Guarda en MongoDB TODO el progreso de una lista de jugadores, en una sola llamada.
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
                searchRechargeAt: p.searchRechargeAt
            } }
        }
    })));
}

// ENERGÍA: se calcula según el tiempo pasado, no con un contador.
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

// MISIÓN: si ya pasó la hora de fin, la completa y paga dinero, XP y fama.
function finishMissionIfDone(p, now) {
    if (!p.mission || now < p.mission.endsAt) return null;
    const mission = MISSIONS.find(m => m.id === p.mission.id);
    p.mission = null;
    if (!mission) return null;

    p.money += mission.reward;                    // dinero.
    p.fame += mission.fame;                       // fama (1, 2 o 3 según la misión).
    const levelsGained = addXp(p, mission.xp);    // experiencia (y niveles si alcanza).

    return { name: mission.name, reward: mission.reward, xp: mission.xp, fame: mission.fame, levelsGained, level: p.level };
}

// Arma el "estado personal" que se le manda a UN jugador (solo suyo).
function buildState(p, now) {
    const mission = p.mission ? MISSIONS.find(m => m.id === p.mission.id) : null;
    return {
        money: p.money,
        energy: p.energy,
        maxEnergy: MAX_ENERGY,
        nextEnergyMs: p.energy >= MAX_ENERGY ? 0 : Math.max(0, ENERGY_REGEN_MS - (now - p.energyAt)),
        level: p.level,
        xp: p.xp,
        xpNeeded: xpNeeded(p.level),
        fame: p.fame,
        statPoints: p.statPoints,
        stats: p.stats,
        effects: describeStats(p.stats, p.level),   // texto del efecto de cada estadística.
        maxHp: p.stats.vida * HP_PER_VIDA,          // vida total en combate.
        className: CLASSES[p.cls].name,
        clan: p.clanName,
        searchCharges: p.searchCharges,             // cargas de búsqueda de rival.
        searchMax: SEARCH_MAX,
        searchRechargeMs: p.searchCharges > 0 ? 0 : Math.max(0, p.searchRechargeAt - now), // espera restante.
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
    // Apenas entra (aunque no se haya logueado) ve los rankings.
    socket.emit('players', buildActivityRanking());
    socket.emit('fameRanking', buildFameRanking());
    socket.emit('clanRanking', clanCache);

    // ---------- LOGIN / REGISTRO ----------
    // "data.noCreate" lo manda la página al RECONECTAR: así nunca se crea una cuenta por error.
    socket.on('auth', async (data, cb) => {
        try {
            const name = String(data?.name || '').trim().slice(0, 20);
            const password = String(data?.password || '');

            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });

            const nameKey = name.toLowerCase(); // "Juan" y "juan" son el mismo usuario.
            const now = Date.now();
            let user = await findUserByNameKey(nameKey);

            if (user) {
                // Usuario existente: primero vemos que no esté ya conectado (por su ID interno)...
                if (Object.values(online).some(p => p.key === user._id)) {
                    return cb({ ok: false, code: 'online', error: 'Ese usuario ya está conectado.' });
                }
                // ...y después verificamos la contraseña.
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            } else {
                // No existe. Si es una reconexión automática, NO creamos nada.
                if (data?.noCreate) {
                    return cb({ ok: false, error: 'No encontramos tu usuario. Iniciá sesión de nuevo.' });
                }
                // Usuario nuevo: ID interno aleatorio (fijo para siempre) + nombre aparte.
                const salt = crypto.randomBytes(16).toString('hex');
                user = {
                    _id: crypto.randomBytes(8).toString('hex'),
                    nameKey, name, salt, hash: hashPassword(password, salt),
                    score: 0,
                    money: 0,
                    energy: MAX_ENERGY,
                    energyAt: now,
                    mission: null,
                    level: 1,
                    xp: 0,
                    fame: 0,
                    statPoints: 0,
                    class: DEFAULT_CLASS,
                    stats: { ...CLASSES[DEFAULT_CLASS].stats }, // copia de las stats base de la clase.
                    clanId: null,
                    clanRole: 'miembro',
                    searchCharges: SEARCH_MAX,
                    searchRechargeAt: 0
                };
                try {
                    await users.insertOne(user);
                } catch (e) {
                    // 11000 = otro jugador acaba de registrar ese mismo nombre.
                    if (e.code === 11000) return cb({ ok: false, error: 'Ese nombre se acaba de ocupar, probá de nuevo.' });
                    throw e;
                }
            }

            const player = buildPlayer(user._id, user, now);

            // Si tiene clan, buscamos su nombre. Si el clan ya no existe, lo sacamos.
            if (player.clanId) {
                const clan = await clans.findOne({ _id: player.clanId });
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
            const finished = finishMissionIfDone(player, now);

            cb({ ok: true, name: user.name });  // login correcto.
            // Configuración que necesita el navegador para dibujar la interfaz.
            socket.emit('config', {
                stats: STATS,
                clanJoinLevel: CLAN_JOIN_LEVEL,
                clanCreateLevel: CLAN_CREATE_LEVEL,
                pointsPerLevel: POINTS_PER_LEVEL,
                chatTtlMs: CHAT_TTL_SECONDS * 1000,
                statCost: STAT_COST,
                warEnergy: WAR_ENERGY,
                warReward: WAR_REWARD,
                searchMax: SEARCH_MAX,
                searchRechargeMs: SEARCH_RECHARGE_MS,
                nameCooldownMs: NAME_COOLDOWN_MS,
                clanRulesMax: CLAN_RULES_MAX
            });
            socket.emit('missions', MISSIONS);
            sendState(socket.id, player, now);
            if (finished) {
                socket.emit('missionDone', finished);
                try { await saveProgress([player]); } catch (e) { console.error(e); }
            }
            broadcast();

            // Historial del chat global: solo los últimos 30 minutos (máximo 50 mensajes).
            const since = Date.now() - CHAT_TTL_SECONDS * 1000;
            const last = await messages.find({ ts: { $gte: since } }).sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({
                name: m.name, text: m.text, ts: m.ts
            })));
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
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

            // ¿Lo usa otro jugador? (si es el mío, por ejemplo al cambiar solo mayúsculas, se permite)
            const nameKey = name.toLowerCase();
            const existing = await findUserByNameKey(nameKey);
            if (existing && existing._id !== p.key) return reply({ ok: false, error: 'Ese nombre ya está en uso.' });

            try {
                await users.updateOne({ _id: p.key }, { $set: { name, nameKey, nameChangedAt: now } });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ese nombre ya está en uso.' });
                throw e;
            }

            p.name = name;
            p.nameChangedAt = now;
            await refreshTop();      // los rankings leen el nombre de la base.
            broadcast();
            broadcastSlow();
            if (p.clanId) emitToClan(p.clanId, 'clanChanged'); // los del clan ven el nombre nuevo.
            reply({ ok: true, name });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // ---------- EMPEZAR UNA MISIÓN ----------
    socket.on('startMission', async (missionId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const mission = MISSIONS.find(m => m.id === missionId);
        if (!mission) return reply({ ok: false, error: 'Esa misión no existe.' });

        const now = Date.now();
        refreshEnergy(p, now);

        if (p.mission) return reply({ ok: false, error: 'Ya estás haciendo una misión.' });
        if (p.energy < mission.energy) {
            return reply({ ok: false, error: 'No tenés suficiente energía.' });
        }

        p.energy -= mission.energy;
        p.mission = { id: mission.id, endsAt: now + mission.durationMs };

        sendState(socket.id, p, now);
        reply({ ok: true });

        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- GASTAR UN PUNTO DE ESTADÍSTICA (de los que da cada nivel) ----------
    socket.on('spendStat', async (statId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (!STAT_IDS.includes(statId)) return reply({ ok: false, error: 'Esa estadística no existe.' });
        if (p.statPoints < 1) return reply({ ok: false, error: 'No tenés puntos disponibles.' });

        p.stats[statId]++;
        p.statPoints--;

        sendState(socket.id, p, Date.now());
        reply({ ok: true });

        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- COMPRAR UN PUNTO DE ESTADÍSTICA CON DINERO ----------
    socket.on('buyStat', async (statId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (!STAT_IDS.includes(statId)) return reply({ ok: false, error: 'Esa estadística no existe.' });
        if (p.money < STAT_COST) return reply({ ok: false, error: `Necesitás 💵 ${STAT_COST} para comprar un punto.` });

        // Todo se valida y se cobra acá, sin esperas en el medio (no se puede gastar dos veces).
        p.money -= STAT_COST;
        p.stats[statId]++;

        sendState(socket.id, p, Date.now());
        reply({ ok: true });

        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- GUERRA: BUSCAR RIVAL (gasta 1 de las 3 cargas) ----------
    // Elige al azar a otro jugador de nivel parecido y le muestra su tarjeta.
    socket.on('searchRival', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
        if (p.searching) return reply({ ok: false, error: 'Ya estás buscando.' });

        // ¿Le quedan cargas? (si pasó la espera, se recargan acá mismo)
        const now = Date.now();
        refreshSearch(p, now);
        if (p.searchCharges < 1) {
            return reply({ ok: false, error: `Te quedaste sin búsquedas. Se recargan en ${fmtWait(p.searchRechargeAt - now)}.` });
        }
        if (now - p.lastSearch < 800) return reply({ ok: false, error: 'Esperá un momento antes de buscar de nuevo.' });
        p.lastSearch = now;

        p.searching = true;
        try {
            const result = await findRival(p);

            if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' }); // empezó otra mientras buscábamos.
            if (!result) return reply({ ok: false, error: 'Todavía no hay otros jugadores para pelear.' });

            // Recién ahora, que SÍ encontramos a alguien, gastamos la carga.
            useSearch(p, Date.now());

            const r = result.doc;
            const { cls, stats } = resolveStats(r);
            const level = r.level ?? 1;
            const reward = warReward(p.level, level); // el premio queda fijado desde acá.
            // Guardamos una "foto" del rival: con eso se va a pelear.
            p.rival = { key: r._id, name: r.name, level, cls, stats, reward };

            sendState(socket.id, p, Date.now());
            saveProgress([p]).catch(console.error); // guardamos las cargas.

            reply({
                ok: true,
                rival: {
                    name: r.name,
                    level,
                    className: CLASSES[cls].name,
                    stats,
                    maxHp: stats.vida * HP_PER_VIDA,
                    reward,
                    levelDiff: level - p.level,     // positivo: está por encima tuyo.
                    expanded: result.expanded       // true si no había nadie cerca de tu nivel.
                }
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.searching = false;
        }
    });

    // ---------- GUERRA: PELEAR (cuesta energía) ----------
    socket.on('startFight', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Ya estás peleando.' });
        if (!p.rival) return reply({ ok: false, error: 'Primero buscá un rival.' });

        const now = Date.now();
        refreshEnergy(p, now);
        if (p.energy < WAR_ENERGY) return reply({ ok: false, error: `Necesitás ${WAR_ENERGY} de energía para pelear.` });

        // Cobramos la energía.
        p.energy -= WAR_ENERGY;

        // Armamos los dos luchadores y simulamos TODA la pelea ahora mismo.
        const me = makeFighter(p.name, p.level, p.cls, p.stats);
        const rv = makeFighter(p.rival.name, p.rival.level, p.rival.cls, p.rival.stats);
        const outcome = simulateFight(me, rv);

        // Guardamos la pelea (con el premio ya fijado) y mandamos un golpe cada WAR_TURN_MS.
        p.fight = { events: outcome.events, result: outcome.result, index: 0, timer: null, reward: p.rival.reward };
        p.fight.timer = setInterval(() => stepFight(socket.id, p), WAR_TURN_MS);

        sendState(socket.id, p, now);
        reply({ ok: true, maxHpMe: me.maxHp, maxHpRival: rv.maxHp });
        saveProgress([p]).catch(console.error); // guardamos la energía gastada.
    });

    // ---------- CLANES ----------

    // Crear un clan (requiere nivel CLAN_CREATE_LEVEL). El creador queda como líder.
    socket.on('createClan', async (rawName, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true; // bloqueamos otras acciones de clan hasta terminar.
        try {
            if (p.clanId) return reply({ ok: false, error: 'Ya pertenecés a un clan. Salí primero.' });
            if (p.level < CLAN_CREATE_LEVEL) {
                return reply({ ok: false, error: `Necesitás nivel ${CLAN_CREATE_LEVEL} para crear un clan.` });
            }
            const name = cleanName(rawName);
            if (!name) return reply({ ok: false, error: NAME_ERROR });

            const nameKey = name.toLowerCase();
            if (await findClanByNameKey(nameKey)) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });

            // El clan tiene un ID interno aleatorio y fijo: así su nombre se puede cambiar después.
            const id = crypto.randomBytes(8).toString('hex');
            try {
                await clans.insertOne({ _id: id, nameKey, name, owner: p.key, rules: '', createdAt: Date.now() });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });
                throw e;
            }
            p.clanId = id;
            p.clanName = name;
            p.clanRole = 'miembro';
            await users.updateOne({ _id: p.key }, { $set: { clanId: id, clanRole: 'miembro' } });
            await refreshTop();
            broadcastSlow();
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false; // pase lo que pase, liberamos el bloqueo.
        }
    });

    // Unirse a un clan (requiere nivel CLAN_JOIN_LEVEL).
    socket.on('joinClan', async (clanKey, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            if (p.clanId) return reply({ ok: false, error: 'Ya pertenecés a un clan.' });
            if (p.level < CLAN_JOIN_LEVEL) {
                return reply({ ok: false, error: `Necesitás nivel ${CLAN_JOIN_LEVEL} para unirte a un clan.` });
            }
            const clan = await clans.findOne({ _id: String(clanKey || '') });
            if (!clan) return reply({ ok: false, error: 'Ese clan no existe.' });

            const count = await users.countDocuments({ clanId: clan._id });
            if (count >= CLAN_MAX_MEMBERS) return reply({ ok: false, error: 'Ese clan está lleno.' });

            p.clanId = clan._id;
            p.clanName = clan.name;
            p.clanRole = 'miembro';
            await users.updateOne({ _id: p.key }, { $set: { clanId: clan._id, clanRole: 'miembro' } });
            await refreshTop();
            broadcastSlow();
            emitToClan(clan._id, 'clanChanged'); // los demás miembros ven al nuevo en la lista.
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // Salir del clan. Si era el líder, hereda un Colíder (o, si no hay, un Oficial, o cualquier miembro);
    // si no queda nadie, se borra el clan y su chat.
    socket.on('leaveClan', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            if (!p.clanId) return reply({ ok: false, error: 'No pertenecés a ningún clan.' });

            const clanKey = p.clanId;
            p.clanId = null;
            p.clanName = null;
            p.clanRole = 'miembro';
            await users.updateOne({ _id: p.key }, { $set: { clanId: null, clanRole: 'miembro' } });

            const clan = await clans.findOne({ _id: clanKey });
            if (clan && clan.owner === p.key) {
                // Era el líder: buscamos al reemplazo, de mayor a menor rango.
                const pick = { projection: { _id: 1 } };
                const next =
                    await users.findOne({ clanId: clanKey, clanRole: 'colider' }, pick) ||
                    await users.findOne({ clanId: clanKey, clanRole: 'oficial' }, pick) ||
                    await users.findOne({ clanId: clanKey }, pick);
                if (next) {
                    await clans.updateOne({ _id: clanKey }, { $set: { owner: next._id } });
                } else {
                    await clans.deleteOne({ _id: clanKey });             // no queda nadie: se borra el clan
                    await clanMessages.deleteMany({ clanId: clanKey });  // y también su chat.
                }
            }
            await refreshTop();
            broadcastSlow();
            emitToClan(clanKey, 'clanChanged'); // los que quedan ven la lista actualizada.
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // CAMBIAR EL NOMBRE DEL CLAN (solo el líder).
    socket.on('renameClan', async (rawName, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const ctx = await getClanAndRole(p); // verificamos EN EL SERVIDOR que sea el líder.
            if (!ctx || ctx.role !== 'lider') return reply({ ok: false, error: 'Solo el líder puede cambiar el nombre del clan.' });
            const clan = ctx.clan;

            const now = Date.now();
            const wait = (clan.nameChangedAt || 0) + NAME_COOLDOWN_MS - now;
            if (wait > 0) return reply({ ok: false, error: `El nombre del clan se puede cambiar de nuevo en ${fmtWait(wait)}.` });

            const name = cleanName(rawName);
            if (!name) return reply({ ok: false, error: NAME_ERROR });
            if (name === clan.name) return reply({ ok: false, error: 'Ese ya es el nombre del clan.' });

            const nameKey = name.toLowerCase();
            const existing = await findClanByNameKey(nameKey);
            if (existing && existing._id !== clan._id) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });

            try {
                await clans.updateOne({ _id: clan._id }, { $set: { name, nameKey, nameChangedAt: now } });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });
                throw e;
            }

            // Actualizamos el nombre en la memoria de todos los miembros conectados.
            Object.values(online).forEach(o => { if (o.clanId === clan._id) o.clanName = name; });
            await refreshTop();
            broadcastSlow();
            emitToClan(clan._id, 'clanChanged');
            emitToClan(clan._id, 'clanNotice', `El clan ahora se llama ${name}.`);
            reply({ ok: true, name });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // EDITAR LAS REGLAS DEL CLAN (líder y colíderes).
    socket.on('setClanRules', async (rawText, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        try {
            const ctx = await getClanAndRole(p);
            if (!ctx || !MANAGER_ROLES.includes(ctx.role)) {
                return reply({ ok: false, error: 'Solo el líder y los colíderes pueden editar las reglas.' });
            }
            // Texto limpio: saltos de línea normales, sin espacios de más, máximo CLAN_RULES_MAX caracteres.
            const text = String(rawText || '').replace(/\r\n/g, '\n').trim().slice(0, CLAN_RULES_MAX);
            await clans.updateOne({ _id: ctx.clan._id }, { $set: { rules: text } });
            emitToClan(ctx.clan._id, 'clanChanged'); // todos los miembros ven las reglas nuevas.
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // EXPULSAR a un miembro (líder y colíderes, según el rango del expulsado).
    socket.on('kickMember', async (targetKey, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const ctx = await getClanAndRole(p); // verificamos EN EL SERVIDOR el rango de quien pide.
            if (!ctx || !MANAGER_ROLES.includes(ctx.role)) {
                return reply({ ok: false, error: 'Solo el líder y los colíderes pueden hacer esto.' });
            }
            const { clan, role } = ctx;

            const key = String(targetKey || '');
            if (key === p.key) return reply({ ok: false, error: 'No podés expulsarte a vos mismo. Usá "Salir del clan".' });

            const target = await findClanMember(clan, key); // rango real del expulsado.
            if (!target) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
            if (!canManage(role, target.role)) return reply({ ok: false, error: 'No tenés permiso sobre ese rango.' });

            // Si el expulsado está conectado, actualizamos su memoria PRIMERO.
            // (Si no, el guardado automático de cada 10 s volvería a escribir su clan viejo.)
            if (target.live) {
                target.live.p.clanId = null;
                target.live.p.clanName = null;
                target.live.p.clanRole = 'miembro';
            }
            // El filtro { clanId } asegura que solo se expulse a alguien de ESTE clan.
            await users.updateOne({ _id: key, clanId: clan._id }, { $set: { clanId: null, clanRole: 'miembro' } });

            if (target.live) {
                io.to(target.live.id).emit('clanNotice', `Fuiste expulsado del clan ${clan.name}.`);
                sendState(target.live.id, target.live.p, Date.now());
            }
            await refreshTop();
            broadcastSlow();
            emitToClan(clan._id, 'clanChanged');
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // CAMBIAR EL RANGO de un miembro. data = { key, role }.
    // - El líder puede dejar a alguien como Miembro, Oficial o Colíder.
    // - El colíder solo mueve a Miembros y Oficiales entre Miembro y Oficial.
    socket.on('setMemberRole', async (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const ctx = await getClanAndRole(p);
            if (!ctx || !MANAGER_ROLES.includes(ctx.role)) {
                return reply({ ok: false, error: 'Solo el líder y los colíderes pueden hacer esto.' });
            }
            const { clan, role: myRole } = ctx;

            const key = String(data?.key || '');
            const newRole = data?.role;
            // Rangos que puede asignar quien pide.
            const assignable = myRole === 'lider' ? ['miembro', 'oficial', 'colider'] : ['miembro', 'oficial'];
            if (!assignable.includes(newRole)) return reply({ ok: false, error: 'No podés asignar ese rango.' });
            if (key === p.key) return reply({ ok: false, error: 'No podés cambiar tu propio rango.' });

            const target = await findClanMember(clan, key);
            if (!target) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
            if (!canManage(myRole, target.role)) return reply({ ok: false, error: 'No tenés permiso sobre ese rango.' });
            if (target.role === newRole) return reply({ ok: true }); // ya tenía ese rango.

            // Igual que al expulsar: si está conectado, actualizamos su memoria primero.
            if (target.live) target.live.p.clanRole = newRole;
            await users.updateOne({ _id: key, clanId: clan._id }, { $set: { clanRole: newRole } });

            if (target.live) {
                const labels = { miembro: 'Miembro', oficial: 'Oficial', colider: 'Colíder' };
                io.to(target.live.id).emit('clanNotice', `Tu rango en ${clan.name} ahora es ${labels[newRole]}.`);
            }
            emitToClan(clan._id, 'clanChanged');
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // Datos de MI clan (nombre, reglas, mi rango y lista de miembros).
    socket.on('getClan', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p || !p.clanId) return reply({ ok: true, clan: null });
        try {
            const clan = await clans.findOne({ _id: p.clanId });
            if (!clan) return reply({ ok: true, clan: null });

            const docs = await users
                .find({ clanId: p.clanId }, { projection: { name: 1, level: 1, clanRole: 1 } })
                .limit(CLAN_MAX_MEMBERS).toArray();

            const members = docs.map(m => {
                const live = findOnlineByKey(m._id); // si está conectado usamos sus datos en vivo.
                const stored = live ? live.p.clanRole : m.clanRole;
                return {
                    key: m._id,                                    // ID interno: sirve para expulsar/cambiar rango.
                    name: live ? live.p.name : m.name,
                    level: live ? live.p.level : (m.level ?? 1),
                    // 'lider' | 'colider' | 'oficial' | 'miembro'
                    role: m._id === clan.owner ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro'),
                    online: !!live
                };
            });
            // Orden: de mayor a menor rango; dentro de cada grupo, por nivel.
            members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.level - a.level);

            const me = members.find(m => m.key === p.key);
            reply({
                ok: true,
                clan: { name: clan.name, rules: clan.rules || '', myRole: me ? me.role : 'miembro', members }
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- CHAT DE CLAN ----------

    // Historial del chat de MI clan (últimos 50 mensajes).
    socket.on('getClanChat', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p || !p.clanId) return reply({ ok: true, messages: [] });
        try {
            const last = await clanMessages.find({ clanId: p.clanId }).sort({ ts: -1 }).limit(50).toArray();
            reply({ ok: true, messages: last.reverse().map(m => ({ name: m.name, text: m.text, ts: m.ts })) });
        } catch (e) {
            console.error(e);
            reply({ ok: false, messages: [] });
        }
    });

    // Mensaje nuevo en el chat de clan: solo lo reciben los miembros de ese clan.
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
        try { await clanMessages.insertOne({ clanId, ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });

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
        try { await messages.insertOne({ ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });

    // ---------- DESCONEXIÓN ----------
    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        if (p) {
            // Si estaba peleando, resolvemos la pelea YA (con su resultado) para que
            // cerrar la página no sirva para escapar de una derrota.
            if (p.fight) endFight(socket.id, p, true);
            try { await saveProgress([p]); } catch (e) { console.error(e); }
            await refreshTop();
            broadcastSlow();
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
    const entries = Object.entries(online); // pares [socketId, jugador].

    entries.forEach(([id, p]) => {
        p.score++;                  // +1 punto por segundo (ranking de actividad).
        refreshEnergy(p, now);      // recarga de energía.
        refreshSearch(p, now);      // recarga de cargas de búsqueda.

        const finished = finishMissionIfDone(p, now);
        if (finished) {
            io.to(id).emit('missionDone', finished);
            saveProgress([p]).catch(console.error);
        }

        sendState(id, p, now);      // estado personal actualizado.
    });

    broadcast(); // ranking de actividad para todos.

    ticks++;
    // Cada 10 segundos: guardamos a todos, refrescamos rankings y los mandamos.
    if (ticks % 10 === 0) {
        try { await saveProgress(entries.map(([, p]) => p)); } catch (e) { console.error(e); }
        await refreshTop();
        broadcastSlow();
    }
}, 1000);

// ============================================================
// ARRANQUE
// ============================================================

// Ejecuta una tarea de preparación; si falla, lo muestra pero no frena el servidor.
async function safely(label, fn) {
    try { await fn(); } catch (e) { console.error('Error en ' + label + ':', e); }
}

async function start() {
    await client.connect();                       // conecta a MongoDB.
    const db = client.db('juego');
    users = db.collection('users');               // usuarios y todo su progreso.
    messages = db.collection('messages');         // chat global (los mensajes se borran solos).
    clans = db.collection('clans');               // clanes.
    clanMessages = db.collection('clanMessages'); // chat de clan.

    // --- Mensajes e índices del chat ---
    await safely('chat global', async () => {
        await messages.updateMany(
            { createdAt: { $exists: false } },
            [{ $set: { createdAt: { $toDate: '$ts' } } }]
        );
        await messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CHAT_TTL_SECONDS });
    });
    await safely('chat de clan', async () => {
        await clanMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_CHAT_TTL_SECONDS });
        await clanMessages.createIndex({ clanId: 1, ts: -1 });
    });

    // --- Migración a nombres cambiables ---
    // A los usuarios y clanes viejos les agregamos "nameKey" (su nombre en minúsculas, que era su _id).
    await safely('migración de usuarios', async () => {
        await users.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        // Índice único: impide que dos usuarios tengan el mismo nombre. "sparse" ignora los que no lo tengan.
        await users.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('migración de clanes', async () => {
        await clans.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        await clans.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('índice de clanId', () => users.createIndex({ clanId: 1 }));

    await refreshTop();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();
