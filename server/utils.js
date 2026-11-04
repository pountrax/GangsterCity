// ============================================================
// utils.js — Funciones de ayuda generales (contraseñas, nombres, tiempos, niveles)
// ============================================================

const crypto = require('crypto');
const { db } = require('./state');
const { XP_BASE, XP_GROWTH, RESET_STATS_COST, NAME_REGEX } = require('./config');

// Convierte contraseña + salt en un hash ilegible (scrypt es lento a propósito).
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// ID corto aleatorio (para los objetos del maletín).
function newUid() {
    return crypto.randomBytes(4).toString('hex');
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

// Busca un usuario por su nombre en minúsculas ("nameKey"). Los viejos se encuentran por su _id.
function findUserByNameKey(nameKey) {
    return db.users.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}

// Igual, pero para clanes.
function findClanByNameKey(nameKey) {
    return db.clans.findOne({ $or: [{ nameKey }, { nameKey: { $exists: false }, _id: nameKey }] });
}

// XP necesaria para pasar del nivel "level" al siguiente.
function xpNeeded(level) {
    return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

// Cuánto cuesta el próximo reinicio de estadísticas (500, 1000, 1500...).
function resetCost(p) {
    return RESET_STATS_COST * (p.statResets + 1);
}

module.exports = {
    hashPassword, newUid, fmtWait, cleanName, findUserByNameKey, findClanByNameKey, xpNeeded, resetCost
};
