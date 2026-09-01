/**
 * Barra de vida por cima do personagem, compartilhada pelos dois modos.
 *
 * Mesmo padrão do [ChargeGlow](ChargeGlow.js) e do [DashFx](DashFx.js):
 * `PlayerBase` (offline) e `ArenaActor` (online) são hierarquias separadas, e o
 * desenho é o mesmo — deixá-lo aqui evita as duas cópias divergirem.
 *
 * ## Coordenadas LOCAIS
 *
 * A diferença em relação ao que existia: os retângulos são desenhados em volta
 * de (0, 0), e quem coloca a barra em cima do personagem é a POSIÇÃO do próprio
 * `Graphics` (`setPosition`). Antes eles eram desenhados nas coordenadas de
 * mundo do personagem, o que obrigava a limpar e redesenhar tudo a cada quadro
 * só porque ele andou.
 *
 * Com a barra em coordenadas locais, andar é mover um objeto — uma escrita de
 * transformação, que o Phaser já faz para qualquer sprite — e o desenho só é
 * refeito quando a VIDA muda. Os pixels na tela são exatamente os de antes: a
 * barra continua com 40 × 5, centrada no X do personagem e 70 px acima do Y.
 */

/** Largura e altura da barra, em pixels de mundo. */
export const HEALTH_BAR_WIDTH = 40;
export const HEALTH_BAR_HEIGHT = 5;

/** Altura da barra em relação ao Y do personagem. */
export const HEALTH_BAR_OFFSET_Y = -70;

/**
 * Redesenha a barra. Chamar apenas quando a fração de vida muda.
 *
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} percent Vida restante, 0..1.
 */
export function paintHealthBar(g, percent) {
    const cheio = Math.max(0, Math.min(1, percent));
    const esquerda = -HEALTH_BAR_WIDTH / 2;

    g.clear();

    g.fillStyle(0x000000, 0.7);
    g.fillRect(esquerda, 0, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

    g.fillStyle(0xff0000, 1);
    g.fillRect(esquerda, 0, HEALTH_BAR_WIDTH * cheio, HEALTH_BAR_HEIGHT);
}
