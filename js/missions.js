// ============================================================
// js/missions.js — Misiones y bolsa de dinero (ganancias de gangster)
// ============================================================

const missionListEl = document.getElementById('missionList');
const missionActive = document.getElementById('missionActive');
const missionActiveText = document.getElementById('missionActiveText');
const missionBar = document.getElementById('missionBar');
const missionMsg = document.getElementById('missionMsg');
const pouchBtn = document.getElementById('pouchBtn');
const pouchValue = document.getElementById('pouchValue');
const pouchText = document.getElementById('pouchText');
const pouchMsg = document.getElementById('pouchMsg');

let missionsData = []; // lista de misiones que manda el servidor.

// ---------- Bolsa de dinero ----------
// Al tocarla, el servidor pasa lo acumulado a tu dinero y la bolsa vuelve a 0.
pouchBtn.addEventListener('click', () => {
    pouchMsg.textContent = '';
    socket.emit('claimPouch', (res) => {
        if (!res.ok) { pouchMsg.textContent = '⚠️ ' + res.error; return; }
        pouchMsg.textContent = `✅ Reclamaste 💵 ${res.amount} de tus ganancias de gangster.`;
        playAnim(pouchBtn, 'pop', 450);
    });
});

// ---------- Misiones ----------
// Crea un botón por cada misión.
function renderMissionButtons() {
    missionListEl.innerHTML = '';
    missionsData.forEach((m) => {
        const btn = document.createElement('button');
        btn.className = 'mission-btn';
        btn.dataset.id = m.id;

        const title = document.createElement('strong');
        title.textContent = m.name;
        const info = document.createElement('span');
        info.textContent = `⚡ ${m.energy} · ⏱ ${m.durationMs / 1000}s · 💵 ${m.reward} · ✨ ${m.xp} XP · ⭐ +${m.fame} · 🎁 objetos raros`;
        btn.append(title, info);

        // Al hacer clic, le pedimos al servidor empezar esa misión.
        btn.addEventListener('click', () => {
            missionMsg.textContent = '';
            socket.emit('startMission', m.id, (res) => { if (!res.ok) missionMsg.textContent = '⚠️ ' + res.error; });
        });

        missionListEl.appendChild(btn);
    });
    updateMissionButtons();
}

// Desactiva los botones que no se pueden usar ahora (misión en curso o poca energía).
// Es solo visual: el servidor vuelve a validar todo.
function updateMissionButtons() {
    if (!lastState) return;
    missionListEl.querySelectorAll('.mission-btn').forEach((btn) => {
        const m = missionsData.find((x) => x.id === btn.dataset.id);
        btn.disabled = !!lastState.mission || lastState.energy < m.energy;
    });
}

// Lista de misiones (llega al iniciar sesión).
socket.on('missions', (list) => {
    missionsData = list;
    renderMissionButtons();
});

// Aviso de misión terminada: dinero, XP, fama, subida de nivel y objetos raros.
socket.on('missionDone', ({ name, reward, xp, fame, levelsGained, level, items }) => {
    let msg = `✅ Misión completada: ${name}. Ganaste 💵 ${reward}, ✨ ${xp} XP y ⭐ ${fame} de fama.`;
    if (levelsGained > 0) {
        const pts = levelsGained * (gameConfig ? gameConfig.pointsPerLevel : 5);
        msg += ` 🎉 ¡Subiste al nivel ${level}! Tenés +${pts} puntos para repartir en Inventario.`;
    }
    (items || []).forEach((it) => {
        const def = itemsCatalog[it.id];
        if (!def) return;
        msg += it.lost
            ? ` 🎁 Encontraste ${def.emoji} ${def.name}, pero tu mochila estaba llena y se perdió.`
            : ` 🎁 ¡Encontraste ${def.emoji} ${def.name}${it.qty > 1 ? ' x' + it.qty : ''}! Está en tu mochila.`;
    });
    missionMsg.textContent = msg;
});

// Configuración del juego: texto de la bolsa.
function applyConfigMissions(cfg) {
    pouchText.textContent =
        `Esta bolsa de dinero son tus ganancias de gangster: suma 💵 ${cfg.pouchPerSecond} por cada segundo que estás conectado. Tocá la bolsa para reclamarlas.`;
}

// Estado personal: la bolsa y el progreso de la misión en curso.
function renderMissions(s) {
    pouchValue.textContent = s.pouch;
    pouchBtn.disabled = s.pouch < 1;   // con la bolsa vacía no hay nada para reclamar.

    if (s.mission) {
        const done = 1 - s.mission.remainingMs / s.mission.durationMs; // de 0 a 1.
        missionActive.hidden = false;
        missionActiveText.textContent =
            `Haciendo: ${s.mission.name} — faltan ${Math.ceil(s.mission.remainingMs / 1000)}s`;
        missionBar.style.width = (done * 100) + '%';
    } else {
        missionActive.hidden = true;
    }
    updateMissionButtons();
}
