// ============================================================
// events/clans.js — Clanes: crear, unirse, salir, renombrar, reglas, expulsar, rangos y datos del clan
// ============================================================

const crypto = require('crypto');
const { io } = require('../core');
const { db, online } = require('../state');
const {
    CLAN_JOIN_LEVEL, CLAN_CREATE_LEVEL, CLAN_MAX_MEMBERS, CLAN_RULES_MAX, ROLE_RANK, MANAGER_ROLES,
    NAME_COOLDOWN_MS, NAME_ERROR
} = require('../config');
const { fmtWait, cleanName, findClanByNameKey } = require('../utils');
const { emitToClan, findOnlineByKey, sendState } = require('../players');
const { getClanAndRole, canManage, findClanMember } = require('../clans');
const { refreshTop, broadcastSlow } = require('../rankings');

module.exports = function registerClans(socket) {

    // ---------- CREAR UN CLAN (requiere nivel CLAN_CREATE_LEVEL). El creador queda como líder ----------
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

            // El clan tiene un ID interno aleatorio y fijo: así su nombre se puede cambiar después.
            const id = crypto.randomBytes(8).toString('hex');
            try {
                await db.clans.insertOne({ _id: id, nameKey, name, owner: p.key, rules: '', createdAt: Date.now() });
            } catch (e) {
                if (e.code === 11000) return reply({ ok: false, error: 'Ya existe un clan con ese nombre.' });
                throw e;
            }
            p.clanId = id;
            p.clanName = name;
            p.clanRole = 'miembro';
            await db.users.updateOne({ _id: p.key }, { $set: { clanId: id, clanRole: 'miembro' } });
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

    // ---------- UNIRSE A UN CLAN (requiere nivel CLAN_JOIN_LEVEL) ----------
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
            const clan = await db.clans.findOne({ _id: String(clanKey || '') });
            if (!clan) return reply({ ok: false, error: 'Ese clan no existe.' });

            const count = await db.users.countDocuments({ clanId: clan._id });
            if (count >= CLAN_MAX_MEMBERS) return reply({ ok: false, error: 'Ese clan está lleno.' });

            p.clanId = clan._id;
            p.clanName = clan.name;
            p.clanRole = 'miembro';
            await db.users.updateOne({ _id: p.key }, { $set: { clanId: clan._id, clanRole: 'miembro' } });
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

    // ---------- SALIR DEL CLAN ----------
    // Si era el líder, hereda un Colíder (o un Oficial, o cualquier miembro);
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
            await db.users.updateOne({ _id: p.key }, { $set: { clanId: null, clanRole: 'miembro' } });

            const clan = await db.clans.findOne({ _id: clanKey });
            if (clan && clan.owner === p.key) {
                // Era el líder: buscamos al reemplazo, de mayor a menor rango.
                const pick = { projection: { _id: 1 } };
                const next =
                    await db.users.findOne({ clanId: clanKey, clanRole: 'colider' }, pick) ||
                    await db.users.findOne({ clanId: clanKey, clanRole: 'oficial' }, pick) ||
                    await db.users.findOne({ clanId: clanKey }, pick);
                if (next) {
                    await db.clans.updateOne({ _id: clanKey }, { $set: { owner: next._id } });
                } else {
                    await db.clans.deleteOne({ _id: clanKey });             // no queda nadie: se borra el clan
                    await db.clanMessages.deleteMany({ clanId: clanKey });  // y también su chat.
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

    // ---------- CAMBIAR EL NOMBRE DEL CLAN (solo el líder) ----------
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
                await db.clans.updateOne({ _id: clan._id }, { $set: { name, nameKey, nameChangedAt: now } });
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

    // ---------- EDITAR LAS REGLAS DEL CLAN (líder y colíderes) ----------
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
            await db.clans.updateOne({ _id: ctx.clan._id }, { $set: { rules: text } });
            emitToClan(ctx.clan._id, 'clanChanged'); // todos los miembros ven las reglas nuevas.
            reply({ ok: true });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- EXPULSAR A UN MIEMBRO (líder y colíderes, según el rango del expulsado) ----------
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
            await db.users.updateOne({ _id: key, clanId: clan._id }, { $set: { clanId: null, clanRole: 'miembro' } });

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

    // ---------- CAMBIAR EL RANGO DE UN MIEMBRO. data = { key, role } ----------
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
            await db.users.updateOne({ _id: key, clanId: clan._id }, { $set: { clanRole: newRole } });

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

    // ---------- DATOS DE MI CLAN (nombre, reglas, mi rango y lista de miembros) ----------
    socket.on('getClan', async (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p || !p.clanId) return reply({ ok: true, clan: null });
        try {
            const clan = await db.clans.findOne({ _id: p.clanId });
            if (!clan) return reply({ ok: true, clan: null });

            const docs = await db.users
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
            reply({ ok: true, clan: { name: clan.name, rules: clan.rules || '', myRole: me ? me.role : 'miembro', members } });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });
};
