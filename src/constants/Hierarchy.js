/**
 * ATENÇÃO: no modo online quem manda é
 * `chess-armageddon-server/src/sim/constants.ts`. Este arquivo é a cópia que o
 * cliente usa para DESENHAR (textura, tamanho, forma do golpe) e para rodar o
 * modo offline (cena `Start`). Se um número mudar lá, espelhe aqui — senão o
 * golpe acerta fora do que aparece na tela.
 */
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

/** Dimensões do mapa. Espelha WORLD_WIDTH/WORLD_HEIGHT do servidor. */
export const WORLD_WIDTH = 3548;
export const WORLD_HEIGHT = 1774;
