// ============================================================
// js/clanwar.js — Guerra de clanes: elegir rival, historial, cuenta regresiva y el aviso de arriba
// (La repetición de la guerra está en js/replay.js)
// ============================================================

const cwListBox = document.getElementById('cwListBox');
const cwInfo = document.getElementById('cwInfo');
const cwPrepBox = document.getElementById('cwPrepBox');
const cwCanDeclare = document.getElementById('cwCanDeclare');
const cwCandidates = document.getElementById('cwCandidates');
const cwHistory = document.getElementById('cwHistory');
const cwMsg = document.getElementById('cwMsg');
const clanWarAlert = document.getElementById('clanWarAlert');
const clanWarAlertText = document.getElementById('clanWarAlertText');
const clanWarAlertBtn = document.getElementById('clanWarAlertBtn');
const clanWarAlertClose = document.getElementById('clanWarAlertClose');

let cwData = null;          // lo último que mandó el servidor para el panel.
let cwFetchedAt = 0;        // cuándo lo recibimos (para calcular los tiempos restantes con tu reloj).
let warAlert = null;        // guerra de clanes en curso para el aviso de arriba.
let warAlertHidden = false; // true si cerraste el aviso.

// Pide al servidor los datos del panel de guerra de clan.
function loadClanWarPanel() {
    socket.emit('getClanWarPanel', (res) => {
        if (!res.ok) { cwMsg.textContent = '⚠️ ' + res.error; return; }
        cwData = res;
        cwFetchedAt = Date.now();
        renderClanWarPanel();
    });
}

// ¿Hay una guerra preparándose (en cuenta regresiva)?
function cwPrepActive() {
    return !!(cwData && cwData.prep && cwFetchedAt + cwData.prep.startsInMs > Date.now());
}

// Dibuja la lista de clanes rivales y el historial.
function renderClanWarPanel() {
    if (!cwData) return;
    cwCanDeclare.textContent = cwData.canDeclare
        ? '✅ Podés declarar guerras (sos líder o colíder).'
        : '🔒 Solo el líder y los colíderes pueden declarar guerras. Vos podés ver las repeticiones.';

    // Candidatos
    cwCandidates.innerHTML = '';
    if (!cwData.candidates.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.className = 'muted';
        td.textContent = 'Todavía no hay otros clanes.';
        tr.appendChild(td);
        cwCandidates.appendChild(tr);
    }
    cwData.candidates.forEach((c) => {
        const tr = document.createElement('tr');
        tr.dataset.until = cwFetchedAt + c.lockMs;   // hora (de tu reloj) en que ese clan vuelve a estar libre.

        const tdName = document.createElement('td');
        tdName.textContent = c.name;
        const tdMembers = document.createElement('td');
        tdMembers.textContent = c.members;
        const tdFame = document.createElement('td');
        tdFame.textContent = c.fame;

        const tdBtn = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn small cw-attack';
        btn.textContent = '⚔️ Atacar';
        const lock = document.createElement('div');
        lock.className = 'cw-lock';
        btn.addEventListener('click', () => {
            cwMsg.textContent = '';
            btn.disabled = true;
            socket.emit('declareClanWar', c.id, (res) => {
                if (!res.ok) { cwMsg.textContent = '⚠️ ' + res.error; loadClanWarPanel(); return; }
                cwMsg.textContent = `✅ ¡Guerra declarada contra ${c.name}! Empieza en ${Math.round(res.startsInMs / 1000)} segundos.`;
                loadClanWarPanel();
            });
        });
        tdBtn.append(btn, lock);

        tr.append(tdName, tdMembers, tdFame, tdBtn);
        cwCandidates.appendChild(tr);
    });
    updateCwTimers();

    // Historial
    cwHistory.innerHTML = '';
    if (!cwData.wars.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Todavía no hubo guerras de clanes.';
        cwHistory.appendChild(p);
    }
    cwData.wars.forEach((w) => {
        const row = document.createElement('div');
        row.className = 'cw-hist ' + (w.won ? 'won' : 'lost');

        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${w.attackerName} vs ${w.defenderName}`;
        const sub = document.createElement('small');
        sub.textContent = `${w.won ? '🏆 Ganó tu clan' : '💀 Perdió tu clan'} · ` +
            new Date(w.ts).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        info.append(title, sub);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn small';
        btn.textContent = '▶ Ver repetición';
        btn.addEventListener('click', () => watchWar(w.id)); // (js/replay.js)

        row.append(info, btn);
        cwHistory.appendChild(row);
    });
}

// Se ejecuta cada segundo: cuenta regresiva de la guerra y bloqueos de los clanes.
function updateCwTimers() {
    const now = Date.now();

    // Cuenta regresiva dentro del panel.
    if (cwData && cwData.prep) {
        const left = cwFetchedAt + cwData.prep.startsInMs - now;
        cwPrepBox.hidden = false;
        cwPrepBox.textContent = left > 0
            ? `⏳ ${cwData.prep.attackerName} vs ${cwData.prep.defenderName}: la guerra empieza en ${fmtClock(left)}. ¡Subí tus estadísticas y equipá tu maletín!`
            : '⚔️ La guerra está empezando...';
    } else {
        cwPrepBox.hidden = true;
    }

    // Botones "Atacar": se habilitan solo si podés declarar y ni tu clan ni el rival están bloqueados.
    if (!cwData) return;
    const myLockLeft = cwFetchedAt + cwData.lockMs - now;
    const prepOn = cwPrepActive();
    cwCandidates.querySelectorAll('tr[data-until]').forEach((tr) => {
        const left = Number(tr.dataset.until) - now;
        const btn = tr.querySelector('.cw-attack');
        const lock = tr.querySelector('.cw-lock');
        if (!btn) return;
        btn.disabled = !cwData.canDeclare || prepOn || myLockLeft > 0 || left > 0;
        lock.textContent = left > 0 ? `⏳ libre en ${fmtClock(left)}` : '';
    });
    cwInfo.textContent = (gameConfig
        ? `Todos los miembros de tu clan pelean contra todos los del clan rival, de a uno por vez: el que gana sigue peleando con la vida que le queda hasta que un clan se queda sin luchadores. ` +
          `No gasta energía. Cada clan puede participar en una guerra cada ${Math.round(gameConfig.clanWarCooldownMs / 60000)} minutos. ` +
          `Cada miembro del clan ganador recibe 💵 ${gameConfig.clanWarReward}, ⭐ ${gameConfig.clanWarFame} y ✨ ${gameConfig.clanWarXp} XP.`
        : '') + (myLockLeft > 0 ? ` ⏳ Tu clan podrá volver a pelear en ${fmtClock(myLockLeft)}.` : '');
}

// ----- Aviso de arriba (se ve en cualquier pestaña) -----
function renderWarAlert() {
    if (!warAlert || warAlertHidden) { clanWarAlert.hidden = true; return; }
    const a = warAlert;
    clanWarAlert.hidden = false;
    clanWarAlertBtn.hidden = false;
    if (a.status === 'prep') {
        const left = a.startsAt - Date.now();
        clanWarAlertText.textContent = left > 0
            ? `⚔️ Guerra de clanes: ${a.attackerName} vs ${a.defenderName}. ¡Preparate! Empieza en ${fmtClock(left)}.`
            : `⚔️ ${a.attackerName} vs ${a.defenderName}: la guerra está empezando...`;
        clanWarAlertBtn.textContent = 'Ir al clan';
    } else if (a.status === 'done') {
        clanWarAlertText.textContent = `✅ Terminó la guerra ${a.attackerName} vs ${a.defenderName}. Ganó ${a.winnerName}.`;
        clanWarAlertBtn.textContent = '▶ Ver guerra';
    } else {
        clanWarAlertText.textContent = '⚠️ ' + (a.message || 'La guerra se canceló.');
        clanWarAlertBtn.hidden = true;
    }
}

// Abre la pestaña Clan → Guerra de clan.
function openClanWarPane() {
    showTab('clan');
    showClanPane('guerra');
}

// Abre una repetición (cambia a la pestaña y la carga).
function openWarReplay(warId) {
    openClanWarPane();
    watchWar(warId); // (js/replay.js)
}

clanWarAlertBtn.addEventListener('click', () => {
    if (!warAlert) return;
    if (warAlert.status === 'done') openWarReplay(warAlert.warId);
    else openClanWarPane();
});
clanWarAlertClose.addEventListener('click', () => { warAlertHidden = true; renderWarAlert(); });

// El servidor avisa cuando una guerra se declara, termina o se cancela.
socket.on('clanWarUpdate', (d) => {
    warAlert = { ...d, startsAt: Date.now() + d.startsInMs };
    warAlertHidden = false;
    renderWarAlert();
    // Si estás mirando el panel de guerra, lo refrescamos (aparece la guerra nueva o el botón de repetición).
    if (!myClanBox.hidden && document.getElementById('clanPane-guerra').classList.contains('active')) loadClanWarPanel();
});

// Cada segundo: cuentas regresivas del aviso y del panel.
setInterval(() => {
    if (warAlert && warAlert.status === 'prep') renderWarAlert();
    updateCwTimers();
}, 1000);

// Al iniciar sesión o reconectar: empezamos de cero (el servidor nos vuelve a avisar si hay una guerra preparándose).
function applyConfigClanWar() {
    closeReplay();  // (js/replay.js) si había una repetición abierta, la cerramos.
    cwData = null;
    warAlert = null;
    renderWarAlert();
}
