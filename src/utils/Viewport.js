/**
 * Viewport: a única fonte de "onde ficam as coisas na TELA".
 *
 * O jogo tem duas categorias de coordenada, e elas nunca se misturam:
 *
 *   - **mundo** — personagens, mapa, colisão, spawn, zona de cura, câmera.
 *     Medido nos 4992 × 1684 de `Scenario.js`, com `setDepth(y)`. Nada aqui
 *     encosta nisso;
 *   - **tela** — tudo que tem `setScrollFactor(0)`: joystick, botões, barra de
 *     XP, placar, kill feed, status, telas de morte e de resultado. É essa a
 *     categoria que este módulo governa.
 *
 * O que separa uma da outra, na prática, é justamente o `setScrollFactor(0)`:
 * quem o tem é HUD e se posiciona pelo `Viewport`; quem não o tem é mundo e se
 * posiciona pelas coordenadas do mapa.
 *
 * ## FOV vertical fixo
 *
 * A altura lógica é SEMPRE `BASE_HEIGHT` (720). A largura lógica é derivada da
 * proporção da tela — nunca cravada:
 *
 * | Tela | Proporção | Tamanho lógico |
 * | --- | --- | --- |
 * | 1920 × 1080 | 16:9 | 1280 × 720 |
 * | 2400 × 1080 | 20:9 | 1600 × 720 |
 * | 2340 × 1080 | 19,5:9 | 1560 × 720 |
 *
 * Como a altura não muda, a escala vertical percebida do mundo também não:
 * um personagem ocupa a mesma fração da tela em qualquer aparelho. O que a
 * tela mais larga ganha é **mais área horizontal visível**, que é o pedido.
 *
 * O mecanismo é o `Scale.FIT` que o jogo já usava, com uma diferença: em vez
 * de um tamanho de jogo fixo em 1280 × 720 (que sobra barra preta nas laterais
 * de um celular 20:9), o tamanho lógico é recalculado para ter **a mesma
 * proporção da tela**. Com as proporções iguais, o FIT preenche tudo e não
 * existe barra nenhuma. Zoom continua 1 e a câmera não é tocada, então
 * `1 px de mundo = 1 px lógico` como sempre foi.
 *
 * Não se usou `Scale.RESIZE` porque ele iguala o tamanho lógico ao tamanho em
 * pixels da tela: num aparelho de 1080 de altura o jogo passaria a ter 1080 de
 * altura lógica, mostrando mais mundo na vertical (o oposto de FOV fixo) e
 * deixando todo o HUD pequeno demais. Corrigir isso exigiria zoom na câmera e
 * uma segunda câmera só para o HUD — muito mais peça móvel para chegar onde
 * o FIT já chega.
 *
 * `Scale.EXPAND` (3.90) chega ao mesmo resultado sozinho para telas mais largas
 * que a base, mas o teto de tamanho dele (`min`/`max`) é compartilhado entre o
 * tamanho LÓGICO e o tamanho em CSS: travar a altura lógica em 720 encolheria
 * o canvas na tela junto. Daí o cálculo ficar aqui, explícito.
 */

/** Altura lógica do jogo. É a constante do FOV vertical — não muda nunca. */
export const BASE_HEIGHT = 720;

/** Largura lógica na proporção de referência (16:9), que é o desktop de hoje. */
export const BASE_WIDTH = 1280;

/**
 * Limites da proporção aceita.
 *
 * Fora deles o FIT volta a deixar barra, de propósito:
 *
 * - abaixo de 4:3 está o retrato, que o jogo não suporta (a trava de verdade é
 *   a orientação do app, na etapa do Android). Sem piso, uma tela em pé viraria
 *   um jogo de 340 px de largura lógica com os botões empilhados uns sobre os
 *   outros;
 * - acima de 21:9 está o monitor ultralargo. Largura lógica é campo de visão, e
 *   campo de visão é vantagem: quem joga em 32:9 enxergaria o dobro do mapa do
 *   que quem joga no celular.
 */
export const MIN_ASPECT = 4 / 3;
export const MAX_ASPECT = 21 / 9;

/**
 * Distância padrão entre o HUD e a borda útil da tela.
 *
 * É o mesmo 16 que já estava espalhado pelo status, pelo kill feed e pela barra
 * de XP — agora com um nome só.
 */
export const HUD_MARGIN = 16;

/**
 * Tamanho lógico do jogo para uma janela de tanto por tanto.
 *
 * Função pura de propósito: é a regra inteira do FOV vertical fixo, e dá para
 * conferi-la sem navegador nenhum.
 */
export function logicalSize(larguraDaTela, alturaDaTela) {
    const bruta = (larguraDaTela > 0 && alturaDaTela > 0)
        ? larguraDaTela / alturaDaTela
        : BASE_WIDTH / BASE_HEIGHT;

    const aspecto = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, bruta));

    return { width: Math.round(BASE_HEIGHT * aspecto), height: BASE_HEIGHT };
}

/**
 * Liga o tamanho lógico do jogo ao tamanho da janela. Chamado UMA vez, no
 * `main.js`, logo depois de `new Phaser.Game()`.
 *
 * Não mede nada agora: o `main.js` já entrega a configuração com o tamanho
 * certo, e `setGameSize` antes de o `ScaleManager` subir esbarraria num canvas
 * que ainda não existe. A partir daqui quem avisa é o próprio `ScaleManager`,
 * que já escuta `resize` e `orientationchange` do navegador.
 *
 * A trava `ajustando` existe porque `setGameSize` dispara outro RESIZE: sem ela
 * a chamada se realimentaria. Com ela, o segundo passe encontra o tamanho já
 * correto e sai na comparação.
 */
export function installViewportScaling(game) {
    const scale = game.scale;
    let ajustando = false;

    const ajustar = () => {
        if (ajustando) return;

        // `parentSize` é o container do jogo, que o CSS mantém do tamanho da
        // janela. A janela é a reserva para o caso de ele ainda não ter sido
        // medido (div sem altura, antes do primeiro layout).
        const largura = scale.parentSize.width || window.innerWidth;
        const altura = scale.parentSize.height || window.innerHeight;

        const alvo = logicalSize(largura, altura);
        if (alvo.width === scale.gameSize.width && alvo.height === scale.gameSize.height) return;

        ajustando = true;
        scale.setGameSize(alvo.width, alvo.height);
        ajustando = false;
    };

    scale.on(Phaser.Scale.Events.RESIZE, ajustar);
}

/** Recortes do sistema (notch, barra de gestos), em pixels de CSS. */
function insetsDoSistema() {
    const estilo = window.getComputedStyle(document.documentElement);
    const px = (nome) => parseFloat(estilo.getPropertyValue(nome)) || 0;

    return {
        top: px('--safe-top'),
        right: px('--safe-right'),
        bottom: px('--safe-bottom'),
        left: px('--safe-left')
    };
}

/**
 * Medidas da tela para uma cena, com âncoras de canto.
 *
 * Uma instância por cena, criada na primeira consulta (`viewportOf`). Ela se
 * remede sozinha a cada RESIZE e avisa quem se inscreveu, que é como o HUD
 * inteiro se reposiciona sem ninguém guardar número de tela.
 */
export class Viewport {
    constructor(scene) {
        this.scene = scene;
        /** @type {Array<() => void>} */
        this.ouvintes = [];

        this.medir();

        this.aoRedimensionar = () => {
            this.medir();
            for (const ouvinte of this.ouvintes) ouvinte();
        };

        scene.scale.on(Phaser.Scale.Events.RESIZE, this.aoRedimensionar);
        scene.events.once('shutdown', () => this.destroy());
    }

    /**
     * Lê o tamanho lógico e converte os recortes do sistema para a mesma
     * unidade.
     *
     * O tamanho vem de `scale.gameSize`, e não de `cameras.main`: os dois valem
     * o mesmo depois que o `CameraManager` reage ao RESIZE, mas o `gameSize` já
     * está certo NO MOMENTO em que o evento é disparado, então a ordem dos
     * ouvintes deixa de importar.
     *
     * `displayScale` é quantos pixels lógicos cabem num pixel de CSS. Os
     * `env(safe-area-inset-*)` vêm em CSS, e o HUD é desenhado em lógico — sem
     * a conversão, um notch de 44 px reservaria espaço errado em toda tela cuja
     * escala não seja 1.
     */
    medir() {
        const scale = this.scene.scale;

        this.width = scale.gameSize.width;
        this.height = scale.gameSize.height;
        this.centerX = this.width / 2;
        this.centerY = this.height / 2;

        const css = insetsDoSistema();
        this.safeTop = css.top * scale.displayScale.y;
        this.safeBottom = css.bottom * scale.displayScale.y;
        this.safeLeft = css.left * scale.displayScale.x;
        this.safeRight = css.right * scale.displayScale.x;
    }

    /** Bordas da área ÚTIL: a tela menos os recortes do sistema. */
    get left() { return this.safeLeft; }
    get right() { return this.width - this.safeRight; }
    get top() { return this.safeTop; }
    get bottom() { return this.height - this.safeBottom; }

    /**
     * Âncoras de canto. Os deslocamentos contam sempre para DENTRO da tela, de
     * modo que o mesmo par de números serve nos quatro cantos e ninguém precisa
     * saber de que lado está.
     */
    topLeft(dx = 0, dy = 0) { return { x: this.left + dx, y: this.top + dy }; }
    topRight(dx = 0, dy = 0) { return { x: this.right - dx, y: this.top + dy }; }
    bottomLeft(dx = 0, dy = 0) { return { x: this.left + dx, y: this.bottom - dy }; }
    bottomRight(dx = 0, dy = 0) { return { x: this.right - dx, y: this.bottom - dy }; }

    /** Centralizado na horizontal, colado no topo útil. */
    topCenter(dy = 0) { return { x: this.centerX, y: this.top + dy }; }

    /** Centro da tela. Os deslocamentos são relativos a ele. */
    center(dx = 0, dy = 0) { return { x: this.centerX + dx, y: this.centerY + dy }; }

    /**
     * Inscreve um reposicionamento. Devolve a função que o cancela.
     *
     * O retorno raramente é usado — o `shutdown` da cena já limpa tudo —, mas
     * ele existe para quem criar HUD temporário não deixar rastro.
     */
    onResize(callback) {
        this.ouvintes.push(callback);
        return () => {
            const i = this.ouvintes.indexOf(callback);
            if (i >= 0) this.ouvintes.splice(i, 1);
        };
    }

    destroy() {
        this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.aoRedimensionar);
        this.ouvintes.length = 0;
        viewports.delete(this.scene);
    }
}

/**
 * Um `Viewport` por cena.
 *
 * `WeakMap` em vez de um campo na cena: nada é plantado num objeto do Phaser, e
 * a entrada some junto com a cena mesmo que o `shutdown` não chegue a rodar.
 */
const viewports = new WeakMap();

export function viewportOf(scene) {
    let vp = viewports.get(scene);
    if (!vp) {
        vp = new Viewport(scene);
        viewports.set(scene, vp);
    }
    return vp;
}
