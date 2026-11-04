// ============================================================
// events/war.js — Guerra 1 contra 1: buscar rival (al azar o por nombre) y pelear
// ============================================================

const { db, online } = require('../state');
const {
    WAR_ENERGY, WAR_TURN_MS, GRENADES_PER_FIGHT, NAME_SEARCH_COSTS_CHARGE, CLASSES, DEFAULT_CLASS
} = require('../config');
const { fmtWait } = require('../utils');
const { refreshEnergy, sendState, sendInventory, saveProgress } = require('../players');
const { gearOfItems, consumeGrenade } = require('../items');
const { makeFighter, simulateFight } = require('../combat');
const {
    refreshSearch, useSearch, recentKeys, cooldownLeft, findRival, setRival, rivalPayload, stepFight
} = require('../war');

module.exports = function registerWar(socket) {

    // ---------- BUSCAR RIVAL AL AZAR (gasta 1 de las 3 cargas) ----------
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

            // Recién ahora, que SÍ encontramos a alguien, gastamos la carga.
            useSearch(p, Date.now());
            setRival(p, result.doc);

            sendState(socket.id, p, Date.now());
            saveProgress([p]).catch(console.error); // guarda las cargas Y el rival.
            reply({ ok: true, rival: rivalPayload(p, result.expanded) });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        } finally {
            p.searching = false;
        }
    });

    // ---------- BUSCAR JUGADORES POR NOMBRE ----------
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
            // Escapamos los símbolos especiales para que lo escrito se busque como texto común.
            const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const docs = await db.users
                .find({ nameKey: rx, _id: { $ne: p.key } }, { projection: { name: 1, level: 1, class: 1 } })
                .limit(8).toArray();

            reply({
                ok: true,
                players: docs.map(d => ({
                    key: d._id,
                    name: d.name,
                    level: d.level ?? 1,
                    className: CLASSES[CLASSES[d.class] ? d.class : DEFAULT_CLASS].name,
                    cooldownMs: cooldownLeft(p, d._id, now)   // > 0: todavía no se puede atacar.
                }))
            });
        } catch (e) {
            console.error(e);
            reply({ ok: false, error: 'Error del servidor, probá de nuevo.' });
        }
    });

    // ---------- ELEGIR UN RIVAL ENCONTRADO POR NOMBRE ----------
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
            const doc = await db.users.findOne({ _id: key }, { projection: { name: 1, level: 1, class: 1, stats: 1, briefcase: 1 } });
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

    // ---------- PELEAR (cuesta energía) ----------
    socket.on('startFight', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'Ya estás peleando.' });
        if (!p.rival) return reply({ ok: false, error: 'Primero buscá un rival.' });

        const now = Date.now();
        refreshEnergy(p, now);
        if (p.energy < WAR_ENERGY) return reply({ ok: false, error: `Necesitás ${WAR_ENERGY} de energía para pelear.` });

        // No se puede volver a atacar al mismo rival durante 20 minutos.
        const wait = cooldownLeft(p, p.rival.key, now);
        if (wait > 0) {
            return reply({ ok: false, error: `Ya peleaste con ese jugador hace poco. Podés volver a atacarlo en ${fmtWait(wait)}.` });
        }

        // Cobramos la energía y anotamos el ataque (para el bloqueo de 20 minutos).
        p.energy -= WAR_ENERGY;
        recentKeys(p, now); // limpia los vencidos.
        p.recentAttacks.push({ key: p.rival.key, at: now });

        // Equipo del maletín: suma daño, habilita la pistola y se gasta 1 granada si hay.
        const gear = gearOfItems(p.briefcase);
        const grenades = consumeGrenade(p) ? GRENADES_PER_FIGHT : 0;
        if (grenades) sendInventory(socket.id, p);

        // Armamos los dos luchadores (con el daño del arma ya sumado) y simulamos TODA la pelea.
        const myTotal = { ...p.stats, dano: p.stats.dano + gear.dmg };
        const rvTotal = { ...p.rival.stats, dano: p.rival.stats.dano + p.rival.gear.dmg };
        const me = makeFighter(p.name, p.level, p.cls, myTotal, gear.pistol, grenades);
        const rv = makeFighter(p.rival.name, p.rival.level, p.rival.cls, rvTotal, p.rival.gear.pistol, 0);
        const outcome = simulateFight(me, rv);

        // Guardamos la pelea (con el premio ya fijado) y mandamos un golpe cada WAR_TURN_MS.
        p.fight = { events: outcome.events, result: outcome.result, index: 0, timer: null, reward: p.rival.reward };
        p.fight.timer = setInterval(() => stepFight(socket.id, p), WAR_TURN_MS);

        sendState(socket.id, p, now);
        reply({ ok: true, maxHpMe: me.maxHp, maxHpRival: rv.maxHp, grenade: grenades > 0 });
        saveProgress([p]).catch(console.error);
    });
};
