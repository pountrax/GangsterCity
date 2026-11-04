// ============================================================
// js/utils.js — Funciones de ayuda que usan varios archivos
// ============================================================

// BOTÓN DE DOS TOQUES (para acciones peligrosas: salir, expulsar).
// El primer toque pide confirmación; el segundo ejecuta la acción. A los 4 segundos se cancela solo.
function confirmButton(btn, label, confirmLabel, onConfirm) {
    let armed = false;
    let timer = null;
    btn.textContent = label;
    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            btn.textContent = confirmLabel;
            timer = setTimeout(() => { armed = false; btn.textContent = label; }, 4000);
            return;
        }
        clearTimeout(timer);
        armed = false;
        btn.textContent = label;
        onConfirm();
    });
}

// Formatos de tiempo
function fmtClock(ms) {            // 9:05
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function fmtHM(ms) {               // "3 h 20 min" o "45 min"
    const m = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

// ICONOS DE OBJETOS: muestra el emoji; si existe la imagen en img/items/, la reemplaza al cargar.
// Si la imagen no existe, queda el emoji.
function makeIcon(def) {
    const wrap = document.createElement('span');
    wrap.className = 'icon';
    const emoji = document.createElement('span');
    emoji.className = 'icon-emoji' + (def.flip ? ' flip' : '');
    emoji.textContent = def.emoji;
    wrap.appendChild(emoji);
    if (def.img) {
        const img = new Image();
        img.alt = '';
        img.draggable = false;
        img.onload = () => { emoji.remove(); wrap.appendChild(img); };
        img.src = def.img;
    }
    return wrap;
}

// Reinicia una animación CSS: saca la clase, fuerza al navegador a "olvidarla" y la vuelve a poner.
function playAnim(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
}
