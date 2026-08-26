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
 * Área que RECUPERA VIDA, no fundo do pátio de cada castelo. Espelha
 * `HEAL_ZONE` do servidor (`chess-armageddon-server/src/sim/constants.ts`).
 *
 * NÃO é a `SPAWN_ZONE` acima: aquela é larga de propósito e transborda o
 * portão (vai até y 1400, já no campo aberto ao sul do castelo). Este
 * retângulo é o miolo do pátio, recuado da entrada — é preciso atravessar o
 * portão e avançar para dentro antes de a regeneração ligar.
 *
 * É este mesmo retângulo que `HealZoneFx` desenha como névoa verde, então
 * área visual e área real são literalmente o mesmo número: não há como uma
 * mudar sem a outra.
 */
export const HEAL_ZONE = { minX: 220, maxX: 840, minY: 540, maxY: 980 }

/**
 * O ponto está na área de cura do castelo deste time? Espelha
 * `insideHealZone` do servidor: a zona do `enemy` é o espelho em X, e
 * qualquer outro time (o `'human'` do modo offline, que joga pelos aliados)
 * usa a da esquerda — mesma convenção de `skinKey` e de
 * `MapCollider.findSpawn`.
 */
export function insideHealZone(team, x, y) {
    const bruteX = team === 'enemy' ? WORLD_WIDTH - x : x
    return bruteX >= HEAL_ZONE.minX && bruteX <= HEAL_ZONE.maxX
        && y >= HEAL_ZONE.minY && y <= HEAL_ZONE.maxY
}

/**
 * Vida por segundo recuperada no próprio castelo (espelha o servidor).
 *
 * Era 20/s — peão inteiro em 5 s. A 12/s o peão leva 8,3 s e a torre 16,7 s:
 * voltar inteiro à briga custa tempo. Mexer aqui exige mexer no servidor
 * junto; ele é quem manda no modo online.
 */
export const BASE_HEAL_PER_SECOND = 12
