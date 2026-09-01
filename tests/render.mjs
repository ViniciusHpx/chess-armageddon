/**
 * Política de resolução física (DPR, buffer de desenho, memória de framebuffer).
 *
 * O que está sob teste é a ARITMÉTICA da política — função pura — mais a
 * invariante que ela existe para vigiar: o buffer de desenho é o tamanho
 * lógico da Fase D e não cresce com o `devicePixelRatio`.
 *
 * Não dá para automatizar aqui (ver as instruções manuais): FPS, tempo de
 * quadro e memória de GPU reais. Esses saem do `renderReport()` no console do
 * aparelho.
 */
import './stubs.mjs';

const {
    renderProfile, textResolution, screenUpscale, framebufferBytes, preFxPoolBytes,
    installRenderPolicy, currentProfile,
    MAX_RENDER_PIXELS, MAX_TEXT_RESOLUTION, PRE_FX_ENABLED
} = await import('./src/utils/RenderPolicy.mjs');
const { logicalSize, BASE_HEIGHT } = await import('./src/utils/Viewport.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };
const mpx = (n) => (n / 1e6).toFixed(2);
const mib = (n) => (n / 1048576).toFixed(1);

/** As telas da Fase D, em pixels de CSS. */
const TELAS = [
    ['1280x720  ', 1280, 720],
    ['1600x720  ', 1600, 720],
    ['1560x720  ', 1560, 720],
    ['1920x1080 ', 1920, 1080],
    ['1366x768  ', 1366, 768],
];

const DPRS = [1, 1.5, 2, 2.5, 3];

export async function run() {
    pass = 0;
    fail = 0;

    // ----------------------------------------------------------------------
    console.log('-- 1. o buffer NAO segue o devicePixelRatio --');
    {
        let constante = true;
        let alturaSempre720 = true;

        for (const [nome, w, h] of TELAS) {
            const larguras = new Set();
            for (const dpr of DPRS) {
                const p = renderProfile({ cssWidth: w, cssHeight: h, dpr });
                larguras.add(p.buffer.width + 'x' + p.buffer.height);
                if (p.buffer.height !== BASE_HEIGHT) alturaSempre720 = false;
            }
            const unico = larguras.size === 1;
            if (!unico) constante = false;
            ok(unico, nome + '-> buffer ' + [...larguras].join(' / ') + ' em DPR 1 .. 3');
        }

        ok(constante, 'o buffer e o mesmo em todos os DPRs, em todas as telas');
        ok(alturaSempre720, 'altura do buffer sempre ' + BASE_HEIGHT + ' linhas');
    }

    // ----------------------------------------------------------------------
    console.log('-- 2. buffer = tamanho logico da Fase D --');
    {
        let bate = true;
        for (const [, w, h] of TELAS) {
            const logico = logicalSize(w, h);
            const p = renderProfile({ cssWidth: w, cssHeight: h, dpr: 2 });
            if (p.buffer.width !== logico.width || p.buffer.height !== logico.height) bate = false;
        }
        ok(bate, 'buffer identico ao tamanho logico em todas as telas (Scale.FIT)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 3. teto de pixels --');
    {
        ok(MAX_RENDER_PIXELS === 1680 * 720,
            'teto = 1680 x 720 = ' + mpx(MAX_RENDER_PIXELS) + ' Mpx (proporcao maxima da Fase D)');

        let dentro = true;
        for (const [, w, h] of TELAS) {
            for (const dpr of DPRS) {
                if (!renderProfile({ cssWidth: w, cssHeight: h, dpr }).withinBudget) dentro = false;
            }
        }
        ok(dentro, 'toda combinacao tela x DPR fica dentro do teto');

        // Retrato e ultralargo tambem, que sao os extremos da politica.
        ok(renderProfile({ cssWidth: 1080, cssHeight: 2340, dpr: 3 }).withinBudget, 'retrato dentro do teto');
        ok(renderProfile({ cssWidth: 5120, cssHeight: 1440, dpr: 2 }).withinBudget, 'ultralargo dentro do teto');
    }

    // ----------------------------------------------------------------------
    console.log('-- 4. custo de pixels que a politica EVITA --');
    {
        // Quantos fragmentos a mais um buffer em DPR cheio pintaria.
        for (const [nome, w, h] of TELAS) {
            const linha = DPRS.map((dpr) => {
                const p = renderProfile({ cssWidth: w, cssHeight: h, dpr });
                return dpr + 'x:' + p.savedVsFullDpr.toFixed(2);
            }).join('  ');
            ok(true, nome + 'economia -> ' + linha);
        }

        const p3 = renderProfile({ cssWidth: 1600, cssHeight: 720, dpr: 3 });
        ok(Math.abs(p3.savedVsFullDpr - 9) < 0.01,
            'DPR 3 pintaria 9x mais fragmentos (custo cresce com o QUADRADO do DPR)');

        const p2 = renderProfile({ cssWidth: 1600, cssHeight: 720, dpr: 2 });
        ok(Math.abs(p2.savedVsFullDpr - 4) < 0.01, 'DPR 2 pintaria 4x mais');
    }

    // ----------------------------------------------------------------------
    console.log('-- 5. resolucao das texturas de texto --');
    {
        ok(textResolution(1.0) === 1, 'sem ampliacao -> 1 (identico ao de antes)');
        ok(textResolution(1.2) === 1, 'ampliacao pequena -> 1');
        ok(textResolution(1.5) === 2, 'tela de 1080 linhas (1,5x) -> 2');
        ok(textResolution(2.0) === 2, 'tela de 1440 linhas (2,0x) -> 2');
        ok(textResolution(4.0) === MAX_TEXT_RESOLUTION, 'teto respeitado -> ' + MAX_TEXT_RESOLUTION);
        ok(textResolution(0) === 1 && textResolution(NaN) === 1, 'entrada invalida cai em 1');

        ok(Number.isInteger(textResolution(1.5)) && Number.isInteger(textResolution(1.83)),
            'sempre inteiro (o canvas do texto nao aceita fracao sem erro de meio pixel)');

        // Celular 20:9 de 1080 x 2400 fisicos, DPR 2,75 -> 873 x 393 em CSS.
        // Da 1599 e nao 1600 porque o navegador ja arredondou a janela em CSS
        // (2400 / 2,75 = 872,7). O pixel de diferenca e do arredondamento do
        // navegador, nao da politica.
        const celular = renderProfile({ cssWidth: 873, cssHeight: 393, dpr: 2.75 });
        ok(celular.buffer.width === 1599 && celular.buffer.height === 720,
            'celular 20:9 -> buffer ' + celular.buffer.width + ' x ' + celular.buffer.height);
        ok(Math.abs(celular.upscale - 1.5) < 0.01,
            'compositor amplia 1,5x ate a tela fisica (' + celular.upscale.toFixed(2) + 'x)');
        ok(celular.textResolution === 2, 'texto em 2x nesse celular');
        ok(Math.abs(celular.effectiveDpr - 1.83) < 0.01,
            'DPR efetivo de ' + celular.effectiveDpr.toFixed(2) + ' pixels de buffer por pixel de CSS');
        ok(Math.abs(celular.savedVsFullDpr - 2.25) < 0.01,
            'a tela tem 2,25x os pixels do buffer');
    }

    // ----------------------------------------------------------------------
    console.log('-- 6. ampliacao --');
    {
        ok(Math.abs(screenUpscale(720, 1, 720) - 1) < 1e-9, 'tela 1:1 -> 1,0x');
        ok(Math.abs(screenUpscale(1080, 1, 720) - 1.5) < 1e-9, 'monitor 1080p -> 1,5x');
        ok(Math.abs(screenUpscale(393, 2.75, 720) - 1.50104) < 1e-4, 'celular 20:9 -> 1,50x');
        ok(screenUpscale(0, 2, 720) === 1 && screenUpscale(720, 0, 720) === 1, 'entrada invalida -> 1');
    }

    // ----------------------------------------------------------------------
    console.log('-- 7. memoria de framebuffer (nao confundir com textura) --');
    {
        // 4 alvos do tamanho do canvas sobram com Pre FX desligado; 7 com ele
        // ligado. Ver a contagem em RenderPolicy.js.
        const semFx = framebufferBytes(1600, 720, false);
        const comFx = framebufferBytes(1600, 720, true);

        ok(semFx === 4 * 1600 * 720 * 4, 'sem Pre FX: 4 alvos = ' + mib(semFx) + ' MiB (1600x720)');
        ok(comFx === 7 * 1600 * 720 * 4, 'com Pre FX: 7 alvos = ' + mib(comFx) + ' MiB (1600x720)');
        ok(comFx - semFx === 3 * 1600 * 720 * 4,
            'os 3 alvos de tela cheia do Pre FX custam ' + mib(comFx - semFx) + ' MiB');

        // A escada de alvos quadrados: 22 degraus de 32 em 32 ate 704.
        const piscina = preFxPoolBytes(1600, 720);
        ok(piscina === 3 * 1024 * 3795 * 4,
            'escada do Pre FX = ' + mib(piscina) + ' MiB (22 degraus x 3 alvos)');

        // Ela depende da MENOR dimensao, que a Fase D fixou em 720: nao cresce
        // com a largura da tela.
        ok(preFxPoolBytes(1280, 720) === piscina && preFxPoolBytes(1680, 720) === piscina,
            'a escada nao cresce com a largura (depende da altura, que e fixa)');

        ok(PRE_FX_ENABLED === false, 'Pre FX desligado na configuracao do jogo');

        const economia = piscina + (comFx - semFx);
        ok(economia > 55 * 1048576, 'economia total do disablePreFX = ' + mib(economia) + ' MiB');

        // Framebuffer por resolucao, para o relatorio.
        for (const [nome, w, h] of TELAS) {
            const p = renderProfile({ cssWidth: w, cssHeight: h, dpr: 2 });
            ok(p.framebufferBytes === 4 * p.buffer.pixels * 4,
                nome + 'framebuffer = ' + mib(p.framebufferBytes) + ' MiB (buffer ' +
                p.buffer.width + 'x' + p.buffer.height + ', ' + mpx(p.buffer.pixels) + ' Mpx)');
        }
    }

    // ----------------------------------------------------------------------
    console.log('-- 8. vigia do teto --');
    {
        const ouvintes = [];
        const avisos = [];
        const jogo = {
            canvas: { width: 1600, height: 720, style: { width: '873px', height: '393px' } },
            scale: { on(_e, cb) { ouvintes.push(cb); } },
            renderer: { pipelines: { renderTargets: [] } },
            loop: { actualFps: 60 },
        };

        const warnOriginal = console.warn;
        console.warn = (m) => avisos.push(m);
        try {
            installRenderPolicy(jogo);
            ok(avisos.length === 0, 'buffer dentro do teto nao reclama');

            // Alguem trocou o modo de escala e o buffer virou o da tela fisica.
            jogo.canvas = { width: 2400, height: 1080, style: { width: '873px', height: '393px' } };
            for (const cb of ouvintes) cb();
            ok(avisos.length === 1 && /acima do teto/.test(avisos[0]),
                'buffer acima do teto reclama uma vez');
        } finally {
            console.warn = warnOriginal;
        }

        ok(typeof globalThis.window.renderReport === 'function',
            'renderReport() publicado para diagnostico no aparelho');

        const relatorio = globalThis.window.renderReport();
        ok(relatorio.canvasBuffer.width === 2400 && relatorio.fps === 60,
            'renderReport le o canvas e o FPS reais');
        ok(relatorio.preFxTargets === 0, 'renderReport conta os render targets do pipeline');
    }

    // ----------------------------------------------------------------------
    console.log('-- 9. perfil da sessao atual --');
    {
        // `stubs.mjs` finge uma janela de 1280 x 720 com DPR 1.
        const p = currentProfile();
        ok(p.buffer.width === 1280 && p.buffer.height === 720, 'perfil atual: buffer 1280 x 720');
        ok(p.textResolution === 1, 'DPR 1 sem ampliacao -> texto em 1x (nada muda no desktop de referencia)');
        ok(p.withinBudget, 'dentro do teto');
    }

    return { pass, fail };
}
