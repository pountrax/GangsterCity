// ============================================================
// clanwar.js — Guerra de clanes
// Flujo: el líder/colíder declara → cuenta regresiva de 1 minuto (todos se preparan) →
// el servidor junta a TODOS los miembros de los dos clanes, los hace pelear uno a la vez
// y guarda la repetición completa → los miembros del clan ganador reciben el premio.
// (Los eventos que pide el navegador están en events/clanwar.js)
// ============================================================

const { db, clanWarTimers } = require('./state');
const {
    CLAN_MAX_MEMBERS, CLAN_WAR_REWARD, CLAN_WAR_FAME, CLAN_WAR_XP, CLAN_WAR_HEAL_PCT, HP_PER_VIDA, ROLE_RANK
} = require('./config');
const { findOnlineByKey, emitToClan, resolveStats, addXp, sendState, saveProgress } = require('./players');
const { sanitizeCase, gearOfItems } = require('./items');
const { makeFighter, simulateFight } = require('./combat');
const { notifyWarMembers } = require('./notify');
const { refreshTop, broadcastSlow } = require('./rankings');

// Intenta "reservar" un clan: solo funciona si no tiene otra guerra en los últimos 10 minutos.
async function lockClan(clanId, now, until) {
    const r = await db.clans.updateOne(
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
    const docs = await db.users.find({ clanId: clan._id }).limit(CLAN_MAX_MEMBERS).toArray();
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
    const d = await db.users.findOne({ _id: key }, { projection: { money: 1, xp: 1, level: 1, fame: 1, statPoints: 1 } });
    if (!d) return;
    const t = {
        money: (d.money ?? 0) + CLAN_WAR_REWARD, fame: (d.fame ?? 0) + CLAN_WAR_FAME,
        xp: d.xp ?? 0, level: d.level ?? 1, statPoints: d.statPoints ?? 0
    };
    addXp(t, CLAN_WAR_XP);
    await db.users.updateOne({ _id: key }, { $set: { money: t.money, fame: t.fame, xp: t.xp, level: t.level, statPoints: t.statPoints } });
}

// Cancela una guerra (por ejemplo si uno de los clanes dejó de existir).
async function cancelClanWar(war, message) {
    await db.clanWars.updateOne({ _id: war._id }, { $set: { status: 'cancelled' } });
    emitWarUpdate(war, { ...warPayload(war, 'cancelled'), message });
}

// Termina la cuenta regresiva: arma los equipos, simula la guerra, guarda la repetición y paga los premios.
async function resolveClanWar(warId) {
    delete clanWarTimers[warId];

    // "Tomamos" la guerra una sola vez (si ya la tomó otro proceso, no hacemos nada).
    const claim = await db.clanWars.updateOne({ _id: warId, status: 'prep' }, { $set: { status: 'running' } });
    if (claim.modifiedCount !== 1) return;
    const war = await db.clanWars.findOne({ _id: warId });

    const clanA = await db.clans.findOne({ _id: war.attackerId });
    const clanB = await db.clans.findOne({ _id: war.defenderId });
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
    await db.clanWars.updateOne({ _id: warId }, { $set: {
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

module.exports = {
    lockClan, warPayload, emitWarUpdate, scheduleClanWar, buildClanTeam, snapFighter, simulateClanWar,
    giveWarReward, cancelClanWar, resolveClanWar
};
