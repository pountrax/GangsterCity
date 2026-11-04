// ============================================================
// state.js — Lo que se comparte entre todos los archivos del servidor
//   db            → la base de datos (las colecciones se llenan al arrancar, en start.js)
//   online        → jugadores conectados AHORA: { socketId: jugador }
//   cache         → rankings leídos de la base cada 10 segundos
//   clanWarTimers → temporizadores de las guerras de clanes en cuenta regresiva
// Son objetos: todos los archivos ven siempre los mismos datos.
// ============================================================

const db = {
    client: null,        // cliente de MongoDB.
    users: null,         // usuarios y todo su progreso.
    messages: null,      // chat global (los mensajes se borran solos).
    clans: null,         // clanes.
    clanMessages: null,  // chat de clan.
    notifications: null, // avisos (ataques recibidos y resultados de guerras de clanes).
    clanWars: null       // guerras de clanes y sus repeticiones.
};

// Jugadores conectados AHORA. Cada uno tiene (entre otras cosas): key (ID interno FIJO), name, money,
// pouch (bolsa de dinero), energy, level, xp, fame, stats, statResets, clanId, bag, briefcase, shop, rival...
const online = {};

// Rankings leídos de la base (incluyen jugadores desconectados).
const cache = {
    score: [],  // top 50 por tiempo jugado.
    fame: [],   // top 50 por fama.
    clans: []   // ranking de clanes.
};

// Temporizadores de las guerras de clanes en preparación: { warId: temporizador }.
const clanWarTimers = {};

module.exports = { db, online, cache, clanWarTimers };
