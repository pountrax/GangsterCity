// ============================================================
// js/session.js — Iniciar sesión y reconectar solo si se corta internet
// ============================================================

const loginBox = document.getElementById('login');
const gameBox = document.getElementById('game');
const form = document.getElementById('loginForm');
const inputUser = document.getElementById('username');
const inputPass = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

// Recordamos el último usuario usado (la contraseña NO se recuerda).
try { inputUser.value = localStorage.getItem('lastUser') || ''; } catch (e) {}

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
        // Si el servidor todavía cree que seguimos conectados, esperamos 3 segundos y reintentamos.
        if (res.code === 'online' && i < 5) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }
        // Cualquier otro problema: volvemos a la pantalla de login con el motivo.
        credentials = null;
        gameBox.hidden = true;
        loginBox.hidden = false;
        loginError.textContent = res.error;
        return;
    }
});
