/**
 * FOV vertical fixo e ancoragem do HUD.
 *
 * Duas coisas sob teste, as duas sem navegador:
 *
 *   1. `logicalSize()` — a regra inteira do tamanho lógico. É função pura, e as
 *      proporções pedidas (16:9, 20:9, 19,5:9) são conferidas contra os números
 *      exatos esperados;
 *   2. `Viewport` — as âncoras de canto, a área útil descontando os recortes do
 *      sistema e o aviso de redimensionamento. A cena é falsa: o que importa
 *      aqui é aritmética de tela, não Phaser.
 *
 * Não dá para automatizar aqui (ver as instruções de teste manual): como a
 * imagem realmente aparece, se algo ficou cortado ou sobreposto, e o
 * multitouch.
 */
import './stubs.mjs';

const {
    logicalSize, Viewport, viewportOf, installViewportScaling,
    BASE_WIDTH, BASE_HEIGHT, MIN_ASPECT, MAX_ASPECT, HUD_MARGIN
} = await import('./src/utils/Viewport.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };

/** Cena falsa: só o `ScaleManager` e os eventos que o `Viewport` consome. */
function cenaFalsa(largura, altura, insets = {}) {
    const ouvintes = [];
    const shutdown = [];

    globalThis.__insets = {
        '--safe-top': (insets.top || 0) + 'px',
        '--safe-right': (insets.right || 0) + 'px',
        '--safe-bottom': (insets.bottom || 0) + 'px',
        '--safe-left': (insets.left || 0) + 'px',
    };

    const scale = {
        gameSize: { width: largura, height: altura },
        parentSize: { width: 0, height: 0 },
        displayScale: { x: 1, y: 1 },
        on(_evento, cb) { ouvintes.push(cb); },
        off(_evento, cb) {
            const i = ouvintes.indexOf(cb);
            if (i >= 0) ouvintes.splice(i, 1);
        },
        setGameSize(w, h) {
            this.gameSize = { width: w, height: h };
            for (const cb of ouvintes.slice()) cb();
        },
        _ouvintes: ouvintes,
    };

    return {
        scale,
        cameras: { main: { width: largura, height: altura } },
        events: { once(_e, cb) { shutdown.push(cb); } },
        _shutdown: shutdown,
    };
}

export async function run() {
    pass = 0;
    fail = 0;

    // ----------------------------------------------------------------------
    console.log('-- 1. tamanho logico: altura fixa, largura derivada --');
    {
        const casos = [
            ['16:9   1920x1080', 1920, 1080, 1280],
            ['16:9   1280x720 (referencia)', 1280, 720, 1280],
            ['16:9   1366x768', 1366, 768, 1281],
            ['20:9   2400x1080', 2400, 1080, 1600],
            ['19.5:9 2340x1080', 2340, 1080, 1560],
            ['16:10  1920x1200', 1920, 1200, 1152],
            ['4:3    1024x768', 1024, 768, 960],
        ];

        let alturaSempre720 = true;
        for (const [nome, w, h, esperado] of casos) {
            const r = logicalSize(w, h);
            ok(r.width === esperado, nome + ' -> ' + r.width + ' x ' + r.height);
            if (r.height !== BASE_HEIGHT) alturaSempre720 = false;
        }
        ok(alturaSempre720, 'altura logica constante em ' + BASE_HEIGHT + ' em todos os casos');

        // 1366/768 nao e exatamente 16:9, dai o 1281: a largura acompanha a
        // proporcao REAL da tela, que e o que evita a barra preta.
        ok(Math.abs(logicalSize(1366, 768).width / 720 - 1366 / 768) < 0.001,
            'a proporcao logica bate com a da tela (sem barra)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 2. limites de proporcao --');
    {
        const retrato = logicalSize(1080, 2340);
        ok(retrato.width === Math.round(BASE_HEIGHT * MIN_ASPECT),
            'retrato trava no piso 4:3 -> ' + retrato.width + ' x ' + retrato.height);

        const ultra = logicalSize(3840, 1080);
        ok(ultra.width === Math.round(BASE_HEIGHT * MAX_ASPECT),
            'ultralargo trava no teto 21:9 -> ' + ultra.width + ' x ' + ultra.height);

        const zero = logicalSize(0, 0);
        ok(zero.width === BASE_WIDTH && zero.height === BASE_HEIGHT,
            'tela sem medida cai na referencia ' + BASE_WIDTH + ' x ' + BASE_HEIGHT);
    }

    // ----------------------------------------------------------------------
    console.log('-- 3. ancoras do viewport --');
    {
        const cena = cenaFalsa(1280, 720);
        const vp = new Viewport(cena);

        ok(vp.width === 1280 && vp.height === 720, 'mede o tamanho logico');
        ok(vp.centerX === 640 && vp.centerY === 360, 'centro');

        // Os mesmos numeros que o HUD usava cravados antes desta fase.
        ok(vp.topLeft(HUD_MARGIN, HUD_MARGIN).x === 16, 'status: x = 16 (era cravado)');
        ok(vp.topRight(HUD_MARGIN, HUD_MARGIN).x === 1264, 'kill feed: x = 1264 (era width - 16)');
        ok(vp.topCenter(HUD_MARGIN).x === 640, 'placar dos times: x = 640 (era width / 2)');
        ok(vp.bottomLeft(120, 120).y === 600, 'joystick: y = 600 (era height - 120)');
        ok(vp.bottomRight(100, 120).x === 1180, 'ataque: x = 1180 (era width - 100)');
        ok(vp.bottomRight(185, 68).x === 1095, 'dash: x = 1095 (era width - 185)');
        ok(vp.bottomRight(268, 68).x === 1012, 'debug: x = 1012 (era width - 268)');
        ok(vp.center(0, -80).y === 280, 'titulo da tela de morte: y = 280');
    }

    // ----------------------------------------------------------------------
    console.log('-- 4. tela mais larga: HUD acompanha, altura nao muda --');
    {
        const cena = cenaFalsa(1600, 720);
        const vp = new Viewport(cena);

        ok(vp.height === 720, 'altura segue 720 numa tela 20:9');
        ok(vp.topLeft(HUD_MARGIN, HUD_MARGIN).x === 16, 'canto esquerdo nao se move');
        ok(vp.bottomLeft(120, 120).x === 120 && vp.bottomLeft(120, 120).y === 600,
            'joystick continua colado no canto de baixo a esquerda');
        ok(vp.bottomRight(100, 120).x === 1500, 'ataque acompanha a borda direita (1500)');
        ok(vp.topCenter(HUD_MARGIN).x === 800, 'placar centraliza em 800');
        ok(vp.center().x === 800 && vp.center().y === 360, 'centro acompanha');
    }

    // ----------------------------------------------------------------------
    console.log('-- 5. recortes do sistema (notch / barra de gestos) --');
    {
        // Celular deitado: notch de 44 px de um lado, barra de 20 px do outro.
        const cena = cenaFalsa(1600, 720, { left: 44, right: 20, bottom: 12 });
        const vp = new Viewport(cena);

        ok(vp.left === 44 && vp.right === 1580, 'area util desconta o notch e a barra');
        ok(vp.bottom === 708, 'area util desconta a barra de gestos embaixo');
        ok(vp.topLeft(HUD_MARGIN, HUD_MARGIN).x === 60, 'status desviou do notch (16 + 44)');
        ok(vp.bottomRight(100, 120).x === 1480, 'ataque desviou da borda direita');
        ok(vp.bottomLeft(120, 120).y === 588, 'joystick subiu acima da barra de gestos');
        ok(vp.centerX === 800, 'o CENTRO ignora os recortes: telas cheias sao centradas na tela');
    }

    // ----------------------------------------------------------------------
    console.log('-- 6. conversao de pixel de CSS para pixel logico --');
    {
        // Tela fisica de 2400 px para 1600 logicos: cada px de CSS vale 0,666
        // logico. Um notch de 44 px de CSS nao pode reservar 44 px logicos.
        const cena = cenaFalsa(1600, 720, { left: 44 });
        cena.scale.displayScale = { x: 1600 / 2400, y: 720 / 1080 };
        const vp = new Viewport(cena);

        ok(Math.abs(vp.left - 44 * (1600 / 2400)) < 0.001,
            'inset convertido para unidades logicas (' + vp.left.toFixed(2) + ')');
    }

    // ----------------------------------------------------------------------
    console.log('-- 7. redimensionamento avisa quem se inscreveu --');
    {
        const cena = cenaFalsa(1280, 720);
        const vp = new Viewport(cena);

        let avisos = 0;
        let ultimaLargura = 0;
        vp.onResize(() => { avisos++; ultimaLargura = vp.width; });

        cena.scale.setGameSize(1600, 720);
        ok(avisos === 1 && ultimaLargura === 1600, 'aviso unico, com a medida ja atualizada');
        ok(vp.bottomRight(100, 120).x === 1500, 'ancora recalculada apos o resize');

        cena.scale.setGameSize(1560, 720);
        ok(avisos === 2 && vp.width === 1560, 'segundo resize tambem avisa');

        // O cancelamento existe para HUD temporario nao deixar rastro.
        const cancelar = vp.onResize(() => { avisos += 100; });
        cancelar();
        cena.scale.setGameSize(1280, 720);
        ok(avisos === 3, 'ouvinte cancelado nao e mais chamado');

        vp.destroy();
        cena.scale.setGameSize(1600, 720);
        ok(avisos === 3, 'destroy solta o listener do ScaleManager');
        ok(cena.scale._ouvintes.length === 0, 'nada fica pendurado no ScaleManager');
    }

    // ----------------------------------------------------------------------
    console.log('-- 8. um viewport por cena --');
    {
        const a = cenaFalsa(1280, 720);
        const b = cenaFalsa(1280, 720);

        ok(viewportOf(a) === viewportOf(a), 'a mesma cena devolve a mesma instancia');
        ok(viewportOf(a) !== viewportOf(b), 'cenas diferentes, viewports diferentes');
        ok(a.scale._ouvintes.length === 1, 'so um listener por cena');

        const vp = viewportOf(a);
        vp.destroy();
        ok(viewportOf(a) !== vp, 'apos o shutdown, a cena ganha um viewport novo');
    }

    // ----------------------------------------------------------------------
    console.log('-- 9. a politica de escala nao entra em laco --');
    {
        const jogo = { scale: cenaFalsa(1280, 720).scale };
        jogo.scale.parentSize = { width: 2400, height: 1080 };

        let chamadasDeSetGameSize = 0;
        const original = jogo.scale.setGameSize.bind(jogo.scale);
        jogo.scale.setGameSize = function (w, h) { chamadasDeSetGameSize++; original(w, h); };

        installViewportScaling(jogo);

        // Primeiro RESIZE do navegador: a tela e 20:9, o jogo esta em 16:9.
        for (const cb of jogo.scale._ouvintes.slice()) cb();

        ok(jogo.scale.gameSize.width === 1600 && jogo.scale.gameSize.height === 720,
            'tela 20:9 -> jogo 1600 x 720');
        ok(chamadasDeSetGameSize === 1,
            'o RESIZE que o proprio setGameSize dispara nao se realimenta (' + chamadasDeSetGameSize + ' chamada)');

        // Nada mudou na tela: nao pode haver trabalho novo.
        for (const cb of jogo.scale._ouvintes.slice()) cb();
        ok(chamadasDeSetGameSize === 1, 'tamanho ja correto nao dispara setGameSize');
    }

    return { pass, fail };
}
