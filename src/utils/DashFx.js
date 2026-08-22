/**
 * Feedback visual do dash, compartilhado pelos dois modos.
 *
 * `PlayerBase` (offline) e `ArenaActor` (online) são hierarquias separadas —
 * uma tem corpo Arcade, a outra nem sprite de física é — mas o efeito é o
 * mesmo, e ele só precisa de um `Sprite` qualquer. Por isso mora aqui como
 * função, e não como método duplicado nas duas classes.
 *
 * São dois elementos, os dois disparados uma única vez por dash (evento, não
 * por quadro):
 *
 *   1. squash/stretch — o boneco se estica no sentido do movimento e volta;
 *   2. fantasmas — poucas cópias paradas que desaparecem, dando o rastro.
 *
 * Os fantasmas são criados e destruídos por dash em vez de virem de um pool:
 * com cooldown de 1,5 s e no máximo TEAM_SIZE * 2 personagens, o pior caso é
 * da ordem de uma dezena de sprites por segundo, e cada um morre no
 * `onComplete` do próprio tween. Um pool aqui custaria mais código do que
 * economiza.
 */

/** Quantos fantasmas por dash. Três já lê como rastro; mais vira borrão. */
const GHOST_COUNT = 3;

/** Espaçamento entre os fantasmas, em ms. */
const GHOST_GAP_MS = 45;

const GHOST_FADE_MS = 220;

/**
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Sprite} sprite Quem deu o dash.
 * @param {number} dirX Direção do dash (unitária) — define o eixo do stretch.
 * @param {number} dirY
 */
export function playDashFx(scene, sprite, dirX = 0, dirY = 0) {
    if (!scene || !sprite || !sprite.scene) return;

    stretch(scene, sprite, dirX, dirY);

    for (let i = 0; i < GHOST_COUNT; i++) {
        // O primeiro sai já; os outros seguem o boneco e marcam o caminho.
        scene.time.delayedCall(i * GHOST_GAP_MS, () => spawnGhost(scene, sprite));
    }
}

/**
 * Estica no eixo dominante do movimento e volta. `yoyo` em cima da escala atual
 * do sprite, não de 1: os ranks têm tamanhos diferentes e alguns são espelhados
 * em X (`flipX` não mexe na escala, mas um tween que assume 1 quebraria se
 * algum dia mexerem nela).
 */
function stretch(scene, sprite, dirX, dirY) {
    const horizontal = Math.abs(dirX) >= Math.abs(dirY);
    const baseX = sprite.scaleX;
    const baseY = sprite.scaleY;

    scene.tweens.add({
        targets: sprite,
        scaleX: horizontal ? baseX * 1.18 : baseX * 0.88,
        scaleY: horizontal ? baseY * 0.88 : baseY * 1.18,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
            // O tween pode ser interrompido (morte, troca de rank no meio):
            // devolver a escala na mão evita deixar a peça achatada.
            sprite.setScale(baseX, baseY);
        }
    });
}

function spawnGhost(scene, sprite) {
    if (!sprite.scene || !sprite.visible) return;

    const ghost = scene.add.image(sprite.x, sprite.y, sprite.texture.key);
    ghost.setScale(sprite.scaleX, sprite.scaleY);
    ghost.setFlipX(sprite.flipX);
    ghost.setOrigin(sprite.originX, sprite.originY);
    ghost.setDepth(sprite.depth - 1);
    ghost.setAlpha(0.45);
    ghost.setTint(0xbfd8ff);

    scene.tweens.add({
        targets: ghost,
        alpha: 0,
        duration: GHOST_FADE_MS,
        ease: 'Linear',
        onComplete: () => ghost.destroy()
    });
}
