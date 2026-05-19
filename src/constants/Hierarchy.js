export const RANKS = {
    PAWN: {
        key: 'pawn',
        speed: 200,
        next: 'TOWER',
        hitbox: { width: 40, height: 40, offset: 50 },
        health: 100,
        attack: {
            type: 'rectangle',      // ataque retangular para frente
            length: 80,             // alcance para frente
            width: 50               // largura lateral
        }
    },
    TOWER: {
        key: 'tower',
        speed: 140,
        next: 'HORSE',
        hitbox: { width: 80, height: 80, offset: 30 },
        health: 200,
        attack: {
            type: 'circle',         // círculo ao redor do jogador
            radius: 120
        }
    },
    HORSE: {
        key: 'horse',
        speed: 280,
        next: 'PAWN',
        hitbox: { width: 50, height: 50, offset: 60 },
        health: 125,
        attack: {
            type: 'lshape',         // ataque em "L"
            forwardLength: 80,      // comprimento do segmento frontal
            sideLength: 60,         // comprimento do segmento lateral
            width: 50               // largura dos segmentos
        }
    }
};

export const COLLISION_ELLIPSE = {
    RX: 50,
    RY: 25
};