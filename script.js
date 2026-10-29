// ============================================================
// script.js — Lo que corre en el NAVEGADOR del jugador
// Se encarga de mostrar el login, el panel del personaje, el menú,
// las misiones, el inventario, el ranking y el chat.
// NO calcula puntajes, dinero ni energía: solo pide cosas al
// servidor (server.js) y muestra lo que el servidor devuelve.
// ============================================================

// ---------- Elementos del HTML que vamos a usar ----------
const loginBox = document.getElementById('login');      // caja de login.
const gameBox = document.getElementById('game');        // caja del juego.
const form = document.getElementById('loginForm');
const inputUser = document.getElementById('username');
const inputPass = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const tbody = document.querySelector('#scoreboard tbody'); // cuerpo de la tabla de ranking.

// Elementos del recuadro del personaje.
const avatar = document.getElementById('avatar');
const nameValue = document.getElementById('nameValue');
const scoreValue = document.getElementById('scoreValue');

// Conectamos al servidor que está en Render.
const socket = io('https://gangstercity.onrender.com');

// Usuario y contraseña, SOLO en memoria, para reconectar solos si se corta internet.
let credentials = null;
// Nombre del jugador logueado (sirve para resaltar su fila y sus mensajes).
let myName = null;

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

    // Si el servidor dijo "no", mostramos el error y paramos.
    if (!res.ok) {
        loginError.textContent = res.error;
        return;
    }

    // Login exitoso:
    credentials = creds;
    myName = res.name;
    try { localStorage.setItem('lastUser', res.name); } catch (e) {}

    // Completamos el recuadro del personaje con su nombre.
    nameValue.textContent = myName;
    avatar.textContent = myName.charAt(0).toUpperCase(); // inicial como icono provisorio.

    loginBox.hidden = true; // ocultamos el login.
    gameBox.hidden = false; // mostramos el juego.
});

// Si se corta la conexión y el navegador reconecta solo, volvemos a loguearnos.
socket.on('connect', async () => {
    if (credentials) await login(credentials);
});

// ============================================================
// RANKING
// El servidor manda la lista ya ordenada (evento "players").
// ============================================================
socket.on('players', (players) => {
    tbody.innerHTML = ''; // vaciamos la tabla para llenarla de nuevo.

    players.forEach((p, i) => {
        const tr = document.createElement('tr'); // una fila por jugador.

        // Columna 1: posición.
        const tdRank = document.createElement('td');
        tdRank.textContent = i + 1;

        // Columna 2: nombre (con puntito verde si está conectado).
        const tdName = document.createElement('td');
        if (p.online) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = 'Conectado';
            tdName.appendChild(dot);
        }
        tdName.appendChild(document.createTextNode(p.name));

        // Columna 3: puntaje.
        const tdScore = document.createElement('td');
        tdScore.textContent = p.score;

        tr.append(tdRank, tdName, tdScore);
        // Resaltamos la fila del jugador actual.
        if (myName && p.name === myName) tr.classList.add('me');
        tbody.appendChild(tr);
    });

    // Actualizamos "Tiempo jugado" en el recuadro del personaje.
    const mine = players.find((p) => p.name === myName);
    if (mine) scoreValue.textContent = mine.score;
});

// ============================================================
// NAVEGACIÓN ENTRE SECCIONES (Misiones / Inventario / Guerra / Clan)
// ============================================================
const navButtons = document.querySelectorAll('.nav-btn'); // los 4 botones del menú.
const tabs = document.querySelectorAll('.tab');           // las 4 secciones del centro.

// Muestra la sección "name" y oculta las demás.
function showTab(name) {
    // Solo la sección cuyo id es "tab-<name>" queda con la clase "active".
    tabs.forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    // Marcamos como activo el botón correspondiente.
    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
}

// Cada botón abre la sección indicada en su atributo data-tab.
navButtons.forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
});

// ============================================================
// INVENTARIO
// Por ahora solo dibuja casillas vacías. Más adelante el servidor
// mandará la lista de objetos y se la pasamos a renderInventory().
// Formato esperado de cada objeto: { icon: '🔫', name: 'Pistola' }
// ============================================================
const bagGrid = document.getElementById('bagGrid');
const BAG_SLOTS = 20; // cantidad de casillas de la mochila.

function renderInventory(items = []) {
    bagGrid.innerHTML = ''; // vaciamos la mochila.
    for (let i = 0; i < BAG_SLOTS; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const item = items[i]; // objeto de esta casilla (undefined si está vacía).
        if (item) {
            slot.textContent = item.icon; // textContent: seguro contra código HTML.
            slot.title = item.name;       // al pasar el mouse muestra el nombre.
            slot.classList.add('filled');
        }
        bagGrid.appendChild(slot);
    }
}
renderInventory(); // la dibujamos vacía al cargar la página.

// ============================================================
// ENERGÍA, DINERO Y MISIONES (parte visual)
// Este código NO calcula nada: muestra lo que manda el servidor.
// ============================================================
const moneyValue = document.getElementById('moneyValue');
const energyValue = document.getElementById('energyValue');
const energyMax = document.getElementById('energyMax');
const energyTimer = document.getElementById('energyTimer');
const energyBar = document.getElementById('energyBar');
const missionActive = document.getElementById('missionActive');
const missionActiveText = document.getElementById('missionActiveText');
const missionBar = document.getElementById('missionBar');
const missionList = document.getElementById('missionList');
const missionMsg = document.getElementById('missionMsg');

let missionsData = []; // lista de misiones que manda el servidor.
let lastState = null;  // último estado recibido (dinero, energía, misión).

// Crea un botón por cada misión.
function renderMissionButtons() {
    missionList.innerHTML = ''; // vaciamos por si se llama de nuevo (reconexión).
    missionsData.forEach((m) => {
        const btn = document.createElement('button');
        btn.className = 'mission-btn';
        btn.dataset.id = m.id; // guardamos el ID para encontrar el botón después.

        const title = document.createElement('strong');
        title.textContent = m.name;
        const info = document.createElement('span');
        info.textContent = `⚡ ${m.energy} · ⏱ ${m.durationMs / 1000}s · 💵 ${m.reward}`;
        btn.append(title, info);

        // Al hacer clic, le pedimos al servidor empezar esa misión.
        btn.addEventListener('click', () => {
            missionMsg.textContent = '';
            socket.emit('startMission', m.id, (res) => {
                if (!res.ok) missionMsg.textContent = '⚠️ ' + res.error;
            });
        });

        missionList.appendChild(btn);
    });
    updateMissionButtons();
}

// Desactiva los botones que no se pueden usar ahora (misión en curso o poca energía).
// Es solo visual: el servidor vuelve a validar todo.
function updateMissionButtons() {
    if (!lastState) return;
    missionList.querySelectorAll('.mission-btn').forEach((btn) => {
        const m = missionsData.find((x) => x.id === btn.dataset.id);
        btn.disabled = !!lastState.mission || lastState.energy < m.energy;
    });
}

// Dibuja el estado que mandó el servidor.
function renderState(s) {
    lastState = s;

    moneyValue.textContent = s.money;
    energyValue.textContent = s.energy;
    energyMax.textContent = s.maxEnergy;
    energyBar.style.width = (s.energy / s.maxEnergy * 100) + '%'; // ancho = porcentaje.

    // Cuánto falta para el próximo punto de energía.
    energyTimer.textContent = s.nextEnergyMs > 0
        ? `(+1 en ${Math.ceil(s.nextEnergyMs / 1000)}s)`
        : '(llena)';

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
}

// Lista de misiones (llega al iniciar sesión).
socket.on('missions', (list) => {
    missionsData = list;
    renderMissionButtons();
});

// Estado personal (llega cada segundo y cuando algo cambia).
socket.on('state', renderState);

// Aviso de misión terminada y recompensa pagada.
socket.on('missionDone', ({ name, reward }) => {
    missionMsg.textContent = `✅ Misión completada: ${name}. Ganaste 💵 ${reward}.`;
});

// ============================================================
// CHAT
// ============================================================
const chatLog = document.getElementById('chatLog');     // caja de mensajes.
const chatForm = document.getElementById('chatForm');   // formulario para escribir.
const chatInput = document.getElementById('chatInput'); // campo de texto.

// Agrega un mensaje a la caja del chat.
function addMessage(m) {
    // ¿Estaba el usuario mirando el final del chat? Si sí, bajamos solos después.
    const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;

    const div = document.createElement('div');
    div.className = 'msg' + (m.name === myName ? ' mine' : '');

    // Hora en formato HH:MM.
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Nombre de quien escribió.
    const name = document.createElement('strong');
    name.textContent = m.name + ': ';

    // Texto. Usamos textContent (no innerHTML) para que el código HTML
    // escrito por alguien se muestre como texto y no se ejecute (evita XSS).
    const text = document.createElement('span');
    text.textContent = m.text;

    div.append(time, name, text);
    chatLog.appendChild(div);

    // Máximo 100 mensajes en pantalla.
    while (chatLog.children.length > 100) chatLog.removeChild(chatLog.firstChild);

    if (nearBottom || m.name === myName) chatLog.scrollTop = chatLog.scrollHeight;
}

// Historial (últimos 50 mensajes) al entrar o reconectar.
socket.on('chatHistory', (list) => {
    chatLog.innerHTML = '';
    list.forEach(addMessage);
    chatLog.scrollTop = chatLog.scrollHeight;
});

// Mensaje nuevo en vivo.
socket.on('chat', addMessage);

// Enviar mensaje (Enter o botón).
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    chatInput.value = '';
    chatInput.focus();
});
