// ============================================================
// items.js — Mochila, maletín de guerra y objetos que caen en misiones
// Son funciones "puras": trabajan sobre los datos del jugador, sin mandar nada ni tocar la base.
// ============================================================

const { ITEMS, BAG_SLOTS, CASE_BASE, CASE_EXPANDED } = require('./config');

// ---------- Limpieza de datos que vienen de la base ----------

// Mochila: solo objetos que existen, con cantidades válidas.
function sanitizeBag(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(s => s && ITEMS[s.id] && Number.isInteger(s.qty) && s.qty > 0)
        .slice(0, BAG_SLOTS)
        .map(s => ({ id: s.id, qty: Math.min(s.qty, ITEMS[s.id].stackMax) }));
}

// Maletín: solo objetos que existen, que entran en el maletín y tienen posición.
function sanitizeCase(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(it => it && ITEMS[it.id] && ITEMS[it.id].w && Number.isInteger(it.x) && Number.isInteger(it.y) && it.uid && it.qty > 0)
        .map(it => ({ uid: String(it.uid), id: it.id, qty: Math.min(it.qty, ITEMS[it.id].stackMax), x: it.x, y: it.y }));
}

// ---------- Mochila ----------

// Agrega "qty" unidades a la mochila (completando pilas y usando casillas libres).
// Devuelve false (sin cambiar nada) si no hay lugar para todas.
function addToBag(p, id, qty) {
    const def = ITEMS[id];
    let room = (BAG_SLOTS - p.bag.length) * def.stackMax;
    p.bag.forEach(s => { if (s.id === id) room += def.stackMax - s.qty; });
    if (room < qty) return false;

    let left = qty;
    for (const s of p.bag) {
        if (left <= 0) break;
        if (s.id === id && s.qty < def.stackMax) {
            const add = Math.min(left, def.stackMax - s.qty);
            s.qty += add;
            left -= add;
        }
    }
    while (left > 0) {
        const add = Math.min(left, def.stackMax);
        p.bag.push({ id, qty: add });
        left -= add;
    }
    return true;
}

// ---------- Maletín ----------

// Lado del maletín del jugador (3 o 5).
function caseSize(p) {
    return p.caseExpanded ? CASE_EXPANDED : CASE_BASE;
}

// ¿Dos rectángulos se pisan?
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// ¿Entra el objeto "def" en la posición (x, y) del maletín? (ignoreUid: un objeto que se está moviendo)
function canPlace(p, def, x, y, ignoreUid) {
    const size = caseSize(p);
    if (!def.w || x < 0 || y < 0 || x + def.w > size || y + def.h > size) return false;
    for (const it of p.briefcase) {
        if (it.uid === ignoreUid) continue;
        const d = ITEMS[it.id];
        if (rectsOverlap(x, y, def.w, def.h, it.x, it.y, d.w, d.h)) return false;
    }
    return true;
}

// Primer lugar libre del maletín (de arriba a abajo, de izquierda a derecha).
function findSpot(p, def) {
    const size = caseSize(p);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (canPlace(p, def, x, y, null)) return { x, y };
        }
    }
    return null;
}

// Ventajas del maletín: el arma de mayor daño es la que cuenta.
function gearOfItems(items) {
    let dmg = 0;
    let pistol = false;
    items.forEach(it => {
        const d = ITEMS[it.id];
        if (d && d.kind === 'weapon') { pistol = true; dmg = Math.max(dmg, d.dmg); }
    });
    return { dmg, pistol };
}

// Gasta 1 granada del maletín (si hay). Devuelve true si gastó una.
function consumeGrenade(p) {
    const it = p.briefcase.find(i => i.id === 'granada' && i.qty > 0);
    if (!it) return false;
    it.qty--;
    if (it.qty <= 0) p.briefcase = p.briefcase.filter(i => i !== it); // se acabó: libera el espacio.
    return true;
}

// ---------- Objetos raros de las misiones ----------

// Sortea los objetos raros que caen al terminar una misión.
// Devuelve la lista de los que cayeron ("lost" = la mochila estaba llena y se perdió).
function rollDrops(p, mission) {
    const got = [];
    (mission.drops || []).forEach(d => {
        if (Math.random() < d.chance) {
            const ok = addToBag(p, d.id, d.qty);
            got.push({ id: d.id, qty: d.qty, lost: !ok });
        }
    });
    return got;
}

module.exports = {
    sanitizeBag, sanitizeCase, addToBag, caseSize, rectsOverlap, canPlace, findSpot,
    gearOfItems, consumeGrenade, rollDrops
};
