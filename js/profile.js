// ============================================================
// js/profile.js — Recuadro del personaje (nombre, nivel, XP, dinero, energía, fama) y "Editar perfil"
// ============================================================

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

// Dibuja los datos del recuadro con el estado que mandó el servidor.
function renderProfile(s) {
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
}

// Texto de ayuda del cambio de nombre (llega con la configuración del juego).
function applyConfigProfile(cfg) {
    editNameHint.textContent =
        `Podés cambiarlo cada ${Math.round(cfg.nameCooldownMs / 60000)} minutos. Es también tu nombre para iniciar sesión.`;
}

// Abrir y cerrar el panel de edición.
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
        // El nombre también es el de inicio de sesión: actualizamos todo lo que lo usa.
        myName = res.name;
        if (credentials) credentials.name = res.name; // para que al reconectar entre con el nombre nuevo.
        try { localStorage.setItem('lastUser', res.name); } catch (err) {}
        nameValue.textContent = myName;
        editName.value = myName;
        avatar.textContent = myName.charAt(0).toUpperCase();
        editMsg.textContent = '✅ Nombre cambiado. Desde ahora iniciás sesión con ese nombre.';
    });
});
