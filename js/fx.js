// ============================================================
// js/fx.js — Animaciones de combate (las usan la guerra 1 contra 1 y la repetición de la guerra de clanes)
// "S" es un par de tarjetas { me, rival }; "me" mira a la derecha y "rival" a la izquierda.
// ============================================================

// Junta las partes de una tarjeta de luchador para poder actualizarlas fácil.
function fighterParts(id) {
    const root = document.getElementById(id);
    return {
        root,
        avatar: root.querySelector('.f-avatar'),
        name: root.querySelector('.f-name'),
        sub: root.querySelector('.f-sub'),
        hpFill: root.querySelector('.f-hp-fill'),
        hpText: root.querySelector('.f-hp-text'),
        stats: root.querySelector('.f-stats')
    };
}

// Lista compacta de estadísticas dentro de una tarjeta.
function fillStats(box, stats) {
    box.innerHTML = '';
    statsConfig.forEach((c) => {
        const span = document.createElement('span');
        span.textContent = `${c.icon} ${stats[c.id]}`;
        span.title = c.label;
        box.appendChild(span);
    });
}

// Barra de vida de un lado ('me' o 'rival'): cambia de color según lo que queda.
function setHpOn(S, side, hp, maxHp) {
    const f = S[side];
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    f.hpFill.style.width = (ratio * 100) + '%';
    f.hpFill.classList.toggle('mid', ratio <= 0.5 && ratio > 0.25);
    f.hpFill.classList.toggle('low', ratio <= 0.25);
    f.hpText.textContent = `${Math.round(hp)}/${maxHp}`;
}

// Número que flota sobre una tarjeta ('-12', '¡Esquivó!', etc.).
function floatNumberOn(S, side, text, cls) {
    const el = document.createElement('div');
    el.className = 'float-num ' + cls;
    el.textContent = text;
    S[side].root.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// PISTOLA: sale de la carta, se levanta hacia el rival y dispara.
function playPistolOn(S, side) {
    const def = itemsCatalog.pistola;
    if (!def) return;
    const outer = document.createElement('div');
    outer.className = 'gun-anim ' + side;
    const inner = document.createElement('div');
    inner.className = 'gun-inner';
    inner.appendChild(makeIcon(def));
    const flash = document.createElement('span');
    flash.className = 'muzzle';
    flash.textContent = '💥';
    inner.appendChild(flash);
    outer.appendChild(inner);
    S[side].root.appendChild(outer);
    setTimeout(() => outer.remove(), 1100);
}

// GRANADA: cae desde arriba sobre el rival y explota.
function playGrenadeOn(S, targetSide) {
    const def = itemsCatalog.granada;
    if (!def) return;
    const g = document.createElement('div');
    g.className = 'grenade-anim';
    g.appendChild(makeIcon(def));
    const boom = document.createElement('div');
    boom.className = 'boom';
    boom.textContent = '💥';
    S[targetSide].root.append(g, boom);
    setTimeout(() => { g.remove(); boom.remove(); }, 1500);
}

// Anima UN golpe completo.
// ev = { actor: 'me'|'rival', result: 'hit'|'crit'|'dodge'|'boom', dmg, weapon: 'pistol'|'grenade'|'' }.
// "onImpact" se ejecuta cuando el golpe llega (ahí se bajan las barras de vida).
function playHit(S, arenaEl, ev, onImpact, speed = 1) {
    const targetSide = ev.actor === 'me' ? 'rival' : 'me';

    // 1) El que ataca brilla y se lanza hacia adelante, con su arma.
    playAnim(S[ev.actor].root, 'acting', 900);
    if (ev.weapon === 'pistol') playPistolOn(S, ev.actor);
    if (ev.weapon === 'grenade') playGrenadeOn(S, targetSide);

    // 2) Cuando el disparo o la granada llegan, se ve el efecto en el que recibe.
    const delay = (ev.weapon === 'grenade' ? 800 : ev.weapon === 'pistol' ? 650 : 450) / speed;
    setTimeout(() => {
        const target = S[targetSide].root;
        if (ev.result === 'dodge') {
            playAnim(target, 'dodge', 600);
            floatNumberOn(S, targetSide, '¡Esquivó!', 'dodge');
        } else if (ev.result === 'boom') {
            playAnim(target, 'crit-hit', 650);
            playAnim(arenaEl, 'flash', 500);
            floatNumberOn(S, targetSide, '💣 -' + ev.dmg, 'boom-num');
        } else if (ev.result === 'crit') {
            playAnim(target, 'crit-hit', 650);
            playAnim(arenaEl, 'flash', 500);
            floatNumberOn(S, targetSide, '💥 -' + ev.dmg, 'crit');
        } else {
            playAnim(target, 'hit', 550);
            floatNumberOn(S, targetSide, '-' + ev.dmg, 'dmg');
        }
        onImpact();
    }, delay);
}
