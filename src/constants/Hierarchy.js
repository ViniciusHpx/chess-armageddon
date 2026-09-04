/**
 * ATENÇÃO: no modo online quem manda é
 * `chess-armageddon-server/src/sim/constants.ts`. Este arquivo é a cópia que o
 * cliente usa para DESENHAR (textura, tamanho, forma do golpe) e para rodar o
 * modo offline (cena `Start`). Se um número mudar lá, espelhe aqui — senão o
 * golpe acerta fora do que aparece na tela.
 */
/**
 * Fração da velocidade mantida durante o golpe (espelha
 * `ATTACK_MOVE_FACTOR` do servidor).
 *
 * Parar seco durante o windup, somado ao RTT, dava a sensação de travar bem
 * mais que os 200 ms reais do golpe.
 */
export const ATTACK_MOVE_FACTOR = 0.6;

/**
 * Fração da velocidade enquanto o golpe está sendo CARREGADO (espelha
 * `CHARGE_MOVE_FACTOR` do servidor).
 *
 * Mais lento que durante o próprio golpe: segurar a carga passa a custar
 * posicionamento, não só tempo.
 */
export const CHARGE_MOVE_FACTOR = 0.45;

/**
 * Fator de velocidade do estado de combate — fonte única, igual à do servidor.
 * Calcular isso solto em cada lugar faria previsão, simulação e modo offline
 * divergirem.
 */
/**
 * Fração da velocidade dentro da água (espelha `WATER_SPEED_FACTOR` do
 * servidor). A água é navegável por todo mundo; só custa 20% de velocidade.
 */
export const WATER_SPEED_FACTOR = 0.8;

export function movementFactor(attacking, charging, inWater = false) {
    let fator = 1;
    if (attacking) fator = ATTACK_MOVE_FACTOR;
    else if (charging) fator = CHARGE_MOVE_FACTOR;

    // Terreno multiplica o estado de combate. Como o fator é recalculado a
    // partir da `rank.speed` a cada quadro, entrar e sair da água não acumula
    // nada — fora da água a conta simplesmente não tem o 0,8.
    return inWater ? fator * WATER_SPEED_FACTOR : fator;
}

/**
 * Modos de jogo. A ORDEM é contrato de rede (é o índice que trafega em
 * `ArenaState.mode`); modo novo entra no fim. As regras de cada modo ainda não
 * existem — por ora o modo é só o rótulo da sala.
 */
export const GAME_MODES = ['team_deathmatch', 'capture_the_flag', 'free_for_all'];

export const GAME_MODE_LABELS = {
    team_deathmatch: 'Team Deathmatch',
    capture_the_flag: 'Rouba Bandeira',
    free_for_all: 'Todos contra Todos'
};

/** Padrão e fallback: é o comportamento que o jogo já tem hoje. */
export const DEFAULT_GAME_MODE = 'team_deathmatch';

// ---------------------------------------------------------------------------
// GOLPE: LEVE <-> CARREGADO  (espelho de `constants.ts` do servidor)
//
// Toda a diferença entre o toque no botão e a carga cheia sai de um número:
// `power`, de 0 a 1 (= tempo segurado / `chargeTime` do rank, limitado em 1).
// O clamp é o teto absoluto de dano, área, empurrão e tempos.
//
// Mudar aqui sem mudar lá faz o cliente desenhar um golpe do tamanho errado.
// ---------------------------------------------------------------------------

/**
 * TEMPORÁRIO: ataque carregado desligado (espelha `CHARGED_ATTACK_ENABLED` do
 * servidor — as duas precisam ter o mesmo valor).
 *
 * Com `false`, apertar o botão já dispara o golpe leve e ninguém entra em
 * estado de carga. Nada da máquina de carga foi removido: voltar a flag para
 * `true` nos dois lados devolve o comportamento.
 */
export const CHARGED_ATTACK_ENABLED = false;

/**
 * Rank que atravessa estrutura durante o dash — o salto do cavalo do xadrez.
 * Espelha `DASH_PHASE_RANK`/`canPhaseDash` do servidor: é regra da PEÇA, então
 * vale para jogador e bot, e some quando ela promove.
 */
export const DASH_PHASE_RANK = 'HORSE';

/** O rank atravessa parede durante o dash? */
export function canPhaseDash(rankKey) {
    return rankKey === DASH_PHASE_RANK;
}

/** Abates que decidem uma partida de `team_deathmatch` (espelha o servidor). */
export const TEAM_KILL_LIMIT = 40;

export const DAMAGE_LIGHT = 25;
export const DAMAGE_MAX = 50;
export const DAMAGE_CHARGE_EXP = 1.6;

export const AREA_MULT_LIGHT = 1;
export const AREA_MULT_MAX = 2;
export const AREA_CHARGE_EXP = 1;

export const ATTACK_WINDUP_LIGHT_MS = 160;
export const ATTACK_WINDUP_MAX_MS = 260;

export const ATTACK_RECOVERY_LIGHT_MS = 60;
export const ATTACK_RECOVERY_MAX_MS = 340;

// ---------------------------------------------------------------------------
// DIREÇÃO DO GOLPE (espelho de `constants.ts` do servidor)
//
// O golpe já saiu preso ao eixo X (a direção era o `flipX`: leste ou oeste) e
// depois passou por uma fase de OITO direções, em que o vetor da mira era
// encaixado no múltiplo de 45° mais próximo. Hoje não há encaixe nenhum: a
// direção é o ÂNGULO do vetor de mira, contínuo em todos os 360°.
//
// O que trafega é o ÂNGULO EM RADIANOS já decidido pelo servidor
// (`ActorState.atkAngle`, float32): o cliente desenha exatamente o número que
// gerou o dano, então não há conta repetida de cada lado para divergir. O que
// o cliente MANDA continua sendo o vetor cru da mira (`ax`/`ay` no pacote de
// entrada).
// ---------------------------------------------------------------------------

/**
 * Módulo mínimo do vetor de mira para ele valer como direção.
 *
 * Abaixo disto o toque conta como "sem mira" e o golpe sai para onde a peça
 * olha (o `flipX`), que é o comportamento de sempre — é o que mantém o teclado
 * exatamente como era.
 */
export const ATTACK_AIM_DEADZONE = 0.35;

/**
 * Direção do golpe, em radianos, a partir do vetor de mira. SEM quantização:
 * o ângulo é o do vetor, e não o múltiplo de 45° mais próximo.
 *
 * Espelha `attackAimAngle` de `constants.ts`. Usada pelo jogador E pelos bots
 * offline (`AIPlayer`, que preenche o mesmo `_aimDx`/`_aimDy` mirando no
 * alvo). Vetor não finito, zerado ou dentro da zona morta cai no `flipX`.
 *
 * @param {boolean} flipX A peça olha para oeste?
 */
export function attackAimAngle(ax, ay, flipX) {
    if (Number.isFinite(ax) && Number.isFinite(ay)
        && Math.hypot(ax, ay) >= ATTACK_AIM_DEADZONE) {
        return Math.atan2(ay, ax);
    }
    return flipX ? Math.PI : 0;
}

/**
 * Espera MÍNIMA entre o início de dois golpes, em ms (espelha
 * `ATTACK_INTERVAL` do servidor — as duas precisam ter o mesmo valor, senão a
 * previsão local desanda).
 *
 * Segurar o controle NÃO repete golpe: cada golpe custa uma mira nova. Este
 * piso é o teto de CADÊNCIA para quem mira rápido (e para cliente adulterado);
 * sem ele seriam windup + recuperação do golpe leve, 160 + 60 = 220 ms, ou 4,5
 * golpes por segundo. Com 420 ms dá ~2,4 por segundo.
 *
 * Entra como PISO do `_attackReadyAt`, o mesmo gate que já era o freio de spam
 * — não existe um segundo temporizador. Bots não são afetados: o cooldown deles
 * (700 ms) é maior, e vale o maior dos dois.
 */
export const ATTACK_INTERVAL = 420;

/** Potência (0..1) do tempo de carga cumprido, já com o teto aplicado. */
export function chargePower(elapsedMs, chargeTimeMs) {
    if (!(chargeTimeMs > 0)) return 1;
    return Math.min(1, Math.max(0, elapsedMs / chargeTimeMs));
}

function scaleByCharge(power, min, max, exp) {
    const p = Math.min(1, Math.max(0, power));
    return min + (max - min) * Math.pow(p, exp);
}

export function chargeDamage(power) {
    return scaleByCharge(power, DAMAGE_LIGHT, DAMAGE_MAX, DAMAGE_CHARGE_EXP);
}

export function chargeAreaMult(power) {
    return scaleByCharge(power, AREA_MULT_LIGHT, AREA_MULT_MAX, AREA_CHARGE_EXP);
}

export function attackWindupMs(power) {
    return scaleByCharge(power, ATTACK_WINDUP_LIGHT_MS, ATTACK_WINDUP_MAX_MS, 1);
}

export function attackRecoveryMs(power) {
    return scaleByCharge(power, ATTACK_RECOVERY_LIGHT_MS, ATTACK_RECOVERY_MAX_MS, 1);
}

/**
 * DASH / ESQUIVA — espelho de `chess-armageddon-server/src/sim/constants.ts`.
 *
 * A distância e a duração precisam bater com o servidor: é com elas que a
 * previsão local move o boneco antes do `dashing` voltar no estado. Se
 * divergirem, o cliente anda diferente do servidor e a reconciliação corrige
 * na cara do jogador.
 *
 * O cooldown aqui é só o denominador do indicador circular do botão e o valor
 * usado pelo modo offline; quem recusa um dash cedo demais é o servidor.
 */
export const DASH_DISTANCE = 220;
export const DASH_DURATION_MS = 220;
export const DASH_SPEED = DASH_DISTANCE / (DASH_DURATION_MS / 1000);
/** Teto de segurança do dash; quem manda na distância é DASH_DISTANCE. */
export const DASH_TIMEOUT_MS = DASH_DURATION_MS * 2;

export const DASH_COOLDOWN_MS = 1500;
export const DASH_INVULN_MS = 160;

/** Só no offline: online quem cronometra o bot é o servidor. */
export const BOT_DASH_COOLDOWN_MS = 3000;
export const BOT_DODGE_CHANCE = 0.35;
export const BOT_DODGE_REACTION_MS = 90;
export const BOT_DODGE_RANGE_SLACK = 1.25;

export const RANKS = {
    PAWN: {
        key: 'pawn',
        speed: 200,
        size: { width: 128, height: 128 },
        hitbox: { width: 128/2, height: 128/2 },
        health: 100,
        mass: 1,
        attack: {
            type: 'rectangle',
            length: 80,
            width: 50
        },
        chargeTime: 1000,
        next: 'TOWER'
    },
    TOWER: {
        key: 'tower',
        speed: 140,
        size: { width: 160, height: 160 },
        hitbox: { width: 160/2, height: 160/2 },
        health: 200,
        mass: 4,
        attack: {
            type: 'circle',
            radius: 120
        },
        chargeTime: 1500,
        next: 'HORSE'
    },
    HORSE: {
        key: 'horse',
        speed: 280,
        size: { width: 144, height: 144 },
        hitbox: { width: 144/2, height: 144/2 },
        health: 125,
        mass: 1.6,
        attack: {
            type: 'lshape',
            forwardLength: 80,
            sideLength: 60,
            width: 50
        },
        chargeTime: 1200,
        next: 'BISHOP'
    },
    BISHOP: {
        key: 'bishop',
        speed: 200,
        size: { width: 144, height: 144 },
        hitbox: { width: 144/2, height: 144/2 },
        health: 150,
        mass: 1.8,
        attack: {
            type: 'diamond',
            radius: 100
        },
        chargeTime: 1500,
        next: 'QUEEN'
    },
    QUEEN: {
        key: 'queen',
        speed: 250,
        size: { width: 160, height: 160 },
        hitbox: { width: 160/2, height: 160/2 },
        health: 200,
        mass: 3,
        attack: {
            type: 'circle',
            radius: 150
        },
        chargeTime: 2000,
        next: null
    }
};

// Aura concedida ao abater cada tipo de inimigo
export const AURA_KILL_VALUES = {
    pawn: 10,
    tower: 20,
    horse: 30,
    bishop: 40,
    queen: 50
};

// Limiares mínimos de aura para cada cor
export const AURA_THRESHOLDS = [
    { minAura: 10,  color: 0xffffff }, // branco
    { minAura: 30,  color: 0xffff00 }, // amarelo
    { minAura: 60,  color: 0x00ff00 }, // verde claro
    { minAura: 100, color: 0x0000ff }, // azul
    { minAura: 150, color: 0x800080 }, // roxo
    { minAura: 210, color: 0xdc143c }  // vinho (crimson)
];
/**
 * Ordem dos ranks tal como o servidor a envia no campo `rank` (uint8).
 * A ordem NÃO pode mudar sem mudar `RANK_ORDER` no servidor junto.
 */
export const RANK_ORDER = ['PAWN', 'TOWER', 'HORSE', 'BISHOP', 'QUEEN'];

// ---------------------------------------------------------------------------
// EXPERIÊNCIA E NÍVEL (espelho de `constants.ts` do servidor)
//
// Nível e rank são a mesma coisa: nível 1 é peão, MAX_LEVEL é rainha, na ordem
// de `RANK_ORDER`. Por isso o nível não é guardado nem trafega — deriva do
// rank, e a XP acumulada é que decide o rank.
// ---------------------------------------------------------------------------

export const XP_PER_KILL = 30;
export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = RANK_ORDER.length;

export function levelFromXp(xp) {
    const nivel = Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
    return Math.min(nivel, MAX_LEVEL);
}

/** Nível de um rank, pelo lugar dele em `RANK_ORDER`. */
export function levelFromRank(rank) {
    const i = RANK_ORDER.indexOf(String(rank.key).toUpperCase());
    return (i < 0 ? 0 : i) + 1;
}

export function rankKeyForLevel(level) {
    const i = Math.min(MAX_LEVEL, Math.max(1, Math.round(level))) - 1;
    return RANK_ORDER[i];
}

/**
 * Progresso DENTRO do nível atual, que é o que a barra desenha: a XP total
 * passa de 100 e encheria a barra para sempre. No nível máximo devolve cheia,
 * porque não existe próximo nível para calcular.
 */
export function xpProgress(xp) {
    const level = levelFromXp(xp);
    if (level >= MAX_LEVEL) {
        return { level, into: XP_PER_LEVEL, need: XP_PER_LEVEL, max: true };
    }
    return {
        level,
        into: Math.max(0, xp) - (level - 1) * XP_PER_LEVEL,
        need: XP_PER_LEVEL,
        max: false
    };
}


/**
 * Ordem dos times tal como o servidor os envia no campo `team` (uint8).
 * Espelha `TEAM_INDEX` em `src/sim/constants.ts` — mudar de um lado só troca
 * a cor de todo mundo.
 */
export const TEAM_ORDER = ['ally', 'enemy'];

/**
 * Sufixo do spritesheet de cada time. O time `enemy` veste as peças escuras
 * (`assets/*_b.png`), carregadas sob a chave `<rank>_black`; o `ally` usa as
 * claras, sem sufixo.
 */
const TEAM_SKIN_SUFFIX = {
    ally: '',
    enemy: '_black'
};

/**
 * Chave da textura de uma peça conforme rank e time.
 *
 * Qualquer time que não seja `enemy` recebe a peça clara — inclusive o
 * `'human'` do `HumanPlayer`, que joga pelos aliados apesar do nome.
 */
export function skinKey(rankKey, team) {
    return `${rankKey}${TEAM_SKIN_SUFFIX[team] || ''}`;
}

/**
 * Alcance do golpe, do centro da elipse até a ponta da forma.
 *
 * Espelha `attackReach()` do servidor. Serve para a IA decidir QUANDO bater —
 * o dano continua saindo da geometria exata de `executeAttackHit()`. Antes a
 * IA usava 100 px fixos para todo rank: o peão (alcance 80) atacava fora e a
 * rainha (150) só colada.
 */
export function attackReach(rank) {
    const atk = rank.attack;
    switch (atk.type) {
        case 'rectangle': return atk.length;
        case 'circle': return atk.radius;
        case 'lshape': return atk.forwardLength;
        case 'diamond': return atk.radius;
        default: return 0;
    }
}

/**
 * Meia-altura (em Y) da área que o golpe cobre. Espelha `attackHalfBand()`.
 *
 * Golpes retos (peão, cavalo) só acertam quem está na faixa à frente; os
 * radiais (torre, bispo, rainha) pegam em volta e não têm restrição — daí o
 * `Infinity`, que dispensa um `if` na comparação.
 */
export function attackHalfBand(rank) {
    const atk = rank.attack;
    switch (atk.type) {
        case 'rectangle': return atk.width / 2;
        case 'lshape': return atk.width / 2 + atk.sideLength / 2;
        default: return Infinity;
    }
}

/**
 * Dano de um golpe. Espelha `DAMAGE_NORMAL`/`DAMAGE_CHARGED` do servidor.
 *
 * Estavam escritos à mão dentro de `executeAttackHit`; a IA precisa deles para
 * saber quando o carregado mata e o normal não, e duas cópias do número
 * acabariam divergindo.
 */
/** Extremos da escala, usados pela IA ao decidir se vale carregar. */
export const DAMAGE_NORMAL = DAMAGE_LIGHT;
export const DAMAGE_CHARGED = DAMAGE_MAX;

/**
 * Empurrão do golpe. Espelha as constantes de mesmo nome em `constants.ts`.
 *
 * `KNOCKBACK_SPEED` é a velocidade inicial, em px/s, de um golpe normal sobre
 * uma peça de massa 1 (o peão); o empurrão decai exponencialmente com
 * `KNOCKBACK_DECAY_MS` de constante de tempo, então o deslocamento total é
 * aproximadamente `velocidade * (KNOCKBACK_DECAY_MS / 1000)` — cerca de 63 px
 * num peão, 113 no golpe carregado.
 */
export const KNOCKBACK_SPEED = 420;

/**
 * Quanto o golpe carregado empurra a mais. Deliberadamente MENOR que o
 * multiplicador de dano (que é 2): dobrar dano e empurrão juntos arremessaria
 * o alvo para fora da briga, sem chance de revidar.
 */
export const KNOCKBACK_CHARGED_FACTOR = 1.8;

/** Expoente do empurrão: entre o do dano (1,6) e o da área (1). */
export const KNOCKBACK_CHARGE_EXP = 1.3;

export const KNOCKBACK_DECAY_MS = 150;

/** Abaixo disto o empurrão é zerado, para o alvo não ficar à deriva. */
export const KNOCKBACK_MIN_SPEED = 5;

/**
 * Velocidade inicial do empurrão sobre um alvo de massa `targetMass`.
 *
 * Divide pela RAIZ da massa, e não pela massa: com a massa crua a torre
 * (massa 4) mal se mexeria enquanto o peão (massa 1) voaria quatro vezes mais
 * longe. A raiz mantém a diferença perceptível sem ficar discrepante.
 */
export function knockbackSpeed(power, targetMass) {
    const fator = scaleByCharge(power, 1, KNOCKBACK_CHARGED_FACTOR, KNOCKBACK_CHARGE_EXP);
    return (KNOCKBACK_SPEED * fator) / Math.sqrt(Math.max(targetMass, 0.01));
}
