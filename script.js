// ============================================================
// script.js — Lo que corre en el NAVEGADOR del jugador
// Muestra el login, el panel del personaje, el menú, las misiones,
// el inventario con estadísticas, los clanes (miembros y chat), los
// rankings y el chat global.
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
const editName = document.getElementById('editName');

// Conectamos al servidor que está en Render.
const socket = io('https://gangstercity.onrender.com');

// Usuario y contraseña, SOLO en memoria, para reconectar solos si se corta internet.
let credentials = null;
// Nombre del jugador logueado (sirve para resaltar su fila y sus mensajes).
let myName = null;
// Último estado personal que mandó el servidor (dinero, energía, nivel, etc.).
let lastState = null;
// Configuración del juego que manda el servidor (niveles de clan, lista de estadísticas).
let clanConfig = null;
// Cuánto dura un mensaje del chat global (el servidor lo confirma al entrar).
let chatTtlMs = 30 * 60 * 1000;

// Recordamos el último usuario usado (la contraseña NO se recuerda).
try { inputUser.value = localStorage.getItem('lastUser') || ''; } catch (e) {}

// ============================================================
// LOGIN
// ============================================================

// Le pide al servidor que valide usuario y contraseña. Devuelve una "promesa".
function login(creds) {
    return new Promise((resolve) => {
        socket.emit('auth', creds, resolve);
    });
}

// Se ejecuta al apretar "Entrar" (o Enter).
form.addEventListener('submit', async (e) => {
    e.preventDefault(); // evita que la página se recargue.

    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Conectando... (puede tardar si el servidor estaba dormido)';

    const creds = { name: inputUser.value.trim(), password: inputPass.value };
    const res = await login(creds); // esperamos la respuesta del servidor.

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
    editName.value = myName;                              // para el panel "Editar perfil".
    avatar.textContent = myName.charAt(0).toUpperCase();  // inicial como icono provisorio.

    loginBox.hidden = true; // ocultamos el login.
    gameBox.hidden = false; // mostramos el juego.
});

// Si se corta la conexión y el navegador reconecta solo, volvemos a loguearnos.
socket.on('connect', async () => {
    if (credentials) await login(credentials);
});

// ============================================================
// BOTÓN DE DOS TOQUES (para acciones peligrosas: salir, expulsar)
// El primer toque pide confirmación; el segundo ejecuta la acción.
// Si no se confirma en 4 segundos, vuelve al texto original.
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
// EDITAR PERFIL (por ahora solo abre y cierra el panel)
// ============================================================
editProfileBtn.addEventListener('click', () => {
    editProfile.hidden = !editProfile.hidden; // mostrar u ocultar.
    editProfileBtn.textContent = editProfile.hidden ? '✏️ Editar perfil' : '✖ Cerrar edición';
});

// ============================================================
// NAVEGACIÓN ENTRE SECCIONES (Misiones / Inventario / Guerra / Clan)
// ============================================================
const navButtons = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab');

// Muestra la sección "name" y oculta las demás.
function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    // Al abrir Clan, pedimos los datos frescos (miembros, etc.).
    if (name === 'clan') loadMyClan();
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

// Cambia de pestaña de ranking.
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
    renderBoard(
        scoreBody, players,
        (p, i) => [i + 1, nameCell(p), p.score],
        (p) => myName && p.name === myName,
        'Todavía no hay jugadores.', 3
    );
    // Actualizamos "Tiempo jugado" en el recuadro del personaje.
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
let clanRankingData = []; // lo guardamos también para la lista "Clanes disponibles".
socket.on('clanRanking', (rows) => {
    clanRankingData = rows;
    renderBoard(
        clanBoardBody, rows,
        (c, i) => [i + 1, c.name, c.members, c.fame],
        (c) => lastState && lastState.clan && c.name === lastState.clan,
        'Todavía no hay clanes.', 4
    );
    if (!myClanInfo) renderClanTab(); // actualiza la lista para unirse.
});

// ============================================================
// INVENTARIO (casillas)
// Por ahora solo dibuja casillas vacías. Más adelante el servidor
// mandará los objetos y se los pasamos a renderInventory().
// Formato de cada objeto: { icon: '🔫', name: 'Pistola' }
// ============================================================
const bagGrid = document.getElementById('bagGrid');
const BAG_SLOTS = 20;

function renderInventory(items = []) {
    bagGrid.innerHTML = '';
    for (let i = 0; i < BAG_SLOTS; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const item = items[i];
        if (item) {
            slot.textContent = item.icon;
            slot.title = item.name;
            slot.classList.add('filled');
        }
        bagGrid.appendChild(slot);
    }
}
renderInventory();

// ============================================================
// ESTADÍSTICAS (Vida, Aguante, Velocidad, Inteligencia, Suerte)
// ============================================================
const statsList = document.getElementById('statsList');
const statsMsg = document.getElementById('statsMsg');
const statPointsValue = document.getElementById('statPointsValue');
const inventoryBadge = document.getElementById('inventoryBadge');

let statRows = {}; // { vida: { value, btn }, ... } para actualizar cada fila.

// Crea una fila por cada estadística (la lista viene del servidor).
function buildStatsPanel(list) {
    statsList.innerHTML = '';
    statRows = {};
    list.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'stat-row';

        const label = document.createElement('span');
        label.className = 'stat-name';
        label.textContent = `${s.icon} ${s.label}`;

        const value = document.createElement('span');
        value.className = 'stat-value';
        value.textContent = '0';

        // Botón "+": le pide al servidor gastar un punto en esta estadística.
        const btn = document.createElement('button');
        btn.className = 'plus-btn';
        btn.type = 'button';
        btn.textContent = '+';
        btn.title = 'Subir ' + s.label;
        btn.disabled = true;
        btn.addEventListener('click', () => {
            statsMsg.textContent = '';
            socket.emit('spendStat', s.id, (res) => {
                if (!res.ok) statsMsg.textContent = '⚠️ ' + res.error;
            });
        });

        row.append(label, value, btn);
        statsList.appendChild(row);
        statRows[s.id] = { value, btn };
    });
}

// ============================================================
// MISIONES
// ============================================================
const missionListEl = document.getElementById('missionList');
const missionActive = document.getElementById('missionActive');
const missionActiveText = document.getElementById('missionActiveText');
const missionBar = document.getElementById('missionBar');
const missionMsg = document.getElementById('missionMsg');

let missionsData = []; // lista de misiones que manda el servidor.

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
        info.textContent = `⚡ ${m.energy} · ⏱ ${m.durationMs / 1000}s · 💵 ${m.reward} · ✨ ${m.xp} XP`;
        btn.append(title, info);

        // Al hacer clic, le pedimos al servidor empezar esa misión.
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

// Aviso de misión terminada: dinero, XP y, si corresponde, subida de nivel.
socket.on('missionDone', ({ name, reward, xp, levelsGained, level }) => {
    let msg = `✅ Misión completada: ${name}. Ganaste 💵 ${reward}, ✨ ${xp} XP y ⭐ 1 de fama.`;
    if (levelsGained > 0) {
        const pts = levelsGained * (clanConfig ? clanConfig.pointsPerLevel : 5);
        msg += ` 🎉 ¡Subiste al nivel ${level}! Tenés +${pts} puntos para repartir en Inventario.`;
    }
    missionMsg.textContent = msg;
});

// ============================================================
// CHAT (funciones compartidas por el chat global y el chat de clan)
// ============================================================

// Agrega un mensaje a una caja de chat (logEl).
function addChatMessage(logEl, m) {
    // ¿Estaba el usuario mirando el final del chat? Si sí, bajamos solos después.
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;

    const div = document.createElement('div');
    div.className = 'msg' + (m.name === myName ? ' mine' : '');
    div.dataset.ts = m.ts; // guardamos la hora para poder ocultar mensajes viejos.

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

    // Máximo 100 mensajes en pantalla.
    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);

    if (nearBottom || m.name === myName) logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================
// CHAT GLOBAL
// ============================================================
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

// Historial (últimos mensajes de los últimos 30 minutos) al entrar o reconectar.
socket.on('chatHistory', (list) => {
    chatLog.innerHTML = '';
    list.forEach((m) => addChatMessage(chatLog, m));
    chatLog.scrollTop = chatLog.scrollHeight;
});

// Mensaje nuevo en vivo.
socket.on('chat', (m) => addChatMessage(chatLog, m));

// Enviar mensaje (Enter o botón).
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    chatInput.value = '';
    chatInput.focus();
});

// Cada minuto sacamos de la pantalla los mensajes que ya pasaron los 30 minutos,
// igual que hace la base de datos. (Usa la hora de tu dispositivo: si tu reloj
// estuviera muy mal, podrías ver mensajes desaparecer antes o después.)
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

// Icono y nombre de cada rango. El líder lleva el sombrero 🎩 (cambialo por 🧢 si preferís gorra).
const ROLE_ICONS = { lider: '🎩', oficial: '⭐', miembro: '👤' };
const ROLE_LABELS = { lider: 'Líder', oficial: 'Oficial', miembro: 'Miembro' };

let myClanInfo = null;    // datos de mi clan (null si no tengo).
let lastClanName;         // para detectar cuándo cambia mi clan.

// Le pide al servidor los datos de MI clan y redibuja la pestaña.
function loadMyClan() {
    socket.emit('getClan', (res) => {
        if (res && res.ok) {
            myClanInfo = res.clan;
            renderClanTab();
        }
    });
}

// Activa o desactiva los botones según mi nivel (se llama cada segundo, es liviano).
function updateClanButtons() {
    if (!lastState || !clanConfig) return;
    const canCreate = lastState.level >= clanConfig.clanCreateLevel;
    const canJoin = lastState.level >= clanConfig.clanJoinLevel;
    createClanBtn.disabled = !canCreate;
    createClanReq.textContent =
        `Requiere nivel ${clanConfig.clanCreateLevel}. ${canCreate ? '✅ Cumplís el requisito.' : '🔒 Todavía no llegás.'}`;
    joinClanReq.textContent =
        `Requiere nivel ${clanConfig.clanJoinLevel} para unirse. ${canJoin ? '✅ Cumplís el requisito.' : '🔒 Todavía no llegás.'}`;
    document.querySelectorAll('.join-btn').forEach((b) => { b.disabled = !canJoin; });
}

// Pide al servidor cambiar el rango de un miembro ('oficial' o 'miembro').
function setRole(key, role) {
    clanMsg.textContent = '';
    socket.emit('setMemberRole', { key, role }, (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = role === 'oficial' ? '✅ Miembro ascendido a Oficial.' : '✅ Oficial degradado a Miembro.';
        loadMyClan();
    });
}

// Dibuja la lista de miembros: una fila por miembro, con botones si soy el líder.
function renderMembers(members, myRole) {
    clanMembers.innerHTML = '';
    const iAmLeader = myRole === 'lider';

    members.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'member-row';

        // Icono de rango + punto verde (si está conectado) + nombre.
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

        // Botones SOLO si soy el líder y esta fila no es la del líder.
        // (El servidor vuelve a verificarlo: esto es solo para mostrar u ocultar.)
        if (iAmLeader && m.role !== 'lider') {
            const actions = document.createElement('div');
            actions.className = 'member-actions';

            const roleBtn = document.createElement('button');
            roleBtn.type = 'button';
            roleBtn.className = 'action-btn small';
            if (m.role === 'oficial') {
                roleBtn.classList.add('neutral');
                roleBtn.textContent = '⬇ Degradar';
                roleBtn.addEventListener('click', () => setRole(m.key, 'miembro'));
            } else {
                roleBtn.textContent = '⬆ Ascender';
                roleBtn.addEventListener('click', () => setRole(m.key, 'oficial'));
            }

            // Expulsar pide confirmar con un segundo toque.
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

            actions.append(roleBtn, kickBtn);
            row.appendChild(actions);
        }

        clanMembers.appendChild(row);
    });
}

// Dibuja la pestaña Clan completa.
function renderClanTab() {
    const inClan = !!myClanInfo;
    // Si tengo clan: veo mi clan. Si no: veo "crear" y "clanes disponibles".
    myClanBox.hidden = !inClan;
    createClanBox.hidden = inClan;
    joinClanBox.hidden = inClan;

    if (inClan) {
        clanNameEl.textContent = myClanInfo.name;
        clanInfo.textContent = `${myClanInfo.members.length} miembro(s)`;
        myRoleValue.textContent = `${ROLE_ICONS[myClanInfo.myRole]} ${ROLE_LABELS[myClanInfo.myRole]}`;
        renderMembers(myClanInfo.members, myClanInfo.myRole);
    } else {
        // Lista de clanes para unirse (sale del ranking de clanes).
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

// Crear clan.
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

// Salir del clan (con confirmación de dos toques).
confirmButton(leaveClanBtn, 'Salir del clan', '¿Seguro? Tocá de nuevo', () => {
    socket.emit('leaveClan', (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = '✅ Saliste del clan.';
        loadMyClan();
    });
});

// ---------- Subpestañas del clan (Miembros / Chat) ----------
const subTabs = document.querySelectorAll('.sub-tab');
const clanPanes = document.querySelectorAll('.clan-pane');
const clanChatLog = document.getElementById('clanChatLog');
const clanChatForm = document.getElementById('clanChatForm');
const clanChatInput = document.getElementById('clanChatInput');

function showClanPane(name) {
    subTabs.forEach((b) => b.classList.toggle('active', b.dataset.clanpane === name));
    clanPanes.forEach((p) => p.classList.toggle('active', p.id === 'clanPane-' + name));
    // Al abrir el chat, bajamos hasta el último mensaje.
    if (name === 'chat') clanChatLog.scrollTop = clanChatLog.scrollHeight;
}
subTabs.forEach((b) => b.addEventListener('click', () => showClanPane(b.dataset.clanpane)));

// ---------- Chat del clan ----------

// Pide el historial del chat de mi clan (vacío si no tengo clan).
function loadClanChat() {
    socket.emit('getClanChat', (res) => {
        clanChatLog.innerHTML = '';
        if (res && res.ok) {
            res.messages.forEach((m) => addChatMessage(clanChatLog, m));
            clanChatLog.scrollTop = clanChatLog.scrollHeight;
        }
    });
}

// Mensaje nuevo del clan en vivo (el servidor solo se lo manda a los miembros).
socket.on('clanChat', (m) => addChatMessage(clanChatLog, m));

// Enviar mensaje al clan.
clanChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = clanChatInput.value.trim();
    if (!text) return;
    socket.emit('clanChat', text);
    clanChatInput.value = '';
    clanChatInput.focus();
});

// Algo cambió en mi clan (alguien entró, salió, fue expulsado o ascendido): refrescamos.
socket.on('clanChanged', loadMyClan);

// Avisos que me manda el servidor (por ejemplo "Fuiste expulsado del clan X").
socket.on('clanNotice', (text) => {
    clanMsg.textContent = 'ℹ️ ' + text;
});

// ============================================================
// CONFIGURACIÓN Y ESTADO PERSONAL
// ============================================================

// Configuración del juego (llega al iniciar sesión, antes del estado).
socket.on('config', (cfg) => {
    clanConfig = cfg;
    if (cfg.chatTtlMs) chatTtlMs = cfg.chatTtlMs;
    buildStatsPanel(cfg.stats);
    updateClanButtons();
    loadClanChat(); // también al reconectar, para no perder mensajes del clan.
});

// Dibuja el estado personal que mandó el servidor.
function renderState(s) {
    lastState = s;

    // Datos del recuadro del personaje.
    classValue.textContent = s.className;
    levelValue.textContent = s.level;
    xpValue.textContent = s.xp;
    xpMax.textContent = s.xpNeeded;
    xpBar.style.width = (s.xp / s.xpNeeded * 100) + '%';
    moneyValue.textContent = s.money;
    fameValue.textContent = s.fame;

    // Energía.
    energyValue.textContent = s.energy;
    energyMax.textContent = s.maxEnergy;
    energyBar.style.width = (s.energy / s.maxEnergy * 100) + '%';
    energyTimer.textContent = s.nextEnergyMs > 0
        ? `(+1 en ${Math.ceil(s.nextEnergyMs / 1000)}s)`
        : '(llena)';

    // Estadísticas: valores, puntos disponibles y botones "+".
    statPointsValue.textContent = s.statPoints;
    Object.keys(statRows).forEach((id) => {
        statRows[id].value.textContent = s.stats[id];
        statRows[id].btn.disabled = s.statPoints < 1;
    });
    // Globito rojo en el botón Inventario si hay puntos sin gastar.
    inventoryBadge.hidden = s.statPoints < 1;
    inventoryBadge.textContent = s.statPoints;

    // Misión en curso: mostramos el progreso. Si no hay, ocultamos el bloque.
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
    updateClanButtons();

    // Si cambió mi clan (entré, salí, me expulsaron o recién cargó), pedimos los datos del clan y su chat.
    if (s.clan !== lastClanName) {
        lastClanName = s.clan;
        loadMyClan();
        loadClanChat();
    }
}

// Estado personal (llega cada segundo y cuando algo cambia).
socket.on('state', renderState);
