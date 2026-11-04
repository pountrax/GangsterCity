// ============================================================
// js/chat.js — Chat global (y la función que dibuja mensajes, que también usa el chat de clan)
// ============================================================

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

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
// igual que hace la base de datos.
setInterval(() => {
    const limit = Date.now() - chatTtlMs;
    chatLog.querySelectorAll('.msg').forEach((el) => {
        if (Number(el.dataset.ts) < limit) el.remove();
    });
}, 60000);
