// ============================================================
// script.js — Lo que corre en el NAVEGADOR del jugador
// Muestra el login, el panel del personaje, el menú, las misiones,
// el inventario (estadísticas, mochila y maletín con arrastrar y soltar),
// la tienda, la guerra (con armas animadas y búsqueda por nombre),
// las notificaciones, los clanes, los rankings y el chat global.
// NO calcula nada del juego: solo pide cosas al servidor (server.js)
// y muestra lo que el servidor devuelve.
// ============================================================

// ---------- Elementos del HTML que vamos a usar ----------
const loginBox = document.getElementById('login');
const gameBox = document.getElementById('game');
const form = document.getElementById('loginForm');
const inputUser = document.getElementById('username');
const inputPass = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

// Recuadro del personaje.
const avatar = document.getElementById('avatar');
const nameValue = document.getElementById('nameValue');
const classValue = document.getElementById('classValue');
const levelValue = document.getElementById('levelValue');
const xpValue = document.getElementById('xpValue');
const xpMax = document.getElementById('xpMax');
const xpBar = document.getElementById('xpBar');
const moneyValue = document.getElementById('moneyValue');
const energyValue = document.getElementById('energyValue');
const energyMax = document.getElementById('energyMax');
const energyTimer = document.getElementById('energyTimer');
const energyBar = document.getElementById('energyBar');
const fameValue = document.getElementById('fameValue');
const scoreValue = document.getElementById('scoreValue');
const editProfileBtn = document.getElementById('editProfileBtn');
const editProfile = document.getElementById('editProfile');
const editNameForm = document.getElementById('editNameForm');
const editName = document.getElementById('editName');
const editNameHint = document.getElementById('editNameHint');
const editMsg = document.getElementById('editMsg');

// Conectamos al servidor que está en Render.
const socket = io('https://gangstercity.onrender.com');

// Usuario y contraseña, SOLO en memoria, para reconectar solos si se corta internet.
let credentials = null;
// Nombre del jugador logueado (sirve para resaltar su fila y sus mensajes).
let myName = null;
// Último estado personal que mandó el servidor (dinero, energía, nivel, etc.).
let lastState = null;
// Configuración del juego que manda el servidor (niveles de clan, costos, etc.).
let gameConfig = null;
// Lista de estadísticas (id, nombre, icono) que manda el servidor.
let statsConfig = [];
// Catálogo de objetos (id → { name, emoji, img, w, h... }) que manda el servidor.
let itemsCatalog = {};
// Cuánto dura un mensaje del chat global (el servidor lo confirma al entrar).
let chatTtlMs = 30 * 60 * 1000;

// Recordamos el último usuario usado (la contraseña NO se recuerda).
try { inputUser.value = localStorage.getItem('lastUser') || ''; } catch (e) {}

// ============================================================
// LOGIN
// ============================================================

// Le pide al servidor que valide usuario y contraseña. Devuelve una "promesa".
// "extra" permite mandar datos adicionales (por ejemplo { noCreate: true } al reconectar).
function login(creds, extra = {}) {
    return new Promise((resolve) => {
        socket.emit('auth', { ...creds, ...extra }, resolve);
    });
}

// Se ejecuta al apretar "Entrar" (o Enter).
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Conectando... (puede tardar si el servidor estaba dormido)';

    const creds = { name: inputUser.value.trim(), password: inputPass.value };
    const res = await login(creds);

    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';

    if (!res.ok) {
        loginError.textContent = res.error;
        return;
    }

    // Login exitoso:
    credentials = creds;
    myName = res.name;
    try { localStorage.setItem('lastUser', res.name); } catch (e) {}

    nameValue.textContent = myName;
    editName.value = myName;
    avatar.textContent = myName.charAt(0).toUpperCase();

    loginBox.hidden = true;
    gameBox.hidden = false;
});

// Si se corta la conexión y el navegador reconecta solo, volvemos a loguearnos.
// "noCreate" evita que el servidor cree una cuenta nueva por error.
socket.on('connect', async () => {
    if (!credentials) return;
    for (let i = 0; i < 6; i++) {
        const res = await login(credentials, { noCreate: true });
        if (res.ok) return;
        if (res.code === 'online' && i < 5) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }
        credentials = null;
        gameBox.hidden = true;
        loginBox.hidden = false;
        loginError.textContent = res.error;
        return;
    }
});

// ============================================================
// BOTÓN DE DOS TOQUES (para acciones peligrosas: salir, expulsar)
// ============================================================
function confirmButton(btn, label, confirmLabel, onConfirm) {
    let armed = false;
    let timer = null;
    btn.textContent = label;
    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            btn.textContent = confirmLabel;
            timer = setTimeout(() => { armed = false; btn.textContent = label; }, 4000);
            return;
        }
        clearTimeout(timer);
        armed = false;
        btn.textContent = label;
        onConfirm();
    });
}

// ============================================================
// FORMATOS DE TIEMPO
// ============================================================

// 9:05 (minutos:segundos)
function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// "3 h 20 min" o "45 min"
function fmtHM(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

// ============================================================
// ICONOS DE OBJETOS
// Muestra el emoji; si existe la imagen del objeto (carpeta img/items/),
// la reemplaza apenas termina de cargar. Si la imagen no existe, queda el emoji.
// ============================================================
function makeIcon(def) {
    const wrap = document.createElement('span');
    wrap.className = 'icon';
    const emoji = document.createElement('span');
    emoji.className = 'icon-emoji' + (def.flip ? ' flip' : '');
    emoji.textContent = def.emoji;
    wrap.appendChild(emoji);
    if (def.img) {
        const img = new Image();
        img.alt = '';
        img.draggable = false;
        img.onload = () => { emoji.remove(); wrap.appendChild(img); };
        img.src = def.img;
    }
    return wrap;
}

// ============================================================
// EDITAR PERFIL
// ============================================================
editProfileBtn.addEventListener('click', () => {
    editProfile.hidden = !editProfile.hidden;
    editProfileBtn.textContent = editProfile.hidden ? '✏️ Editar perfil' : '✖ Cerrar edición';
});

// Guardar el nuevo nombre de usuario.
editNameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    editMsg.textContent = '';
    socket.emit('changeName', editName.value, (res) => {
        if (!res.ok) { editMsg.textContent = '⚠️ ' + res.error; return; }
        myName = res.name;
        if (credentials) credentials.name = res.name;
        try { localStorage.setItem('lastUser', res.name); } catch (err) {}
        nameValue.textContent = myName;
        editName.value = myName;
        avatar.textContent = myName.charAt(0).toUpperCase();
        editMsg.textContent = '✅ Nombre cambiado. Desde ahora iniciás sesión con ese nombre.';
    });
});

// ============================================================
// NAVEGACIÓN ENTRE SECCIONES (Misiones / Inventario / Guerra / Tienda / Clan)
// ============================================================
const navButtons = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab');

function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'clan') loadMyClan();
    if (name === 'inventario') renderCase(); // recalcula el tamaño de las casillas.
}

navButtons.forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
});

// ============================================================
// RANKINGS (con pestañas: Actividad / Clanes / Fama)
// ============================================================
const rankTabs = document.querySelectorAll('.rank-tab');
const rankPanes = document.querySelectorAll('.rank-pane');
const scoreBody = document.querySelector('#scoreboard tbody');
const clanBoardBody = document.querySelector('#clanBoard tbody');
const fameBoardBody = document.querySelector('#fameBoard tbody');

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
            if (c instanceof Node) td.appendChild(c); else td.textContent = c;
            tr.appendChild(td);
        });
        if (isMine && isMine(row)) tr.classList.add('me');
        body.appendChild(tr);
    });
}

// Ranking de ACTIVIDAD (llega cada segundo).
socket.on('players', (players) => {
    renderBoard(
        scoreBody, players,
        (p, i) => [i + 1, nameCell(p), p.score],
        (p) => myName && p.name === myName,
        'Todavía no hay jugadores.', 3
    );
    const mine = players.find((p) => p.name === myName);
    if (mine) scoreValue.textContent = mine.score;
});

// Ranking de FAMA (llega cada 10 segundos).
socket.on('fameRanking', (rows) => {
    renderBoard(
        fameBoardBody, rows,
        (p, i) => [i + 1, nameCell(p), p.level, p.fame],
        (p) => myName && p.name === myName,
        'Todavía no hay jugadores.', 4
    );
});

// Ranking de CLANES (llega cada 10 segundos).
let clanRankingData = [];
socket.on('clanRanking', (rows) => {
    clanRankingData = rows;
    renderBoard(
        clanBoardBody, rows,
        (c, i) => [i + 1, c.name, c.members, c.fame],
        (c) => lastState && lastState.clan && c.name === lastState.clan,
        'Todavía no hay clanes.', 4
    );
    if (!myClanInfo) renderClanTab();
});

// ============================================================
// ESTADÍSTICAS (Vida, Daño, Aguante, Velocidad, Inteligencia, Suerte)
// Cada fila: nombre + efecto | valor (+ extra del maletín) | botón "+" | botón 💵
// ============================================================
const statsList = document.getElementById('statsList');
const statsMsg = document.getElementById('statsMsg');
const statPointsValue = document.getElementById('statPointsValue');
const inventoryBadge = document.getElementById('inventoryBadge');

let statRows = {};

function buildStatsPanel(list) {
    statsList.innerHTML = '';
    statRows = {};

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

        const plus = document.createElement('button');
        plus.className = 'plus-btn';
        plus.type = 'button';
        plus.textContent = '+';
        plus.title = 'Subir ' + s.label + ' con un punto disponible';
        plus.disabled = true;
        plus.addEventListener('click', () => {
            statsMsg.textContent = '';
            socket.emit('spendStat', s.id, (res) => {
                if (!res.ok) statsMsg.textContent = '⚠️ ' + res.error;
            });
        });

        const buy = document.createElement('button');
        buy.className = 'buy-btn';
        buy.type = 'button';
        buy.textContent = '💵 ' + gameConfig.statCost;
        buy.title = `Comprar 1 punto de ${s.label}`;
        buy.disabled = true;
        buy.addEventListener('click', () => {
            statsMsg.textContent = '';
            socket.emit('buyStat', s.id, (res) => {
                if (!res.ok) statsMsg.textContent = '⚠️ ' + res.error;
            });
        });

        row.append(info, value, plus, buy);
        statsList.appendChild(row);
        statRows[s.id] = { value, effect, plus, buy };
    });
}

// ============================================================
// INVENTARIO: SUBPESTAÑAS, MOCHILA Y MALETÍN DE GUERRA
// ============================================================
const invTabs = document.querySelectorAll('#tab-inventario .sub-tab');
const invPanes = document.querySelectorAll('#tab-inventario .inv-pane');
const bagGrid = document.getElementById('bagGrid');
const bagBox = document.getElementById('bagBox');
const bagCount = document.getElementById('bagCount');
const itemInfo = document.getElementById('itemInfo');
const invMsg = document.getElementById('invMsg');
const caseGrid = document.getElementById('caseGrid');
const caseHint = document.getElementById('caseHint');
const expandCaseBtn = document.getElementById('expandCaseBtn');

let bagSlots = 20; // casillas de la mochila (el servidor lo confirma).
// Lo último que mandó el servidor sobre mochila y maletín.
let invData = { bag: [], briefcase: [], caseSize: 3, expanded: false };
let caseCells = [];   // las casillas (div) del maletín, para pintarlas al arrastrar.
let selected = null;  // objeto seleccionado: { from: 'bag', idx } o { from: 'case', uid }.

// Cambia entre "Inventario" (estadísticas) y "Maletín de guerra".
function showInvPane(name) {
    invTabs.forEach((b) => b.classList.toggle('active', b.dataset.invpane === name));
    invPanes.forEach((p) => p.classList.toggle('active', p.id === 'invPane-' + name));
    if (name === 'case') renderCase();
}
invTabs.forEach((b) => b.addEventListener('click', () => showInvPane(b.dataset.invpane)));

// Define el tamaño de una casilla del maletín en píxeles (se usa para el tamaño de los iconos).
function setCellSize() {
    const w = caseGrid.clientWidth;
    if (w) caseGrid.style.setProperty('--cell', (w / invData.caseSize) + 'px');
}
window.addEventListener('resize', setCellSize);

// Dibuja la mochila: una casilla por cada espacio.
function renderBag() {
    bagGrid.innerHTML = '';
    for (let i = 0; i < bagSlots; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const st = invData.bag[i];
        if (st && itemsCatalog[st.id]) {
            const def = itemsCatalog[st.id];
            slot.classList.add('filled');
            slot.title = def.name;
            slot.appendChild(makeIcon(def));
            if (st.qty > 1) {
                const q = document.createElement('span');
                q.className = 'qty';
                q.textContent = 'x' + st.qty;
                slot.appendChild(q);
            }
            if (selected && selected.from === 'bag' && selected.idx === i) slot.classList.add('selected');
            slot.addEventListener('pointerdown', (e) => onItemPointerDown(e, { from: 'bag', idx: i }, def));
        }
        bagGrid.appendChild(slot);
    }
    bagCount.textContent = `(${invData.bag.length}/${bagSlots})`;
}

// Dibuja el maletín: la grilla de casillas y los objetos colocados.
function renderCase() {
    const size = invData.caseSize;
    caseGrid.innerHTML = '';
    caseGrid.style.setProperty('--size', size);
    caseCells = [];
    for (let i = 0; i < size * size; i++) {
        const c = document.createElement('div');
        c.className = 'case-cell';
        caseGrid.appendChild(c);
        caseCells.push(c);
    }
    invData.briefcase.forEach((it) => {
        const def = itemsCatalog[it.id];
        if (!def) return;
        const el = document.createElement('div');
        el.className = 'case-item';
        el.title = def.name;
        // Posición y tamaño en porcentajes de la grilla.
        el.style.left = (it.x / size * 100) + '%';
        el.style.top = (it.y / size * 100) + '%';
        el.style.width = (def.w / size * 100) + '%';
        el.style.height = (def.h / size * 100) + '%';
        el.style.setProperty('--minside', Math.min(def.w, def.h));
        el.appendChild(makeIcon(def));
        if (it.qty > 1) {
            const q = document.createElement('span');
            q.className = 'qty';
            q.textContent = 'x' + it.qty;
            el.appendChild(q);
        }
        if (selected && selected.from === 'case' && selected.uid === it.uid) el.classList.add('selected');
        el.addEventListener('pointerdown', (e) => onItemPointerDown(e, { from: 'case', uid: it.uid }, def));
        caseGrid.appendChild(el);
    });
    setCellSize();
}

// Texto de ayuda del maletín y botón de expansión (se llama cada segundo: es liviano).
function updateExpandBtn() {
    if (!gameConfig) return;
    const n = invData.caseSize;
    caseHint.textContent =
        `Maletín de ${n}x${n}. Lo que esté acá es lo que usa tu personaje al pelear. ` +
        `Arrastrá objetos desde la mochila (🔫 2x2, 💣 2x1), o tocá un objeto y elegí "Poner en el maletín".`;
    if (invData.expanded) {
        expandCaseBtn.textContent = '✅ Maletín expandido';
        expandCaseBtn.disabled = true;
    } else {
        expandCaseBtn.textContent =
            `Expandir maletín (+2x2) · 💵 ${gameConfig.caseExpandCost} · Nivel ${gameConfig.caseExpandLevel}`;
        expandCaseBtn.disabled = !lastState || lastState.level < gameConfig.caseExpandLevel || lastState.money < gameConfig.caseExpandCost;
    }
}
expandCaseBtn.addEventListener('click', () => {
    invMsg.textContent = '';
    socket.emit('expandCase', (res) => {
        invMsg.textContent = res.ok ? '✅ ¡Maletín expandido a 5x5!' : '⚠️ ' + res.error;
    });
});

// Panel de información del objeto seleccionado, con sus botones.
function renderItemInfo() {
    itemInfo.innerHTML = '';
    if (!selected) return;
    const item = selected.from === 'bag'
        ? invData.bag[selected.idx]
        : invData.briefcase.find((i) => i.uid === selected.uid);
    if (!item || !itemsCatalog[item.id]) { selected = null; return; }
    const def = itemsCatalog[item.id];

    const card = document.createElement('div');
    card.className = 'item-card';
    const title = document.createElement('strong');
    title.textContent = `${def.emoji} ${def.name}` + (item.qty > 1 ? ` x${item.qty}` : '');
    const desc = document.createElement('p');
    desc.textContent = def.desc + (def.w ? ` (Ocupa ${def.w}x${def.h} en el maletín.)` : '');
    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const addBtn = (text, cls, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'action-btn small ' + cls;
        b.textContent = text;
        b.addEventListener('click', onClick);
        actions.appendChild(b);
    };

    if (selected.from === 'bag') {
        const idx = selected.idx;
        if (def.kind === 'consumable') {
            addBtn(`${def.emoji} Usar`, '', () => {
                invMsg.textContent = '';
                socket.emit('useItem', idx, (res) => { invMsg.textContent = res.ok ? res.message : '⚠️ ' + res.error; });
            });
        }
        if (def.w) {
            addBtn('💼 Poner en el maletín', '', () => {
                invMsg.textContent = '';
                socket.emit('placeInCase', { idx }, (res) => { if (!res.ok) invMsg.textContent = '⚠️ ' + res.error; });
            });
        }
    } else {
        const uid = selected.uid;
        addBtn('↩ Sacar del maletín', 'neutral', () => {
            invMsg.textContent = '';
            socket.emit('removeFromCase', { uid }, (res) => { if (!res.ok) invMsg.textContent = '⚠️ ' + res.error; });
        });
    }

    card.append(title, desc, actions);
    itemInfo.appendChild(card);
}

// Selecciona (o deselecciona) un objeto.
function selectItem(payload) {
    const same = selected && selected.from === payload.from &&
        (payload.from === 'bag' ? selected.idx === payload.idx : selected.uid === payload.uid);
    selected = same ? null : payload;
    renderBag();
    renderCase();
    renderItemInfo();
}

// ---------- Arrastrar y soltar (funciona con mouse y con el dedo) ----------
let drag = null; // { payload, def, startX, startY, ghost, moved, target }

// ¿Entra el objeto "def" en la casilla (x, y) del maletín, según lo que ya hay?
// (Solo para mostrar verde o rojo: el servidor lo vuelve a verificar.)
function fitsLocal(def, x, y, ignoreUid) {
    if (!def.w) return false;
    const size = invData.caseSize;
    if (x < 0 || y < 0 || x + def.w > size || y + def.h > size) return false;
    return !invData.briefcase.some((it) => {
        if (it.uid === ignoreUid) return false;
        const d = itemsCatalog[it.id];
        return x < it.x + d.w && it.x < x + def.w && y < it.y + d.h && it.y < y + def.h;
    });
}

// Saca el verde/rojo de las casillas.
function clearHighlight() {
    caseCells.forEach((c) => c.classList.remove('ok', 'bad'));
}

// Pinta de verde o rojo las casillas que ocuparía el objeto arrastrado.
function updateHover(x, y) {
    clearHighlight();
    drag.target = null;
    const rect = caseGrid.getBoundingClientRect();
    if (!rect.width) return; // el maletín no está visible.
    if (x < rect.left - 20 || x > rect.right + 20 || y < rect.top - 20 || y > rect.bottom + 20) return;

    const size = invData.caseSize;
    const cs = rect.width / size;
    const def = drag.def;
    const w = def.w || 1;
    const h = def.h || 1;
    // El objeto queda centrado en el puntero.
    const gx = Math.round((x - rect.left) / cs - w / 2);
    const gy = Math.round((y - rect.top) / cs - h / 2);
    const ok = fitsLocal(def, gx, gy, drag.payload.uid);
    drag.target = { x: gx, y: gy, ok };

    for (let yy = gy; yy < gy + h; yy++) {
        for (let xx = gx; xx < gx + w; xx++) {
            if (xx >= 0 && yy >= 0 && xx < size && yy < size) {
                caseCells[yy * size + xx].classList.add(ok ? 'ok' : 'bad');
            }
        }
    }
}

function onItemPointerDown(e, payload, def) {
    if (e.button !== undefined && e.button !== 0) return; // solo clic izquierdo.
    e.preventDefault();
    drag = { payload, def, startX: e.clientX, startY: e.clientY, ghost: null, moved: false, target: null };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
}

function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved) {
        // Hasta que no se mueva unos pixeles, lo tomamos como un toque (no como arrastre).
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.moved = true;
        // "Fantasma" que sigue al puntero, con el tamaño que ocuparía en el maletín.
        const rect = caseGrid.getBoundingClientRect();
        const cs = rect.width ? rect.width / invData.caseSize : 56;
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.width = (drag.def.w || 1) * cs + 'px';
        ghost.style.height = (drag.def.h || 1) * cs + 'px';
        ghost.appendChild(makeIcon(drag.def));
        document.body.appendChild(ghost);
        drag.ghost = ghost;
    }
    drag.ghost.style.transform =
        `translate(${e.clientX - drag.ghost.offsetWidth / 2}px, ${e.clientY - drag.ghost.offsetHeight / 2}px)`;
    updateHover(e.clientX, e.clientY);
}

function endDragCleanup() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    if (drag && drag.ghost) drag.ghost.remove();
    clearHighlight();
}

function onDragCancel() {
    endDragCleanup();
    drag = null;
}

function onDragEnd(e) {
    if (!drag) return;
    const d = drag;
    endDragCleanup();
    drag = null;

    // Un toque sin arrastrar: seleccionamos el objeto.
    if (!d.moved) { selectItem(d.payload); return; }

    invMsg.textContent = '';
    const report = (res) => { if (!res.ok) invMsg.textContent = '⚠️ ' + res.error; };

    if (d.target) {
        // Lo soltó sobre el maletín.
        if (!d.target.ok) { invMsg.textContent = '⚠️ No entra en ese lugar.'; return; }
        if (d.payload.from === 'bag') {
            socket.emit('placeInCase', { idx: d.payload.idx, x: d.target.x, y: d.target.y }, report);
        } else {
            socket.emit('moveInCase', { uid: d.payload.uid, x: d.target.x, y: d.target.y }, report);
        }
        return;
    }
    // Un objeto del maletín soltado sobre la mochila: vuelve a la mochila.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (d.payload.from === 'case' && under && bagBox.contains(under)) {
        socket.emit('removeFromCase', { uid: d.payload.uid }, report);
    }
}

// El servidor manda la mochila y el maletín (al entrar y cada vez que cambian).
socket.on('inventory', (data) => {
    invData = data;
    selected = null; // los números de casilla pueden haber cambiado.
    renderBag();
    renderCase();
    renderItemInfo();
    updateExpandBtn();
});

// ============================================================
// TIENDA
// ============================================================
const shopOffers = document.getElementById('shopOffers');
const shopInfo = document.getElementById('shopInfo');
const shopTimer = document.getElementById('shopTimer');
const shopManualBtn = document.getElementById('shopManualBtn');
const shopManualInfo = document.getElementById('shopManualInfo');
const shopMsg = document.getElementById('shopMsg');

let shopData = null;      // lo último que mandó el servidor.
let shopNextAt = 0;       // hora (de TU reloj) en que se actualiza la tienda.
let shopResetAt = 0;      // hora en que se reponen las recargas manuales (0 = no hay espera).
let shopButtons = [];     // botones "Comprar" de cada oferta.

// Dibuja las ofertas.
function renderShop() {
    shopOffers.innerHTML = '';
    shopButtons = [];
    if (!shopData) return;
    shopData.offers.forEach((o) => {
        const def = itemsCatalog[o.id];
        if (!def) return;
        const card = document.createElement('div');
        card.className = 'offer';

        const icon = document.createElement('div');
        icon.className = 'offer-icon';
        icon.appendChild(makeIcon(def));

        const name = document.createElement('div');
        name.className = 'offer-name';
        name.textContent = def.name + (o.qty > 1 ? ` x${o.qty}` : '');

        const desc = document.createElement('div');
        desc.className = 'offer-desc';
        desc.textContent = def.desc;

        const price = document.createElement('div');
        price.className = 'offer-price';
        price.textContent = '💵 ' + o.price;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn small';
        btn.textContent = o.bought ? 'Comprado' : 'Comprar';
        btn.addEventListener('click', () => {
            shopMsg.textContent = '';
            // Mandamos el precio que VEMOS: si la tienda cambió justo antes, el servidor no cobra otro.
            socket.emit('buyOffer', { id: o.id, price: o.price }, (res) => {
                shopMsg.textContent = res.ok
                    ? `✅ Compraste ${res.name}${res.qty > 1 ? ' x' + res.qty : ''}. Está en tu mochila.`
                    : '⚠️ ' + res.error;
            });
        });

        card.append(icon, name, desc, price, btn);
        shopOffers.appendChild(card);
        shopButtons.push({ btn, offer: o });
    });
    updateShopButtons();
}

// Habilita o no cada botón según tu dinero (se llama cada segundo).
function updateShopButtons() {
    shopButtons.forEach(({ btn, offer }) => {
        btn.disabled = offer.bought || !lastState || lastState.money < offer.price;
    });
    if (shopData) {
        shopManualBtn.textContent = `🔄 Recargar tienda (${shopData.manualLeft}/${shopData.manualMax})`;
        shopManualBtn.disabled = shopData.manualLeft < 1;
    }
}

// Cuentas regresivas de la tienda (cada segundo, con tu propio reloj).
function updateShopTimer() {
    if (!shopData) return;
    const left = shopNextAt - Date.now();
    shopTimer.textContent = left > 0
        ? `🕒 La tienda se actualiza en ${fmtClock(left)}.`
        : '🕒 Actualizando la tienda...';
    if (shopData.manualLeft < 1 && shopResetAt) {
        shopManualInfo.textContent = `Sin recargas por hoy. Se reponen en ${fmtHM(shopResetAt - Date.now())}.`;
    } else {
        shopManualInfo.textContent = 'Cada recarga manual cambia las ofertas y los precios al instante.';
    }
}
setInterval(updateShopTimer, 1000);

// El servidor manda la tienda (al entrar y cada vez que cambia).
socket.on('shop', (data) => {
    shopData = data;
    shopNextAt = Date.now() + data.nextInMs;
    shopResetAt = data.manualResetInMs ? Date.now() + data.manualResetInMs : 0;
    renderShop();
    updateShopTimer();
});

shopManualBtn.addEventListener('click', () => {
    shopMsg.textContent = '';
    socket.emit('refreshShopManual', (res) => {
        shopMsg.textContent = res.ok ? '✅ Tienda recargada.' : '⚠️ ' + res.error;
    });
});

// ============================================================
// MISIONES
// ============================================================
const missionListEl = document.getElementById('missionList');
const missionActive = document.getElementById('missionActive');
const missionActiveText = document.getElementById('missionActiveText');
const missionBar = document.getElementById('missionBar');
const missionMsg = document.getElementById('missionMsg');

let missionsData = [];

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

        btn.addEventListener('click', () => {
            missionMsg.textContent = '';
            socket.emit('startMission', m.id, (res) => {
                if (!res.ok) missionMsg.textContent = '⚠️ ' + res.error;
            });
        });

        missionListEl.appendChild(btn);
    });
    updateMissionButtons();
}

function updateMissionButtons() {
    if (!lastState) return;
    missionListEl.querySelectorAll('.mission-btn').forEach((btn) => {
        const m = missionsData.find((x) => x.id === btn.dataset.id);
        btn.disabled = !!lastState.mission || lastState.energy < m.energy;
    });
}

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

// ============================================================
// GUERRA
// Dos tarjetas (vos y tu rival). El servidor manda cada golpe
// en vivo (evento "warEvent") y acá lo animamos, con pistola o granada.
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

// Junta las partes de una tarjeta para poder actualizarlas fácil.
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
const fMe = fighterParts('fighterMe');
const fRival = fighterParts('fighterRival');
const sides = { me: fMe, rival: fRival };

// Estado de la guerra en esta pantalla: 'idle' = sin rival, 'found' = rival encontrado, 'fighting' = peleando.
let warState = 'idle';
let showingResult = false;
let rivalInfo = null;
let fightMax = { me: 0, rival: 0 };
let bannerTimer = null;
let searchPending = false;
let fightPending = false;

// Reinicia una animación CSS: saca la clase, fuerza al navegador a "olvidarla" y la vuelve a poner.
function playAnim(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
}

// Dibuja la lista compacta de estadísticas dentro de una tarjeta.
function fillStats(box, stats) {
    box.innerHTML = '';
    statsConfig.forEach((c) => {
        const span = document.createElement('span');
        span.textContent = `${c.icon} ${stats[c.id]}`;
        span.title = c.label;
        box.appendChild(span);
    });
}

// Pone la barra de vida de un lado ('me' o 'rival').
function setHp(side, hp, maxHp) {
    const f = sides[side];
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    f.hpFill.style.width = (ratio * 100) + '%';
    f.hpFill.classList.toggle('mid', ratio <= 0.5 && ratio > 0.25);
    f.hpFill.classList.toggle('low', ratio <= 0.25);
    f.hpText.textContent = `${Math.round(hp)}/${maxHp}`;
}

// Número que flota sobre la tarjeta ('-12', '¡Esquivó!', etc.).
function floatNumber(side, text, cls) {
    const el = document.createElement('div');
    el.className = 'float-num ' + cls;
    el.textContent = text;
    sides[side].root.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// ----- Animación de la PISTOLA: sale de la carta, se levanta hacia el rival y dispara -----
function playPistol(side) {
    const def = itemsCatalog.pistola;
    if (!def) return;
    const outer = document.createElement('div');
    outer.className = 'gun-anim ' + side; // "me" apunta a la derecha, "rival" a la izquierda.
    const inner = document.createElement('div');
    inner.className = 'gun-inner';
    inner.appendChild(makeIcon(def));
    const flash = document.createElement('span');
    flash.className = 'muzzle';
    flash.textContent = '💥';
    inner.appendChild(flash);
    outer.appendChild(inner);
    sides[side].root.appendChild(outer);
    setTimeout(() => outer.remove(), 1100);
}

// ----- Animación de la GRANADA: cae desde arriba sobre el rival y explota -----
function playGrenade(targetSide) {
    const def = itemsCatalog.granada;
    if (!def) return;
    const g = document.createElement('div');
    g.className = 'grenade-anim';
    g.appendChild(makeIcon(def));
    const boom = document.createElement('div');
    boom.className = 'boom';
    boom.textContent = '💥';
    sides[targetSide].root.append(g, boom);
    setTimeout(() => { g.remove(); boom.remove(); }, 1500);
}

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
    if (warState !== 'fighting' && !showingResult) setHp('me', lastState.maxHp, lastState.maxHp);
}

// Tarjeta del rival encontrado.
function renderRivalCard(r) {
    rivalInfo = r;
    fRival.root.classList.remove('empty');
    fRival.avatar.textContent = r.name.charAt(0).toUpperCase();
    fRival.name.textContent = r.name;
    fRival.sub.textContent = `${r.className} · Nv ${r.level}` + (r.pistol ? ' · 🔫' : '');
    fillStats(fRival.stats, r.stats);
    setHp('rival', r.maxHp, r.maxHp);
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
    if (lastState) setHp('me', lastState.maxHp, lastState.maxHp);
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
        setHp('me', fightMax.me, fightMax.me);
        setHp('rival', fightMax.rival, fightMax.rival);
        warLog.innerHTML = '';
        addWarLog('¡Comienza el combate!' + (res.grenade ? ' Llevás una 💣 granada lista.' : ''), 'l-sys');
        showBanner('⚔️ ¡Comienza el combate!', '', 1200);
        updateWarButtons();
    });
});

// ----- Cada golpe que manda el servidor -----
socket.on('warEvent', (ev) => {
    if (warState !== 'fighting') return;

    const targetSide = ev.actor === 'me' ? 'rival' : 'me';
    const actor = sides[ev.actor];
    const target = sides[targetSide];
    const rivalName = rivalInfo ? rivalInfo.name : 'El rival';

    // 1) El que ataca brilla y se lanza hacia adelante, con su arma.
    playAnim(actor.root, 'acting', 900);
    if (ev.extra) showBanner('⚡ ¡Turno extra!', 'extra', 1000);
    if (ev.weapon === 'pistol') playPistol(ev.actor);
    if (ev.weapon === 'grenade') playGrenade(targetSide);

    // 2) Cuando el disparo o la granada llegan, se ve el efecto en el que recibe.
    const delay = ev.weapon === 'grenade' ? 800 : ev.weapon === 'pistol' ? 650 : 450;
    setTimeout(() => {
        if (ev.result === 'dodge') {
            playAnim(target.root, 'dodge', 600);
            floatNumber(targetSide, '¡Esquivó!', 'dodge');
        } else if (ev.result === 'boom') {
            playAnim(target.root, 'crit-hit', 650);
            playAnim(arena, 'flash', 500);
            floatNumber(targetSide, '💣 -' + ev.dmg, 'boom-num');
        } else if (ev.result === 'crit') {
            playAnim(target.root, 'crit-hit', 650);
            playAnim(arena, 'flash', 500);
            floatNumber(targetSide, '💥 -' + ev.dmg, 'crit');
        } else {
            playAnim(target.root, 'hit', 550);
            floatNumber(targetSide, '-' + ev.dmg, 'dmg');
        }
        setHp('me', ev.hpMe, fightMax.me);
        setHp('rival', ev.hpRival, fightMax.rival);
    }, delay);

    // 3) Registro escrito del golpe.
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
    showingResult = true;

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

clearRival();

// ============================================================
// NOTIFICACIONES (campanita arriba a la derecha)
// Avisos de ataques recibidos, con el registro de la pelea.
// ============================================================
const notifBtn = document.getElementById('notifBtn');
const notifBadge = document.getElementById('notifBadge');
const notifPanel = document.getElementById('notifPanel');
const notifList = document.getElementById('notifList');
const notifClose = document.getElementById('notifClose');

let notes = []; // notificaciones (la más nueva primero).

// Texto de resumen. "result" está contado desde el punto de vista del ATACANTE.
function noteSummary(n) {
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

// Dibuja la lista de notificaciones y el globito con la cantidad sin leer.
function renderNotifs() {
    const unread = notes.filter((n) => !n.read).length;
    notifBadge.hidden = unread < 1;
    notifBadge.textContent = unread;

    notifList.innerHTML = '';
    if (!notes.length) {
        const empty = document.createElement('div');
        empty.className = 'notif-empty';
        empty.textContent = 'Todavía no recibiste ataques.';
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

        item.append(text, time, toggle, log);
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
function closeNotifs() {
    notifPanel.hidden = true;
}
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

// Un ataque nuevo, en vivo.
socket.on('notification', (n) => {
    n.read = !notifPanel.hidden; // si el panel está abierto, se considera leída.
    n.fresh = notifPanel.hidden ? false : true;
    notes.unshift(n);
    if (notes.length > 30) notes.pop();
    renderNotifs();
    if (!notifPanel.hidden) socket.emit('readNotifications');
    playAnim(notifBtn, 'ring', 1000); // la campanita se sacude.
});

// ============================================================
// CHAT (funciones compartidas por el chat global y el chat de clan)
// ============================================================
function addChatMessage(logEl, m) {
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;

    const div = document.createElement('div');
    div.className = 'msg' + (m.name === myName ? ' mine' : '');
    div.dataset.ts = m.ts;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const name = document.createElement('strong');
    name.textContent = m.name + ': ';

    // textContent (no innerHTML) para que el HTML escrito por alguien no se ejecute (evita XSS).
    const text = document.createElement('span');
    text.textContent = m.text;

    div.append(time, name, text);
    logEl.appendChild(div);

    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);

    if (nearBottom || m.name === myName) logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================
// CHAT GLOBAL
// ============================================================
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

socket.on('chatHistory', (list) => {
    chatLog.innerHTML = '';
    list.forEach((m) => addChatMessage(chatLog, m));
    chatLog.scrollTop = chatLog.scrollHeight;
});

socket.on('chat', (m) => addChatMessage(chatLog, m));

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    chatInput.value = '';
    chatInput.focus();
});

// Cada minuto sacamos de la pantalla los mensajes que ya pasaron los 30 minutos.
setInterval(() => {
    const limit = Date.now() - chatTtlMs;
    chatLog.querySelectorAll('.msg').forEach((el) => {
        if (Number(el.dataset.ts) < limit) el.remove();
    });
}, 60000);

// ============================================================
// CLANES
// ============================================================
const myClanBox = document.getElementById('myClanBox');
const clanNameEl = document.getElementById('clanName');
const clanInfo = document.getElementById('clanInfo');
const myRoleValue = document.getElementById('myRoleValue');
const clanMembers = document.getElementById('clanMembers');
const leaveClanBtn = document.getElementById('leaveClanBtn');
const createClanBox = document.getElementById('createClanBox');
const createClanReq = document.getElementById('createClanReq');
const createClanForm = document.getElementById('createClanForm');
const clanNameInput = document.getElementById('clanNameInput');
const createClanBtn = document.getElementById('createClanBtn');
const joinClanBox = document.getElementById('joinClanBox');
const joinClanReq = document.getElementById('joinClanReq');
const clanJoinList = document.getElementById('clanJoinList');
const clanMsg = document.getElementById('clanMsg');
const renameClanForm = document.getElementById('renameClanForm');
const renameClanInput = document.getElementById('renameClanInput');
const rulesView = document.getElementById('rulesView');
const rulesForm = document.getElementById('rulesForm');
const rulesInput = document.getElementById('rulesInput');
const rulesCount = document.getElementById('rulesCount');

// Icono y nombre de cada rango.
const ROLE_ICONS = { lider: '🎩', colider: '🕶️', oficial: '⭐', miembro: '👤' };
const ROLE_LABELS = { lider: 'Líder', colider: 'Colíder', oficial: 'Oficial', miembro: 'Miembro' };

let myClanInfo = null;
let lastClanName;
let rulesDirty = false;

// ¿Puede alguien con el rango "actor" gestionar a alguien con el rango "target"? (solo para mostrar botones)
function canManageClient(actor, target) {
    if (actor === 'lider') return target !== 'lider';
    if (actor === 'colider') return target === 'miembro' || target === 'oficial';
    return false;
}

function loadMyClan() {
    socket.emit('getClan', (res) => {
        if (res && res.ok) {
            myClanInfo = res.clan;
            renderClanTab();
        }
    });
}

function updateClanButtons() {
    if (!lastState || !gameConfig) return;
    const canCreate = lastState.level >= gameConfig.clanCreateLevel;
    const canJoin = lastState.level >= gameConfig.clanJoinLevel;
    createClanBtn.disabled = !canCreate;
    createClanReq.textContent =
        `Requiere nivel ${gameConfig.clanCreateLevel}. ${canCreate ? '✅ Cumplís el requisito.' : '🔒 Todavía no llegás.'}`;
    joinClanReq.textContent =
        `Requiere nivel ${gameConfig.clanJoinLevel} para unirse. ${canJoin ? '✅ Cumplís el requisito.' : '🔒 Todavía no llegás.'}`;
    document.querySelectorAll('.join-btn').forEach((b) => { b.disabled = !canJoin; });
}

function setRole(key, role, name) {
    clanMsg.textContent = '';
    socket.emit('setMemberRole', { key, role }, (res) => {
        if (!res.ok) clanMsg.textContent = '⚠️ ' + res.error;
        else clanMsg.textContent = `✅ ${name} ahora es ${ROLE_LABELS[role]}.`;
        loadMyClan();
    });
}

function renderMembers(members, myRole) {
    clanMembers.innerHTML = '';

    members.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'member-row';

        const nameBox = document.createElement('span');
        nameBox.className = 'member-name';
        const icon = document.createElement('span');
        icon.className = 'member-icon';
        icon.textContent = ROLE_ICONS[m.role] || '👤';
        icon.title = ROLE_LABELS[m.role] || '';
        nameBox.appendChild(icon);
        if (m.online) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = 'Conectado';
            nameBox.appendChild(dot);
        }
        nameBox.appendChild(document.createTextNode(m.name + (m.name === myName ? ' (vos)' : '')));

        const level = document.createElement('span');
        level.className = 'member-level';
        level.textContent = 'Nv ' + m.level;

        const tag = document.createElement('span');
        tag.className = 'role-tag ' + m.role;
        tag.textContent = ROLE_LABELS[m.role];

        row.append(nameBox, level, tag);

        if (canManageClient(myRole, m.role)) {
            const actions = document.createElement('div');
            actions.className = 'member-actions';

            const select = document.createElement('select');
            select.className = 'role-select';
            select.title = 'Cambiar rango';
            const options = myRole === 'lider' ? ['miembro', 'oficial', 'colider'] : ['miembro', 'oficial'];
            options.forEach((r) => {
                const opt = document.createElement('option');
                opt.value = r;
                opt.textContent = `${ROLE_ICONS[r]} ${ROLE_LABELS[r]}`;
                if (r === m.role) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', () => setRole(m.key, select.value, m.name));

            const kickBtn = document.createElement('button');
            kickBtn.type = 'button';
            kickBtn.className = 'action-btn small danger';
            confirmButton(kickBtn, '✖ Expulsar', '¿Seguro?', () => {
                clanMsg.textContent = '';
                socket.emit('kickMember', m.key, (res) => {
                    if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
                    clanMsg.textContent = `✅ ${m.name} fue expulsado del clan.`;
                    loadMyClan();
                });
            });

            actions.append(select, kickBtn);
            row.appendChild(actions);
        }

        clanMembers.appendChild(row);
    });
}

function renderRules(clan) {
    const canEdit = clan.myRole === 'lider' || clan.myRole === 'colider';
    rulesForm.hidden = !canEdit;
    rulesView.hidden = canEdit;

    if (canEdit) {
        if (!rulesDirty) {
            rulesInput.value = clan.rules;
            rulesCount.textContent = `${clan.rules.length}/${gameConfig ? gameConfig.clanRulesMax : 1000}`;
        }
    } else {
        rulesView.textContent = clan.rules || 'El líder todavía no escribió las reglas del clan.';
        rulesView.classList.toggle('empty', !clan.rules);
    }
}

function renderClanTab() {
    const inClan = !!myClanInfo;
    myClanBox.hidden = !inClan;
    createClanBox.hidden = inClan;
    joinClanBox.hidden = inClan;

    if (inClan) {
        clanNameEl.textContent = myClanInfo.name;
        clanInfo.textContent = `${myClanInfo.members.length} miembro(s)`;
        myRoleValue.textContent = `${ROLE_ICONS[myClanInfo.myRole]} ${ROLE_LABELS[myClanInfo.myRole]}`;

        renameClanForm.hidden = myClanInfo.myRole !== 'lider';
        if (document.activeElement !== renameClanInput) renameClanInput.value = myClanInfo.name;

        renderMembers(myClanInfo.members, myClanInfo.myRole);
        renderRules(myClanInfo);
    } else {
        rulesDirty = false;
        clanJoinList.innerHTML = '';
        if (!clanRankingData.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.className = 'muted';
            td.textContent = 'Todavía no hay clanes. ¡Creá el primero!';
            tr.appendChild(td);
            clanJoinList.appendChild(tr);
        }
        clanRankingData.forEach((c) => {
            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.textContent = c.name;
            const tdMembers = document.createElement('td');
            tdMembers.textContent = c.members;

            const tdBtn = document.createElement('td');
            const btn = document.createElement('button');
            btn.className = 'action-btn small join-btn';
            btn.type = 'button';
            btn.textContent = 'Unirme';
            btn.addEventListener('click', () => {
                clanMsg.textContent = '';
                socket.emit('joinClan', c.id, (res) => {
                    if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
                    clanMsg.textContent = `✅ Te uniste a ${c.name}.`;
                    loadMyClan();
                });
            });
            tdBtn.appendChild(btn);

            tr.append(tdName, tdMembers, tdBtn);
            clanJoinList.appendChild(tr);
        });
    }
    updateClanButtons();
}

createClanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clanMsg.textContent = '';
    socket.emit('createClan', clanNameInput.value, (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanNameInput.value = '';
        clanMsg.textContent = '✅ Clan creado.';
        loadMyClan();
    });
});

renameClanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clanMsg.textContent = '';
    socket.emit('renameClan', renameClanInput.value, (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = `✅ El clan ahora se llama ${res.name}.`;
        loadMyClan();
    });
});

rulesInput.addEventListener('input', () => {
    rulesDirty = true;
    rulesCount.textContent = `${rulesInput.value.length}/${gameConfig ? gameConfig.clanRulesMax : 1000}`;
});

rulesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clanMsg.textContent = '';
    socket.emit('setClanRules', rulesInput.value, (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        rulesDirty = false;
        clanMsg.textContent = '✅ Reglas guardadas.';
        loadMyClan();
    });
});

confirmButton(leaveClanBtn, 'Salir del clan', '¿Seguro? Tocá de nuevo', () => {
    socket.emit('leaveClan', (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = '✅ Saliste del clan.';
        loadMyClan();
    });
});

// ---------- Subpestañas del clan (Miembros / Chat / Reglas) ----------
// (Usamos "#myClanBox" para no mezclarlas con las subpestañas del inventario.)
const subTabs = document.querySelectorAll('#myClanBox .sub-tab');
const clanPanes = document.querySelectorAll('#myClanBox .clan-pane');
const clanChatLog = document.getElementById('clanChatLog');
const clanChatForm = document.getElementById('clanChatForm');
const clanChatInput = document.getElementById('clanChatInput');

function showClanPane(name) {
    subTabs.forEach((b) => b.classList.toggle('active', b.dataset.clanpane === name));
    clanPanes.forEach((p) => p.classList.toggle('active', p.id === 'clanPane-' + name));
    if (name === 'chat') clanChatLog.scrollTop = clanChatLog.scrollHeight;
}
subTabs.forEach((b) => b.addEventListener('click', () => showClanPane(b.dataset.clanpane)));

function loadClanChat() {
    socket.emit('getClanChat', (res) => {
        clanChatLog.innerHTML = '';
        if (res && res.ok) {
            res.messages.forEach((m) => addChatMessage(clanChatLog, m));
            clanChatLog.scrollTop = clanChatLog.scrollHeight;
        }
    });
}

socket.on('clanChat', (m) => addChatMessage(clanChatLog, m));

clanChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = clanChatInput.value.trim();
    if (!text) return;
    socket.emit('clanChat', text);
    clanChatInput.value = '';
    clanChatInput.focus();
});

socket.on('clanChanged', loadMyClan);

socket.on('clanNotice', (text) => {
    clanMsg.textContent = 'ℹ️ ' + text;
});

// ============================================================
// CONFIGURACIÓN Y ESTADO PERSONAL
// ============================================================

// Configuración del juego (llega al iniciar sesión, antes del estado).
socket.on('config', (cfg) => {
    gameConfig = cfg;
    statsConfig = cfg.stats;
    itemsCatalog = cfg.items;
    bagSlots = cfg.bagSlots;
    if (cfg.chatTtlMs) chatTtlMs = cfg.chatTtlMs;
    buildStatsPanel(cfg.stats);
    warInfo.textContent =
        `Buscá un rival de nivel parecido o desafiá a alguien por su nombre. Pelear cuesta ⚡ ${cfg.warEnergy}. ` +
        `El premio base es 💵 ${cfg.warReward} y sube o baja según la diferencia de nivel. ` +
        `No podés volver a atacar al mismo jugador hasta pasados ${Math.round(cfg.rivalCooldownMs / 60000)} minutos. ` +
        `Tu maletín de guerra (en Inventario) define qué armas usás.`;
    shopInfo.textContent =
        'Cada oferta se puede comprar una vez por actualización. Los precios cambian en cada actualización. ' +
        'Lo que compres va a tu mochila; si es un arma o granadas, pasalo al maletín de guerra.';
    editNameHint.textContent =
        `Podés cambiarlo cada ${Math.round(cfg.nameCooldownMs / 60000)} minutos. Es también tu nombre para iniciar sesión.`;
    rulesInput.maxLength = cfg.clanRulesMax;
    resetWar();
    renderBag();
    renderCase();
    updateClanButtons();
    loadClanChat();
});

// Dibuja el estado personal que mandó el servidor.
function renderState(s) {
    lastState = s;

    classValue.textContent = s.className;
    levelValue.textContent = s.level;
    xpValue.textContent = s.xp;
    xpMax.textContent = s.xpNeeded;
    xpBar.style.width = (s.xp / s.xpNeeded * 100) + '%';
    moneyValue.textContent = s.money;
    fameValue.textContent = s.fame;

    energyValue.textContent = s.energy;
    energyMax.textContent = s.maxEnergy;
    energyBar.style.width = (s.energy / s.maxEnergy * 100) + '%';
    energyTimer.textContent = s.nextEnergyMs > 0
        ? `(+1 en ${Math.ceil(s.nextEnergyMs / 1000)}s)`
        : '(llena)';

    // Estadísticas: valor base, extra del maletín (en verde), efectos y botones.
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
        r.plus.disabled = s.statPoints < 1;
        r.buy.disabled = !canBuy;
    });
    inventoryBadge.hidden = s.statPoints < 1;
    inventoryBadge.textContent = s.statPoints;

    // Misión en curso.
    if (s.mission) {
        const done = 1 - s.mission.remainingMs / s.mission.durationMs;
        missionActive.hidden = false;
        missionActiveText.textContent =
            `Haciendo: ${s.mission.name} — faltan ${Math.ceil(s.mission.remainingMs / 1000)}s`;
        missionBar.style.width = (done * 100) + '%';
    } else {
        missionActive.hidden = true;
    }

    updateMissionButtons();
    updateClanButtons();
    updateShopButtons();   // habilita o no "Comprar" según tu dinero.
    updateExpandBtn();     // botón de expandir el maletín.
    renderMyCard();
    updateWarButtons();

    if (s.clan !== lastClanName) {
        lastClanName = s.clan;
        loadMyClan();
        loadClanChat();
    }
}

socket.on('state', renderState);
