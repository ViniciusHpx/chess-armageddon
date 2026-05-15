export const RANKS = {
    PAWN: {
        key: 'pawn',
        speed: 200,     // Velocidade de movimento em pixels/segundo
        next: 'TOWER',  // Próximo estado na evolução
        hitbox: { width: 40, height: 40, offset: 50}    // Dimensões e distância do ataque
    },
    TOWER: {
        key: 'tower',
        speed: 140,
        next: 'HORSE',
        hitbox: { width: 80, height: 80, offset: 30}
    },
    HORSE: {
        key: 'horse',
        speed: 280,
        next: 'PAWN',   // Loop retorna ao início
        hitbox: { with: 50, height: 50, offset: 60}
    }
}