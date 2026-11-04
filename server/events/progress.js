// ============================================================
// events/progress.js — El progreso del personaje:
// misiones, subir estadísticas, bolsa de dinero y reinicio de estadísticas.
// ============================================================

const { online } = require('../state');
const { MISSIONS, STAT_IDS, STAT_COST, CLASSES } = require('../config');
const { resetCost } = require('../utils');
const { refreshEnergy, sendState, saveProgress } = require('../players');

module.exports = function registerProgress(socket) {

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

        p.money -= STAT_COST;
        p.stats[statId]++;

        sendState(socket.id, p, Date.now());
        reply({ ok: true });
        try { await saveProgress([p]); } catch (e) { console.error(e); }
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
    // Vuelven a las básicas de la clase y TODOS los demás puntos quedan libres para repartir.
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
};
