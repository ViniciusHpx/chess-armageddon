/**
 * Contador de draw calls e de objetos de cena, para diagnóstico.
 *
 * O Phaser 3.90 **não expõe** um contador de draw calls no renderizador WebGL:
 * `renderer.drawCount` só existe no renderizador Canvas (`phaser.js:173797`).
 * O que ele expõe são dois eventos de pipeline, e é deles que estes números
 * saem — nada aqui é inventado nem estimado:
 *
 * | Evento | Quando | O que dá |
 * | --- | --- | --- |
 * | `pipelinebeforeflush` | antes do laço de `gl.drawArrays` | `pipeline.batch.length` = quantas chamadas aquele flush vai fazer |
 * | `pipelineafterflush` | depois do laço | só a contagem de flushes |
 *
 * A ordem importa: `flush()` zera `batch` **antes** de emitir o
 * `AFTER_FLUSH` (`phaser.js:178889-178895`), então quem quiser contar as
 * chamadas tem de olhar no BEFORE.
 *
 * **Limite honesto:** isto conta o caminho em lote, que é por onde passa todo
 * o desenho do jogo (sprites, `Graphics`, textos, partículas). Pipelines de
 * efeito desenham fora do lote, com `gl.drawArrays` direto — mas eles nem são
 * criados aqui, porque a Fase E desligou o Pre FX.
 *
 * O contador só roda quando alguém chama `renderReport()`: instalar os
 * ouvintes é barato, e o corpo deles é uma soma. Ainda assim, para não pagar
 * nada no caminho normal, ele começa DESLIGADO e liga na primeira consulta.
 */

/**
 * Liga os contadores ao jogo. Devolve a função que tira uma fotografia do
 * último quadro completo.
 *
 * @param {Phaser.Game} game
 * @returns {() => object} snapshot
 */
export function installRenderProbe(game) {
    /** Quadro em andamento. */
    let flushes = 0;
    let drawArrays = 0;

    /** Último quadro FECHADO — é o que o relatório mostra, sempre completo. */
    let ultimo = { flushes: 0, drawArrays: 0 };

    let ligado = false;

    const antesDoFlush = (pipeline) => {
        flushes++;
        // `batch` é a lista de trechos que o flush vai desenhar: um
        // `gl.drawArrays` por entrada. Pipeline sem lote conta como uma.
        drawArrays += pipeline.batch ? Math.max(1, pipeline.batch.length) : 1;
    };

    const aoIniciarQuadro = () => {
        flushes = 0;
        drawArrays = 0;
    };

    const aoFecharQuadro = () => {
        ultimo = { flushes, drawArrays };
    };

    /**
     * Liga na primeira consulta.
     *
     * Assinar os pipelines na subida não daria certo de qualquer forma: eles
     * são criados no boot do renderizador, depois deste módulo rodar.
     */
    const ligar = () => {
        if (ligado) return;

        const renderer = game.renderer;
        const gerente = renderer && renderer.pipelines;
        if (!gerente || !gerente.pipelines) return;

        const eventos = Phaser.Renderer.WebGL.Pipelines.Events;
        gerente.pipelines.each((_nome, pipeline) => {
            pipeline.on(eventos.BEFORE_FLUSH, antesDoFlush);
        });

        game.events.on(Phaser.Core.Events.PRE_RENDER, aoIniciarQuadro);
        game.events.on(Phaser.Core.Events.POST_RENDER, aoFecharQuadro);

        ligado = true;
    };

    return function snapshot() {
        ligar();

        const renderer = game.renderer;
        const cena = cenaAtiva(game);

        return {
            // Contados pelos eventos do Phaser, no último quadro fechado.
            // `null` enquanto o primeiro quadro depois de ligar não terminou.
            drawCalls: ligado ? ultimo.drawArrays : null,
            flushes: ligado ? ultimo.flushes : null,

            // Canvas 2D não tem pipeline, mas tem contador próprio.
            canvasDrawCount: renderer && renderer.drawCount !== undefined
                ? renderer.drawCount
                : null,

            ...contarCena(cena)
        };
    };
}

/**
 * A cena visível: a primeira que estiver rodando e desenhando.
 *
 * Exportada porque o [CpuProbe](CpuProbe.js) precisa exatamente da mesma
 * resposta — os dois relatórios têm de falar da mesma cena.
 */
export function cenaAtiva(game) {
    const cenas = game.scene && game.scene.getScenes ? game.scene.getScenes(true) : [];
    return cenas.find((c) => c.sys && c.sys.isVisible && c.sys.isVisible()) || cenas[0] || null;
}

/**
 * Conta o que está na lista de desenho da cena, por tipo.
 *
 * É uma varredura da lista inteira, então roda só quando pedido — nunca por
 * quadro.
 */
function contarCena(cena) {
    if (!cena || !cena.children) {
        return {
            displayObjects: null, sprites: null, images: null, graphics: null,
            texts: null, shapes: null, emitters: null, particles: null, textures: null
        };
    }

    let sprites = 0;
    let images = 0;
    let graphics = 0;
    let texts = 0;
    let shapes = 0;
    let emitters = 0;
    let particles = 0;

    for (const filho of cena.children.list) {
        const tipo = filho.type;

        if (tipo === 'Sprite') sprites++;
        else if (tipo === 'Image') images++;
        else if (tipo === 'Graphics') graphics++;
        else if (tipo === 'Text') texts++;
        else if (tipo === 'ParticleEmitter') {
            emitters++;
            // Partículas VIVAS agora — o número que interessa para o pior caso.
            if (filho.getAliveParticleCount) particles += filho.getAliveParticleCount();
        } else if (filho.geom !== undefined) shapes++;
    }

    return {
        displayObjects: cena.children.list.length,
        sprites, images, graphics, texts, shapes, emitters, particles,
        textures: cena.textures ? Object.keys(cena.textures.list).length : null
    };
}
