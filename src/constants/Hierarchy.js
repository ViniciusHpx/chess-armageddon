export const RANKS = {
    PAWN: {
        key: 'pawn',
        speed: 200,
        size: { width: 128, height: 128 },
        hitbox: { width: 128/2, height: 128/2 },
        health: 100,
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