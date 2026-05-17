export const RANKS = {
    PAWN: {
        key: 'pawn',
        speed: 200,
        next: 'TOWER',
        hitbox: { width: 40, height: 40, offset: 50 },
        health: 100      // Vida máxima do peão
    },
    TOWER: {
        key: 'tower',
        speed: 140,
        next: 'HORSE',
        hitbox: { width: 80, height: 80, offset: 30 },
        health: 200      // Vida máxima da torre
    },
    HORSE: {
        key: 'horse',
        speed: 280,
        next: 'PAWN',
        hitbox: { width: 50, height: 50, offset: 60 },  // corrigido "with" -> "width"
        health: 125      // Vida máxima do cavalo
    }
}

export const COLLISION_ELLIPSE = {
    RX: 50,   // raio horizontal
    RY: 25    // raio vertical
};