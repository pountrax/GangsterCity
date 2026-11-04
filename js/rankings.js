// ============================================================
// js/rankings.js — Rankings con pestañas: Actividad / Clanes / Fama
// ============================================================

const rankTabs = document.querySelectorAll('.rank-tab');
const rankPanes = document.querySelectorAll('.rank-pane');
const scoreBody = document.querySelector('#scoreboard tbody');
const clanBoardBody = document.querySelector('#clanBoard tbody');
const fameBoardBody = document.querySelector('#fameBoard tbody');

let clanRankingData = []; // también se usa para la lista "Clanes disponibles" (js/clan.js).

rankTabs.forEach((b) => {
    b.addEventListener('click', () => {
        rankTabs.forEach((x) => x.classList.toggle('active', x === b));
        rankPanes.forEach((p) => p.classList.toggle('active', p.id === 'rank-' + b.dataset.rank));
    });
});

// Celda de nombre: con puntito verde si el jugador está conectado.
function nameCell(p) {
    const span = document.createElement('span');
    if (p.online) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.title = 'Conectado';
        span.appendChild(dot);
    }
    span.appendChild(document.createTextNode(p.name));
    return span;
}

// Dibuja una tabla de ranking.
// - body: el <tbody> a llenar.  - rows: lista de datos.
// - getCells(row, i): devuelve las celdas de esa fila (texto o elementos).
// - isMine(row): true si hay que resaltar la fila.  - cols: cantidad de columnas.
function renderBoard(body, rows, getCells, isMine, emptyText, cols) {
    body.innerHTML = '';
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols;
        td.className = 'empty';
        td.textContent = emptyText;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }
    rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        getCells(row, i).forEach((c) => {
            const td = document.createElement('td');
            // textContent es seguro: el código HTML escrito por alguien se muestra como texto.
            if (c instanceof Node) td.appendChild(c); else td.textContent = c;
            tr.appendChild(td);
        });
        if (isMine && isMine(row)) tr.classList.add('me');
        body.appendChild(tr);
    });
}

// Ranking de ACTIVIDAD (llega cada segundo).
socket.on('players', (players) => {
    renderBoard(scoreBody, players, (p, i) => [i + 1, nameCell(p), p.score],
        (p) => myName && p.name === myName, 'Todavía no hay jugadores.', 3);
    // Actualizamos "Tiempo jugado" en el recuadro del personaje.
    const mine = players.find((p) => p.name === myName);
    if (mine) scoreValue.textContent = mine.score;
});

// Ranking de FAMA (llega cada 10 segundos).
socket.on('fameRanking', (rows) => {
    renderBoard(fameBoardBody, rows, (p, i) => [i + 1, nameCell(p), p.level, p.fame],
        (p) => myName && p.name === myName, 'Todavía no hay jugadores.', 4);
});

// Ranking de CLANES (llega cada 10 segundos).
socket.on('clanRanking', (rows) => {
    clanRankingData = rows;
    renderBoard(clanBoardBody, rows, (c, i) => [i + 1, c.name, c.members, c.fame],
        (c) => lastState && lastState.clan && c.name === lastState.clan, 'Todavía no hay clanes.', 4);
    if (!myClanInfo) renderClanTab(); // (js/clan.js) actualiza la lista para unirse.
});
