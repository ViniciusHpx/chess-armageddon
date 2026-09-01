/**
 * Medidor de CPU por quadro, para diagnóstico. Irmão do
 * [RenderProbe](RenderProbe.js), do outro lado do orçamento de quadro.
 *
 * ## O que ele mede, e como
 *
 * O relógio é o `performance.now()` do navegador e as marcações são os eventos
 * que o próprio Phaser emite no laço principal — nada aqui é inventado nem
 * inferido:
 *
 * ```
 *   PRE_STEP ──────────── PRE_RENDER ──────────── POST_RENDER
 *      |                       |                        |
 *      |<──── lógica ─────────>|<───── desenho ────────>|
 *      |<──────────────── quadro ──────────────────────>|
 * ```
 *
 * - **lógica** — `update` das cenas, física, entrada, previsão, interpolação.
 *   É o custo de JavaScript do jogo;
 * - **desenho** — travessia da lista de exibição e envio dos comandos para o
 *   WebGL. É custo de **CPU**, não de GPU: o tempo que a placa leva para pintar
 *   NÃO aparece aqui, e o navegador não o expõe sem uma extensão de
 *   cronometragem que costuma vir bloqueada. Para tempo de GPU, DevTools;
 * - **quadro** — a soma dos dois. O que sobra para 16,7 ms é a folga.
 *
 * ## Custo do próprio medidor
 *
 * Ele nasce **desligado**. A primeira chamada de `cpuReport()` liga os três
 * ouvintes; a partir daí são três `performance.now()` e três escritas em
 * `Float64Array` por quadro, sem alocar nada. Antes disso o custo é zero.
 *
 * ## O que ele NÃO faz
 *
 * Não atribui tempo por subsistema (quanto foi previsão, quanto foi
 * interpolação, quanto foi colisão). Isso exigiria marcações dentro dos laços
 * quentes, que custariam mais do que medem. Para essa atribuição existe o
 * **Performance do DevTools**, e o procedimento está no relatório da fase.
 */

import { cenaAtiva } from './RenderProbe.js';

/** Quadros guardados: ~4 s a 60 fps. Anel de tamanho fixo, sem alocação. */
const CAPACIDADE = 240;

/**
 * Liga o medidor ao jogo. Devolve a função que tira a fotografia.
 *
 * @param {Phaser.Game} game
 * @returns {() => object} snapshot
 */
export function installCpuProbe(game) {
    const quadro = new Float64Array(CAPACIDADE);
    const logica = new Float64Array(CAPACIDADE);
    const desenho = new Float64Array(CAPACIDADE);

    let indice = 0;
    let escritos = 0;
    let ligado = false;

    let tInicio = 0;
    let tRender = 0;

    /** Sequência de entrada da consulta anterior, para dar a taxa de envio. */
    let seqAnterior = null;
    let instanteAnterior = 0;

    const aoIniciarQuadro = () => { tInicio = performance.now(); };
    const aoIniciarDesenho = () => { tRender = performance.now(); };

    const aoFecharQuadro = () => {
        const fim = performance.now();

        quadro[indice] = fim - tInicio;
        logica[indice] = tRender - tInicio;
        desenho[indice] = fim - tRender;

        indice = (indice + 1) % CAPACIDADE;
        if (escritos < CAPACIDADE) escritos++;
    };

    const ligar = () => {
        if (ligado) return;

        game.events.on(Phaser.Core.Events.PRE_STEP, aoIniciarQuadro);
        game.events.on(Phaser.Core.Events.PRE_RENDER, aoIniciarDesenho);
        game.events.on(Phaser.Core.Events.POST_RENDER, aoFecharQuadro);

        ligado = true;
    };

    return function snapshot() {
        const primeira = !ligado;
        ligar();

        const cena = cenaAtiva(game);
        const agora = performance.now();

        const relatorio = {
            armado: !primeira,
            amostras: escritos,
            quadro: estatisticas(quadro, escritos),
            logica: estatisticas(logica, escritos),
            desenho: estatisticas(desenho, escritos),
            fps: game.loop ? Math.round(game.loop.actualFps) : null,
            orcamentoMs: game.loop && game.loop.targetFps ? 1000 / game.loop.targetFps : null,
            ...contarEntidades(cena),
            ...taxaDeEntrada(cena, seqAnterior, instanteAnterior, agora),
            atribuicaoPorSubsistema: 'apenas no Performance do DevTools',
            tempoDeGpu: 'nao exposto pelo navegador'
        };

        seqAnterior = cena && Number.isFinite(cena.inputSeq) ? cena.inputSeq : null;
        instanteAnterior = agora;

        return relatorio;
    };
}

/**
 * Média, mediana, percentil 95 e máximo de um anel.
 *
 * O p95 é o número que importa num jogo: a média esconde o engasgo, e é o
 * engasgo que o jogador sente. Só é calculado quando alguém pede.
 */
function estatisticas(anel, escritos) {
    if (escritos === 0) return { media: null, p50: null, p95: null, max: null };

    const amostras = Array.prototype.slice.call(anel, 0, escritos);
    amostras.sort((a, b) => a - b);

    let soma = 0;
    for (let i = 0; i < escritos; i++) soma += amostras[i];

    const emPercentil = (p) => amostras[Math.min(escritos - 1, Math.floor(escritos * p))];

    return {
        media: arredonda(soma / escritos),
        p50: arredonda(emPercentil(0.5)),
        p95: arredonda(emPercentil(0.95)),
        max: arredonda(amostras[escritos - 1])
    };
}

const arredonda = (v) => Math.round(v * 1000) / 1000;

/**
 * Quantas entidades a cena está processando, e o estado das filas que crescem
 * com o multiplayer.
 *
 * Tudo lido de campos que já existem — nenhum contador foi plantado no caminho
 * quente para isto.
 */
function contarEntidades(cena) {
    if (!cena) return { modo: null, entidades: null };

    // A `Arena` tem `actors`; a `Start` tem grupos de física.
    if (cena.actors && typeof cena.actors.size === 'number') {
        let amostras = 0;
        for (const ator of cena.actors.values()) {
            amostras += ator.snapshots ? ator.snapshots.length : 0;
        }

        return {
            modo: 'online',
            entidades: {
                atores: cena.actors.size,
                amostrasDeInterpolacao: amostras,
                entradasPendentes: cena.pendingInputs ? cena.pendingInputs.length : null,
                conectado: cena.conectado === true
            },
            intervaloEntrePatchesMs: intervaloEntrePatches(cena)
        };
    }

    if (cena.alliedPlayers && cena.enemyPlayers) {
        return {
            modo: 'offline',
            entidades: {
                aliados: cena.alliedPlayers.getLength(),
                inimigos: cena.enemyPlayers.getLength()
            },
            intervaloEntrePatchesMs: null
        };
    }

    return { modo: null, entidades: null };
}

/**
 * Intervalo médio entre patches do servidor, em ms.
 *
 * Sai do buffer de interpolação, que já guarda a hora de chegada de cada
 * patch: o espaçamento entre as amostras É o intervalo. Nada precisou ser
 * instrumentado na rede para obtê-lo. Deve ficar perto do `TICK_MS` (50 ms);
 * muito acima disso significa patch chegando em rajada.
 */
function intervaloEntrePatches(cena) {
    for (const ator of cena.actors.values()) {
        const buf = ator.snapshots;
        if (!buf || buf.length < 2) continue;

        let soma = 0;
        for (let i = 1; i < buf.length; i++) soma += buf[i].t - buf[i - 1].t;

        return arredonda(soma / (buf.length - 1));
    }
    return null;
}

/** Pacotes de entrada enviados por segundo, medidos entre duas consultas. */
function taxaDeEntrada(cena, seqAnterior, instanteAnterior, agora) {
    if (!cena || !Number.isFinite(cena.inputSeq)) return { entradasPorSegundo: null };
    if (seqAnterior === null) return { entradasPorSegundo: null };

    const segundos = (agora - instanteAnterior) / 1000;
    if (segundos <= 0) return { entradasPorSegundo: null };

    return { entradasPorSegundo: arredonda((cena.inputSeq - seqAnterior) / segundos) };
}
