// ============================================================
// socket.js — Qué pasa cuando un jugador se conecta
// Apenas entra (aunque no se haya logueado) ve los rankings; después se activan todos los
// eventos que puede pedir, repartidos por tema en la carpeta events/.
// ============================================================

const { io } = require('./core');
const { cache } = require('./state');
const { buildActivityRanking, buildFameRanking } = require('./rankings');

const registerAccount = require('./events/account');     // login, nombre, notificaciones, desconexión.
const registerProgress = require('./events/progress');   // misiones, estadísticas, bolsa, reinicio.
const registerInventory = require('./events/inventory'); // tienda, objetos y maletín.
const registerWar = require('./events/war');             // guerra 1 contra 1.
const registerClans = require('./events/clans');         // clanes.
const registerClanWar = require('./events/clanwar');     // guerra de clanes.
const registerChat = require('./events/chat');           // chat global y de clan.

io.on('connection', (socket) => {
    socket.emit('players', buildActivityRanking());
    socket.emit('fameRanking', buildFameRanking());
    socket.emit('clanRanking', cache.clans);

    registerAccount(socket);
    registerProgress(socket);
    registerInventory(socket);
    registerWar(socket);
    registerClans(socket);
    registerClanWar(socket);
    registerChat(socket);
});
