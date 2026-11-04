// ============================================================
// js/main.js — Arranque del navegador (este archivo se carga ÚLTIMO)
// Recibe del servidor la configuración y el estado personal, y le avisa a cada parte de la
// pantalla (perfil, estadísticas, misiones, guerra, clan...) que se actualice.
// Al final se conecta al servidor: así todos los "oyentes" ya están listos.
// ============================================================

// Configuración del juego (llega al iniciar sesión, antes del estado).
socket.on('config', (cfg) => {
    gameConfig = cfg;
    statsConfig = cfg.stats;
    itemsCatalog = cfg.items;
    if (cfg.chatTtlMs) chatTtlMs = cfg.chatTtlMs;

    applyConfigProfile(cfg);    // js/profile.js
    applyConfigStats(cfg);      // js/stats.js
    applyConfigInventory(cfg);  // js/inventory.js
    applyConfigShop();          // js/shop.js
    applyConfigMissions(cfg);   // js/missions.js
    applyConfigWar(cfg);        // js/war.js
    applyConfigClan(cfg);       // js/clan.js
    applyConfigClanWar();       // js/clanwar.js
});

// Estado personal (llega cada segundo y cuando algo cambia).
function renderState(s) {
    lastState = s;

    renderProfile(s);      // js/profile.js: nivel, XP, dinero, energía, fama.
    renderStats(s);        // js/stats.js: estadísticas, botones y globito rojo.
    renderMissions(s);     // js/missions.js: bolsa de dinero y misión en curso.
    updateClanButtons();   // js/clan.js
    updateShopButtons();   // js/shop.js: habilita o no "Comprar" según tu dinero.
    updateExpandBtn();     // js/inventory.js: botón de expandir el maletín.
    renderMyCard();        // js/war.js: tarjeta de Guerra con tus datos actuales.
    updateWarButtons();    // js/war.js: cargas de búsqueda y botón de pelear.

    // Si cambió mi clan (entré, salí, me expulsaron, renombraron o recién cargó),
    // cerramos cualquier repetición abierta y pedimos los datos del clan y su chat.
    if (s.clan !== lastClanName) {
        lastClanName = s.clan;
        closeReplay();
        cwData = null;
        loadMyClan();
        loadClanChat();
    }
}
socket.on('state', renderState);

// Ahora sí: nos conectamos al servidor.
socket.connect();
