export const ARENA_PATH = 'assets/arena.png'
export const COLLISION_PATH = 'assets/arena_collision.png'

export const HALF_WORLD_WIDTH = 2496
export const WORLD_WIDTH = 4992
export const WORLD_HEIGHT = 1684

/**
 * Área de nascimento dentro do castelo, espelho de `SPAWN_ZONE` do servidor
 * (`chess-armageddon-server/src/sim/constants.ts`).
 *
 * O retângulo é generoso: quem garante que ninguém nasce em cima das
 * construções do pátio é a máscara de colisão, validando cada sorteio. O time
 * `enemy` usa o espelho em X, como o resto do mapa.
 */
export const SPAWN_ZONE = { minX: 150, maxX: 900, minY: 560, maxY: 1400 }

export const SPAWN_ATTEMPTS = 40
