// ============================================================
// events/clanwar.js — Guerra de clanes: panel, declarar guerra y ver repeticiones
// ============================================================

const crypto = require('crypto');
const { db, online, cache } = require('../state');
const {
    MANAGER_ROLES, CLAN_WAR_PREP_MS, CLAN_WAR_COOLDOWN_MS, CLAN_WAR_REWARD, CLAN_WAR_FAME, CLAN_WAR_XP,
    CLAN_WAR_HISTORY
} = require('../config');
const { fmtWait } = require('../utils');
const { getClanAndRole } = require('../clans');
const { lockClan, warPayload, emitWarUpdate, scheduleClanWar } = require('../clanwar');

module.exports = function registerClanWar(socket) {

    // ---------- DATOS DE LA PESTAÑA "GUERRA DE CLAN" ----------
    // Clanes a los que se puede atacar, guerra en preparación e historial.
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
            const others = cache.clans.filter(c => c.id !== mine._id);
            const docs = await db.clans.find({ _id: { $in: others.map(c => c.id) } }, { projection: { warLockUntil: 1 } }).toArray();
            const locks = new Map(docs.map(d => [d._id, d.warLockUntil || 0]));
            const candidates = others.map(c => ({
                id: c.id, name: c.name, members: c.members, fame: c.fame,
                lockMs: Math.max(0, (locks.get(c.id) || 0) - now)
            }));

            const mineFilter = { $or: [{ attackerId: mine._id }, { defenderId: mine._id }] };
            const prep = await db.clanWars.findOne({ status: 'prep', ...mineFilter });
            const wars = await db.clanWars
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

    // ---------- DECLARAR UNA GUERRA (solo líder y colíderes). Empieza tras 1 minuto de preparación ----------
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
            const target = await db.clans.findOne({ _id: String(targetId || '') });
            if (!target) return reply({ ok: false, error: 'Ese clan no existe.' });
            if (target._id === mine._id) return reply({ ok: false, error: 'No podés declararle la guerra a tu propio clan.' });
            if (!(await db.users.countDocuments({ clanId: target._id }))) return reply({ ok: false, error: 'Ese clan no tiene miembros.' });

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
                await db.clans.updateOne({ _id: mine._id }, { $set: { warLockUntil: mine.warLockUntil || 0 } }); // deshacemos la reserva.
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
            await db.clanWars.insertOne(war);
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

    // ---------- REPETICIÓN COMPLETA DE UNA GUERRA (solo para miembros de los dos clanes que pelearon) ----------
    socket.on('getClanWarReplay', async (warId, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        try {
            const war = await db.clanWars.findOne({ _id: String(warId || ''), status: 'done' });
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
};
