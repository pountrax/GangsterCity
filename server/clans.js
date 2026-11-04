// ============================================================
// clans.js — Ayudas de clanes: quién es el líder, qué rango tiene cada uno y qué puede hacer
// (Las acciones en sí —crear, unirse, expulsar...— están en events/clans.js)
// ============================================================

const { db } = require('./state');
const { ROLE_RANK } = require('./config');
const { findOnlineByKey } = require('./players');

// Devuelve { clan, role } con el clan del jugador y su rango REAL (verificado contra la base),
// o null si no tiene clan. El líder es quien figura como "owner" del clan.
async function getClanAndRole(p) {
    if (!p.clanId) return null;
    const clan = await db.clans.findOne({ _id: p.clanId });
    if (!clan) return null;
    return { clan, role: clan.owner === p.key ? 'lider' : p.clanRole };
}

// ¿Puede alguien con rango "actorRole" expulsar o cambiar el rango de alguien con "targetRole"?
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
    const doc = await db.users.findOne({ _id: key, clanId: clan._id }, { projection: { clanRole: 1 } });
    if (!doc) return null;
    const live = findOnlineByKey(key);
    const stored = live ? live.p.clanRole : doc.clanRole;
    const role = clan.owner === key ? 'lider' : (ROLE_RANK[stored] !== undefined ? stored : 'miembro');
    return { live, role };
}

module.exports = { getClanAndRole, canManage, findClanMember };
