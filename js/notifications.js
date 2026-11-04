// ============================================================
// js/notifications.js — La campanita 🔔 (arriba a la derecha)
// Dos tipos: 'attack' (te atacaron, con registro de la pelea) y 'clanwar' (resultado de una guerra de clanes).
// ============================================================

const notifBtn = document.getElementById('notifBtn');
const notifBadge = document.getElementById('notifBadge');
const notifPanel = document.getElementById('notifPanel');
const notifList = document.getElementById('notifList');
const notifClose = document.getElementById('notifClose');

let notes = []; // notificaciones (la más nueva primero).

// Texto de resumen. "result" está contado desde el punto de vista del ATACANTE.
function noteSummary(n) {
    if (n.type === 'clanwar') return n.text;
    if (n.result === 'win') return `⚔️ ${n.from} (Nv ${n.fromLevel}) te atacó y te venció.`;
    if (n.result === 'lose') return `🛡️ ${n.from} (Nv ${n.fromLevel}) te atacó, ¡pero lo derrotaste!`;
    return `🤝 ${n.from} (Nv ${n.fromLevel}) te atacó y terminaron en empate.`;
}

// Líneas del registro, contadas desde TU punto de vista (vos sos el defensor).
function noteLines(n) {
    return n.log.map((e) => {
        const gun = e.w === 'pistol' ? '🔫 ' : '';
        const extra = e.x ? '⚡ ' : '';
        if (e.a === 'me') { // actuó el atacante.
            if (e.r === 'dodge') return `${extra}¡Esquivaste el ataque de ${n.from}!`;
            if (e.r === 'boom') return `${extra}💣 ${n.from} te lanzó una granada: -${e.d}.`;
            if (e.r === 'crit') return `${extra}${gun}💥 ¡CRÍTICO! ${n.from} te golpeó por ${e.d}.`;
            return `${extra}${gun}${n.from} ${e.w === 'pistol' ? 'te disparó' : 'te golpeó'} por ${e.d}.`;
        }
        // actuaste vos, defendiéndote.
        if (e.r === 'dodge') return `${extra}${n.from} esquivó tu ataque.`;
        if (e.r === 'crit') return `${extra}${gun}💥 ¡CRÍTICO! Golpeaste a ${n.from} por ${e.d}.`;
        return `${extra}${gun}${e.w === 'pistol' ? 'Le disparaste' : 'Golpeaste'} a ${n.from} por ${e.d}.`;
    });
}

// Dibuja la lista y el globito con la cantidad sin leer.
function renderNotifs() {
    const unread = notes.filter((n) => !n.read).length;
    notifBadge.hidden = unread < 1;
    notifBadge.textContent = unread;

    notifList.innerHTML = '';
    if (!notes.length) {
        const empty = document.createElement('div');
        empty.className = 'notif-empty';
        empty.textContent = 'Todavía no tenés notificaciones.';
        notifList.appendChild(empty);
        return;
    }
    notes.forEach((n) => {
        const item = document.createElement('div');
        item.className = 'notif-item' + (n.fresh ? ' fresh' : '');

        const text = document.createElement('div');
        text.textContent = noteSummary(n);
        const time = document.createElement('span');
        time.className = 'notif-time';
        time.textContent = new Date(n.ts).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        item.append(text, time);

        // Solo los ataques tienen registro para desplegar.
        if (n.type !== 'clanwar' && n.log.length) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'notif-toggle';
            toggle.textContent = 'Ver registro';
            const log = document.createElement('div');
            log.className = 'notif-log';
            log.hidden = true;
            noteLines(n).forEach((line) => {
                const d = document.createElement('div');
                d.textContent = line;
                log.appendChild(d);
            });
            toggle.addEventListener('click', () => {
                log.hidden = !log.hidden;
                toggle.textContent = log.hidden ? 'Ver registro' : 'Ocultar registro';
            });
            item.append(toggle, log);
        }
        notifList.appendChild(item);
    });
}

function openNotifs() {
    // Las que estaban sin leer quedan resaltadas mientras el panel está abierto.
    notes.forEach((n) => { n.fresh = !n.read; n.read = true; });
    renderNotifs();
    notifPanel.hidden = false;
    socket.emit('readNotifications');
}
function closeNotifs() { notifPanel.hidden = true; }

notifBtn.addEventListener('click', () => { if (notifPanel.hidden) openNotifs(); else closeNotifs(); });
notifClose.addEventListener('click', closeNotifs);
// Tocar fuera del panel lo cierra.
document.addEventListener('click', (e) => {
    if (!notifPanel.hidden && !document.getElementById('notifBox').contains(e.target)) closeNotifs();
});

// Lista inicial (al entrar).
socket.on('notifications', (list) => {
    notes = list;
    renderNotifs();
});

// Una notificación nueva, en vivo.
socket.on('notification', (n) => {
    n.read = !notifPanel.hidden;   // si el panel está abierto, se considera leída.
    n.fresh = !notifPanel.hidden;
    notes.unshift(n);
    if (notes.length > 30) notes.pop();
    renderNotifs();
    if (!notifPanel.hidden) socket.emit('readNotifications');
    playAnim(notifBtn, 'ring', 1000); // la campanita se sacude.
});
