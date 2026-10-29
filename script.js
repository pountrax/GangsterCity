// ============================================================
// script.js — Lo que corre en el NAVEGADOR del jugador
// Qué hace este archivo, en una frase:
// Es la parte "visible" del juego. Se encarga de mostrar la pantalla
// de login, dibujar el puntaje, mostrar la tabla de posiciones y el
// chat. NO calcula puntajes ni guarda contraseñas: solo pide cosas
// al servidor (server.js) y muestra lo que el servidor le devuelve.
// ============================================================

// Buscamos en la página HTML el "lienzo" (canvas) donde se dibuja el puntaje.
const canvas = document.getElementById('gameCanvas');
// "ctx" es como el "pincel" que usamos para dibujar sobre ese lienzo.
const ctx = canvas.getContext('2d');
// Le damos un tamaño fijo al lienzo (800 píxeles de ancho, 400 de alto).
canvas.width = 800;
canvas.height = 400;

// Buscamos en el HTML las distintas "cajas" y elementos que vamos a usar:
const loginBox = document.getElementById('login');
const gameBox = document.getElementById('game');
const form = document.getElementById('loginForm');
const inputUser = document.getElementById('username');
const inputPass = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const tbody = document.querySelector('#scoreboard tbody');
// Conectamos al servidor que está en Render.
const socket = io('https://gangstercity.onrender.com');
// Guardamos en memoria (solo mientras la página está abierta) el usuario
// y la contraseña, para poder reconectarnos solos si se corta internet.
// La contraseña NO se guarda en el disco: solo vive en la memoria del navegador.
let credentials = null; // se guarda solo en memoria
// Guardamos el nombre del jugador logueado, para resaltar su fila en la tabla.
let myName = null;

// Recordamos el último usuario que usó esta computadora (para no tener que
// escribirlo de nuevo). La contraseña NO se recuerda.
try { inputUser.value = localStorage.getItem('lastUser') || ''; } catch (e) {}
// Función que pide al servidor "validame este usuario y contraseña".
// Devuelve una "promesa": algo que en el futuro nos va a dar la respuesta.
function login(creds) {
    return new Promise((resolve) => {
        // Le mandamos al servidor el evento "auth" con los datos,
        // y le decimos "cuando respondas, llamá a resolve con la respuesta".
        socket.emit('auth', creds, resolve);
    });
}
// Esto se ejecuta cuando el jugador aprieta el botón "Entrar" (o Enter).
form.addEventListener('submit', async (e) => {
    e.preventDefault(); // evitamos que la página se recargue (comportamiento normal del form).
    
    // Limpiamos errores anteriores y bloqueamos el botón mientras esperamos.
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Conectando... (puede tardar si el servidor estaba dormido)';

    // Tomamos lo que escribió el jugador (sacando espacios sobrantes).
    const creds = { name: inputUser.value.trim(), password: inputPass.value };
    // Esperamos la respuesta del servidor.
    const res = await login(creds);
    // Pase lo que pase, reactivamos el botón.
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
    // Si el servidor dijo "no", mostramos el error y no hacemos nada más.
    if (!res.ok) {
        loginError.textContent = res.error;
        return;
    }
    // Si llegamos acá, el login fue exitoso:
    credentials = creds; // guardamos para reconexiones.
    myName = res.name; // guardamos el nombre confirmado.
    try { localStorage.setItem('lastUser', res.name); } catch (e) {} // recordamos el usuario
    loginBox.hidden = true; // ocultamos la caja de login.
    gameBox.hidden = false; // mostramos la caja del juego.
});
// Si se corta la conexión y el navegador logra reconectar solo,
// volvemos a loguearnos automáticamente con las credenciales que teníamos.
socket.on('connect', async () => {
    if (credentials) await login(credentials);
});
// El servidor nos manda el ranking actualizado (evento "players").
// Acá lo dibujamos en la tabla y actualizamos el puntaje en el lienzo.
socket.on('players', (players) => {
        // Vaciamos la tabla para volver a llenarla desde cero.
    tbody.innerHTML = '';
    // Recorremos la lista de jugadores (ya viene ordenada del servidor).
    players.forEach((p, i) => {
        const tr = document.createElement('tr'); // creamos una fila.
        
        // Primera columna: el número de posición (1, 2, 3...).
        const tdRank = document.createElement('td');
        tdRank.textContent = i + 1;

        // Segunda columna: el nombre (con un puntito verde si está conectado).
        const tdName = document.createElement('td');
        if (p.online) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = 'Conectado';
            tdName.appendChild(dot);
        }
        tdName.appendChild(document.createTextNode(p.name));

        // Tercera columna: el puntaje.
        const tdScore = document.createElement('td');
        tdScore.textContent = p.score;

        // Armamos la fila y la agregamos a la tabla.
        tr.append(tdRank, tdName, tdScore);
        // Si esta fila es del jugador actual, la resaltamos.
        if (myName && p.name === myName) tr.classList.add('me');
        tbody.appendChild(tr);
    });

    // Ahora actualizamos el puntaje grande del lienzo.
    // Buscamos al jugador actual dentro de la lista.
    const mine = players.find((p) => p.name === myName);
    ctx.clearRect(0, 0, canvas.width, canvas.height); // borramos lo dibujado antes.
    ctx.fillStyle = 'black'; // color negro.
    ctx.font = '32px Arial'; // tamaño y fuente.
    ctx.fillText('Tu puntaje: ' + (mine ? mine.score : 0), 16, 40); // escribimos el texto.
});
// ============================================================
// CHAT
// ============================================================

// Buscamos en el HTML los elementos del chat.
const chatLog = document.getElementById('chatLog'); // caja donde aparecen los mensajes.
const chatForm = document.getElementById('chatForm');  // formulario para escribir.
const chatInput = document.getElementById('chatInput'); // campo de texto.

// Función que agrega un mensaje a la caja del chat.
function addMessage(m) {    
    // Verificamos si el usuario estaba mirando el final del chat.
    // Si sí (o si el mensaje es suyo), después hacemos scroll automático.
    const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
    // Creamos un div para el mensaje.
    const div = document.createElement('div');
    // Le ponemos una clase extra si el mensaje es del jugador actual.
    div.className = 'msg' + (m.name === myName ? ' mine' : '');

    // Mostramos la hora del mensaje en formato "HH:MM".
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Mostramos el nombre del que envió el mensaje.
    const name = document.createElement('strong');
    name.textContent = m.name + ': ';

    // Mostramos el texto del mensaje.
    // IMPORTANTE: usamos "textContent" (no "innerHTML") para que si alguien
    // escribe código HTML, se muestre como texto y no se ejecute.
    // Así evitamos ataques de tipo XSS.
    const text = document.createElement('span');
    text.textContent = m.text; // textContent evita que alguien inyecte código HTML
    
    // Armamos el mensaje completo: hora + nombre + texto.
    div.append(time, name, text);
    chatLog.appendChild(div);

    // Si hay más de 100 mensajes en pantalla, borramos el más viejo.
    // Así no se llena la página y no se pone lenta.
    while (chatLog.children.length > 100) chatLog.removeChild(chatLog.firstChild);
    // Si el usuario estaba abajo del todo, o el mensaje es suyo,
    // bajamos el scroll para que lo vea.
    if (nearBottom || m.name === myName) chatLog.scrollTop = chatLog.scrollHeight;
}

// El servidor nos manda el historial del chat (últimos 50 mensajes)
// cuando entramos o cuando nos reconectamos.
socket.on('chatHistory', (list) => {
    chatLog.innerHTML = ''; // vaciamos la caja del chat.
    list.forEach(addMessage); // agregamos cada mensaje del historial.
    chatLog.scrollTop = chatLog.scrollHeight; // bajamos al final.
});

// Cuando llega un mensaje nuevo en vivo, lo agregamos al chat.
socket.on('chat', addMessage);

// Cuando el jugador aprieta Enter o el botón de enviar:
chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); // evitamos que la página se recargue.
    const text = chatInput.value.trim();  // tomamos el texto sin espacios.
    if (!text) return; // si está vacío, no hacemos nada.
    socket.emit('chat', text); // mandamos el mensaje al servidor.
    chatInput.value = '';  // limpiamos el campo.
    chatInput.focus(); // dejamos el cursor listo para el próximo mensaje.
});

// ============================================================
// ENERGÍA, DINERO Y MISIONES (parte visual)
// Este código NO calcula nada: solo muestra lo que manda el servidor.
// ============================================================

// Buscamos en el HTML los elementos del panel.
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

// Crea un botón por cada misión de la lista.
function renderMissionButtons() {
    missionList.innerHTML = ''; // vaciamos por si se vuelve a llamar (reconexión).
    missionsData.forEach((m) => {
        const btn = document.createElement('button');
        btn.className = 'mission-btn';
        btn.dataset.id = m.id; // guardamos el ID para encontrar el botón después.

        // Título y detalle (usamos textContent: es más seguro que innerHTML).
        const title = document.createElement('strong');
        title.textContent = m.name;
        const info = document.createElement('span');
        info.textContent = `⚡ ${m.energy} · ⏱ ${m.durationMs / 1000}s · 💵 ${m.reward}`;
        btn.append(title, info);

        // Al hacer clic, le pedimos al servidor empezar esa misión.
        // El servidor responde { ok, error } y mostramos el error si lo hay.
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

// Desactiva los botones de misiones que no se pueden hacer ahora
// (hay una misión en curso, o no alcanza la energía).
// OJO: es solo visual. El servidor vuelve a validar todo igual.
function updateMissionButtons() {
    if (!lastState) return;
    missionList.querySelectorAll('.mission-btn').forEach((btn) => {
        const m = missionsData.find((x) => x.id === btn.dataset.id);
        btn.disabled = !!lastState.mission || lastState.energy < m.energy;
    });
}

// Dibuja en pantalla el estado que mandó el servidor.
function renderState(s) {
    lastState = s;

    // Dinero y energía en texto.
    moneyValue.textContent = s.money;
    energyValue.textContent = s.energy;
    energyMax.textContent = s.maxEnergy;

    // Barra de energía: ancho = porcentaje.
    energyBar.style.width = (s.energy / s.maxEnergy * 100) + '%';

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

// El servidor nos manda la lista de misiones (al iniciar sesión).
socket.on('missions', (list) => {
    missionsData = list;
    renderMissionButtons();
});

// El servidor nos manda nuestro estado (cada segundo y cuando algo cambia).
socket.on('state', renderState);

// El servidor avisa que terminó una misión y pagó la recompensa.
socket.on('missionDone', ({ name, reward }) => {
    missionMsg.textContent = `✅ Misión completada: ${name}. Ganaste 💵 ${reward}.`;
});
