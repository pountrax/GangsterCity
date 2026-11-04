// ============================================================
// shop.js — La tienda (cada jugador tiene la suya)
// ============================================================

const {
    ITEMS, SHOP_ITEMS, SHOP_REFRESH_MS, SHOP_MANUAL_MAX, PRICE_MIN, PRICE_MAX
} = require('./config');

// Un precio al azar entre PRICE_MIN y PRICE_MAX, en múltiplos de 10.
function randPrice() {
    const steps = Math.floor((PRICE_MAX - PRICE_MIN) / 10);
    return PRICE_MIN + 10 * Math.floor(Math.random() * (steps + 1));
}

// Ofertas nuevas: una por objeto de la tienda, con precio al azar.
function newOffers() {
    return SHOP_ITEMS.map(id => ({ id, price: randPrice(), bought: false }));
}

// Actualiza la tienda si pasó la hora (y repone las recargas manuales si pasó el día).
// Devuelve true si algo cambió (para avisarle al jugador).
function refreshShop(p, now) {
    let changed = false;
    const s = p.shop;
    const valid = s && Array.isArray(s.offers) && s.offers.length && s.nextAt;
    if (!valid || now >= s.nextAt) {
        p.shop = {
            offers: newOffers(),
            nextAt: now + SHOP_REFRESH_MS,
            manualLeft: valid ? s.manualLeft : SHOP_MANUAL_MAX,
            manualResetAt: valid ? s.manualResetAt : 0
        };
        changed = true;
    }
    if (p.shop.manualResetAt && now >= p.shop.manualResetAt) {
        p.shop.manualLeft = SHOP_MANUAL_MAX;
        p.shop.manualResetAt = 0;
        changed = true;
    }
    return changed;
}

// Lo que se le manda al navegador (tiempos RESTANTES, no horas absolutas).
function shopPayload(p, now) {
    const s = p.shop;
    return {
        offers: s.offers.map(o => ({ id: o.id, price: o.price, qty: ITEMS[o.id].shopQty, bought: o.bought })),
        nextInMs: Math.max(0, s.nextAt - now),
        manualLeft: s.manualLeft,
        manualMax: SHOP_MANUAL_MAX,
        manualResetInMs: s.manualResetAt ? Math.max(0, s.manualResetAt - now) : 0
    };
}

module.exports = { randPrice, newOffers, refreshShop, shopPayload };
