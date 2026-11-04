// ============================================================
// js/war.js — Guerra 1 contra 1
// Dos tarjetas (vos y tu rival). El servidor manda cada golpe en vivo (evento "warEvent")
// y acá lo animamos, con pistola o granada (las animaciones están en js/fx.js).
// ============================================================

const arena = document.getElementById('arena');
const warInfo = document.getElementById('warInfo');
const searchRivalBtn = document.getElementById('searchRivalBtn');
const fightBtn = document.getElementById('fightBtn');
const warBanner = document.getElementById('warBanner');
const warMsg = document.getElementById('warMsg');
const warLog = document.getElementById('warLog');
const rivalNote = document.getElementById('rivalNote');
const searchInfo = document.getElementById('searchInfo');
const playerSearchForm = document.getElementById('playerSearchForm');
const playerSearchInput = document.getElementById('playerSearchInput');
const playerResults = document.getElementById('playerResults');

const fMe = fighterParts('fighterMe');
const fRival = fighterParts('fighterRival');
const sides = { me: fMe, rival: fRival };

let warState = 'idle';       // 'idle' = sin rival, 'found' = rival encontrado, 'fighting' = peleando.
let showingResult = false;   // true después de una pelea, hasta la próxima búsqueda.
let rivalInfo = null;
let fightMax = { me: 0, rival: 0 };
let bannerTimer = null;
let searchPending = false;   // true mientras esperamos la respuesta de "buscar rival".
let fightPending = false;    // true mientras esperamos la respuesta de "pelear".

// Agrega una línea al registro del combate (lo más nuevo arriba).
function addWarLog(text, cls) {
    const line = document.createElement('div');
    line.className = cls || '';
    line.textContent = text;
    warLog.prepend(line);
    while (warLog.children.length > 40) warLog.removeChild(warLog.lastChild);
}

// Cartel de estado. Si autoHideMs > 0, se oculta solo.
function showBanner(text, cls = '', autoHideMs = 0) {
    clearTimeout(bannerTimer);
    warBanner.textContent = text;
    warBanner.className = cls;
    warBanner.hidden = false;
    if (autoHideMs) bannerTimer = setTimeout(() => { warBanner.hidden = true; }, autoHideMs);
}

// Saca los efectos de ganador/perdedor de las tarjetas.
function clearWarFx() {
    fMe.root.classList.remove('winner', 'loser');
    fRival.root.classList.remove('winner', 'loser');
}

// Tu tarjeta: usa tus estadísticas TOTALES (con el extra del maletín).
function renderMyCard() {
    if (!lastState) return;
    fMe.avatar.textContent = (myName || '?').charAt(0).toUpperCase();
    fMe.name.textContent = myName || '---';
    fMe.sub.textContent = `${lastState.className} · Nv ${lastState.level}`;
    fillStats(fMe.stats, lastState.totalStats);
    if (warState !== 'fighting' && !showingResult) setHpOn(sides, 'me', lastState.maxHp, lastState.maxHp);
}

// Tarjeta del rival encontrado.
function renderRivalCard(r) {
    rivalInfo = r;
    fRival.root.classList.remove('empty');
    fRival.avatar.textContent = r.name.charAt(0).toUpperCase();
    fRival.name.textContent = r.name;
    fRival.sub.textContent = `${r.className} · Nv ${r.level}` + (r.pistol ? ' · 🔫' : '');
    fillStats(fRival.stats, r.stats);
    setHpOn(sides, 'rival', r.maxHp, r.maxHp);
}

// Diferencia de nivel con el rival y premio si ganás.
function showRivalNote(r) {
    const n = Math.abs(r.levelDiff);
    const lv = n === 1 ? 'nivel' : 'niveles';
    const diff = r.levelDiff === 0 ? 'Tiene tu mismo nivel'
        : r.levelDiff > 0 ? `Está ${n} ${lv} por encima tuyo`
        : `Está ${n} ${lv} por debajo tuyo`;
    let text = `${diff}. Premio si ganás: 💵 ${r.reward}.`;
    if (r.expanded) text += ' ℹ️ No había nadie cerca de tu nivel, así que se amplió la búsqueda.';
    rivalNote.textContent = text;
}

// Tarjeta del rival vacía.
function clearRival() {
    rivalInfo = null;
    rivalNote.textContent = '';
    fRival.root.classList.add('empty');
    fRival.avatar.textContent = '?';
    fRival.name.textContent = 'Sin rival';
    fRival.sub.textContent = 'Buscá un oponente';
    fRival.stats.innerHTML = '';
    fRival.hpFill.style.width = '0%';
    fRival.hpFill.classList.remove('mid', 'low');
    fRival.hpText.textContent = '-';
}

// Muestra un rival nuevo (buscado, elegido por nombre o restaurado al recargar la página).
function applyRival(r) {
    warState = 'found';
    showingResult = false;
    clearWarFx();
    warBanner.hidden = true;
    warLog.innerHTML = '';
    renderRivalCard(r);
    showRivalNote(r);
    renderMyCard();
    updateWarButtons();
}

// Muestra u oculta los botones según el estado de la guerra, y las cargas de búsqueda.
function updateWarButtons() {
    searchRivalBtn.hidden = warState === 'fighting';
    fightBtn.hidden = warState !== 'found';

    if (lastState && gameConfig) {
        const left = lastState.searchCharges;
        const max = lastState.searchMax;
        searchRivalBtn.textContent = `🔍 Buscar rival (${left}/${max})`;
        searchRivalBtn.disabled = searchPending || left < 1;
        searchInfo.textContent = left < 1
            ? `⏳ Sin búsquedas. Se recargan las ${max} en ${fmtClock(lastState.searchRechargeMs)}. Podés seguir desafiando por nombre.`
            : `Búsquedas disponibles: ${left}/${max}. Al gastar la última, esperás ${Math.round(gameConfig.searchRechargeMs / 60000)} minutos para recuperar las ${max}.`;
    }

    if (warState === 'found' && gameConfig) {
        const cost = gameConfig.warEnergy;
        const enough = lastState && lastState.energy >= cost;
        fightBtn.disabled = fightPending || !enough;
        fightBtn.textContent = enough ? `⚔️ Pelear (-${cost} ⚡)` : `⚔️ Pelear (necesitás ${cost} ⚡)`;
    }
}

// Vuelve la guerra a cero (al iniciar sesión o reconectar).
function resetWar() {
    warState = 'idle';
    showingResult = false;
    searchPending = false;
    fightPending = false;
    clearWarFx();
    clearRival();
    warLog.innerHTML = '';
    warBanner.hidden = true;
    warMsg.textContent = '';
    playerResults.innerHTML = '';
    if (lastState) setHpOn(sides, 'me', lastState.maxHp, lastState.maxHp);
    updateWarButtons();
}

// ----- Buscar rival al azar -----
searchRivalBtn.addEventListener('click', () => {
    warMsg.textContent = '';
    searchPending = true;
    updateWarButtons();
    socket.emit('searchRival', (res) => {
        searchPending = false;
        if (!res.ok) { warMsg.textContent = '⚠️ ' + res.error; updateWarButtons(); return; }
        applyRival(res.rival);
    });
});

// El servidor nos devuelve el rival que habíamos buscado antes de recargar la página.
socket.on('rivalFound', (r) => {
    if (warState !== 'fighting') applyRival(r);
});

// ----- Buscar jugadores por nombre -----
playerSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    warMsg.textContent = '';
    playerResults.innerHTML = '';
    socket.emit('findPlayers', playerSearchInput.value, (res) => {
        if (!res.ok) { warMsg.textContent = '⚠️ ' + res.error; return; }
        if (!res.players.length) { warMsg.textContent = 'No se encontró ningún jugador con ese nombre.'; return; }

        res.players.forEach((pl) => {
            const row = document.createElement('div');
            row.className = 'player-row';

            const info = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = pl.name;
            const sub = document.createElement('small');
            sub.textContent = `${pl.className} · Nv ${pl.level}` +
                (pl.cooldownMs > 0 ? ` · ⏳ podés atacarlo en ${fmtHM(pl.cooldownMs)}` : '');
            info.append(name, sub);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-btn small';
            btn.textContent = 'Elegir';
            btn.disabled = pl.cooldownMs > 0 || warState === 'fighting';
            btn.addEventListener('click', () => {
                warMsg.textContent = '';
                socket.emit('chooseRival', pl.key, (r) => {
                    if (!r.ok) { warMsg.textContent = '⚠️ ' + r.error; return; }
                    playerResults.innerHTML = '';
                    applyRival(r.rival);
                });
            });

            row.append(info, btn);
            playerResults.appendChild(row);
        });
    });
});

// ----- Pelear -----
fightBtn.addEventListener('click', () => {
    warMsg.textContent = '';
    fightPending = true;
    updateWarButtons();
    socket.emit('startFight', (res) => {
        fightPending = false;
        if (!res.ok) { warMsg.textContent = '⚠️ ' + res.error; updateWarButtons(); return; }

        warState = 'fighting';
        showingResult = false;
        fightMax = { me: res.maxHpMe, rival: res.maxHpRival };
        setHpOn(sides, 'me', fightMax.me, fightMax.me);
        setHpOn(sides, 'rival', fightMax.rival, fightMax.rival);
        warLog.innerHTML = '';
        addWarLog('¡Comienza el combate!' + (res.grenade ? ' Llevás una 💣 granada lista.' : ''), 'l-sys');
        showBanner('⚔️ ¡Comienza el combate!', '', 1200);
        updateWarButtons();
    });
});

// ----- Cada golpe que manda el servidor -----
socket.on('warEvent', (ev) => {
    if (warState !== 'fighting') return;
    const rivalName = rivalInfo ? rivalInfo.name : 'El rival';

    if (ev.extra) showBanner('⚡ ¡Turno extra!', 'extra', 1000);
    playHit(sides, arena, ev, () => {
        setHpOn(sides, 'me', ev.hpMe, fightMax.me);
        setHpOn(sides, 'rival', ev.hpRival, fightMax.rival);
    });

    // Registro escrito del golpe.
    const prefix = ev.extra ? '⚡ Turno extra: ' : '';
    const gun = ev.weapon === 'pistol' ? '🔫 ' : '';
    let text;
    if (ev.actor === 'me') {
        text = ev.result === 'dodge' ? `${rivalName} esquivó tu ${ev.weapon === 'pistol' ? 'disparo' : 'ataque'}.`
             : ev.result === 'boom' ? `💣 Lanzaste una granada a ${rivalName}: -${ev.dmg}.`
             : ev.result === 'crit' ? `${gun}💥 ¡CRÍTICO! Golpeaste a ${rivalName} por ${ev.dmg}.`
             : `${gun}${ev.weapon === 'pistol' ? 'Le disparaste' : 'Golpeaste'} a ${rivalName} por ${ev.dmg}.`;
    } else {
        text = ev.result === 'dodge' ? `¡Esquivaste el ataque de ${rivalName}!`
             : ev.result === 'boom' ? `💣 ${rivalName} te lanzó una granada: -${ev.dmg}.`
             : ev.result === 'crit' ? `${gun}💥 ¡CRÍTICO! ${rivalName} te golpeó por ${ev.dmg}.`
             : `${gun}${rivalName} ${ev.weapon === 'pistol' ? 'te disparó' : 'te golpeó'} por ${ev.dmg}.`;
    }
    addWarLog(prefix + text, (ev.actor === 'me' ? 'l-me' : 'l-rival') + (ev.result === 'crit' || ev.result === 'boom' ? ' l-crit' : ''));
});

// ----- Fin de la pelea -----
socket.on('warEnd', ({ result, reward, rivalName }) => {
    warState = 'idle';
    showingResult = true; // dejamos las barras como quedaron.

    if (result === 'win') {
        showBanner(`🏆 ¡VICTORIA! Ganaste 💵 ${reward}`, 'win');
        fMe.root.classList.add('winner');
        fRival.root.classList.add('loser');
        addWarLog(`🏆 Venciste a ${rivalName} y ganaste 💵 ${reward}.`, 'l-me l-crit');
    } else if (result === 'lose') {
        showBanner('💀 Derrota...', 'lose');
        fRival.root.classList.add('winner');
        fMe.root.classList.add('loser');
        addWarLog(`💀 ${rivalName} te venció.`, 'l-rival l-crit');
    } else {
        showBanner('🤝 Empate', '');
        addWarLog('🤝 La pelea terminó en empate.', 'l-sys');
    }
    rivalNote.textContent = '';
    updateWarButtons();
});

// Configuración del juego: texto de ayuda y reinicio de la pantalla de guerra.
function applyConfigWar(cfg) {
    warInfo.textContent =
        `Buscá un rival de nivel parecido o desafiá a alguien por su nombre. Pelear cuesta ⚡ ${cfg.warEnergy}. ` +
        `El premio base es 💵 ${cfg.warReward} y sube o baja según la diferencia de nivel. ` +
        `No podés volver a atacar al mismo jugador hasta pasados ${Math.round(cfg.rivalCooldownMs / 60000)} minutos. ` +
        `Tu maletín de guerra (en Inventario) define qué armas usás.`;
    resetWar(); // si había una pelea a medias antes de reconectar, la limpiamos.
}

clearRival(); // al cargar la página, el rival aparece vacío.
