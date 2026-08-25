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

/**
 * O ponto está dentro do castelo deste time? Espelha `insideSpawnZone` do
 * servidor: a zona do `enemy` é o espelho em X, e qualquer outro time (o
 * `'human'` do modo offline, que joga pelos aliados) usa a da esquerda —
 * mesma convenção de `skinKey` e de `MapCollider.findSpawn`.
 */
export function insideSpawnZone(team, x, y) {
    const bruteX = team === 'enemy' ? WORLD_WIDTH - x : x
    return bruteX >= SPAWN_ZONE.minX && bruteX <= SPAWN_ZONE.maxX
        && y >= SPAWN_ZONE.minY && y <= SPAWN_ZONE.maxY
}

/** Vida por segundo recuperada no próprio castelo (espelha o servidor). */
export const BASE_HEAL_PER_SECOND = 20
