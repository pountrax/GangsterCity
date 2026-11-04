// ============================================================
// js/replay.js — Repetición de la guerra de clanes
// El servidor guarda la guerra entera como una lista de duelos y de golpes.
// Acá se reproduce con las mismas animaciones de la guerra normal (js/fx.js).
// ============================================================

const cwReplay = document.getElementById('cwReplay');
const cwTitle = document.getElementById('cwTitle');
const cwBack = document.getElementById('cwBack');
const cwNameA = document.getElementById('cwNameA');
const cwNameB = document.getElementById('cwNameB');
const cwRosterA = document.getElementById('cwRosterA');
const cwRosterB = document.getElementById('cwRosterB');
const cwArena = document.getElementById('cwArena');
const cwBannerEl = document.getElementById('cwBanner');
const cwPause = document.getElementById('cwPause');
const cwSpeed = document.getElementById('cwSpeed');
const cwSkip = document.getElementById('cwSkip');
const cwLog = document.getElementById('cwLog');

// Las dos tarjetas de la repetición: "me" = clan atacante (izquierda), "rival" = clan defensor (derecha).
const Scw = { me: fighterParts('cwLeft'), rival: fighterParts('cwRight') };

// Estado de la repetición en curso (null = ninguna):
// d = duelo actual, e = golpe actual (-1 = todavía no empezó el duelo), dead = miembros caídos,
// active = peleando ahora, speed = velocidad, paused / ended = estado.
let cw = null;
let cwBannerTimer = null;

function cwBanner(text, cls = '', hideMs = 0) {
    clearTimeout(cwBannerTimer);
    cwBannerEl.textContent = text;
    cwBannerEl.className = cls;
    cwBannerEl.hidden = false;
    if (hideMs) cwBannerTimer = setTimeout(() => { cwBannerEl.hidden = true; }, hideMs);
}

function cwLogAdd(text, cls) {
    const line = document.createElement('div');
    line.className = cls || '';
    line.textContent = text;
    cwLog.prepend(line);
    while (cwLog.children.length > 60) cwLog.removeChild(cwLog.lastChild);
}

// Una ficha por miembro: se apaga cuando cae y brilla cuando está peleando.
function renderRoster(el, roster, dead, activeIdx) {
    el.innerHTML = '';
    roster.forEach((m, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip' + (dead.has(i) ? ' dead' : '') + (i === activeIdx ? ' active' : '');
        chip.title = `${m.name} · Nv ${m.level}`;
        chip.textContent = (m.role === 'lider' ? '🎩' : m.role === 'colider' ? '🕶️' : m.role === 'oficial' ? '⭐' : '') +
            m.name.charAt(0).toUpperCase();
        el.appendChild(chip);
    });
}

function cwRenderRosters() {
    renderRoster(cwRosterA, cw.war.rosterA, cw.dead.a, cw.active.a);
    renderRoster(cwRosterB, cw.war.rosterB, cw.dead.b, cw.active.b);
}

// Llena una tarjeta con los datos de un luchador al empezar su duelo.
function cwFillCard(side, snap) {
    const f = Scw[side];
    f.root.classList.remove('empty', 'winner', 'loser');
    f.avatar.textContent = snap.name.charAt(0).toUpperCase();
    f.name.textContent = snap.name;
    f.sub.textContent = `${snap.className} · Nv ${snap.level}` + (snap.pistol ? ' · 🔫' : '');
    fillStats(f.stats, snap.stats);
    setHpOn(Scw, side, snap.hp, snap.maxHp);
}

// Programa el próximo paso (la velocidad x1/x2/x4 divide la espera).
function cwSchedule(ms) {
    if (!cw) return;
    clearTimeout(cw.timer);
    if (cw.paused || cw.ended) return;
    cw.timer = setTimeout(cwStep, ms / cw.speed);
}

// Un paso de la repetición: empezar un duelo, mostrar un golpe o cerrar el duelo.
function cwStep() {
    if (!cw || cw.paused || cw.ended) return;
    const duel = cw.war.duels[cw.d];
    if (!duel) { cwFinish(); return; }
    const turnMs = gameConfig ? gameConfig.warTurnMs : 1400;

    // 1) Empieza el duelo.
    if (cw.e === -1) {
        cw.active = { a: duel.ia, b: duel.ib };
        cwFillCard('me', duel.a);
        cwFillCard('rival', duel.b);
        cwRenderRosters();
        cwBanner(`⚔️ Duelo ${cw.d + 1}/${cw.war.duels.length}: ${duel.a.name} vs ${duel.b.name}`, '', 1300);
        cwLogAdd(`⚔️ Duelo ${cw.d + 1}: ${duel.a.name} (${Math.round(duel.a.hp)} HP) vs ${duel.b.name} (${Math.round(duel.b.hp)} HP).`, 'l-sys');
        cw.e = 0;
        cwSchedule(1300);
        return;
    }
    // 2) Un golpe.
    if (cw.e < duel.ev.length) {
        cwPlayEvent(duel, duel.ev[cw.e]);
        cw.e++;
        cwSchedule(turnMs);
        return;
    }
    // 3) Terminó el duelo: uno cae y el otro sigue.
    cwEndDuel(duel);
    cw.d++;
    cw.e = -1;
    cwSchedule(1800);
}

// Muestra UN golpe. Formato: [quién (0 = izquierda, 1 = derecha), resultado (0 golpe, 1 crítico, 2 esquive),
// daño, turno extra, pistola, vida izquierda, vida derecha].
function cwPlayEvent(duel, e) {
    const ev = {
        actor: e[0] === 0 ? 'me' : 'rival',
        result: e[1] === 1 ? 'crit' : e[1] === 2 ? 'dodge' : 'hit',
        dmg: e[2],
        extra: !!e[3],
        weapon: e[4] ? 'pistol' : ''
    };
    if (ev.extra) cwBanner('⚡ ¡Turno extra!', 'extra', 900);
    playHit(Scw, cwArena, ev, () => {
        setHpOn(Scw, 'me', e[5], duel.a.maxHp);
        setHpOn(Scw, 'rival', e[6], duel.b.maxHp);
    }, cw.speed);

    // Registro escrito.
    const att = ev.actor === 'me' ? duel.a.name : duel.b.name;
    const def = ev.actor === 'me' ? duel.b.name : duel.a.name;
    const gun = ev.weapon ? '🔫 ' : '';
    const text = (ev.extra ? '⚡ ' : '') + (
        ev.result === 'dodge' ? `${def} esquivó el ataque de ${att}.`
        : ev.result === 'crit' ? `${gun}💥 ¡CRÍTICO! ${att} golpeó a ${def} por ${ev.dmg}.`
        : `${gun}${att} ${ev.weapon ? 'le disparó' : 'golpeó'} a ${def} por ${ev.dmg}.`);
    cwLogAdd(text, (ev.actor === 'me' ? 'l-me' : 'l-rival') + (ev.result === 'crit' ? ' l-crit' : ''));
}

// Cierra un duelo: el perdedor cae (su ficha se apaga) y el ganador sigue con la vida que le queda.
function cwEndDuel(duel) {
    const winSide = duel.w === 'a' ? 'me' : 'rival';
    const loseSide = duel.w === 'a' ? 'rival' : 'me';
    const winSnap = duel.w === 'a' ? duel.a : duel.b;
    const loseSnap = duel.w === 'a' ? duel.b : duel.a;
    const last = duel.ev[duel.ev.length - 1];
    const winHp = duel.w === 'a' ? last[5] : last[6];

    Scw[winSide].root.classList.add('winner');
    Scw[loseSide].root.classList.add('loser');
    setHpOn(Scw, loseSide, 0, loseSnap.maxHp);
    (duel.w === 'a' ? cw.dead.b : cw.dead.a).add(duel.w === 'a' ? duel.ib : duel.ia);
    cwRenderRosters();
    cwLogAdd(`💀 ${loseSnap.name} cayó${duel.t ? ' (por tener menos vida al agotarse los golpes)' : ''}. ` +
        `${winSnap.name} sigue de pie con ${Math.round(winHp)} de vida.`, 'l-sys l-crit');
}

// Resultado final de la guerra.
function cwFinish() {
    if (!cw) return;
    cw.ended = true;
    clearTimeout(cw.timer);
    const war = cw.war;
    const won = war.winner === war.mySide;
    cwBanner(won ? `🏆 ¡Tu clan ganó la guerra! (${war.winnerName})` : `💀 Tu clan perdió. Ganó ${war.winnerName}.`, won ? 'win' : 'lose');
    cwLogAdd(`🏁 ¡${war.winnerName} ganó la guerra! Cada miembro del clan ganador recibió ` +
        `💵 ${war.reward.money}, ⭐ ${war.reward.fame} y ✨ ${war.reward.xp} XP.`, 'l-sys l-crit');
    cwPause.disabled = true;
    cwSkip.disabled = true;
}

// Salta directo al final.
function cwSkipToEnd() {
    if (!cw || cw.ended) return;
    cw.war.duels.forEach((d) => (d.w === 'a' ? cw.dead.b : cw.dead.a).add(d.w === 'a' ? d.ib : d.ia));
    cw.active = { a: -1, b: -1 };
    cwRenderRosters();
    cwFinish();
}

// Detiene la repetición.
function cwStop() {
    if (cw) clearTimeout(cw.timer);
    cw = null;
}

// Cierra la repetición y vuelve a la lista de guerras.
function closeReplay() {
    cwStop();
    cwReplay.hidden = true;
    cwListBox.hidden = false;
}

// Arranca una repetición con los datos que mandó el servidor.
function openReplayView(war) {
    cwStop();
    cw = { war, d: 0, e: -1, timer: null, speed: 1, paused: false, ended: false,
           dead: { a: new Set(), b: new Set() }, active: { a: -1, b: -1 } };

    cwListBox.hidden = true;
    cwReplay.hidden = false;
    cwTitle.textContent = `${war.attackerName} ⚔️ ${war.defenderName}`;
    cwNameA.textContent = war.attackerName + (war.mySide === 'a' ? ' (tu clan)' : '');
    cwNameB.textContent = war.defenderName + (war.mySide === 'b' ? ' (tu clan)' : '');
    cwLog.innerHTML = '';
    cwBannerEl.hidden = true;
    cwPause.disabled = false;
    cwSkip.disabled = false;
    cwPause.textContent = '⏸ Pausa';
    cwSpeed.textContent = 'Velocidad x1';
    ['me', 'rival'].forEach((s) => {
        Scw[s].root.classList.add('empty');
        Scw[s].root.classList.remove('winner', 'loser');
    });
    cwRenderRosters();
    cwLogAdd(`¡Comienza la guerra! ${war.rosterA.length} luchadores vs ${war.rosterB.length}. Pelea primero el de menor rango de cada clan y el líder pelea último.`, 'l-sys');
    cwSchedule(900);
}

// Pide la repetición al servidor.
function watchWar(warId) {
    cwMsg.textContent = '';
    socket.emit('getClanWarReplay', warId, (res) => {
        if (!res.ok) { cwMsg.textContent = '⚠️ ' + res.error; return; }
        openReplayView(res.war);
    });
}

cwBack.addEventListener('click', () => {
    closeReplay();
    loadClanWarPanel(); // (js/clanwar.js)
});

cwPause.addEventListener('click', () => {
    if (!cw || cw.ended) return;
    cw.paused = !cw.paused;
    cwPause.textContent = cw.paused ? '▶ Seguir' : '⏸ Pausa';
    if (!cw.paused) cwSchedule(200);
});

cwSpeed.addEventListener('click', () => {
    if (!cw) return;
    cw.speed = cw.speed === 1 ? 2 : cw.speed === 2 ? 4 : 1;
    cwSpeed.textContent = 'Velocidad x' + cw.speed;
});

cwSkip.addEventListener('click', cwSkipToEnd);
