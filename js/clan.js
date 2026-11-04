// ============================================================
// js/clan.js — Clan: crear/unirse, miembros y rangos, reglas y chat del clan
// (La guerra de clanes está en js/clanwar.js y js/replay.js)
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

// Icono y nombre de cada rango. El líder lleva el sombrero 🎩 y el colíder los lentes 🕶️.
const ROLE_ICONS = { lider: '🎩', colider: '🕶️', oficial: '⭐', miembro: '👤' };
const ROLE_LABELS = { lider: 'Líder', colider: 'Colíder', oficial: 'Oficial', miembro: 'Miembro' };

let myClanInfo = null;   // datos de mi clan (null si no tengo).
let lastClanName;        // para detectar cuándo cambia mi clan.
let rulesDirty = false;  // true si estoy escribiendo reglas sin guardar (para no pisarlas).

// ¿Puede alguien con el rango "actor" gestionar a alguien con el rango "target"?
// (Solo para mostrar u ocultar botones: el servidor lo verifica de nuevo.)
function canManageClient(actor, target) {
    if (actor === 'lider') return target !== 'lider';
    if (actor === 'colider') return target === 'miembro' || target === 'oficial';
    return false;
}

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

// Pide al servidor cambiar el rango de un miembro ('miembro', 'oficial' o 'colider').
function setRole(key, role, name) {
    clanMsg.textContent = '';
    socket.emit('setMemberRole', { key, role }, (res) => {
        if (!res.ok) clanMsg.textContent = '⚠️ ' + res.error;
        else clanMsg.textContent = `✅ ${name} ahora es ${ROLE_LABELS[role]}.`;
        loadMyClan(); // en ambos casos refrescamos (si falló, el desplegable vuelve a su valor).
    });
}

// Dibuja la lista de miembros: una fila por miembro, con controles según mi rango.
function renderMembers(members, myRole) {
    clanMembers.innerHTML = '';

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

        // Controles SOLO si mi rango me permite gestionar a este miembro.
        if (canManageClient(myRole, m.role)) {
            const actions = document.createElement('div');
            actions.className = 'member-actions';

            // Desplegable de rango: el líder puede elegir Miembro, Oficial o Colíder; el colíder solo Miembro u Oficial.
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

            actions.append(select, kickBtn);
            row.appendChild(actions);
        }

        clanMembers.appendChild(row);
    });
}

// Pestaña de reglas: editor para líder y colíderes, solo lectura para el resto.
function renderRules(clan) {
    const canEdit = clan.myRole === 'lider' || clan.myRole === 'colider';
    rulesForm.hidden = !canEdit;
    rulesView.hidden = canEdit;

    if (canEdit) {
        // No pisamos lo que la persona está escribiendo.
        if (!rulesDirty) {
            rulesInput.value = clan.rules;
            rulesCount.textContent = `${clan.rules.length}/${gameConfig ? gameConfig.clanRulesMax : 1000}`;
        }
    } else {
        rulesView.textContent = clan.rules || 'El líder todavía no escribió las reglas del clan.';
        rulesView.classList.toggle('empty', !clan.rules);
    }
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

        // Cambiar el nombre del clan: solo el líder ve el formulario.
        renameClanForm.hidden = myClanInfo.myRole !== 'lider';
        if (document.activeElement !== renameClanInput) renameClanInput.value = myClanInfo.name;

        renderMembers(myClanInfo.members, myClanInfo.myRole);
        renderRules(myClanInfo);
    } else {
        rulesDirty = false;
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

// Cambiar el nombre del clan (solo el líder; el servidor lo vuelve a verificar).
renameClanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clanMsg.textContent = '';
    socket.emit('renameClan', renameClanInput.value, (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = `✅ El clan ahora se llama ${res.name}.`;
        loadMyClan();
    });
});

// Reglas: contador de caracteres y marca de "tengo cambios sin guardar".
rulesInput.addEventListener('input', () => {
    rulesDirty = true;
    rulesCount.textContent = `${rulesInput.value.length}/${gameConfig ? gameConfig.clanRulesMax : 1000}`;
});

// Guardar las reglas (líder y colíderes).
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

// Salir del clan (con confirmación de dos toques).
confirmButton(leaveClanBtn, 'Salir del clan', '¿Seguro? Tocá de nuevo', () => {
    socket.emit('leaveClan', (res) => {
        if (!res.ok) { clanMsg.textContent = '⚠️ ' + res.error; return; }
        clanMsg.textContent = '✅ Saliste del clan.';
        loadMyClan();
    });
});

// ---------- Subpestañas del clan (Miembros / Chat / Reglas / Guerra de clan) ----------
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
    if (name === 'guerra') loadClanWarPanel(); // (js/clanwar.js) al abrir la pestaña, pedimos los datos frescos.
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

// Algo cambió en mi clan (alguien entró, salió, cambió de rango, nuevas reglas...): refrescamos.
socket.on('clanChanged', loadMyClan);

// Avisos que me manda el servidor (por ejemplo "Fuiste expulsado del clan X").
socket.on('clanNotice', (text) => {
    clanMsg.textContent = 'ℹ️ ' + text;
});

// Configuración del juego: largo máximo de las reglas, botones y chat del clan.
function applyConfigClan(cfg) {
    rulesInput.maxLength = cfg.clanRulesMax;
    updateClanButtons();
    loadClanChat(); // también al reconectar, para no perder mensajes del clan.
}
