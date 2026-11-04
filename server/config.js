// ============================================================
// config.js — TODOS los números y listas del juego en un solo lugar
// Si querés cambiar un precio, un tiempo o un premio, es acá.
// Este archivo no depende de ningún otro.
// ============================================================

// ---------- Energía, niveles y dinero ----------
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

// ---------- Clanes ----------
const CLAN_JOIN_LEVEL = 5;       // nivel mínimo para unirse a un clan.
const CLAN_CREATE_LEVEL = 10;    // nivel mínimo para crear un clan.
const CLAN_MAX_MEMBERS = 30;     // máximo de miembros por clan.
const CLAN_RULES_MAX = 1000;     // máximo de caracteres de las reglas del clan.

// Rangos del clan, de menor a mayor. El "lider" se sabe porque su ID está en el campo "owner" del clan.
const ROLE_RANK = { miembro: 0, oficial: 1, colider: 2, lider: 3 };
const MANAGER_ROLES = ['lider', 'colider']; // rangos que pueden expulsar, editar reglas y declarar guerras.

// ---------- Guerra de clanes ----------
const CLAN_WAR_PREP_MS = 60 * 1000;             // cuenta regresiva antes de que empiece (1 minuto).
const CLAN_WAR_COOLDOWN_MS = 10 * 60 * 1000;    // cada clan puede participar en una guerra cada 10 minutos.
const CLAN_WAR_REWARD = 5000;                   // dinero que gana CADA miembro del clan vencedor.
const CLAN_WAR_FAME = 5;                        // fama que gana cada miembro del clan vencedor.
const CLAN_WAR_XP = 200;                        // experiencia que gana cada miembro del clan vencedor.
const CLAN_WAR_HEAL_PCT = 0;                    // vida que recupera el ganador de un duelo (0 = nada, 0.2 = 20%).
const CLAN_WAR_TTL_SECONDS = 30 * 24 * 60 * 60; // las repeticiones se guardan 30 días.
const CLAN_WAR_HISTORY = 10;                    // cuántas guerras se listan en el clan.

// ---------- Nombres ----------
const NAME_COOLDOWN_MS = 10 * 60 * 1000; // tiempo de espera entre cambios de nombre (usuario y clan).
const NAME_REGEX = /^[\p{L}\p{N} _.-]{3,20}$/u;
const NAME_ERROR = 'Nombre inválido: usá entre 3 y 20 letras, números, espacios, guiones o puntos.';

// ---------- Cuánto viven los mensajes y avisos antes de que MongoDB los borre solo ----------
const CHAT_TTL_SECONDS = 30 * 60;               // chat global: 30 minutos.
const CLAN_CHAT_TTL_SECONDS = 7 * 24 * 60 * 60; // chat de clan: 7 días.
const NOTIF_TTL_SECONDS = 7 * 24 * 60 * 60;     // notificaciones: 7 días.
const NOTIF_MAX = 30;                           // cuántas notificaciones se muestran como máximo.

// ---------- Guerra 1 contra 1 ----------
const WAR_ENERGY = 15;        // energía que cuesta pelear.
const WAR_REWARD = 300;       // dinero base al vencer (se ajusta según la diferencia de nivel).
const WAR_TURN_MS = 1400;     // cada cuánto se muestra un golpe (milisegundos).
const WAR_MAX_ACTIONS = 60;   // tope de golpes por pelea (evita peleas eternas).
const HP_PER_VIDA = 5;        // cada punto de Vida da 5 HP en combate.
const CRIT_MULT = 2;          // un crítico pega el doble.
const GRENADE_DAMAGE = 35;    // daño de una granada (no se esquiva ni se reduce con aguante).
const GRENADES_PER_FIGHT = 1; // granadas que se lanzan por pelea.

// Búsqueda de rival: cargas.
const SEARCH_MAX = 3;                      // cargas de búsqueda.
const SEARCH_RECHARGE_MS = 10 * 60 * 1000; // al gastar la última, se recargan todas tras 10 minutos.
const NAME_SEARCH_COSTS_CHARGE = false;    // ¿buscar por nombre gasta una carga? (false = gratis)
const RIVAL_COOLDOWN_MS = 20 * 60 * 1000;  // tiempo hasta poder volver a atacar al MISMO rival.

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

// Convierte una estadística en un porcentaje (0 a 1), teniendo en cuenta el NIVEL. Nunca pasa del tope "cap".
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
// stackMax: unidades por casilla. shopQty: unidades por compra.
// img: ruta de la imagen (si el archivo no existe, se ve el emoji).
// Para agregar una escopeta: copiá la pistola con w: 3, h: 2 y otro dmg.
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
Object.keys(ITEMS).forEach(id => { ITEMS[id].id = id; }); // cada objeto conoce su propio ID.

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
const PRICE_MIN = 300;                                  // precio mínimo de una oferta.
const PRICE_MAX = 700;                                  // precio máximo de una oferta.

// ---------- Estadísticas y clases ----------
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
const DEFAULT_CLASS = 'maton';

// ---------- Misiones ----------
// energy: energía que cuesta. durationMs: cuánto tarda. reward: dinero. xp: experiencia. fame: fama.
// drops: objetos raros que pueden caer al terminar (chance: 0.03 = 3%).
const MISSIONS = [
    { id: 'carteras', name: 'Robar carteras',     energy: 5,  durationMs: 10000, reward: 20,  xp: 20,  fame: 1,
      drops: [ { id: 'chocolate', chance: 0.03, qty: 1 } ] },
    { id: 'tienda',   name: 'Asaltar una tienda', energy: 15, durationMs: 30000, reward: 70,  xp: 60,  fame: 2,
      drops: [ { id: 'chocolate', chance: 0.04, qty: 1 }, { id: 'granada', chance: 0.02, qty: 2 }, { id: 'pistola', chance: 0.01, qty: 1 } ] },
    { id: 'banco',    name: 'Golpe al banco',     energy: 40, durationMs: 60000, reward: 220, xp: 180, fame: 3,
      drops: [ { id: 'chocolate', chance: 0.06, qty: 1 }, { id: 'granada', chance: 0.04, qty: 2 }, { id: 'pistola', chance: 0.02, qty: 1 } ] }
];

// ---------- Lo que se le manda al navegador al iniciar sesión (evento "config") ----------
const CLIENT_CONFIG = {
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
};

module.exports = {
    MAX_ENERGY, ENERGY_REGEN_MS, POINTS_PER_LEVEL, XP_BASE, XP_GROWTH, STAT_COST, RESET_STATS_COST,
    POUCH_PER_SECOND, POUCH_MAX,
    CLAN_JOIN_LEVEL, CLAN_CREATE_LEVEL, CLAN_MAX_MEMBERS, CLAN_RULES_MAX, ROLE_RANK, MANAGER_ROLES,
    CLAN_WAR_PREP_MS, CLAN_WAR_COOLDOWN_MS, CLAN_WAR_REWARD, CLAN_WAR_FAME, CLAN_WAR_XP, CLAN_WAR_HEAL_PCT,
    CLAN_WAR_TTL_SECONDS, CLAN_WAR_HISTORY,
    NAME_COOLDOWN_MS, NAME_REGEX, NAME_ERROR,
    CHAT_TTL_SECONDS, CLAN_CHAT_TTL_SECONDS, NOTIF_TTL_SECONDS, NOTIF_MAX,
    WAR_ENERGY, WAR_REWARD, WAR_TURN_MS, WAR_MAX_ACTIONS, HP_PER_VIDA, CRIT_MULT, GRENADE_DAMAGE, GRENADES_PER_FIGHT,
    SEARCH_MAX, SEARCH_RECHARGE_MS, NAME_SEARCH_COSTS_CHARGE, RIVAL_COOLDOWN_MS, MATCH_RANGES,
    REWARD_PER_LEVEL, REWARD_MIN_MULT, REWARD_MAX_MULT,
    PCT_BASE, PCT_PER_LEVEL, ARMOR_CAP, EXTRA_TURN_CAP, DODGE_CAP, CRIT_CAP, pct,
    BAG_SLOTS, CASE_BASE, CASE_EXPANDED, CASE_EXPAND_COST, CASE_EXPAND_LEVEL,
    ITEMS, ITEMS_CLIENT,
    SHOP_ITEMS, SHOP_REFRESH_MS, SHOP_MANUAL_MAX, SHOP_MANUAL_RESET_MS, PRICE_MIN, PRICE_MAX,
    STATS, STAT_IDS, CLASSES, DEFAULT_CLASS, MISSIONS, CLIENT_CONFIG
};
