// ============================================================
// js/stats.js — Estadísticas (Vida, Daño, Aguante, Velocidad, Inteligencia, Suerte) y su reinicio
// Cada fila: nombre + efecto | valor (+ extra del maletín) | botón "+" (puntos de nivel) | botón 💵 (comprar)
// ============================================================

const statsList = document.getElementById('statsList');
const statsMsg = document.getElementById('statsMsg');
const statPointsValue = document.getElementById('statPointsValue');
const inventoryBadge = document.getElementById('inventoryBadge');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const resetInfo = document.getElementById('resetInfo');

let statRows = {};  // { vida: { value, effect, plus, buy }, ... } para actualizar cada fila.

// Crea una fila por cada estadística (la lista viene del servidor).
function buildStatsPanel(list) {
    statsList.innerHTML = '';
    statRows = {};

    // Aviso con el precio de comprar puntos (se recrea para no duplicarlo al reconectar).
    const oldHint = document.getElementById('statsHint');
    if (oldHint) oldHint.remove();
    const hint = document.createElement('p');
    hint.id = 'statsHint';
    hint.className = 'muted';
    hint.textContent = `➕ usa tus puntos disponibles. 💵 ${gameConfig.statCost} compra 1 punto de esa estadística. Lo verde es el extra que da tu maletín de guerra.`;
    statsList.after(hint);

    list.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'stat-row';

        // Nombre y, debajo, el efecto real (lo calcula el servidor según tu nivel).
        const info = document.createElement('div');
        info.className = 'stat-info';
        const label = document.createElement('span');
        label.className = 'stat-name';
        label.textContent = `${s.icon} ${s.label}`;
        const effect = document.createElement('span');
        effect.className = 'stat-effect';
        info.append(label, effect);

        const value = document.createElement('span');
        value.className = 'stat-value';
        value.textContent = '0';

        // Botón "+": gasta un punto de nivel.
        const plus = document.createElement('button');
        plus.className = 'plus-btn';
        plus.type = 'button';
        plus.textContent = '+';
        plus.title = 'Subir ' + s.label + ' con un punto disponible';
        plus.disabled = true;
        plus.addEventListener('click', () => {
            statsMsg.textContent = '';
            socket.emit('spendStat', s.id, (res) => { if (!res.ok) statsMsg.textContent = '⚠️ ' + res.error; });
        });

        // Botón "💵": compra un punto con dinero.
        const buy = document.createElement('button');
        buy.className = 'buy-btn';
        buy.type = 'button';
        buy.textContent = '💵 ' + gameConfig.statCost;
        buy.title = `Comprar 1 punto de ${s.label}`;
        buy.disabled = true;
        buy.addEventListener('click', () => {
            statsMsg.textContent = '';
            socket.emit('buyStat', s.id, (res) => { if (!res.ok) statsMsg.textContent = '⚠️ ' + res.error; });
        });

        row.append(info, value, plus, buy);
        statsList.appendChild(row);
        statRows[s.id] = { value, effect, plus, buy };
    });
}

// ----- Reiniciar estadísticas (con confirmación de dos toques) -----
let resetArmed = false;
let resetTimer = null;

// Pone el texto y el estado del botón según el precio actual (cada reinicio cuesta 500 más).
function updateResetBtn() {
    if (!lastState || resetArmed) return;
    resetStatsBtn.textContent = `🔄 Reiniciar estadísticas · 💵 ${lastState.resetCost}`;
    resetStatsBtn.disabled = lastState.money < lastState.resetCost;
}

resetStatsBtn.addEventListener('click', () => {
    if (!resetArmed) {
        resetArmed = true;
        resetStatsBtn.textContent = '¿Seguro? Tocá de nuevo para confirmar';
        resetTimer = setTimeout(() => { resetArmed = false; updateResetBtn(); }, 4000);
        return;
    }
    clearTimeout(resetTimer);
    resetArmed = false;
    statsMsg.textContent = '';
    socket.emit('resetStats', (res) => {
        statsMsg.textContent = res.ok
            ? `✅ Estadísticas reiniciadas (-💵 ${res.cost}). Tenés ${res.points} puntos para repartir.`
            : '⚠️ ' + res.error;
        updateResetBtn();
    });
});

// Configuración del juego: arma el panel y el texto del reinicio.
function applyConfigStats(cfg) {
    buildStatsPanel(cfg.stats);
    resetInfo.textContent =
        `Devuelve tus estadísticas a las básicas de Matón y te da todos tus puntos para repartirlos de nuevo. ` +
        `Cuesta 💵 ${cfg.resetStatsBase} la primera vez y ${cfg.resetStatsBase} más cada vez que lo usás.`;
}

// Estado personal: valores, efectos, puntos disponibles y botones.
function renderStats(s) {
    statPointsValue.textContent = s.statPoints;
    const canBuy = !!gameConfig && s.money >= gameConfig.statCost;
    Object.keys(statRows).forEach((id) => {
        const r = statRows[id];
        r.value.textContent = s.stats[id];
        if (s.bonus[id]) {
            const b = document.createElement('span');
            b.className = 'bonus';
            b.textContent = ' +' + s.bonus[id];
            r.value.appendChild(b);
        }
        r.effect.textContent = s.effects[id];
        r.plus.disabled = s.statPoints < 1;   // "+" necesita puntos de nivel.
        r.buy.disabled = !canBuy;             // "💵" necesita dinero.
    });
    // Globito rojo en el botón Inventario si hay puntos sin gastar.
    inventoryBadge.hidden = s.statPoints < 1;
    inventoryBadge.textContent = s.statPoints;
    updateResetBtn();
}
