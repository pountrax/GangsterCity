// ============================================================
// events/inventory.js — Tienda, objetos de la mochila y maletín de guerra
// ============================================================

const { online } = require('../state');
const {
    ITEMS, MAX_ENERGY, SHOP_MANUAL_MAX, SHOP_REFRESH_MS, SHOP_MANUAL_RESET_MS,
    CASE_EXPAND_COST, CASE_EXPAND_LEVEL
} = require('../config');
const { fmtWait, newUid } = require('../utils');
const { refreshEnergy, afterInventoryChange, saveProgress } = require('../players');
const { addToBag, canPlace, findSpot } = require('../items');
const { refreshShop, shopPayload, newOffers } = require('../shop');

module.exports = function registerInventory(socket) {

    // ---------- TIENDA: COMPRAR UNA OFERTA ----------
    // Mandamos también el precio que el jugador VIO: si la tienda se actualizó justo antes,
    // no le cobramos un precio distinto sin avisar.
    socket.on('buyOffer', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const now = Date.now();
        if (refreshShop(p, now)) socket.emit('shop', shopPayload(p, now));

        const offer = p.shop.offers.find(o => o.id === data?.id);
        if (!offer) return reply({ ok: false, error: 'Esa oferta no existe.' });
        if (offer.price !== data?.price) return reply({ ok: false, error: 'La tienda se actualizó. Revisá los precios nuevos.' });
        if (offer.bought) return reply({ ok: false, error: 'Ya compraste esta oferta. Esperá a que se actualice la tienda.' });
        if (p.money < offer.price) return reply({ ok: false, error: `Te faltan 💵 ${offer.price - p.money}.` });

        // Primero vemos si entra en la mochila; recién ahí cobramos.
        if (!addToBag(p, offer.id, ITEMS[offer.id].shopQty)) return reply({ ok: false, error: 'Tu mochila está llena.' });
        p.money -= offer.price;
        offer.bought = true;

        socket.emit('shop', shopPayload(p, now));
        afterInventoryChange(socket.id, p);
        reply({ ok: true, name: ITEMS[offer.id].name, qty: ITEMS[offer.id].shopQty });
    });

    // ---------- TIENDA: RECARGA MANUAL (2 por día) ----------
    socket.on('refreshShopManual', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const now = Date.now();
        refreshShop(p, now);
        if (p.shop.manualLeft < 1) {
            return reply({ ok: false, error: `Ya usaste tus ${SHOP_MANUAL_MAX} recargas de hoy. Se reponen en ${fmtWait(p.shop.manualResetAt - now)}.` });
        }
        p.shop.manualLeft--;
        if (!p.shop.manualResetAt) p.shop.manualResetAt = now + SHOP_MANUAL_RESET_MS; // arranca el reloj del día.
        p.shop.offers = newOffers();
        p.shop.nextAt = now + SHOP_REFRESH_MS;

        socket.emit('shop', shopPayload(p, now));
        saveProgress([p]).catch(console.error);
        reply({ ok: true });
    });

    // ---------- USAR UN OBJETO DE LA MOCHILA (chocolate) ----------
    socket.on('useItem', (idx, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });

        const stack = Number.isInteger(idx) ? p.bag[idx] : null;
        if (!stack) return reply({ ok: false, error: 'Ese objeto ya no está en tu mochila.' });
        const def = ITEMS[stack.id];
        if (def.kind !== 'consumable') return reply({ ok: false, error: 'Ese objeto no se puede usar acá.' });

        const now = Date.now();
        refreshEnergy(p, now);
        if (p.energy >= MAX_ENERGY) return reply({ ok: false, error: 'Ya tenés la energía llena.' });

        p.energy = Math.min(MAX_ENERGY, p.energy + def.energy);
        if (p.energy >= MAX_ENERGY) p.energyAt = now;
        stack.qty--;
        if (stack.qty <= 0) p.bag.splice(idx, 1);

        afterInventoryChange(socket.id, p);
        reply({ ok: true, message: `${def.emoji} Usaste ${def.name}: +${def.energy} de energía.` });
    });

    // ---------- MALETÍN: PONER UN OBJETO (de la mochila al maletín) ----------
    // data = { idx, x, y }. Sin x e y, se coloca en el primer lugar libre.
    socket.on('placeInCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const idx = data?.idx;
        const stack = Number.isInteger(idx) ? p.bag[idx] : null;
        if (!stack) return reply({ ok: false, error: 'Ese objeto ya no está en tu mochila.' });
        const def = ITEMS[stack.id];
        if (!def.w) return reply({ ok: false, error: 'Ese objeto no va en el maletín de guerra.' });

        let spot;
        if (Number.isInteger(data?.x) && Number.isInteger(data?.y)) {
            if (!canPlace(p, def, data.x, data.y, null)) return reply({ ok: false, error: 'No entra en ese lugar.' });
            spot = { x: data.x, y: data.y };
        } else {
            spot = findSpot(p, def);
            if (!spot) return reply({ ok: false, error: 'No hay lugar en el maletín. Sacá algo o expandilo.' });
        }

        p.bag.splice(idx, 1); // sale de la mochila (la pila entera)...
        p.briefcase.push({ uid: newUid(), id: stack.id, qty: stack.qty, x: spot.x, y: spot.y }); // ...y entra al maletín.
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: MOVER UN OBJETO DENTRO DEL MALETÍN ----------
    socket.on('moveInCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const it = p.briefcase.find(i => i.uid === data?.uid);
        if (!it) return reply({ ok: false, error: 'Ese objeto ya no está en el maletín.' });
        if (!Number.isInteger(data?.x) || !Number.isInteger(data?.y)) return reply({ ok: false, error: 'Posición inválida.' });
        if (!canPlace(p, ITEMS[it.id], data.x, data.y, it.uid)) return reply({ ok: false, error: 'No entra en ese lugar.' });

        it.x = data.x;
        it.y = data.y;
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: SACAR UN OBJETO (vuelve a la mochila) ----------
    socket.on('removeFromCase', (data, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.fight) return reply({ ok: false, error: 'No podés cambiar el maletín en plena pelea.' });

        const it = p.briefcase.find(i => i.uid === data?.uid);
        if (!it) return reply({ ok: false, error: 'Ese objeto ya no está en el maletín.' });
        if (!addToBag(p, it.id, it.qty)) return reply({ ok: false, error: 'Tu mochila está llena.' });

        p.briefcase = p.briefcase.filter(i => i !== it);
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });

    // ---------- MALETÍN: COMPRAR LA EXPANSIÓN (+2x2, de 3x3 a 5x5) ----------
    socket.on('expandCase', (cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        const p = online[socket.id];
        if (!p) return reply({ ok: false, error: 'Tenés que iniciar sesión.' });
        if (p.caseExpanded) return reply({ ok: false, error: 'Tu maletín ya está expandido.' });
        if (p.level < CASE_EXPAND_LEVEL) return reply({ ok: false, error: `Necesitás nivel ${CASE_EXPAND_LEVEL} para expandir el maletín.` });
        if (p.money < CASE_EXPAND_COST) return reply({ ok: false, error: `Necesitás 💵 ${CASE_EXPAND_COST}.` });

        p.money -= CASE_EXPAND_COST;
        p.caseExpanded = true;
        afterInventoryChange(socket.id, p);
        reply({ ok: true });
    });
};
