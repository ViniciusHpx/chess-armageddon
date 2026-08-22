/**
 * Brilho de carga do ataque, compartilhado pelos dois modos.
 *
 * `PlayerBase` (offline) e `ArenaActor` (online) são hierarquias separadas — um
 * tem corpo Arcade, o outro nem física tem — mas o indicador precisa ser o
 * mesmo, senão o jogador aprende a ler a carga num modo e erra no outro. Por
 * isso mora aqui como função sobre um `Graphics` qualquer, como o `DashFx`.
 *
 * Três coisas crescem junto com a potência, para dar para ler o poder do golpe
 * sem contar segundos:
 *
 *   1. o raio do ponto;
 *   2. a cor, de branco a vermelho;
 *   3. um anel que fecha a volta como um medidor.
 *
 * Na carga máxima entra o único efeito extra: um pulso branco por cima,
 * dizendo que continuar segurando não rende mais nada. É barato — o `Graphics`
 * já era limpo e redesenhado a cada quadro, e nada aqui cria objeto novo.
 */

/** Raio do ponto central, do toque à carga cheia. */
const RAIO_MIN = 5;
const RAIO_MAX = 11;

/**
 * @param {Phaser.GameObjects.Graphics} g Já limpo pelo chamador.
 * @param {number} x
 * @param {number} y
 * @param {number} ratio Progresso da carga, 0..1.
 * @param {number} nowMs Relógio da cena, só para o pulso da carga máxima.
 */
export function paintChargeGlow(g, x, y, ratio, nowMs) {
    const t = Phaser.Math.Clamp(ratio, 0, 1);

    // Branco -> laranja -> vermelho conforme carrega.
    const verde = Phaser.Math.Linear(255, 40, t);
    const azul = Phaser.Math.Linear(255, 0, t);
    const cor = Phaser.Display.Color.GetColor(255, verde, azul);

    const raio = Phaser.Math.Linear(RAIO_MIN, RAIO_MAX, t);

    g.fillStyle(cor, 0.9);
    g.fillCircle(x, y, raio);

    // Anel-medidor: a volta se fecha exatamente na carga máxima.
    const inicio = -Math.PI / 2;
    g.lineStyle(3, cor, 0.95);
    g.beginPath();
    g.arc(x, y, raio + 5, inicio, inicio + Math.PI * 2 * t, false);
    g.strokePath();

    if (t < 1) return;

    // Carga máxima: pulso branco. Sem tween nem partícula — só um raio que
    // oscila com o relógio da cena, então não sobra estado para limpar.
    const pulso = 1 + 0.18 * Math.sin(nowMs / 90);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeCircle(x, y, (raio + 9) * pulso);
}
