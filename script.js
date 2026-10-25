const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 400;

const loginBox = document.getElementById('login');
const gameBox = document.getElementById('game');
const form = document.getElementById('loginForm');
const inputUser = document.getElementById('username');
const inputPass = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const tbody = document.querySelector('#scoreboard tbody');

const socket = io('https://gangstercity.onrender.com');
let credentials = null; // se guarda solo en memoria
let myName = null;

// recuerda el último usuario usado (la contraseña NO se guarda)
try { inputUser.value = localStorage.getItem('lastUser') || ''; } catch (e) {}

function login(creds) {
    return new Promise((resolve) => {
        socket.emit('auth', creds, resolve);
    });
}

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

    credentials = creds;
    myName = res.name;
    try { localStorage.setItem('lastUser', res.name); } catch (e) {}
    loginBox.hidden = true;
    gameBox.hidden = false;
});

// si el servidor se reinicia o se corta la conexión, vuelve a entrar solo
socket.on('connect', async () => {
    if (credentials) await login(credentials);
});

socket.on('players', (players) => {
    // el servidor ya manda la lista ordenada de mayor a menor
    tbody.innerHTML = '';
    players.forEach((p, i) => {
        const tr = document.createElement('tr');

        const tdRank = document.createElement('td');
        tdRank.textContent = i + 1;

        const tdName = document.createElement('td');
        if (p.online) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = 'Conectado';
            tdName.appendChild(dot);
        }
        tdName.appendChild(document.createTextNode(p.name));

        const tdScore = document.createElement('td');
        tdScore.textContent = p.score;

        tr.append(tdRank, tdName, tdScore);
        if (myName && p.name === myName) tr.classList.add('me');
        tbody.appendChild(tr);
    });

    const mine = players.find((p) => p.name === myName);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '32px Arial';
    ctx.fillText('Tu puntaje: ' + (mine ? mine.score : 0), 16, 40);
});
// ===== CHAT =====
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

function addMessage(m) {
    const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;

    const div = document.createElement('div');
    div.className = 'msg' + (m.name === myName ? ' mine' : '');

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const name = document.createElement('strong');
    name.textContent = m.name + ': ';

    const text = document.createElement('span');
    text.textContent = m.text; // textContent evita que alguien inyecte código HTML

    div.append(time, name, text);
    chatLog.appendChild(div);

    // máximo 100 mensajes en pantalla
    while (chatLog.children.length > 100) chatLog.removeChild(chatLog.firstChild);

    if (nearBottom || m.name === myName) chatLog.scrollTop = chatLog.scrollHeight;
}

// historial al entrar (o al reconectar)
socket.on('chatHistory', (list) => {
    chatLog.innerHTML = '';
    list.forEach(addMessage);
    chatLog.scrollTop = chatLog.scrollHeight;
});

// mensaje nuevo en vivo
socket.on('chat', addMessage);

// enviar
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    chatInput.value = '';
    chatInput.focus();
});