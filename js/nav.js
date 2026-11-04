// ============================================================
// js/nav.js — Navegación entre secciones (Misiones / Inventario / Guerra / Tienda / Clan)
// ============================================================

const navButtons = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab');

// Muestra la sección "name" y oculta las demás.
function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'clan') loadMyClan();        // (js/clan.js) datos frescos del clan.
    if (name === 'inventario') renderCase();  // (js/inventory.js) recalcula el tamaño de las casillas.
}

navButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
