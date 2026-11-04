// ============================================================
// combat.js — Las reglas del combate por turnos (sin mandar nada a nadie)
// Lo usan la guerra 1 contra 1 y la guerra de clanes.
// ============================================================

const {
    CLASSES, HP_PER_VIDA, CRIT_MULT, GRENADE_DAMAGE, WAR_MAX_ACTIONS,
    ARMOR_CAP, EXTRA_TURN_CAP, DODGE_CAP, CRIT_CAP, pct
} = require('./config');

// Convierte las estadísticas TOTALES de un personaje en un "luchador".
function makeFighter(name, level, cls, stats, pistol, grenades) {
    const maxHp = stats.vida * HP_PER_VIDA;
    return {
        name, level, className: CLASSES[cls].name,
        maxHp, hp: maxHp,
        dano: stats.dano, aguante: stats.aguante, velocidad: stats.velocidad,
        inteligencia: stats.inteligencia, suerte: stats.suerte,
        pistol: !!pistol,          // true = cada ataque es un disparo.
        grenades: grenades || 0    // granadas que va a lanzar en sus primeras acciones.
    };
}

// Un golpe de "att" contra "def". Devuelve { result: 'hit' | 'crit' | 'dodge', dmg }.
function resolveHit(att, def) {
    // 1) ¿El defensor esquiva? (inteligencia)
    if (Math.random() < pct(def.inteligencia, DODGE_CAP, def.level)) return { result: 'dodge', dmg: 0 };

    // 2) Daño base con una variación de ±15%.
    let dmg = att.dano * (0.85 + Math.random() * 0.3);

    // 3) ¿Es crítico? (suerte del atacante)
    const crit = Math.random() < pct(att.suerte, CRIT_CAP, att.level);
    if (crit) dmg *= CRIT_MULT;

    // 4) El aguante del defensor reduce el daño.
    dmg *= 1 - pct(def.aguante, ARMOR_CAP, def.level);

    dmg = Math.max(1, Math.round(dmg));
    def.hp = Math.max(0, def.hp - dmg);
    return { result: crit ? 'crit' : 'hit', dmg };
}

// Una granada: no se esquiva ni la reduce el aguante.
function resolveGrenade(def) {
    const dmg = Math.max(1, Math.round(GRENADE_DAMAGE * (0.85 + Math.random() * 0.3)));
    def.hp = Math.max(0, def.hp - dmg);
    return { result: 'boom', dmg };
}

// Simula la pelea COMPLETA de una vez y devuelve la lista de golpes y el resultado.
// Respeta la vida con la que llega cada luchador (sirve también para los duelos de la guerra de clanes,
// donde el ganador sigue herido).
function simulateFight(me, rival) {
    const events = [];
    let actions = 0;

    // Empieza el más veloz; si empatan, se sortea.
    let meTurn = me.velocidad !== rival.velocidad ? me.velocidad > rival.velocidad : Math.random() < 0.5;

    // Una acción: granada (si le quedan) o golpe normal (con pistola si la lleva).
    const act = (att, def, actor, extra) => {
        let r;
        let weapon = null;
        if (att.grenades > 0) {
            att.grenades--;
            weapon = 'grenade';
            r = resolveGrenade(def);
        } else {
            r = resolveHit(att, def);
            if (att.pistol) weapon = 'pistol';
        }
        actions++;
        events.push({ actor, result: r.result, dmg: r.dmg, extra, weapon, hpMe: me.hp, hpRival: rival.hp });
    };

    while (me.hp > 0 && rival.hp > 0 && actions < WAR_MAX_ACTIONS) {
        const att = meTurn ? me : rival;
        const def = meTurn ? rival : me;
        const actor = meTurn ? 'me' : 'rival';

        act(att, def, actor, false);

        // Turno extra (velocidad): una sola vez por turno, y solo si el rival sigue en pie.
        if (def.hp > 0 && actions < WAR_MAX_ACTIONS && Math.random() < pct(att.velocidad, EXTRA_TURN_CAP, att.level)) {
            act(att, def, actor, true);
        }
        meTurn = !meTurn;
    }

    // Resultado: gana quien dejó al otro sin vida; si se acabaron los golpes, quien tiene más vida (%).
    let result;
    if (rival.hp <= 0) result = 'win';
    else if (me.hp <= 0) result = 'lose';
    else {
        const a = me.hp / me.maxHp;
        const b = rival.hp / rival.maxHp;
        result = a > b ? 'win' : a < b ? 'lose' : 'draw';
    }
    return { events, result };
}

module.exports = { makeFighter, resolveHit, resolveGrenade, simulateFight };
