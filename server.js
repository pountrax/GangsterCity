// ============================================================
// server.js — Servidor del juego (v6: guerra por turnos, daño,
// compra de estadísticas con dinero y fama por misión)
// El servidor es el ÚNICO que decide niveles, dinero, energía,
// estadísticas, clanes y peleas. El navegador solo pide acciones
// y muestra el resultado.
// ============================================================

const express = require('express');          // servidor web (rutas HTTP).
const http = require('http');                // servidor HTTP base (Socket.IO se engancha acá).
const crypto = require('crypto');            // para hashear contraseñas.
const socketIo = require('socket.io');       // comunicación en tiempo real.
const { MongoClient } = require('mongodb');  // cliente de la base de datos.

const app = express();
const server = http.createServer(app);
// CORS "*" = acepta cualquier página. CAMBIAR más adelante para que sea solo GitHub Pages.
const io = socketIo(server, { cors: { origin: "*" } });

// Ruta de prueba: sirve para verificar qué versión corre en Render.
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v6 guerra'));

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
const CLAN_ROLES = ['miembro', 'oficial']; // rangos que el líder puede asignar.

// Cuánto viven los mensajes antes de que MongoDB los borre solo.
const CHAT_TTL_SECONDS = 30 * 60;               // chat global: 30 minutos.
const CLAN_CHAT_TTL_SECONDS = 7 * 24 * 60 * 60; // chat de clan: 7 días.

// ---------- Guerra ----------
const WAR_ENERGY = 15;       // energía que cuesta pelear.
const WAR_REWARD = 300;      // dinero que se gana al vencer.
const WAR_TURN_MS = 1400;    // cada cuánto se muestra un golpe (milisegundos).
const WAR_MAX_ACTIONS = 60;  // tope de golpes por pelea (evita peleas eternas).
const HP_PER_VIDA = 5;       // cada punto de Vida da 5 HP en combate.
const CRIT_MULT = 2;         // un crítico pega el doble.
// Topes de los porcentajes (para que ninguna estadística haga invencible a nadie).
const ARMOR_CAP = 0.75;      // aguante: máximo 75% menos de daño.
const EXTRA_TURN_CAP = 0.5;  // velocidad: máximo 50% de turno extra.
const DODGE_CAP = 0.5;       // inteligencia: máximo 50% de esquivar.
const CRIT_CAP = 0.6;        // suerte: máximo 60% de crítico.

// Convierte una estadística en un porcentaje (0 a 1) con rendimientos decrecientes:
// 25 → 20%, 50 → 33%, 100 → 50%, 200 → 67%... y nunca pasa del tope "cap".
function pct(stat, cap) {
    return Math.min(cap, stat / (stat + 100));
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
// (El daño es 15 para todas por ahora; se puede cambiar por clase.)
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
//               rival, fight, searching, lastSearch } }
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
// Los usuarios viejos no tienen las nuevas (como "dano"): se les pone el valor base de su clase.
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
        clanRole: user.clanRole ?? 'miembro',    // 'miembro' u 'oficial' (el líder se sabe por clan.owner).
        busy: false,                             // evita que dos acciones de clan se ejecuten a la vez.
        rival: null,                             // rival encontrado en Guerra (todavía sin pelear).
        fight: null,                             // pelea en curso (null si no está peleando).
        searching: false,                        // true mientras se busca rival.
        lastSearch: 0                            // hora de la última búsqueda (límite de velocidad).
    };
}

// Texto que explica qué hace cada estadística con su valor actual (se muestra en Inventario).
function describeStats(s) {
    const pc = (v) => Math.round(v * 100);
    return {
        vida: `${s.vida * HP_PER_VIDA} HP en combate`,
        dano: `${s.dano} de daño por golpe`,
        aguante: `Reduce ${pc(pct(s.aguante, ARMOR_CAP))}% el daño recibido`,
        velocidad: `${pc(pct(s.velocidad, EXTRA_TURN_CAP))}% de turno extra`,
        inteligencia: `${pc(pct(s.inteligencia, DODGE_CAP))}% de esquivar`,
        suerte: `${pc(pct(s.suerte, CRIT_CAP))}% de crítico`
    };
}

// Busca a un jugador CONECTADO por su key (nombre en minúsculas).
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

// Devuelve el clan del jugador SOLO si él es el líder; si no, null.
async function getClanIfLeader(p) {
    if (!p.clanId) return null;
    const clan = await clans.findOne({ _id: p.clanId });
    return clan && clan.owner === p.key ? clan : null;
}

// ============================================================
// GUERRA: combate por turnos
// ============================================================

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
// Devuelve { result: 'hit' | 'crit' | 'dodge', dmg }.
function resolveHit(att, def) {
    // 1) ¿El defensor esquiva? (inteligencia)
    if (Math.random() < pct(def.inteligencia, DODGE_CAP)) return { result: 'dodge', dmg: 0 };

    // 2) Daño base con una variación de ±15%.
    let dmg = att.dano * (0.85 + Math.random() * 0.3);

    // 3) ¿Es crítico? (suerte del atacante)
    const crit = Math.random() < pct(att.suerte, CRIT_CAP);
    if (crit) dmg *= CRIT_MULT;

    // 4) El aguante del defensor reduce el daño.
    dmg *= 1 - pct(def.aguante, ARMOR_CAP);

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
        if (def.hp > 0 && actions < WAR_MAX_ACTIONS && Math.random() < pct(att.velocidad, EXTRA_TURN_CAP)) {
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

    const reward = f.result === 'win' ? WAR_REWARD : 0;
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

// Recarga los rankings desde MongoDB (cada 10 s y cuando cambian los clanes).
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
                clanRole: p.clanRole
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
        effects: describeStats(p.stats),      // texto del efecto de cada estadística.
        maxHp: p.stats.vida * HP_PER_VIDA,    // vida total en combate.
        className: CLASSES[p.cls].name,
        clan: p.clanName,
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
    socket.on('auth', async (data, cb) => {
        try {
            const name = String(data?.name || '').trim().slice(0, 20);
            const password = String(data?.password || '');

            if (name.length < 3) return cb({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' });
            if (password.length < 4) return cb({ ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' });

            const key = name.toLowerCase(); // "Juan" y "juan" son el mismo usuario.

            if (Object.values(online).some(p => p.key === key)) {
                return cb({ ok: false, error: 'Ese usuario ya está conectado.' });
            }

            const now = Date.now();
            let user = await users.findOne({ _id: key });

            if (!user) {
                // Usuario nuevo: lo creamos con los valores iniciales del juego.
                const salt = crypto.randomBytes(16).toString('hex');
                user = {
                    _id: key, name, salt, hash: hashPassword(password, salt),
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
                    clanRole: 'miembro'
                };
                await users.insertOne(user);
            } else {
                // Usuario existente: verificamos la contraseña.
                const a = Buffer.from(hashPassword(password, user.salt), 'hex');
                const b = Buffer.from(user.hash, 'hex');
                if (!crypto.timingSafeEqual(a, b)) {
                    return cb({ ok: false, error: 'Contraseña incorrecta.' });
                }
            }

            const player = buildPlayer(key, user, now);

            // Si tiene clan, buscamos su nombre. Si el clan ya no existe, lo sacamos.
            if (player.clanId) {
                const clan = await clans.findOne({ _id: player.clanId });
                if (clan) player.clanName = clan.name;
                else player.clanId = null;
            }

            online[socket.id] = player;

            // Ponemos al día lo que pasó mientras estaba desconectado:
            refreshEnergy(player, now);
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
                warReward: WAR_REWARD
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

    // ---------- GUERRA: BUSCAR RIVAL (gratis) ----------
    // Elige al azar a otro jugador de la base y le muestra su tarjeta.
    socket.on('searchRival', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};

        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
        if (p.searching) return reply({ ok: false, error: 'Ya estás buscando.' });

        const now = Date.now();
        if (now - p.lastSearch < 800) return reply({ ok: false, error: 'Esperá un momento antes de buscar de nuevo.' });
        p.lastSearch = now;

        p.searching = true;
        try {
            // $sample elige un documento al azar; $match excluye a uno mismo.
            const found = await users.aggregate([
                { $match: { _id: { $ne: p.key } } },
                { $sample: { size: 1 } },
                { $project: { name: 1, level: 1, class: 1, stats: 1 } }
            ]).toArray();

            if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' }); // empezó otra mientras buscábamos.
            if (!found.length) return reply({ ok: false, error: 'Todavía no hay otros jugadores para pelear.' });

            const r = found[0];
            const { cls, stats } = resolveStats(r);
            // Guardamos una "foto" del rival: con eso se va a pelear.
            p.rival = { key: r._id, name: r.name, level: r.level ?? 1, cls, stats };

            reply({
                ok: true,
                rival: {
                    name: r.name,
                    level: r.level ?? 1,
                    className: CLASSES[cls].name,
                    stats,
                    maxHp: stats.vida * HP_PER_VIDA
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

        // Guardamos la pelea y mandamos un golpe cada WAR_TURN_MS (el cliente lo anima).
        p.fight = { events: outcome.events, result: outcome.result, index: 0, timer: null };
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
            const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 20);
            if (name.length < 3) return reply({ ok: false, error: 'El nombre del clan debe tener al menos 3 caracteres.' });

            const key = name.toLowerCase(); // el ID del clan es su nombre en minúsculas (único).
            try {
                await clans.insertOne({ _id: key, name, owner: p.key, createdAt: Date.now() });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });
                throw e;
            }
            p.clanId = key;
            p.clanName = name;
            p.clanRole = 'miembro';
            await users.updateOne({ _id: p.key }, { $set: { clanId: key, clanRole: 'miembro' } });
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

    // Salir del clan. Si era el líder, hereda un Oficial (o, si no hay, otro miembro);
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
                // Era el líder: primero buscamos un Oficial; si no hay, cualquier miembro.
                const next =
                    await users.findOne({ clanId: clanKey, clanRole: 'oficial' }, { projection: { _id: 1 } }) ||
                    await users.findOne({ clanId: clanKey }, { projection: { _id: 1 } });
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

    // EXPULSAR a un miembro (solo el líder).
    socket.on('kickMember', async (targetKey, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const clan = await getClanIfLeader(p); // verificamos EN EL SERVIDOR que sea el líder.
            if (!clan) return reply({ ok: false, error: 'Solo el líder del clan puede hacer esto.' });

            const key = String(targetKey || '');
            if (key === p.key) return reply({ ok: false, error: 'No podés expulsarte a vos mismo. Usá "Salir del clan".' });

            // Si el expulsado está conectado, actualizamos su memoria PRIMERO.
            // (Si no, el guardado automático de cada 10 s volvería a escribir su clan viejo.)
            const target = findOnlineByKey(key);
            if (target) {
                if (target.p.clanId !== clan._id) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
                target.p.clanId = null;
                target.p.clanName = null;
                target.p.clanRole = 'miembro';
            }
            // El filtro { clanId } asegura que solo se expulse a alguien de ESTE clan.
            const res = await users.updateOne(
                { _id: key, clanId: clan._id },
                { $set: { clanId: null, clanRole: 'miembro' } }
            );
            if (!target && res.matchedCount === 0) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });

            if (target) {
                io.to(target.id).emit('clanNotice', `Fuiste expulsado del clan ${clan.name}.`);
                sendState(target.id, target.p, Date.now());
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

    // ASCENDER o DEGRADAR a un miembro (solo el líder). data = { key, role }.
    socket.on('setMemberRole', async (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const clan = await getClanIfLeader(p);
            if (!clan) return reply({ ok: false, error: 'Solo el líder del clan puede hacer esto.' });

            const key = String(data?.key || '');
            const role = data?.role;
            if (!CLAN_ROLES.includes(role)) return reply({ ok: false, error: 'Rango inválido.' });
            if (key === p.key) return reply({ ok: false, error: 'No podés cambiar tu propio rango.' });

            const target = findOnlineByKey(key);
            if (target) {
                if (target.p.clanId !== clan._id) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
                target.p.clanRole = role;
            }
            const res = await users.updateOne({ _id: key, clanId: clan._id }, { $set: { clanRole: role } });
            if (!target && res.matchedCount === 0) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });

            if (target) {
                io.to(target.id).emit('clanNotice', role === 'oficial'
                    ? `Fuiste ascendido a Oficial en ${clan.name}.`
                    : `Ya no sos Oficial en ${clan.name}.`);
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

    // Datos de MI clan (nombre, mi rango y lista de miembros).
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
                const stored = live ? live.p.clanRole : (m.clanRole ?? 'miembro');
                return {
                    key: m._id,                                    // sirve para expulsar/ascender.
                    name: m.name,
                    level: live ? live.p.level : (m.level ?? 1),
                    role: m._id === clan.owner ? 'lider' : stored, // 'lider' | 'oficial' | 'miembro'
                    online: !!live
                };
            });
            // Orden: líder, oficiales, miembros; dentro de cada grupo, por nivel.
            const order = { lider: 0, oficial: 1, miembro: 2 };
            members.sort((a, b) => order[a.role] - order[b.role] || b.level - a.level);

            const me = members.find(m => m.key === p.key);
            reply({ ok: true, clan: { name: clan.name, myRole: me ? me.role : 'miembro', members } });
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
async function start() {
    await client.connect();                       // conecta a MongoDB.
    const db = client.db('juego');
    users = db.collection('users');               // usuarios y todo su progreso.
    messages = db.collection('messages');         // chat global (los mensajes se borran solos).
    clans = db.collection('clans');               // clanes.
    clanMessages = db.collection('clanMessages'); // chat de clan.

    // Preparamos los índices. Si algo falla, lo mostramos pero el servidor arranca igual.
    try {
        await messages.updateMany(
            { createdAt: { $exists: false } },
            [{ $set: { createdAt: { $toDate: '$ts' } } }]
        );
        await messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CHAT_TTL_SECONDS });
        await clanMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_CHAT_TTL_SECONDS });
        await clanMessages.createIndex({ clanId: 1, ts: -1 });
        await users.createIndex({ clanId: 1 });
    } catch (e) { console.error('Error creando índices:', e); }

    await refreshTop();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();
