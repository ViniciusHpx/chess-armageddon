/**
 * Resolve a colisão corpo-a-corpo entre os personagens usando a ELIPSE de cada
 * um, e não o retângulo do corpo Arcade.
 *
 * Por que não usar `physics.add.collider`: o corpo Arcade é um retângulo
 * (`setSize(rx * 2, ry * 2)`) que apenas circunscreve a elipse real. Isso causa
 * dois defeitos visíveis: colisão fantasma nos cantos (os bonecos param sem se
 * encostar) e separação sempre no eixo X ou Y, que faz um personagem "enganchar"
 * no outro em vez de contorná-lo.
 *
 * Truque do espaço circular: todas as elipses do jogo têm a mesma proporção
 * (rx = ELLIPSE_RATIO * ry), porque `applyRankPhysics` escala a base 50x25 pelo
 * mesmo fator em X e em Y — todos os ranks têm sprites quadrados. Multiplicando
 * o eixo Y por ELLIPSE_RATIO, cada elipse vira um círculo de raio `collisionRx`
 * e a separação vira um empurrão radial simples: exato, sem aproximação.
 *
 * Deve ser chamado no evento 'postupdate' da cena (depois de a física já ter
 * sincronizado os sprites) e ANTES do clamp nos limites do mundo.
 */

/** Proporção rx/ry compartilhada por todas as elipses. Ver `applyRankPhysics`. */
export const ELLIPSE_RATIO = 2;

/** Passes de resolução por frame — mais passes acomodam melhor aglomerados. */
const ITERATIONS = 3;

/** Fração da sobreposição corrigida por passe (< 1 suaviza o empurrão). */
const SEPARATION_STRENGTH = 0.8;

/** Sobreposição ignorada, em pixels: evita micro-correções e tremedeira. */
const OVERLAP_SLOP = 0.5;

/** Distância abaixo da qual os centros são considerados coincidentes. */
const EPSILON = 0.0001;

/** Ângulo áureo: espalha os desempates de forma determinística. */
const GOLDEN_ANGLE = 2.39996;

export default class CollisionResolver {
    /**
     * @param {Phaser.Scene} scene
     * @param {Phaser.Physics.Arcade.Group[]} groups Grupos que colidem entre si e internamente.
     */
    constructor(scene, groups) {
        this.scene = scene;
        this.groups = groups;
    }

    update() {
        const entries = this.collectEntries();
        if (entries.length < 2) return;

        for (let pass = 0; pass < ITERATIONS; pass++) {
            let separatedAny = false;

            for (let i = 0; i < entries.length - 1; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    if (this.separate(entries[i], entries[j])) separatedAny = true;
                }
            }

            // Nenhum par se sobrepõe: não adianta gastar os passes restantes.
            if (!separatedAny) break;
        }

        this.applyCorrections(entries);
    }

    /**
     * Fotografa a posição de todos os personagens vivos no espaço circular.
     * Trabalhamos em cópias para que os passes seguintes enxerguem as correções
     * dos anteriores — `body.center` só é recalculado no próximo frame.
     */
    collectEntries() {
        const entries = [];

        for (const group of this.groups) {
            for (const actor of group.getChildren()) {
                if (!actor.active || !actor.body || !actor.body.enable) continue;

                const center = actor.getEllipseCenter();
                const y = center.y * ELLIPSE_RATIO;

                entries.push({
                    actor,
                    index: entries.length,
                    x: center.x,
                    y,
                    startX: center.x,
                    startY: y,
                    radius: actor.collisionRx,
                    mass: actor.getCollisionMass()
                });
            }
        }

        return entries;
    }

    /**
     * Separa um par no espaço circular.
     * @returns {boolean} true se houve sobreposição relevante.
     */
    separate(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;

        if (distSq >= minDist * minDist) return false;

        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        if (overlap < OVERLAP_SLOP) return false;

        let nx;
        let ny;

        if (dist > EPSILON) {
            nx = dx / dist;
            ny = dy / dist;
        } else {
            // Centros coincidentes (spawn/respawn em cima um do outro): sem uma
            // direção definida os dois ficariam travados. Escolhemos um ângulo
            // determinístico para que o desempate seja estável entre frames.
            const angle = (a.index + b.index) * GOLDEN_ANGLE;
            nx = Math.cos(angle);
            ny = Math.sin(angle);
        }

        const push = overlap * SEPARATION_STRENGTH;

        // Cada personagem absorve a fração correspondente à massa DO OUTRO:
        // o mais pesado cede menos. Uma torre praticamente não sai do lugar
        // quando um peão a empurra.
        const totalMass = a.mass + b.mass;
        const aShare = b.mass / totalMass;
        const bShare = a.mass / totalMass;

        a.x -= nx * push * aShare;
        a.y -= ny * push * aShare;
        b.x += nx * push * bShare;
        b.y += ny * push * bShare;

        return true;
    }

    /** Devolve as correções ao mundo, convertendo Y de volta do espaço circular. */
    applyCorrections(entries) {
        for (const entry of entries) {
            const dx = entry.x - entry.startX;
            const dy = (entry.y - entry.startY) / ELLIPSE_RATIO;

            if (dx === 0 && dy === 0) continue;

            entry.actor.x += dx;
            entry.actor.y += dy;

            // `getEllipseCenter()` lê de `body.center`, que só seria recalculado
            // no `preUpdate` do próximo frame. Ressincronizamos agora para que
            // hitbox, ataque e desenho enxerguem a posição já corrigida.
            entry.actor.body.updateFromGameObject();
        }
    }
}
