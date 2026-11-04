// ============================================================
// js/inventory.js — Mochila y maletín de guerra (con arrastrar y soltar, con mouse o con el dedo)
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

let bagSlots = 20;   // casillas de la mochila (el servidor lo confirma).
let invData = { bag: [], briefcase: [], caseSize: 3, expanded: false }; // lo último que mandó el servidor.
let caseCells = [];  // las casillas (div) del maletín, para pintarlas al arrastrar.
let selected = null; // objeto seleccionado: { from: 'bag', idx } o { from: 'case', uid }.

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

// ---------- Arrastrar y soltar ----------
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

// Configuración del juego: cantidad de casillas de la mochila.
function applyConfigInventory(cfg) {
    bagSlots = cfg.bagSlots;
    renderBag();
    renderCase();
}
