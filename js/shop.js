// ============================================================
// js/shop.js — La tienda: ofertas, compra, cuenta regresiva y recarga manual
// ============================================================

const shopOffers = document.getElementById('shopOffers');
const shopInfo = document.getElementById('shopInfo');
const shopTimer = document.getElementById('shopTimer');
const shopManualBtn = document.getElementById('shopManualBtn');
const shopManualInfo = document.getElementById('shopManualInfo');
const shopMsg = document.getElementById('shopMsg');

let shopData = null;   // lo último que mandó el servidor.
let shopNextAt = 0;    // hora (de TU reloj) en que se actualiza la tienda.
let shopResetAt = 0;   // hora en que se reponen las recargas manuales (0 = no hay espera).
let shopButtons = [];  // botones "Comprar" de cada oferta.

// Dibuja las ofertas.
function renderShop() {
    shopOffers.innerHTML = '';
    shopButtons = [];
    if (!shopData) return;
    shopData.offers.forEach((o) => {
        const def = itemsCatalog[o.id];
        if (!def) return;
        const card = document.createElement('div');
        card.className = 'offer';

        const icon = document.createElement('div');
        icon.className = 'offer-icon';
        icon.appendChild(makeIcon(def));

        const name = document.createElement('div');
        name.className = 'offer-name';
        name.textContent = def.name + (o.qty > 1 ? ` x${o.qty}` : '');

        const desc = document.createElement('div');
        desc.className = 'offer-desc';
        desc.textContent = def.desc;

        const price = document.createElement('div');
        price.className = 'offer-price';
        price.textContent = '💵 ' + o.price;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn small';
        btn.textContent = o.bought ? 'Comprado' : 'Comprar';
        btn.addEventListener('click', () => {
            shopMsg.textContent = '';
            // Mandamos el precio que VEMOS: si la tienda cambió justo antes, el servidor no cobra otro.
            socket.emit('buyOffer', { id: o.id, price: o.price }, (res) => {
                shopMsg.textContent = res.ok
                    ? `✅ Compraste ${res.name}${res.qty > 1 ? ' x' + res.qty : ''}. Está en tu mochila.`
                    : '⚠️ ' + res.error;
            });
        });

        card.append(icon, name, desc, price, btn);
        shopOffers.appendChild(card);
        shopButtons.push({ btn, offer: o });
    });
    updateShopButtons();
}

// Habilita o no cada botón según tu dinero (se llama cada segundo).
function updateShopButtons() {
    shopButtons.forEach(({ btn, offer }) => {
        btn.disabled = offer.bought || !lastState || lastState.money < offer.price;
    });
    if (shopData) {
        shopManualBtn.textContent = `🔄 Recargar tienda (${shopData.manualLeft}/${shopData.manualMax})`;
        shopManualBtn.disabled = shopData.manualLeft < 1;
    }
}

// Cuentas regresivas de la tienda (cada segundo, con tu propio reloj).
function updateShopTimer() {
    if (!shopData) return;
    const left = shopNextAt - Date.now();
    shopTimer.textContent = left > 0
        ? `🕒 La tienda se actualiza en ${fmtClock(left)}.`
        : '🕒 Actualizando la tienda...';
    if (shopData.manualLeft < 1 && shopResetAt) {
        shopManualInfo.textContent = `Sin recargas por hoy. Se reponen en ${fmtHM(shopResetAt - Date.now())}.`;
    } else {
        shopManualInfo.textContent = 'Cada recarga manual cambia las ofertas y los precios al instante.';
    }
}
setInterval(updateShopTimer, 1000);

// El servidor manda la tienda (al entrar y cada vez que cambia).
socket.on('shop', (data) => {
    shopData = data;
    shopNextAt = Date.now() + data.nextInMs;
    shopResetAt = data.manualResetInMs ? Date.now() + data.manualResetInMs : 0;
    renderShop();
    updateShopTimer();
});

shopManualBtn.addEventListener('click', () => {
    shopMsg.textContent = '';
    socket.emit('refreshShopManual', (res) => {
        shopMsg.textContent = res.ok ? '✅ Tienda recargada.' : '⚠️ ' + res.error;
    });
});

// Configuración del juego: texto de ayuda.
function applyConfigShop() {
    shopInfo.textContent =
        'Cada oferta se puede comprar una vez por actualización. Los precios cambian en cada actualización. ' +
        'Lo que compres va a tu mochila; si es un arma o granadas, pasalo al maletín de guerra.';
}
