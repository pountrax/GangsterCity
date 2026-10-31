// ============================================================
// server.js — Servidor del juego (v9: bolsa de dinero, guerra de
// clanes con repetición, reinicio de estadísticas)
// El servidor es el ÚNICO que decide niveles, dinero, energía,
// objetos, clanes y peleas. El navegador solo pide acciones
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
app.get('/', (req, res) => res.send('Servidor funcionando 🎉 - v9 guerra de clanes'));

// La URL de MongoDB está en las variables de entorno de Render (nunca en el código).
const client = new MongoClient(process.env.MONGODB_URI);
let users, messages, clans, clanMessages, notifications, clanWars; // colecciones (se llenan en start()).

// ============================================================
// CONFIGURACIÓN DEL JUEGO (acá ajustás los números)
// ============================================================

const MAX_ENERGY = 100;          // energía máxima.
const ENERGY_REGEN_MS = 60000;   // cada cuántos ms se recupera 1 de energía (60000 = 1 minuto).

const POINTS_PER_LEVEL = 5;      // puntos de estadística que da cada nivel.
const XP_BASE = 100;             // XP necesaria para pasar del nivel 1 al 2.
const XP_GROWTH = 1.1;           // cada nivel pide 10% más XP que el anterior.
const STAT_COST = 1500;          // dinero que cuesta comprar 1 punto de estadística.
const RESET_STATS_COST = 500;    // reinicio de estadísticas: 1ª vez 500, 2ª 1000, 3ª 1500...

// ---------- Bolsa de dinero (ganancias de gangster) ----------
const POUCH_PER_SECOND = 1;      // pesos que suma la bolsa por segundo (solo mientras estás conectado).
const POUCH_MAX = 0;             // tope de la bolsa (0 = sin tope).

const CLAN_JOIN_LEVEL = 5;       // nivel mínimo para unirse a un clan.
const CLAN_CREATE_LEVEL = 10;    // nivel mínimo para crear un clan.
const CLAN_MAX_MEMBERS = 30;     // máximo de miembros por clan.
const CLAN_RULES_MAX = 1000;     // máximo de caracteres de las reglas del clan.

// Rangos del clan, de menor a mayor. El "lider" se sabe porque su ID está en el campo "owner" del clan.
const ROLE_RANK = { miembro: 0, oficial: 1, colider: 2, lider: 3 };
const MANAGER_ROLES = ['lider', 'colider']; // rangos que pueden expulsar, editar reglas y declarar guerras.

// ---------- Guerra de clanes ----------
const CLAN_WAR_PREP_MS = 60 * 1000;           // cuenta regresiva antes de que empiece (1 minuto).
const CLAN_WAR_COOLDOWN_MS = 10 * 60 * 1000;  // cada clan puede participar en una guerra cada 10 minutos.
const CLAN_WAR_REWARD = 5000;                 // dinero que gana CADA miembro del clan vencedor.
const CLAN_WAR_FAME = 5;                      // fama que gana cada miembro del clan vencedor.
const CLAN_WAR_XP = 200;                      // experiencia que gana cada miembro del clan vencedor.
const CLAN_WAR_HEAL_PCT = 0;                  // vida que recupera el ganador de un duelo (0 = nada, 0.2 = 20%).
const CLAN_WAR_TTL_SECONDS = 30 * 24 * 60 * 60; // las repeticiones se guardan 30 días.
const CLAN_WAR_HISTORY = 10;                  // cuántas guerras se listan en el clan.

// Cambio de nombre (de usuario y de clan): tiempo de espera entre un cambio y otro.
const NAME_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos.
const NAME_REGEX = /^[\p{L}\p{N} _.-]{3,20}$/u;
const NAME_ERROR = 'Nombre inválido: usá entre 3 y 20 letras, números, espacios, guiones o puntos.';

// Cuánto viven los mensajes y avisos antes de que MongoDB los borre solo.
const CHAT_TTL_SECONDS = 30 * 60;               // chat global: 30 minutos.
const CLAN_CHAT_TTL_SECONDS = 7 * 24 * 60 * 60; // chat de clan: 7 días.
const NOTIF_TTL_SECONDS = 7 * 24 * 60 * 60;     // notificaciones: 7 días.
const NOTIF_MAX = 30;                           // cuántas notificaciones se muestran como máximo.

// ---------- Guerra ----------
const WAR_ENERGY = 15;       // energía que cuesta pelear.
const WAR_REWARD = 300;      // dinero base al vencer (se ajusta según la diferencia de nivel).
const WAR_TURN_MS = 1400;    // cada cuánto se muestra un golpe (milisegundos).
const WAR_MAX_ACTIONS = 60;  // tope de golpes por pelea (evita peleas eternas).
const HP_PER_VIDA = 5;       // cada punto de Vida da 5 HP en combate.
const CRIT_MULT = 2;         // un crítico pega el doble.
const GRENADE_DAMAGE = 35;   // daño de una granada (no se esquiva ni se reduce con aguante).
const GRENADES_PER_FIGHT = 1; // granadas que se lanzan por pelea.

// Búsqueda de rival: cargas.
const SEARCH_MAX = 3;                         // cargas de búsqueda.
const SEARCH_RECHARGE_MS = 10 * 60 * 1000;    // al gastar la última, se recargan todas tras 10 minutos.
const NAME_SEARCH_COSTS_CHARGE = false;       // ¿buscar por nombre gasta una carga? (false = gratis)
const RIVAL_COOLDOWN_MS = 20 * 60 * 1000;     // tiempo hasta poder volver a atacar al MISMO rival.

// Emparejamiento: primero ±5 niveles; si no hay nadie, se amplía. Infinity = cualquier nivel.
const MATCH_RANGES = [5, 10, 25, Infinity];

// Premio según la diferencia de nivel (±10% por nivel, entre 30% y 200% del premio base).
const REWARD_PER_LEVEL = 0.1;
const REWARD_MIN_MULT = 0.3;
const REWARD_MAX_MULT = 2;

// Los porcentajes de combate dependen del nivel (más nivel = más puntos para el mismo porcentaje).
const PCT_BASE = 100;
const PCT_PER_LEVEL = 4;

// Topes de los porcentajes.
const ARMOR_CAP = 0.75;      // aguante: máximo 75% menos de daño.
const EXTRA_TURN_CAP = 0.5;  // velocidad: máximo 50% de turno extra.
const DODGE_CAP = 0.5;       // inteligencia: máximo 50% de esquivar.
const CRIT_CAP = 0.6;        // suerte: máximo 60% de crítico.

// Convierte una estadística en un porcentaje (0 a 1), teniendo en cuenta el NIVEL.
function pct(stat, cap, level) {
    return Math.min(cap, stat / (stat + PCT_BASE + (level - 1) * PCT_PER_LEVEL));
}

// ---------- Mochila y maletín ----------
const BAG_SLOTS = 20;          // casillas de la mochila.
const CASE_BASE = 3;           // el maletín empieza de 3x3.
const CASE_EXPANDED = 5;       // con la expansión (+2x2) pasa a 5x5.
const CASE_EXPAND_COST = 2000; // precio de la expansión.
const CASE_EXPAND_LEVEL = 10;  // nivel necesario para comprarla.

// ---------- Objetos ----------
// kind: 'consumable' (se usa desde la mochila), 'weapon' o 'grenade'. w/h: tamaño en el maletín.
// stackMax: unidades por casilla. shopQty: unidades por compra. img: ruta de la imagen (si no existe, se ve el emoji).
const ITEMS = {
    chocolate: {
        name: 'Chocolate', emoji: '🍫', img: 'img/items/chocolate.png',
        desc: 'Recupera 50 de energía. Se usa desde la mochila.',
        kind: 'consumable', energy: 50, stackMax: 10, shopQty: 1
    },
    pistola: {
        name: 'Pistola', emoji: '🔫', img: 'img/items/pistola.png', flip: true,
        desc: '+5 de daño mientras esté en el maletín de guerra. Dispara en cada turno.',
        kind: 'weapon', dmg: 5, w: 2, h: 2, stackMax: 1, shopQty: 1
    },
    granada: {
        name: 'Granada', emoji: '💣', img: 'img/items/granada.png',
        desc: 'Se lanza en tu primer ataque: 35 de daño que no se esquiva. Se gasta 1 por pelea.',
        kind: 'grenade', w: 2, h: 1, stackMax: 5, shopQty: 5
    }
};
Object.keys(ITEMS).forEach(id => { ITEMS[id].id = id; });

// Versión del catálogo que se le manda al navegador.
const ITEMS_CLIENT = {};
Object.values(ITEMS).forEach(i => {
    ITEMS_CLIENT[i.id] = {
        id: i.id, name: i.name, emoji: i.emoji, img: i.img, flip: !!i.flip, desc: i.desc,
        kind: i.kind, w: i.w || 0, h: i.h || 0, stackMax: i.stackMax
    };
});

// ---------- Tienda ----------
const SHOP_ITEMS = ['chocolate', 'pistola', 'granada']; // qué objetos vende.
const SHOP_REFRESH_MS = 60 * 60 * 1000;                 // se actualiza cada 1 hora.
const SHOP_MANUAL_MAX = 2;                              // recargas manuales por día.
const SHOP_MANUAL_RESET_MS = 24 * 60 * 60 * 1000;       // se reponen 24 h después de la primera que uses.
const PRICE_MIN = 300;
const PRICE_MAX = 700;

// Estadísticas del personaje.
const STATS = [
    { id: 'vida',         label: 'Vida',         icon: '❤️' },
    { id: 'dano',         label: 'Daño',         icon: '💥' },
    { id: 'aguante',      label: 'Aguante',      icon: '🛡️' },
    { id: 'velocidad',    label: 'Velocidad',    icon: '🏃' },
    { id: 'inteligencia', label: 'Inteligencia', icon: '🧠' },
    { id: 'suerte',       label: 'Suerte',       icon: '🍀' }
];
const STAT_IDS = STATS.map(s => s.id);

// Clases de personaje: cada una define sus estadísticas iniciales.
const CLASSES = {
    maton:     { name: 'Matón',     stats: { vida: 20, dano: 15, aguante: 25, velocidad: 13, inteligencia: 11, suerte: 15 } },
    estafador: { name: 'Estafador', stats: { vida: 14, dano: 15, aguante: 12, velocidad: 18, inteligencia: 24, suerte: 16 } },
    ladron:    { name: 'Ladrón',    stats: { vida: 15, dano: 15, aguante: 13, velocidad: 26, inteligencia: 14, suerte: 16 } },
    apostador: { name: 'Apostador', stats: { vida: 16, dano: 15, aguante: 14, velocidad: 14, inteligencia: 14, suerte: 26 } },
    sicario:   { name: 'Sicario',   stats: { vida: 18, dano: 15, aguante: 16, velocidad: 20, inteligencia: 14, suerte: 16 } }
};
const DEFAULT_CLASS = 'maton';

// Misiones. drops: objetos raros que pueden caer al terminar (chance: 0.03 = 3%).
const MISSIONS = [
    { id: 'carteras', name: 'Robar carteras',     energy: 5,  durationMs: 10000, reward: 20,  xp: 20,  fame: 1,
      drops: [ { id: 'chocolate', chance: 0.03, qty: 1 } ] },
    { id: 'tienda',   name: 'Asaltar una tienda', energy: 15, durationMs: 30000, reward: 70,  xp: 60,  fame: 2,
      drops: [ { id: 'chocolate', chance: 0.04, qty: 1 }, { id: 'granada', chance: 0.02, qty: 2 }, { id: 'pistola', chance: 0.01, qty: 1 } ] },
    { id: 'banco',    name: 'Golpe al banco',     energy: 40, durationMs: 60000, reward: 220, xp: 180, fame: 3,
      drops: [ { id: 'chocolate', chance: 0.06, qty: 1 }, { id: 'granada', chance: 0.04, qty: 2 }, { id: 'pistola', chance: 0.02, qty: 1 } ] }
];

// ============================================================
// ESTADO EN MEMORIA
// ============================================================

// Jugadores conectados AHORA. Cada uno tiene (entre otras cosas): key (ID interno FIJO), name, money,
// pouch (bolsa de dinero), energy, level, xp, fame, stats, statResets, clanId, bag, briefcase, shop, rival...
const online = {};

// Cachés leídos de la base cada 10 segundos (incluyen jugadores desconectados):
let topScoreCache = [];
let topFameCache = [];
let clanCache = [];

// Temporizadores de las guerras de clanes en preparación: { warId: temporizador }.
const clanWarTimers = {};

// ============================================================
// FUNCIONES DE AYUDA
// ============================================================

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
    const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20).trim();
    return NAME_REGEX.test(name) ? name : null;
}

function findUserByNameKey(nameKey) {
    return users.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}
function findClanByNameKey(nameKey) {
    return clans.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}

function xpNeeded(level) {
    return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

// Suma experiencia y sube de nivel las veces que haga falta (también sirve para un objeto cualquiera
// que tenga xp, level, statPoints y fame). Devuelve cuántos niveles subió.
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

// Cuánto cuesta el próximo reinicio de estadísticas (500, 1000, 1500...).
function resetCost(p) {
    return RESET_STATS_COST * (p.statResets + 1);
}

function resolveStats(user) {
    const cls = CLASSES[user.class] ? user.class : DEFAULT_CLASS;
    const base = CLASSES[cls].stats;
    const stats = {};
    STAT_IDS.forEach(id => { stats[id] = user.stats?.[id] ?? base[id]; });
    return { cls, stats };
}

// ---------- Limpieza de datos que vienen de la base ----------
function sanitizeBag(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(s => s && ITEMS[s.id] && Number.isInteger(s.qty) && s.qty > 0)
        .slice(0, BAG_SLOTS)
        .map(s => ({ id: s.id, qty: Math.min(s.qty, ITEMS[s.id].stackMax) }));
}
function sanitizeCase(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(it => it && ITEMS[it.id] && ITEMS[it.id].w && Number.isInteger(it.x) && Number.isInteger(it.y) && it.uid && it.qty > 0)
        .map(it => ({ uid: String(it.uid), id: it.id, qty: Math.min(it.qty, ITEMS[it.id].stackMax), x: it.x, y: it.y }));
}
function sanitizeRecent(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(r => r && typeof r.key === 'string' && Number.isFinite(r.at)).map(r => ({ key: r.key, at: r.at }));
}
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
        clanName: null,
        clanRole: user.clanRole ?? 'miembro',
        busy: false,
        rival: sanitizeRival(user.rival),
        fight: null,
        searching: false,
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

// Devuelve { clan, role } con el clan del jugador y su rango REAL (verificado contra la base).
async function getClanAndRole(p) {
    if (!p.clanId) return null;
    const clan = await clans.findOne({ _id: p.clanId });
    if (!clan) return null;
    return { clan, role: clan.owner === p.key ? 'lider' : p.clanRole };
}

// ¿Puede alguien con rango "actorRole" expulsar o cambiar el rango de alguien con "targetRole"?
function canManage(actorRole, targetRole) {
    if (actorRole === 'lider') return targetRole !== 'lider';
    if (actorRole === 'colider') return targetRole === 'miembro' || targetRole === 'oficial';
    return false;
}

async function findClanMember(clan, key) {
    const doc = await users.findOne({ _id: key, clanId: clan._id }, { projection: { clanRole: 1 } });
    if (!doc) return null;
    const live = findOnlineByKey(key);
    const stored = live ? live.p.clanRole : doc.clanRole;
    const role = clan.owner === key ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro');
    return { live, role };
}

// ============================================================
// MOCHILA Y MALETÍN
// ============================================================

function newUid() { return crypto.randomBytes(4).toString('hex'); }
function caseSize(p) { return p.caseExpanded ? CASE_EXPANDED : CASE_BASE; }

// Agrega "qty" unidades a la mochila. Devuelve false (sin cambiar nada) si no hay lugar para todas.
function addToBag(p, id, qty) {
    const def = ITEMS[id];
    let room = (BAG_SLOTS - p.bag.length) * def.stackMax;
    p.bag.forEach(s => { if (s.id === id) room += def.stackMax - s.qty; });
    if (room < qty) return false;

    let left = qty;
    for (const s of p.bag) {
        if (left <= 0) break;
        if (s.id === id && s.qty < def.stackMax) {
            const add = Math.min(left, def.stackMax - s.qty);
            s.qty += add;
            left -= add;
        }
    }
    while (left > 0) {
        const add = Math.min(left, def.stackMax);
        p.bag.push({ id, qty: add });
        left -= add;
    }
    return true;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// ¿Entra el objeto "def" en la posición (x, y) del maletín?
function canPlace(p, def, x, y, ignoreUid) {
    const size = caseSize(p);
    if (!def.w || x < 0 || y < 0 || x + def.w > size || y + def.h > size) return false;
    for (const it of p.briefcase) {
        if (it.uid === ignoreUid) continue;
        const d = ITEMS[it.id];
        if (rectsOverlap(x, y, def.w, def.h, it.x, it.y, d.w, d.h)) return false;
    }
    return true;
}

function findSpot(p, def) {
    const size = caseSize(p);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (canPlace(p, def, x, y, null)) return { x, y };
        }
    }
    return null;
}

// Ventajas del maletín: el arma de mayor daño es la que cuenta.
function gearOfItems(items) {
    let dmg = 0;
    let pistol = false;
    items.forEach(it => {
        const d = ITEMS[it.id];
        if (d && d.kind === 'weapon') { pistol = true; dmg = Math.max(dmg, d.dmg); }
    });
    return { dmg, pistol };
}

// Gasta 1 granada del maletín (si hay). Devuelve true si gastó una.
function consumeGrenade(p) {
    const it = p.briefcase.find(i => i.id === 'granada' && i.qty > 0);
    if (!it) return false;
    it.qty--;
    if (it.qty <= 0) p.briefcase = p.briefcase.filter(i => i !== it);
    return true;
}

function sendInventory(socketId, p) {
    io.to(socketId).emit('inventory', {
        bag: p.bag, briefcase: p.briefcase, caseSize: caseSize(p), expanded: p.caseExpanded
    });
}

function afterInventoryChange(socketId, p) {
    sendInventory(socketId, p);
    sendState(socketId, p, Date.now());
    saveProgress([p]).catch(console.error);
}

// Sortea los objetos raros que caen al terminar una misión.
function rollDrops(p, mission) {
    const got = [];
    (mission.drops || []).forEach(d => {
        if (Math.random() < d.chance) {
            const ok = addToBag(p, d.id, d.qty);
            got.push({ id: d.id, qty: d.qty, lost: !ok });
        }
    });
    return got;
}

// ============================================================
// TIENDA (cada jugador tiene la suya)
// ============================================================

function randPrice() {
    const steps = Math.floor((PRICE_MAX - PRICE_MIN) / 10);
    return PRICE_MIN + 10 * Math.floor(Math.random() * (steps + 1));
}
function newOffers() {
    return SHOP_ITEMS.map(id => ({ id, price: randPrice(), bought: false }));
}

// Actualiza la tienda si pasó la hora (y repone las recargas manuales si pasó el día).
function refreshShop(p, now) {
    let changed = false;
    const s = p.shop;
    const valid = s && Array.isArray(s.offers) && s.offers.length && s.nextAt;
    if (!valid || now >= s.nextAt) {
        p.shop = {
            offers: newOffers(),
            nextAt: now + SHOP_REFRESH_MS,
            manualLeft: valid ? s.manualLeft : SHOP_MANUAL_MAX,
            manualResetAt: valid ? s.manualResetAt : 0
        };
        changed = true;
    }
    if (p.shop.manualResetAt && now >= p.shop.manualResetAt) {
        p.shop.manualLeft = SHOP_MANUAL_MAX;
        p.shop.manualResetAt = 0;
        changed = true;
    }
    return changed;
}

function shopPayload(p, now) {
    const s = p.shop;
    return {
        offers: s.offers.map(o => ({ id: o.id, price: o.price, qty: ITEMS[o.id].shopQty, bought: o.bought })),
        nextInMs: Math.max(0, s.nextAt - now),
        manualLeft: s.manualLeft,
        manualMax: SHOP_MANUAL_MAX,
        manualResetInMs: s.manualResetAt ? Math.max(0, s.manualResetAt - now) : 0
    };
}

// ============================================================
// GUERRA (1 contra 1)
// ============================================================

function warReward(myLevel, rivalLevel) {
    const mult = Math.max(REWARD_MIN_MULT, Math.min(REWARD_MAX_MULT, 1 + (rivalLevel - myLevel) * REWARD_PER_LEVEL));
    return Math.round(WAR_REWARD * mult);
}

function refreshSearch(p, now) {
    if (p.searchCharges > 0) return;
    if (!p.searchRechargeAt) {
        p.searchRechargeAt = now + SEARCH_RECHARGE_MS;
    } else if (now >= p.searchRechargeAt) {
        p.searchCharges = SEARCH_MAX;
        p.searchRechargeAt = 0;
    }
}

function useSearch(p, now) {
    p.searchCharges = Math.max(0, p.searchCharges - 1);
    if (p.searchCharges === 0) p.searchRechargeAt = now + SEARCH_RECHARGE_MS;
}

function recentKeys(p, now) {
    p.recentAttacks = p.recentAttacks.filter(r => now - r.at < RIVAL_COOLDOWN_MS);
    return p.recentAttacks.map(r => r.key);
}

function cooldownLeft(p, key, now) {
    const r = p.recentAttacks.find(x => x.key === key);
    return r ? Math.max(0, r.at + RIVAL_COOLDOWN_MS - now) : 0;
}

// Busca un rival al azar cerca del nivel del jugador, ampliando el rango si no hay nadie.
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
        const found = await users.aggregate([
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
        reward: warReward(p.level, level)
    };
}

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
        levelDiff: r.level - p.level,
        expanded: !!expanded
    };
}

// Convierte las estadísticas TOTALES de un personaje en un "luchador".
function makeFighter(name, level, cls, stats, pistol, grenades) {
    const maxHp = stats.vida * HP_PER_VIDA;
    return {
        name, level, className: CLASSES[cls].name,
        maxHp, hp: maxHp,
        dano: stats.dano, aguante: stats.aguante, velocidad: stats.velocidad,
        inteligencia: stats.inteligencia, suerte: stats.suerte,
        pistol: !!pistol,
        grenades: grenades || 0
    };
}

// Un golpe de "att" contra "def". Devuelve { result: 'hit' | 'crit' | 'dodge', dmg }.
function resolveHit(att, def) {
    if (Math.random() < pct(def.inteligencia, DODGE_CAP, def.level)) return { result: 'dodge', dmg: 0 };
    let dmg = att.dano * (0.85 + Math.random() * 0.3);
    const crit = Math.random() < pct(att.suerte, CRIT_CAP, att.level);
    if (crit) dmg *= CRIT_MULT;
    dmg *= 1 - pct(def.aguante, ARMOR_CAP, def.level);
    dmg = Math.max(1, Math.round(dmg));
    def.hp = Math.max(0, def.hp - dmg);
    return { result: crit ? 'crit' : 'hit', dmg };
}

// Una granada: no se esquiva ni la reduce el aguante.
function resolveGrenade(def) {
    const dmg = Math.max(1, Math.round(GRENADE_DAMAGE * (0.85 + Math.random() * 0.3)));
    def.hp = Math.max(0, def.hp - dmg);
    return { result: 'boom', dmg };
}

// Simula la pelea COMPLETA de una vez. Respeta la vida con la que llega cada luchador
// (así sirve también para los duelos de la guerra de clanes, donde el ganador sigue herido).
function simulateFight(me, rival) {
    const events = [];
    let actions = 0;
    let meTurn = me.velocidad !== rival.velocidad ? me.velocidad > rival.velocidad : Math.random() < 0.5;

    const act = (att, def, actor, extra) => {
        let r;
        let weapon = null;
        if (att.grenades > 0) {
            att.grenades--;
            weapon = 'grenade';
            r = resolveGrenade(def);
        } else {
            r = resolveHit(att, def);
            if (att.pistol) weapon = 'pistol';
        }
        actions++;
        events.push({ actor, result: r.result, dmg: r.dmg, extra, weapon, hpMe: me.hp, hpRival: rival.hp });
    };

    while (me.hp > 0 && rival.hp > 0 && actions < WAR_MAX_ACTIONS) {
        const att = meTurn ? me : rival;
        const def = meTurn ? rival : me;
        const actor = meTurn ? 'me' : 'rival';

        act(att, def, actor, false);

        if (def.hp > 0 && actions < WAR_MAX_ACTIONS && Math.random() < pct(att.velocidad, EXTRA_TURN_CAP, att.level)) {
            act(att, def, actor, true);
        }
        meTurn = !meTurn;
    }

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
function endFight(socketId, p, instant) {
    const f = p.fight;
    if (!f) return;
    clearInterval(f.timer);
    const rv = p.rival;
    p.fight = null;
    p.rival = null;

    const reward = f.result === 'win' ? f.reward : 0;
    p.money += reward;

    if (rv) notifyDefender(p, rv, f).catch(console.error);

    if (!instant) {
        io.to(socketId).emit('warEnd', { result: f.result, reward, rivalName: rv ? rv.name : '' });
        sendState(socketId, p, Date.now());
        saveProgress([p]).catch(console.error);
    }
}

// Crea la notificación para el defensor y, si está conectado, se la manda al instante.
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
    const res = await notifications.insertOne(doc);
    const live = findOnlineByKey(rv.key);
    if (live) io.to(live.id).emit('notification', formatNote({ ...doc, _id: res.insertedId }));
}

// Convierte una notificación de la base en lo que se le manda al navegador.
// Hay dos tipos: 'attack' (te atacaron, con registro) y 'clanwar' (resultado de una guerra de clanes, solo texto).
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

// ============================================================
// GUERRA DE CLANES
// Flujo: el líder/colíder declara → cuenta regresiva de 1 minuto (todos se preparan) →
// el servidor junta a TODOS los miembros de los dos clanes, los hace pelear uno a la vez
// y guarda la repetición completa → los miembros del clan ganador reciben el premio.
// ============================================================

// Intenta "reservar" un clan: solo funciona si no tiene otra guerra en los últimos 10 minutos.
async function lockClan(clanId, now, until) {
    const r = await clans.updateOne(
        { _id: clanId, $or: [{ warLockUntil: { $exists: false } }, { warLockUntil: { $lte: now } }] },
        { $set: { warLockUntil: until } }
    );
    return r.matchedCount === 1;
}

// Resumen de una guerra para mandar al navegador (tiempos RESTANTES, no horas absolutas).
function warPayload(war, status) {
    return {
        warId: war._id,
        status: status || war.status,
        attackerName: war.attackerName,
        defenderName: war.defenderName,
        winnerName: war.winnerName || null,
        startsInMs: Math.max(0, war.startAt - Date.now())
    };
}

// Avisa a los miembros conectados de los dos clanes.
function emitWarUpdate(war, data) {
    emitToClan(war.attackerId, 'clanWarUpdate', data);
    emitToClan(war.defenderId, 'clanWarUpdate', data);
}

// Programa el momento en que arranca la guerra (cuando termina la cuenta regresiva).
function scheduleClanWar(warId, startAt) {
    clearTimeout(clanWarTimers[warId]);
    clanWarTimers[warId] = setTimeout(() => {
        resolveClanWar(warId).catch(e => console.error('Error en la guerra de clanes:', e));
    }, Math.max(0, startAt - Date.now()));
}

// Junta a TODOS los miembros del clan (conectados o no) como luchadores.
// Los conectados usan sus datos en vivo; los demás, lo guardado en la base.
// Orden de pelea: de menor a mayor rango y nivel (el líder pelea último).
async function buildClanTeam(clan) {
    const docs = await users.find({ clanId: clan._id }).limit(CLAN_MAX_MEMBERS).toArray();
    const team = docs.map(d => {
        const live = findOnlineByKey(d._id);
        const src = live ? live.p : d;
        const { cls, stats } = live ? { cls: live.p.cls, stats: live.p.stats } : resolveStats(d);
        const gear = gearOfItems(live ? live.p.briefcase : sanitizeCase(d.briefcase));
        const stored = live ? live.p.clanRole : d.clanRole;
        const role = d._id === clan.owner ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro');
        // Las granadas no se usan en las guerras de clanes (el último parámetro es 0); la pistola sí.
        const f = makeFighter(src.name, src.level ?? 1, cls, { ...stats, dano: stats.dano + gear.dmg }, gear.pistol, 0);
        f.key = d._id;
        f.role = role;
        return f;
    });
    team.sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.level - b.level);
    return team;
}

// Foto de un luchador para la repetición (con su vida al empezar el duelo).
function snapFighter(f) {
    return {
        name: f.name, level: f.level, className: f.className, maxHp: f.maxHp, hp: f.hp, pistol: f.pistol,
        stats: { vida: Math.round(f.maxHp / HP_PER_VIDA), dano: f.dano, aguante: f.aguante,
                 velocidad: f.velocidad, inteligencia: f.inteligencia, suerte: f.suerte }
    };
}

// Simula la guerra entera: el primero de A vs el primero de B; el que gana (con la vida que le queda)
// se enfrenta al siguiente rival, hasta que un equipo se queda sin luchadores.
function simulateClanWar(teamA, teamB) {
    const duels = [];
    let ia = 0;
    let ib = 0;
    while (ia < teamA.length && ib < teamB.length) {
        const a = teamA[ia];
        const b = teamB[ib];
        const snapA = snapFighter(a);
        const snapB = snapFighter(b);

        const out = simulateFight(a, b); // modifica la vida de a y b.
        // Ganador del duelo: el que dejó al otro sin vida; si se acabaron los golpes, el de más vida (%);
        // si hay empate exacto, se sortea (así la guerra siempre avanza).
        const winner = out.result === 'win' ? 'a' : out.result === 'lose' ? 'b' : (Math.random() < 0.5 ? 'a' : 'b');
        const byTime = a.hp > 0 && b.hp > 0;   // nadie murió: ganó por tener más vida.
        const loser = winner === 'a' ? b : a;
        const champ = winner === 'a' ? a : b;
        loser.hp = 0;
        champ.hp = Math.min(champ.maxHp, champ.hp + Math.round(champ.maxHp * CLAN_WAR_HEAL_PCT));

        // Eventos en formato compacto: [quién (0 = A, 1 = B), resultado (0 golpe, 1 crítico, 2 esquive),
        // daño, turno extra, pistola, vida de A, vida de B].
        const ev = out.events.map(e => [
            e.actor === 'me' ? 0 : 1,
            e.result === 'crit' ? 1 : e.result === 'dodge' ? 2 : 0,
            e.dmg, e.extra ? 1 : 0, e.weapon === 'pistol' ? 1 : 0, e.hpMe, e.hpRival
        ]);
        duels.push({ ia, ib, a: snapA, b: snapB, ev, w: winner, t: byTime ? 1 : 0 });

        if (winner === 'a') ib++; else ia++;
    }
    return { duels, winner: ia < teamA.length ? 'a' : 'b' };
}

// Paga el premio a UN miembro del clan ganador (esté conectado o no).
async function giveWarReward(key) {
    const live = findOnlineByKey(key);
    if (live) {
        // Conectado: se actualiza su memoria (el guardado automático no pisa el premio).
        const p = live.p;
        p.money += CLAN_WAR_REWARD;
        p.fame += CLAN_WAR_FAME;
        addXp(p, CLAN_WAR_XP);
        sendState(live.id, p, Date.now());
        saveProgress([p]).catch(console.error);
        return;
    }
    // Desconectado: se actualiza directo en la base (la XP puede subirle de nivel).
    const d = await users.findOne({ _id: key }, { projection: { money: 1, xp: 1, level: 1, fame: 1, statPoints: 1 } });
    if (!d) return;
    const t = {
        money: (d.money ?? 0) + CLAN_WAR_REWARD, fame: (d.fame ?? 0) + CLAN_WAR_FAME,
        xp: d.xp ?? 0, level: d.level ?? 1, statPoints: d.statPoints ?? 0
    };
    addXp(t, CLAN_WAR_XP);
    await users.updateOne({ _id: key }, { $set: { money: t.money, fame: t.fame, xp: t.xp, level: t.level, statPoints: t.statPoints } });
}

// Crea la notificación del resultado para todos los miembros de los dos clanes.
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
    const res = await notifications.insertMany(docs);
    docs.forEach((d, i) => {
        const live = findOnlineByKey(d.userId);
        if (live) io.to(live.id).emit('notification', formatNote({ ...d, _id: res.insertedIds[i] }));
    });
}

// Cancela una guerra (por ejemplo si uno de los clanes dejó de existir).
async function cancelClanWar(war, message) {
    await clanWars.updateOne({ _id: war._id }, { $set: { status: 'cancelled' } });
    emitWarUpdate(war, { ...warPayload(war, 'cancelled'), message });
}

// Termina la cuenta regresiva: arma los equipos, simula la guerra, guarda la repetición y paga los premios.
async function resolveClanWar(warId) {
    delete clanWarTimers[warId];

    // "Tomamos" la guerra una sola vez (si ya la tomó otro proceso, no hacemos nada).
    const claim = await clanWars.updateOne({ _id: warId, status: 'prep' }, { $set: { status: 'running' } });
    if (claim.modifiedCount !== 1) return;
    const war = await clanWars.findOne({ _id: warId });

    const clanA = await clans.findOne({ _id: war.attackerId });
    const clanB = await clans.findOne({ _id: war.defenderId });
    if (!clanA || !clanB) return cancelClanWar(war, 'Uno de los clanes ya no existe: la guerra se canceló.');

    const teamA = await buildClanTeam(clanA);
    const teamB = await buildClanTeam(clanB);
    if (!teamA.length || !teamB.length) return cancelClanWar(war, 'Uno de los clanes se quedó sin miembros: la guerra se canceló.');

    // Listas de participantes (en orden de pelea) y sus IDs, antes de que la simulación les cambie la vida.
    const rosterOf = (team) => team.map(f => ({ name: f.name, level: f.level, role: f.role }));
    const rosterA = rosterOf(teamA);
    const rosterB = rosterOf(teamB);
    const keysA = teamA.map(f => f.key);
    const keysB = teamB.map(f => f.key);

    const sim = simulateClanWar(teamA, teamB);
    const winnerName = sim.winner === 'a' ? war.attackerName : war.defenderName;

    // Primero guardamos la guerra como terminada (así los premios nunca se pagan dos veces)...
    await clanWars.updateOne({ _id: warId }, { $set: {
        status: 'done', winner: sim.winner, winnerName, rosterA, rosterB, duels: sim.duels, finishedAt: new Date()
    } });
    // ...y recién después pagamos a los miembros del clan ganador.
    const winnerKeys = sim.winner === 'a' ? keysA : keysB;
    await Promise.all(winnerKeys.map(k => giveWarReward(k).catch(console.error)));
    await notifyWarMembers(war, keysA, keysB, sim.winner).catch(console.error);

    await refreshTop();      // la fama cambió: se actualizan los rankings.
    broadcastSlow();
    emitWarUpdate(war, { ...warPayload(war, 'done'), winnerName });
}

// ============================================================
// RANKINGS Y GUARDADO
// ============================================================

async function refreshTop() {
    try {
        topScoreCache = await users
            .find({}, { projection: { name: 1, score: 1 } })
            .sort({ score: -1 }).limit(50).toArray();

        topFameCache = await users
            .find({}, { projection: { name: 1, fame: 1, level: 1 } })
            .sort({ fame: -1, level: -1 }).limit(50).toArray();

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

function broadcast() {
    io.emit('players', buildActivityRanking());
}

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
    const items = rollDrops(p, mission);

    return { name: mission.name, reward: mission.reward, xp: mission.xp, fame: mission.fame, levelsGained, level: p.level, items };
}

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
    const gear = gearOfItems(p.briefcase);
    const total = { ...p.stats, dano: p.stats.dano + gear.dmg };
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
        stats: p.stats,
        bonus: gear.dmg ? { dano: gear.dmg } : {},
        totalStats: total,
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

function sendState(socketId, p, now) {
    io.to(socketId).emit('state', buildState(p, now));
}

// ============================================================
// SOCKET.IO: se ejecuta cada vez que un cliente se conecta
// ============================================================
io.on('connection', (socket) => {
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
                    await users.insertOne(user);
                } catch (e) {
                    if (e.code === 11000) return cb({ ok: false, error: 'Ese nombre se acaba de ocupar, probá de nuevo.' });
                    throw e;
                }
            }

            const player = buildPlayer(user._id, user, now);

            if (player.clanId) {
                const clan = await clans.findOne({ _id: player.clanId });
                if (clan) player.clanName = clan.name;
                else player.clanId = null;
            }

            if (Object.values(online).some(p => p.key === player.key)) {
                return cb({ ok: false, code: 'online', error: 'Ese usuario ya está conectado.' });
            }
            online[socket.id] = player;

            refreshEnergy(player, now);
            refreshSearch(player, now);
            refreshShop(player, now);
            const finished = finishMissionIfDone(player, now);

            cb({ ok: true, name: user.name });

            // Configuración que necesita el navegador para dibujar la interfaz.
            socket.emit('config', {
                stats: STATS,
                items: ITEMS_CLIENT,
                clanJoinLevel: CLAN_JOIN_LEVEL,
                clanCreateLevel: CLAN_CREATE_LEVEL,
                pointsPerLevel: POINTS_PER_LEVEL,
                chatTtlMs: CHAT_TTL_SECONDS * 1000,
                statCost: STAT_COST,
                resetStatsBase: RESET_STATS_COST,
                pouchPerSecond: POUCH_PER_SECOND,
                warEnergy: WAR_ENERGY,
                warReward: WAR_REWARD,
                warTurnMs: WAR_TURN_MS,
                searchMax: SEARCH_MAX,
                searchRechargeMs: SEARCH_RECHARGE_MS,
                rivalCooldownMs: RIVAL_COOLDOWN_MS,
                nameCooldownMs: NAME_COOLDOWN_MS,
                clanRulesMax: CLAN_RULES_MAX,
                clanWarPrepMs: CLAN_WAR_PREP_MS,
                clanWarCooldownMs: CLAN_WAR_COOLDOWN_MS,
                clanWarReward: CLAN_WAR_REWARD,
                clanWarFame: CLAN_WAR_FAME,
                clanWarXp: CLAN_WAR_XP,
                bagSlots: BAG_SLOTS,
                caseExpandCost: CASE_EXPAND_COST,
                caseExpandLevel: CASE_EXPAND_LEVEL,
                caseBase: CASE_BASE,
                caseExpandedSize: CASE_EXPANDED,
                grenadeDamage: GRENADE_DAMAGE
            });
            socket.emit('missions', MISSIONS);
            sendState(socket.id, player, now);
            sendInventory(socket.id, player);
            socket.emit('shop', shopPayload(player, now));
            if (player.rival) socket.emit('rivalFound', rivalPayload(player, false));

            // Si su clan está en plena cuenta regresiva de una guerra, se lo avisamos.
            if (player.clanId) {
                const prep = await clanWars.findOne({
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
            const notes = await notifications.find({ userId: player.key }).sort({ createdAt: -1 }).limit(NOTIF_MAX).toArray();
            socket.emit('notifications', notes.map(formatNote));

            // Historial del chat global: solo los últimos 30 minutos (máximo 50 mensajes).
            const since = Date.now() - CHAT_TTL_SECONDS * 1000;
            const last = await messages.find({ ts: { $gte: since } }).sort({ ts: -1 }).limit(50).toArray();
            socket.emit('chatHistory', last.reverse().map(m => ({ name: m.name, text: m.text, ts: m.ts })));
        } catch (err) {
            console.error(err);
            cb({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    socket.on('readNotifications', async () => {
        const p = online[socket.id];
        if (!p) return;
        try {
            await notifications.updateMany({ userId: p.key, read: false }, { $set: { read: true } });
        } catch (e) { console.error(e); }
    });

    // ---------- BOLSA DE DINERO: RECLAMAR LAS GANANCIAS ----------
    socket.on('claimPouch', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const amount = Math.floor(p.pouch);
        if (amount < 1) return reply({ ok: false, error: 'La bolsa está vacía. Esperá a que se llene.' });

        p.money += amount;   // el dinero pasa a tu billetera...
        p.pouch = 0;         // ...y la bolsa vuelve a empezar desde cero.

        sendState(socket.id, p, Date.now());
        saveProgress([p]).catch(console.error);
        reply({ ok: true, amount });
    });

    // ---------- REINICIAR ESTADÍSTICAS ----------
    // Vuelven a las básicas de la clase (hoy, Matón) y TODOS los demás puntos quedan libres para repartir.
    // Cuesta 500 la primera vez, 1000 la segunda, 1500 la tercera...
    socket.on('resetStats', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés reiniciar tus estadísticas en plena pelea.' });

        const cost = resetCost(p);
        if (p.money < cost) return reply({ ok: false, error: `Necesitás 💵 ${cost} para reiniciar tus estadísticas.` });

        const base = CLASSES[p.cls].stats;
        const sum = (obj) => STAT_IDS.reduce((acc, id) => acc + obj[id], 0);
        // Puntos totales que tiene hoy el jugador (repartidos + sin repartir), menos lo que ya traen las básicas.
        const freePoints = Math.max(0, sum(p.stats) + p.statPoints - sum(base));

        p.money -= cost;
        p.statResets++;
        p.stats = { ...base };
        p.statPoints = freePoints;

        sendState(socket.id, p, Date.now());
        saveProgress([p]).catch(console.error);
        reply({ ok: true, cost, points: freePoints });
    });

    // ---------- CAMBIAR MI NOMBRE DE USUARIO ----------
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
                await users.updateOne({ _id: p.key }, { $set: { name, nameKey, nameChangedAt: now } });
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
        if (p.energy < mission.energy) return reply({ ok: false, error: 'No tenés suficiente energía.' });

        p.energy -= mission.energy;
        p.mission = { id: mission.id, endsAt: now + mission.durationMs };

        sendState(socket.id, p, now);
        reply({ ok: true });
        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- GASTAR UN PUNTO DE ESTADÍSTICA ----------
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

        p.money -= STAT_COST;
        p.stats[statId]++;

        sendState(socket.id, p, Date.now());
        reply({ ok: true });
        try { await saveProgress([p]); } catch (e) { console.error(e); }
    });

    // ---------- TIENDA: COMPRAR UNA OFERTA ----------
    socket.on('buyOffer', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const now = Date.now();
        if (refreshShop(p, now)) socket.emit('shop', shopPayload(p, now));

        const offer = p.shop.offers.find(o => o.id === data?.id);
        if (!offer) return reply({ ok: false, error: 'Esa oferta no existe.' });
        if (offer.price !== data?.price) return reply({ ok: false, error: 'La tienda se actualizó. Revisá los precios nuevos.' });
        if (offer.bought) return reply({ ok: false, error: 'Ya compraste esta oferta. Esperá a que se actualice la tienda.' });
        if (p.money < offer.price) return reply({ ok: false, error: `Te faltan 💵 ${offer.price - p.money}.` });

        if (!addToBag(p, offer.id, ITEMS[offer.id].shopQty)) return reply({ ok: false, error: 'Tu mochila está llena.' });
        p.money -= offer.price;
        offer.bought = true;

        socket.emit('shop', shopPayload(p, now));
        afterInventoryChange(socket.id, p);
        reply({ ok: true, name: ITEMS[offer.id].name, qty: ITEMS[offer.id].shopQty });
    });

    // ---------- TIENDA: RECARGA MANUAL (2 por día) ----------
    socket.on('refreshShopManual', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const now = Date.now();
        refreshShop(p, now);
        if (p.shop.manualLeft < 1) {
            return reply({ ok: false, error: `Ya usaste tus ${SHOP_MANUAL_MAX} recargas de hoy. Se reponen en ${fmtWait(p.shop.manualResetAt - now)}.` });
        }
        p.shop.manualLeft--;
        if (!p.shop.manualResetAt) p.shop.manualResetAt = now + SHOP_MANUAL_RESET_MS;
        p.shop.offers = newOffers();
        p.shop.nextAt = now + SHOP_REFRESH_MS;

        socket.emit('shop', shopPayload(p, now));
        saveProgress([p]).catch(console.error);
        reply({ ok: true });
    });

    // ---------- USAR UN OBJETO DE LA MOCHILA (chocolate) ----------
    socket.on('useItem', (idx, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const stack = Number.isInteger(idx) ? p.bag[idx] : null;
        if (!stack) return reply({ ok: false, error: 'Ese objeto ya no está en tu mochila.' });
        const def = ITEMS[stack.id];
        if (def.kind !== 'consumable') return reply({ ok: false, error: 'Ese objeto no se puede usar acá.' });

        const now = Date.now();
        refreshEnergy(p, now);
        if (p.energy >= MAX_ENERGY) return reply({ ok: false, error: 'Ya tenés la energía llena.' });

        p.energy = Math.min(MAX_ENERGY, p.energy + def.energy);
        if (p.energy >= MAX_ENERGY) p.energyAt = now;
        stack.qty--;
        if (stack.qty <= 0) p.bag.splice(idx, 1);

        afterInventoryChange(socket.id, p);
        reply({ ok: true, message: `${def.emoji} Usaste ${def.name}: +${def.energy} de energía.` });
    });

    // ---------- MALETÍN: PONER UN OBJETO (de la mochila al maletín) ----------
    socket.on('placeInCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const idx = data?.idx;
        const stack = Number.isInteger(idx) ? p.bag[idx] : null;
        if (!stack) return reply({ ok: false, error: 'Ese objeto ya no está en tu mochila.' });
        const def = ITEMS[stack.id];
        if (!def.w) return reply({ ok: false, error: 'Ese objeto no va en el maletín de guerra.' });

        let spot;
        if (Number.isInteger(data?.x) && Number.isInteger(data?.y)) {
            if (!canPlace(p, def, data.x, data.y, null)) return reply({ ok: false, error: 'No entra en ese lugar.' });
            spot = { x: data.x, y: data.y };
        } else {
            spot = findSpot(p, def);
            if (!spot) return reply({ ok: false, error: 'No hay lugar en el maletín. Sacá algo o expandilo.' });
        }

        p.bag.splice(idx, 1);
        p.briefcase.push({ uid: newUid(), id: stack.id, qty: stack.qty, x: spot.x, y: spot.y });
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: MOVER UN OBJETO DENTRO DEL MALETÍN ----------
    socket.on('moveInCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const it = p.briefcase.find(i => i.uid === data?.uid);
        if (!it) return reply({ ok: false, error: 'Ese objeto ya no está en el maletín.' });
        if (!Number.isInteger(data?.x) || !Number.isInteger(data?.y)) return reply({ ok: false, error: 'Posición inválida.' });
        if (!canPlace(p, ITEMS[it.id], data.x, data.y, it.uid)) return reply({ ok: false, error: 'No entra en ese lugar.' });

        it.x = data.x;
        it.y = data.y;
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: SACAR UN OBJETO (vuelve a la mochila) ----------
    socket.on('removeFromCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const it = p.briefcase.find(i => i.uid === data?.uid);
        if (!it) return reply({ ok: false, error: 'Ese objeto ya no está en el maletín.' });
        if (!addToBag(p, it.id, it.qty)) return reply({ ok: false, error: 'Tu mochila está llena.' });

        p.briefcase = p.briefcase.filter(i => i !== it);
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: COMPRAR LA EXPANSIÓN (+2x2, de 3x3 a 5x5) ----------
    socket.on('expandCase', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.caseExpanded) return reply({ ok: false, error: 'Tu maletín ya está expandido.' });
        if (p.level < CASE_EXPAND_LEVEL) return reply({ ok: false, error: `Necesitás nivel ${CASE_EXPAND_LEVEL} para expandir el maletín.` });
        if (p.money < CASE_EXPAND_COST) return reply({ ok: false, error: `Necesitás 💵 ${CASE_EXPAND_COST}.` });

        p.money -= CASE_EXPAND_COST;
        p.caseExpanded = true;
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- GUERRA: BUSCAR RIVAL AL AZAR (gasta 1 de las 3 cargas) ----------
    socket.on('searchRival', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
        if (p.searching) return reply({ ok: false, error: 'Ya estás buscando.' });

        const now = Date.now();
        refreshSearch(p, now);
        if (p.searchCharges < 1) {
            return reply({ ok: false, error: `Te quedaste sin búsquedas. Se recargan en ${fmtWait(p.searchRechargeAt - now)}.` });
        }
        if (now - p.lastSearch < 800) return reply({ ok: false, error: 'Esperá un momento antes de buscar de nuevo.' });
        p.lastSearch = now;

        p.searching = true;
        try {
            const result = await findRival(p, now);
            if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
            if (!result) return reply({ ok: false, error: 'No hay rivales disponibles ahora (o ya peleaste con todos hace poco).' });

            useSearch(p, Date.now());
            setRival(p, result.doc);

            sendState(socket.id, p, Date.now());
            saveProgress([p]).catch(console.error);
            reply({ ok: true, rival: rivalPayload(p, result.expanded) });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.searching = false;
        }
    });

    // ---------- GUERRA: BUSCAR JUGADORES POR NOMBRE ----------
    socket.on('findPlayers', async (rawQuery, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const now = Date.now();
        if (now - p.lastLookup < 400) return reply({ ok: false, error: 'Esperá un momento.' });
        p.lastLookup = now;

        const q = String(rawQuery || '').trim().toLowerCase().slice(0, 20);
        if (q.length < 2) return reply({ ok: false, error: 'Escribí al menos 2 letras.' });

        try {
            const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const docs = await users
                .find({ nameKey: rx, _id: { $ne: p.key } }, { projection: { name: 1, level: 1, class: 1 } })
                .limit(8).toArray();

            reply({
                ok: true,
                players: docs.map(d => ({
                    key: d._id,
                    name: d.name,
                    level: d.level ?? 1,
                    className: CLASSES[CLASSES[d.class] ? d.class : DEFAULT_CLASS].name,
                    cooldownMs: cooldownLeft(p, d._id, now)
                }))
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- GUERRA: ELEGIR UN RIVAL ENCONTRADO POR NOMBRE ----------
    socket.on('chooseRival', async (rawKey, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
        if (p.searching) return reply({ ok: false, error: 'Esperá un momento.' });

        const key = String(rawKey || '');
        if (!key || key === p.key) return reply({ ok: false, error: 'Rival inválido.' });

        const now = Date.now();
        const wait = cooldownLeft(p, key, now);
        if (wait > 0) {
            return reply({ ok: false, error: `Ya peleaste con ese jugador hace poco. Podés volver a atacarlo en ${fmtWait(wait)}.` });
        }

        p.searching = true;
        try {
            if (NAME_SEARCH_COSTS_CHARGE) {
                refreshSearch(p, now);
                if (p.searchCharges < 1) {
                    return reply({ ok: false, error: `Te quedaste sin búsquedas. Se recargan en ${fmtWait(p.searchRechargeAt - now)}.` });
                }
            }
            const doc = await users.findOne({ _id: key }, { projection: { name: 1, level: 1, class: 1, stats: 1, briefcase: 1 } });
            if (p.fight) return reply({ ok: false, error: 'Estás en medio de una pelea.' });
            if (!doc) return reply({ ok: false, error: 'Ese jugador no existe.' });

            if (NAME_SEARCH_COSTS_CHARGE) useSearch(p, Date.now());
            setRival(p, doc);

            sendState(socket.id, p, Date.now());
            saveProgress([p]).catch(console.error);
            reply({ ok: true, rival: rivalPayload(p, false) });
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

        const wait = cooldownLeft(p, p.rival.key, now);
        if (wait > 0) {
            return reply({ ok: false, error: `Ya peleaste con ese jugador hace poco. Podés volver a atacarlo en ${fmtWait(wait)}.` });
        }

        p.energy -= WAR_ENERGY;
        recentKeys(p, now);
        p.recentAttacks.push({ key: p.rival.key, at: now });

        const gear = gearOfItems(p.briefcase);
        const grenades = consumeGrenade(p) ? GRENADES_PER_FIGHT : 0;
        if (grenades) sendInventory(socket.id, p);

        const myTotal = { ...p.stats, dano: p.stats.dano + gear.dmg };
        const rvTotal = { ...p.rival.stats, dano: p.rival.stats.dano + p.rival.gear.dmg };
        const me = makeFighter(p.name, p.level, p.cls, myTotal, gear.pistol, grenades);
        const rv = makeFighter(p.rival.name, p.rival.level, p.rival.cls, rvTotal, p.rival.gear.pistol, 0);
        const outcome = simulateFight(me, rv);

        p.fight = { events: outcome.events, result: outcome.result, index: 0, timer: null, reward: p.rival.reward };
        p.fight.timer = setInterval(() => stepFight(socket.id, p), WAR_TURN_MS);

        sendState(socket.id, p, now);
        reply({ ok: true, maxHpMe: me.maxHp, maxHpRival: rv.maxHp, grenade: grenades > 0 });
        saveProgress([p]).catch(console.error);
    });

    // ---------- CLANES ----------

    socket.on('createClan', async (rawName, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            if (p.clanId) return reply({ ok: false, error: 'Ya pertenecés a un clan. Salí primero.' });
            if (p.level < CLAN_CREATE_LEVEL) {
                return reply({ ok: false, error: `Necesitás nivel ${CLAN_CREATE_LEVEL} para crear un clan.` });
            }
            const name = cleanName(rawName);
            if (!name) return reply({ ok: false, error: NAME_ERROR });

            const nameKey = name.toLowerCase();
            if (await findClanByNameKey(nameKey)) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });

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
            p.busy = false;
        }
    });

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
            emitToClan(clan._id, 'clanChanged');
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // Salir del clan. Si era el líder, hereda un Colíder (o un Oficial, o cualquier miembro);
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
                const pick = { projection: { _id: 1 } };
                const next =
                    await users.findOne({ clanId: clanKey, clanRole: 'colider' }, pick) ||
                    await users.findOne({ clanId: clanKey, clanRole: 'oficial' }, pick) ||
                    await users.findOne({ clanId: clanKey }, pick);
                if (next) {
                    await clans.updateOne({ _id: clanKey }, { $set: { owner: next._id } });
                } else {
                    await clans.deleteOne({ _id: clanKey });
                    await clanMessages.deleteMany({ clanId: clanKey });
                }
            }
            await refreshTop();
            broadcastSlow();
            emitToClan(clanKey, 'clanChanged');
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    socket.on('renameClan', async (rawName, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const ctx = await getClanAndRole(p);
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

    socket.on('setClanRules', async (rawText, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        try {
            const ctx = await getClanAndRole(p);
            if (!ctx || !MANAGER_ROLES.includes(ctx.role)) {
                return reply({ ok: false, error: 'Solo el líder y los colíderes pueden editar las reglas.' });
            }
            const text = String(rawText || '').replace(/\r\n/g, '\n').trim().slice(0, CLAN_RULES_MAX);
            await clans.updateOne({ _id: ctx.clan._id }, { $set: { rules: text } });
            emitToClan(ctx.clan._id, 'clanChanged');
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    socket.on('kickMember', async (targetKey, cb) => {
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
            const { clan, role } = ctx;

            const key = String(targetKey || '');
            if (key === p.key) return reply({ ok: false, error: 'No podés expulsarte a vos mismo. Usá "Salir del clan".' });

            const target = await findClanMember(clan, key);
            if (!target) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
            if (!canManage(role, target.role)) return reply({ ok: false, error: 'No tenés permiso sobre ese rango.' });

            if (target.live) {
                target.live.p.clanId = null;
                target.live.p.clanName = null;
                target.live.p.clanRole = 'miembro';
            }
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
            const assignable = myRole === 'lider' ? ['miembro', 'oficial', 'colider'] : ['miembro', 'oficial'];
            if (!assignable.includes(newRole)) return reply({ ok: false, error: 'No podés asignar ese rango.' });
            if (key === p.key) return reply({ ok: false, error: 'No podés cambiar tu propio rango.' });

            const target = await findClanMember(clan, key);
            if (!target) return reply({ ok: false, error: 'Ese jugador no está en tu clan.' });
            if (!canManage(myRole, target.role)) return reply({ ok: false, error: 'No tenés permiso sobre ese rango.' });
            if (target.role === newRole) return reply({ ok: true });

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
                const live = findOnlineByKey(m._id);
                const stored = live ? live.p.clanRole : m.clanRole;
                return {
                    key: m._id,
                    name: live ? live.p.name : m.name,
                    level: live ? live.p.level : (m.level ?? 1),
                    role: m._id === clan.owner ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro'),
                    online: !!live
                };
            });
            members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.level - a.level);

            const me = members.find(m => m.key === p.key);
            reply({ ok: true, clan: { name: clan.name, rules: clan.rules || '', myRole: me ? me.role : 'miembro', members } });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- GUERRA DE CLANES ----------

    // Datos de la pestaña "Guerra de clan": clanes a los que se puede atacar, guerra en preparación e historial.
    socket.on('getClanWarPanel', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p || !p.clanId) return reply({ ok: false, error: 'No pertenecés a ningún clan.' });
        try {
            const ctx = await getClanAndRole(p);
            if (!ctx) return reply({ ok: false, error: 'No pertenecés a ningún clan.' });
            const mine = ctx.clan;
            const now = Date.now();

            // Candidatos: los clanes del ranking (menos el mío), con lo que falta para que se puedan atacar.
            const others = clanCache.filter(c => c.id !== mine._id);
            const docs = await clans.find({ _id: { $in: others.map(c => c.id) } }, { projection: { warLockUntil: 1 } }).toArray();
            const locks = new Map(docs.map(d => [d._id, d.warLockUntil || 0]));
            const candidates = others.map(c => ({
                id: c.id, name: c.name, members: c.members, fame: c.fame,
                lockMs: Math.max(0, (locks.get(c.id) || 0) - now)
            }));

            const mineFilter = { $or: [{ attackerId: mine._id }, { defenderId: mine._id }] };
            const prep = await clanWars.findOne({ status: 'prep', ...mineFilter });
            const wars = await clanWars
                .find({ status: 'done', ...mineFilter }, { projection: { attackerName: 1, defenderName: 1, attackerId: 1, defenderId: 1, winner: 1, winnerName: 1, finishedAt: 1 } })
                .sort({ createdAt: -1 }).limit(CLAN_WAR_HISTORY).toArray();

            reply({
                ok: true,
                canDeclare: MANAGER_ROLES.includes(ctx.role),
                lockMs: Math.max(0, (mine.warLockUntil || 0) - now),
                candidates,
                prep: prep ? warPayload(prep) : null,
                wars: wars.map(w => ({
                    id: w._id,
                    attackerName: w.attackerName,
                    defenderName: w.defenderName,
                    winnerName: w.winnerName,
                    won: (w.winner === 'a' ? w.attackerId : w.defenderId) === mine._id,
                    ts: w.finishedAt ? w.finishedAt.getTime() : 0
                }))
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // DECLARAR una guerra (solo líder y colíderes). Empieza tras 1 minuto de preparación.
    socket.on('declareClanWar', async (targetId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.busy) return reply({ ok: false, error: 'Esperá un momento.' });
        p.busy = true;
        try {
            const ctx = await getClanAndRole(p); // el rango se verifica EN EL SERVIDOR.
            if (!ctx || !MANAGER_ROLES.includes(ctx.role)) {
                return reply({ ok: false, error: 'Solo el líder y los colíderes pueden declarar guerras.' });
            }
            const mine = ctx.clan;
            const target = await clans.findOne({ _id: String(targetId || '') });
            if (!target) return reply({ ok: false, error: 'Ese clan no existe.' });
            if (target._id === mine._id) return reply({ ok: false, error: 'No podés declararle la guerra a tu propio clan.' });
            if (!(await users.countDocuments({ clanId: target._id }))) return reply({ ok: false, error: 'Ese clan no tiene miembros.' });

            const now = Date.now();
            if ((mine.warLockUntil || 0) > now) {
                return reply({ ok: false, error: `Tu clan ya participó en una guerra hace poco. Podrá declarar otra en ${fmtWait(mine.warLockUntil - now)}.` });
            }
            if ((target.warLockUntil || 0) > now) {
                return reply({ ok: false, error: `Ese clan ya participó en una guerra hace poco. Podés atacarlo en ${fmtWait(target.warLockUntil - now)}.` });
            }

            // Reservamos los DOS clanes por 10 minutos. Si dos líderes declaran a la vez, solo uno lo logra.
            const until = now + CLAN_WAR_COOLDOWN_MS;
            if (!(await lockClan(mine._id, now, until))) {
                return reply({ ok: false, error: 'Tu clan ya está en una guerra. Esperá unos minutos.' });
            }
            if (!(await lockClan(target._id, now, until))) {
                await clans.updateOne({ _id: mine._id }, { $set: { warLockUntil: mine.warLockUntil || 0 } }); // deshacemos la reserva.
                return reply({ ok: false, error: 'Ese clan acaba de entrar en otra guerra.' });
            }

            const war = {
                _id: crypto.randomBytes(8).toString('hex'),
                status: 'prep',
                attackerId: mine._id, defenderId: target._id,
                attackerName: mine.name, defenderName: target.name,
                declaredBy: p.name,
                startAt: now + CLAN_WAR_PREP_MS,
                createdAt: new Date(now)
            };
            await clanWars.insertOne(war);
            scheduleClanWar(war._id, war.startAt);
            emitWarUpdate(war, warPayload(war)); // aviso a todos los miembros conectados de los dos clanes.
            reply({ ok: true, startsInMs: CLAN_WAR_PREP_MS });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.busy = false;
        }
    });

    // Repetición completa de una guerra (solo para miembros de los dos clanes que pelearon).
    socket.on('getClanWarReplay', async (warId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        try {
            const war = await clanWars.findOne({ _id: String(warId || ''), status: 'done' });
            if (!war) return reply({ ok: false, error: 'Esa guerra no existe (o ya se borró del historial).' });
            if (!p.clanId || (p.clanId !== war.attackerId && p.clanId !== war.defenderId)) {
                return reply({ ok: false, error: 'Solo los miembros de los clanes que pelearon pueden ver esta guerra.' });
            }
            reply({
                ok: true,
                war: {
                    id: war._id,
                    attackerName: war.attackerName, defenderName: war.defenderName,
                    winner: war.winner, winnerName: war.winnerName,
                    mySide: p.clanId === war.attackerId ? 'a' : 'b',
                    rosterA: war.rosterA, rosterB: war.rosterB, duels: war.duels,
                    reward: { money: CLAN_WAR_REWARD, fame: CLAN_WAR_FAME, xp: CLAN_WAR_XP }
                }
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- CHAT DE CLAN ----------
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

    socket.on('clanChat', async (text) => {
        const p = online[socket.id];
        if (!p || !p.clanId) return;

        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return;

        const now = Date.now();
        if (now - p.lastClanMsg < 700) return;
        p.lastClanMsg = now;

        const clanId = p.clanId;
        const msg = { name: p.name, text: clean, ts: now };
        emitToClan(clanId, 'clanChat', msg);
        try { await clanMessages.insertOne({ clanId, ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });

    // ---------- CHAT GLOBAL ----------
    socket.on('chat', async (text) => {
        const p = online[socket.id];
        if (!p) return;

        const clean = String(text || '').trim().slice(0, 200);
        if (!clean) return;

        const now = Date.now();
        if (now - p.lastMsg < 700) return;
        p.lastMsg = now;

        const msg = { name: p.name, text: clean, ts: now };
        io.emit('chat', msg);
        try { await messages.insertOne({ ...msg, createdAt: new Date(now) }); } catch (e) { console.error(e); }
    });

    // ---------- DESCONEXIÓN ----------
    socket.on('disconnect', async () => {
        const p = online[socket.id];
        delete online[socket.id];
        if (p) {
            if (p.fight) endFight(socket.id, p, true); // cerrar la página no sirve para escapar de una derrota.
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
    const entries = Object.entries(online);

    entries.forEach(([id, p]) => {
        p.score++;                  // +1 punto por segundo (ranking de actividad).
        // Bolsa de dinero: suma mientras estás conectado (con tope si POUCH_MAX es mayor que 0).
        p.pouch = POUCH_MAX ? Math.min(POUCH_MAX, p.pouch + POUCH_PER_SECOND) : p.pouch + POUCH_PER_SECOND;
        refreshEnergy(p, now);
        refreshSearch(p, now);

        if (refreshShop(p, now)) {
            io.to(id).emit('shop', shopPayload(p, now));
            saveProgress([p]).catch(console.error);
        }

        const finished = finishMissionIfDone(p, now);
        if (finished) {
            io.to(id).emit('missionDone', finished);
            if (finished.items.length) sendInventory(id, p);
            saveProgress([p]).catch(console.error);
        }

        sendState(id, p, now);
    });

    broadcast();

    ticks++;
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
    await client.connect();
    const db = client.db('juego');
    users = db.collection('users');
    messages = db.collection('messages');
    clans = db.collection('clans');
    clanMessages = db.collection('clanMessages');
    notifications = db.collection('notifications');
    clanWars = db.collection('clanWars');             // guerras de clanes y sus repeticiones.

    await safely('chat global', async () => {
        await messages.updateMany({ createdAt: { $exists: false } }, [{ $set: { createdAt: { $toDate: '$ts' } } }]);
        await messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CHAT_TTL_SECONDS });
    });
    await safely('chat de clan', async () => {
        await clanMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_CHAT_TTL_SECONDS });
        await clanMessages.createIndex({ clanId: 1, ts: -1 });
    });
    await safely('notificaciones', async () => {
        await notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: NOTIF_TTL_SECONDS });
        await notifications.createIndex({ userId: 1, createdAt: -1 });
    });
    await safely('migración de usuarios', async () => {
        await users.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        await users.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('migración de clanes', async () => {
        await clans.updateMany({ nameKey: { $exists: false } }, [{ $set: { nameKey: '$_id' } }]);
        await clans.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    });
    await safely('índice de clanId', () => users.createIndex({ clanId: 1 }));

    // Guerras de clanes: índices, limpieza de guerras que quedaron a medias y reprogramación de las que
    // estaban en cuenta regresiva cuando el servidor se reinició.
    await safely('guerras de clanes', async () => {
        await clanWars.createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAN_WAR_TTL_SECONDS });
        await clanWars.createIndex({ attackerId: 1, createdAt: -1 });
        await clanWars.createIndex({ defenderId: 1, createdAt: -1 });
        await clanWars.updateMany({ status: 'running' }, { $set: { status: 'failed' } });
        const pending = await clanWars.find({ status: 'prep' }).toArray();
        pending.forEach(w => scheduleClanWar(w._id, w.startAt));
    });

    await refreshTop();
    server.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo'));
}
start();
