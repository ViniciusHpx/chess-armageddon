/**
 * Política de resolução física: quantos pixels a GPU realmente pinta.
 *
 * ## O achado da auditoria
 *
 * O jogo nunca leu `devicePixelRatio`, e **não é por esquecimento**: no Phaser
 * 3.90 o DPR não entra na conta do buffer de desenho. Duas linhas fecham o
 * assunto, as duas no `phaser.js` vendorizado:
 *
 * ```
 * 195473:  this.canvas.width  = this.baseSize.width;    // setGameSize
 * 195538:  this.canvas.width  = this.baseSize.width;    // resize
 * ```
 *
 * `baseSize` é o tamanho LÓGICO do jogo. No modo `FIT` o `updateScale` mexe
 * apenas em `style.width/height` (o tamanho em CSS), nunca no `canvas.width`.
 * Ou seja: **o buffer de desenho é exatamente o tamanho lógico**, e o
 * `devicePixelRatio` não o multiplica em lugar nenhum. O antigo
 * `game.config.resolution` do Phaser foi removido da engine; o único
 * `resolution` que sobrou é o dos objetos `Text` (ver `TEXT_RESOLUTION` abaixo),
 * e o Phaser só consulta o DPR para preencher `Device.OS.pixelRatio`, que é
 * informativo (`phaser.js:24630`).
 *
 * Some-se a isso a Fase D, que fixou a altura lógica em 720: **o buffer tem
 * 720 linhas em qualquer aparelho, com qualquer DPR**. O teto absoluto é
 * `MAX_RENDER_PIXELS`.
 *
 * Consequência prática, e é o ponto todo desta fase: `Math.min(dpr, 2)` aqui
 * não faria nada — não há o que limitar, porque nada multiplica. O custo de
 * fragmento já está travado. O que esta política faz é:
 *
 *   1. **guardar a invariante** — se alguém mudar `MAX_ASPECT`, trocar o modo
 *      de escala por `RESIZE` ou passar a mexer no canvas na mão, o buffer
 *      cresce em silêncio e ninguém percebe até o celular esquentar. O
 *      `installRenderPolicy` reclama no console;
 *   2. **devolver a nitidez que o buffer travado custa.** Um buffer de 720
 *      linhas numa tela de 1080 é ampliado 1,5× pelo compositor. Para a arte
 *      isso é imperceptível (é textura pintada, sem aresta dura); para TEXTO é
 *      visível. `TEXT_RESOLUTION` compensa isso onde custa quase nada;
 *   3. **dar o número medido** — `window.renderReport()` no console de
 *      qualquer aparelho.
 */

import { logicalSize, BASE_HEIGHT, MAX_ASPECT } from './Viewport.js';
import { installRenderProbe } from './RenderProbe.js';
import { installCpuProbe } from './CpuProbe.js';

/**
 * Teto de pixels do buffer de desenho.
 *
 * Não é um número escolhido a dedo: é exatamente o que a política de viewport
 * da Fase D consegue produzir no pior caso (a proporção máxima, na altura
 * fixa). Passar disso significa que alguma outra coisa mudou — e é isso que se
 * quer descobrir.
 */
export const MAX_RENDER_PIXELS = Math.round(BASE_HEIGHT * MAX_ASPECT) * BASE_HEIGHT;

/**
 * Teto da resolução das texturas de texto.
 *
 * A 2× a textura do texto já tem mais pixels do que a tela mostra em qualquer
 * caso realista: o buffer é ampliado 1,5× numa tela de 1080 linhas e 2,0× numa
 * de 1440. Acima disso o ganho some na distância de leitura (celular na mão,
 * monitor a um braço) e a memória cresce ao QUADRADO — 3× seriam 9× os pixels
 * de cada rótulo.
 */
export const MAX_TEXT_RESOLUTION = 2;

/**
 * Render targets do tamanho do canvas que o Phaser 3.90 aloca sozinho no boot,
 * usados ou não. Contados no `phaser.js`:
 *
 * | Origem | Quantos |
 * | --- | --- |
 * | `WebGLRenderer.renderTarget` / `maskTarget` / `maskSource` (181004-181007) | 3 |
 * | `UtilityPipeline.fsTarget` (188441) | 1 |
 * | "Full-screen RTs" do `PipelineManager`, só com Pre FX ligado (175679-175681) | 3 |
 */
const RENDER_TARGETS_SEMPRE = 4;
const RENDER_TARGETS_PRE_FX = 3;

/** Bytes por pixel de um render target RGBA8. */
const BYTES_POR_PIXEL = 4;

/**
 * Os Pre FX estão desligados no `main.js` (`disablePreFX: true`).
 *
 * O projeto não usa nenhum efeito — nem `preFX`, nem `postFX`, nem
 * `setPostPipeline` —, mas o Phaser aloca a piscina inteira do Pre FX no boot
 * de qualquer jeito: além dos três alvos de tela cheia, uma escada de alvos
 * quadrados de 32 em 32 px até a menor dimensão do canvas. Ver
 * `preFxPoolBytes`, que refaz a conta do `phaser.js:175660-175681`.
 *
 * Manter em sincronia com o `main.js`: este valor é só para o relatório.
 */
export const PRE_FX_ENABLED = false;

/** Passo da escada de alvos quadrados do Pre FX (`phaser.js:175592`). */
const PRE_FX_FRAME_INC = 32;

/**
 * Memória dos render targets do tamanho do canvas, em bytes.
 *
 * É memória de FRAMEBUFFER, e não de textura: não tem relação com o tamanho de
 * `arena.png` nem com a máscara de colisão. As duas somam na VRAM, mas crescem
 * por motivos diferentes — esta cresce com a resolução de render, aquela com a
 * arte.
 */
export function framebufferBytes(width, height, comPreFx = PRE_FX_ENABLED) {
    const alvos = RENDER_TARGETS_SEMPRE + (comPreFx ? RENDER_TARGETS_PRE_FX : 0);
    return alvos * width * height * BYTES_POR_PIXEL;
}

/**
 * Memória da escada de alvos quadrados do Pre FX, em bytes.
 *
 * Reproduz `PipelineManager.boot`: `qty = ceil(min(w, h) / 32)` e, para cada
 * `i` de 1 a `qty - 1`, TRÊS alvos de `32i × 32i`. Não acompanha
 * redimensionamento (são criados sem `autoResize`), então o que vale é o
 * tamanho do canvas no boot.
 */
export function preFxPoolBytes(width, height, frameInc = PRE_FX_FRAME_INC) {
    const menorLado = Math.min(width, height);
    const qty = Math.ceil(menorLado / frameInc);

    let pixels = 0;
    for (let i = 1; i < qty; i++) {
        const lado = i * frameInc;
        pixels += 3 * lado * lado;
    }

    return pixels * BYTES_POR_PIXEL;
}

/**
 * Quantos pixels FÍSICOS da tela cada pixel do buffer tem de cobrir.
 *
 * 1,0 = o buffer bate com a tela. Acima disso o compositor amplia (e é o caso
 * normal aqui). Abaixo, o buffer é maior que a tela e está sendo reduzido —
 * desperdício puro, e é o que a política impede.
 */
export function screenUpscale(cssHeight, dpr, bufferHeight) {
    if (!(cssHeight > 0) || !(dpr > 0) || !(bufferHeight > 0)) return 1;
    return (cssHeight * dpr) / bufferHeight;
}

/**
 * Resolução das texturas de texto para uma dada ampliação.
 *
 * Inteiro de propósito: o Phaser dimensiona o canvas interno do texto em
 * `tamanho × resolution` e o navegador trunca fração, o que renderia meio pixel
 * de erro na borda dos glifos. Arredondar para o inteiro mais próximo dá 1 em
 * tela sem ampliação, 2 de 1,5× para cima — e o teto segura o resto.
 *
 * Não muda o tamanho do texto na tela: o renderizador desenha
 * `width / resolution` (`phaser.js:84593`). Só a textura fica mais densa.
 */
export function textResolution(upscale) {
    if (!(upscale > 0)) return 1;
    return Math.min(MAX_TEXT_RESOLUTION, Math.max(1, Math.round(upscale)));
}

/**
 * Todos os números da política para uma tela. Função pura — é ela que os
 * testes conferem, e é ela que o `renderReport` imprime.
 *
 * @param {{cssWidth: number, cssHeight: number, dpr: number}} tela
 *        Tamanho da janela em pixels de CSS e o `devicePixelRatio` do aparelho.
 */
export function renderProfile({ cssWidth, cssHeight, dpr }) {
    const logico = logicalSize(cssWidth, cssHeight);

    // Com `Scale.FIT`, buffer e tamanho lógico são a MESMA coisa. A igualdade
    // está escrita aqui de propósito: se um dia deixar de valer, é este ponto
    // que precisa mudar.
    const buffer = { width: logico.width, height: logico.height };
    const bufferPixels = buffer.width * buffer.height;

    const fisico = {
        width: Math.round(cssWidth * dpr),
        height: Math.round(cssHeight * dpr)
    };
    const fisicoPixels = fisico.width * fisico.height;

    const upscale = screenUpscale(cssHeight, dpr, buffer.height);

    return {
        dpr,
        css: { width: cssWidth, height: cssHeight },
        logical: logico,
        buffer: { ...buffer, pixels: bufferPixels },
        physical: { ...fisico, pixels: fisicoPixels },

        /** Pixels de buffer por pixel de CSS. É o "DPR" que o jogo usa de fato. */
        effectiveDpr: cssWidth > 0 ? buffer.width / cssWidth : 1,

        /** Quanto o compositor amplia o buffer até a tela. */
        upscale,

        /** Quantas vezes MENOS fragmentos que um buffer em DPR cheio. */
        savedVsFullDpr: bufferPixels > 0 ? fisicoPixels / bufferPixels : 1,

        textResolution: textResolution(upscale),
        framebufferBytes: framebufferBytes(buffer.width, buffer.height),
        withinBudget: bufferPixels <= MAX_RENDER_PIXELS
    };
}

/**
 * Perfil da tela ATUAL, medido no navegador.
 *
 * Usa as mesmas entradas do `main.js` (janela + DPR), então o resultado é o
 * que o jogo vai realmente fazer.
 */
export function currentProfile() {
    return renderProfile({
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1
    });
}

/**
 * Resolução das texturas de texto desta sessão.
 *
 * Decidida UMA vez, na carga do módulo, porque é isso que o Phaser suporta: a
 * resolução entra na criação de cada `Text` e mudá-la depois obrigaria a
 * redesenhar todas as texturas. Arrastar a janela para um monitor de densidade
 * diferente no meio da partida mantém a resolução com que os textos nasceram —
 * o que se perde é nitidez, não layout.
 */
export const TEXT_RESOLUTION = currentProfile().textResolution;

/**
 * Liga a política ao jogo. Chamada uma vez, no `main.js`.
 *
 * Não configura nada no Phaser: o buffer já sai do tamanho certo por causa da
 * Fase D. O que ela faz é VIGIAR — a cada mudança de tamanho, confere se o
 * buffer continua dentro do teto — e deixar o diagnóstico à mão.
 */
export function installRenderPolicy(game) {
    const conferir = () => {
        const canvas = game.canvas;
        if (!canvas) return;

        const pixels = canvas.width * canvas.height;
        if (pixels <= MAX_RENDER_PIXELS) return;

        console.warn(
            `[render] buffer de ${canvas.width}x${canvas.height} = ${(pixels / 1e6).toFixed(2)} Mpx, ` +
            `acima do teto de ${(MAX_RENDER_PIXELS / 1e6).toFixed(2)} Mpx. ` +
            'Alguma coisa passou a dimensionar o canvas fora da política de viewport.'
        );
    };

    game.scale.on(Phaser.Scale.Events.RESIZE, conferir);
    conferir();

    // Contadores de draw call e de objetos de cena. Ficam parados até alguém
    // chamar `renderReport()` — ver `RenderProbe.js`.
    const gpu = installRenderProbe(game);

    // Medidor de CPU por quadro, do outro lado do orçamento. Também nasce
    // desligado; a primeira chamada de `cpuReport()` liga — ver `CpuProbe.js`.
    window.cpuReport = installCpuProbe(game);

    // Diagnóstico de aparelho: abrir o console e chamar `renderReport()`. É de
    // onde saem os números MEDIDOS do relatório desta fase, que não dá para
    // obter de outro jeito sem o aparelho na mão.
    window.renderReport = () => {
        const perfil = currentProfile();
        const canvas = game.canvas;
        const gl = game.renderer && game.renderer.gl;

        return {
            ...perfil,
            // O que o navegador diz, e não o que a política calculou: é a
            // conferência de que os dois concordam.
            canvasBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
            drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight } : null,
            canvasCss: canvas && canvas.style
                ? { width: canvas.style.width, height: canvas.style.height }
                : null,
            fps: Math.round(game.loop.actualFps),
            preFxTargets: game.renderer && game.renderer.pipelines
                ? game.renderer.pipelines.renderTargets.length
                : null,

            // Draw calls, objetos de cena e partículas vivas. O primeiro
            // `renderReport()` liga os contadores, então os de draw call só
            // aparecem a partir da SEGUNDA chamada.
            ...gpu()
        };
    };
}
