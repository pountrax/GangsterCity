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

const socket = io('https://ejemplo-g0ye.onrender.com');

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
    players.sort((a, b) => b.score - a.score);

    tbody.innerHTML = '';
    players.forEach((p, i) => {
        const tr = document.createElement('tr');
        [i + 1, p.name, p.score].forEach((value) => {
            const td = document.createElement('td');
            td.textContent = value;
            tr.appendChild(td);
        });
        if (p.name === myName) tr.classList.add('me');
        tbody.appendChild(tr);
    });

    const mine = players.find((p) => p.name === myName);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '32px Arial';
    ctx.fillText('Tu puntaje: ' + (mine ? mine.score : 0), 16, 40);
});