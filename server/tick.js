// ============================================================
// tick.js — El reloj del juego: se ejecuta cada 1 segundo
// Suma puntos y bolsa, recarga energía y búsquedas, termina misiones, actualiza la tienda,
// manda el estado a cada jugador y, cada 10 segundos, guarda todo y refresca los rankings.
// ============================================================

const { io } = require('./core');
const { online } = require('./state');
const { POUCH_PER_SECOND, POUCH_MAX } = require('./config');
const { refreshEnergy, finishMissionIfDone, sendState, sendInventory, saveProgress } = require('./players');
const { refreshSearch } = require('./war');
const { refreshShop, shopPayload } = require('./shop');
const { refreshTop, broadcast, broadcastSlow } = require('./rankings');

function startTick() {
    let ticks = 0;
    setInterval(async () => {
        const now = Date.now();
        const entries = Object.entries(online); // pares [socketId, jugador].

        entries.forEach(([id, p]) => {
            p.score++;                  // +1 punto por segundo (ranking de actividad).
            // Bolsa de dinero: suma mientras estás conectado (con tope si POUCH_MAX es mayor que 0).
            p.pouch = POUCH_MAX ? Math.min(POUCH_MAX, p.pouch + POUCH_PER_SECOND) : p.pouch + POUCH_PER_SECOND;
            refreshEnergy(p, now);      // recarga de energía.
            refreshSearch(p, now);      // recarga de cargas de búsqueda.

            // Si pasó la hora, la tienda se actualiza sola y se lo avisamos.
            if (refreshShop(p, now)) {
                io.to(id).emit('shop', shopPayload(p, now));
                saveProgress([p]).catch(console.error);
            }

            const finished = finishMissionIfDone(p, now);
            if (finished) {
                io.to(id).emit('missionDone', finished);
                if (finished.items.length) sendInventory(id, p); // cayó algún objeto.
                saveProgress([p]).catch(console.error);
            }

            sendState(id, p, now);      // estado personal actualizado.
        });

        broadcast(); // ranking de actividad para todos.

        ticks++;
        // Cada 10 segundos: guardamos a todos, refrescamos rankings y los mandamos.
        if (ticks % 10 === 0) {
            try { await saveProgress(entries.map(([, p]) => p)); } catch (e) { console.error(e); }
            await refreshTop();
            broadcastSlow();
        }
    }, 1000);
}

module.exports = { startTick };
