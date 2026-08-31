/**
 * Layout do HUD nas proporções de tela que interessam.
 *
 * Aqui rodam os componentes DE VERDADE — `InputManager`, `XpBar`,
 * `Scoreboard`, `DeathScreen`, `ResultScreen` e o `layoutHud` da `Arena` —
 * contra um `scene.add` que só anota o que foi criado e onde foi parar. O que
 * se afirma é geometria:
 *
 *   - nada nasce fora da tela nem encosta na borda errada;
 *   - os controles de toque não se sobrepõem (a distância entre centros é
 *     maior que a soma dos raios, que é a regra que impede um toque de pegar
 *     dois botões);
 *   - redimensionar reposiciona sem criar objeto novo.
 *
 * Não dá para automatizar aqui (ver as instruções de teste manual): a largura
 * real de cada texto depende da fonte do aparelho, então o que se confere é a
 * ÂNCORA do texto, não a mancha de glifos. Sobreposição entre dois textos
 * longos continua sendo coisa de olho.
 */
import './stubs.mjs';

const { logicalSize } = await import('./src/utils/Viewport.mjs');
const InputManager = (await import('./src/utils/InputManager.mjs')).default;
const XpBar = (await import('./src/ui/XpBar.mjs')).default;
const Scoreboard = (await import('./src/ui/Scoreboard.mjs')).default;
const DeathScreen = (await import('./src/ui/DeathScreen.mjs')).default;
const ResultScreen = (await import('./src/ui/ResultScreen.mjs')).default;
const { Arena } = await import('./src/scenes/Arena.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };
const perto = (a, b) => Math.abs(a - b) < 0.001;

// --------------------------------------------------------------------------
// Cena falsa que ANOTA o que o HUD cria e para onde o manda.
// --------------------------------------------------------------------------
function objetoFalso(tipo, x, y, extra = {}) {
    const o = {
        tipo, x, y, visible: true, alpha: 1, texto: '',
        originX: 0.5, originY: 0.5,
        ...extra,
    };
    const eu = () => o;
    Object.assign(o, {
        setPosition(px, py) { o.x = px; o.y = py; return o; },
        setSize(w, h) { o.width = w; o.height = h; return o; },
        setOrigin(ox, oy) { o.originX = ox; o.originY = oy === undefined ? ox : oy; return o; },
        setText(t) { o.texto = String(t); return o; },
        setVisible(v) { o.visible = v; return o; },
        setAlpha(a) { o.alpha = a; return o; },
        getBounds() {
            return { x: o.x - (o.width || 0) / 2, y: o.y - (o.height || 0) / 2, width: o.width || 0, height: o.height || 0 };
        },
        setScrollFactor: eu, setDepth: eu, setStrokeStyle: eu, setFillStyle: eu,
        setInteractive: eu, disableInteractive: eu, setAngle: eu, setScale: eu,
        setColor: eu, on: eu, off: eu, once: eu, destroy: eu,
        clear: eu, fillStyle: eu, lineStyle: eu, fillRect: eu, strokeRect: eu,
        fillRoundedRect: eu, strokeRoundedRect: eu, slice: eu, fillPath: eu,
        strokePath: eu, beginPath: eu, closePath: eu, moveTo: eu, lineTo: eu,
        fillPoints: eu, fillCircle: eu, generateTexture: eu,
    });
    return o;
}

function cenaFalsa(larguraDaTela, alturaDaTela) {
    const { width, height } = logicalSize(larguraDaTela, alturaDaTela);

    const criados = [];
    const ouvintesDeResize = [];
    const anota = (o) => { criados.push(o); return o; };

    const scale = {
        gameSize: { width, height },
        parentSize: { width: larguraDaTela, height: alturaDaTela },
        displayScale: { x: 1, y: 1 },
        on(_e, cb) { ouvintesDeResize.push(cb); },
        off(_e, cb) {
            const i = ouvintesDeResize.indexOf(cb);
            if (i >= 0) ouvintesDeResize.splice(i, 1);
        },
        setGameSize(w, h) {
            this.gameSize = { width: w, height: h };
            for (const cb of ouvintesDeResize.slice()) cb();
        },
    };

    const teclado = {
        createCursorKeys: () => ({
            left: { isDown: false }, right: { isDown: false },
            up: { isDown: false }, down: { isDown: false },
        }),
        addKeys: () => ({
            up: { isDown: false }, down: { isDown: false },
            left: { isDown: false }, right: { isDown: false },
        }),
        addKey: () => ({ isDown: false }),
        addCapture() {}, removeCapture() {}, on() {}, off() {},
    };

    return {
        scale,
        criados,
        cameras: { main: { width, height } },
        add: {
            text: (x, y, t) => anota(objetoFalso('text', x, y, { texto: String(t || '') })),
            circle: (x, y, r) => anota(objetoFalso('circle', x, y, { raio: r, width: r * 2, height: r * 2 })),
            rectangle: (x, y, w, h) => anota(objetoFalso('rect', x, y, { width: w, height: h })),
            image: (x, y) => anota(objetoFalso('image', x, y)),
            graphics: () => anota(objetoFalso('graphics', 0, 0)),
        },
        make: { graphics: () => objetoFalso('graphics', 0, 0) },
        textures: { exists: () => true },
        input: { addPointer() {}, on() {}, keyboard: teclado },
        events: { once() {} },
        game: { events: { on() {}, off() {} } },
    };
}

/** Está inteiramente dentro da tela? Círculos contam o raio. */
function dentroDaTela(o, vpWidth, vpHeight) {
    const r = o.raio || 0;
    return o.x - r >= 0 && o.y - r >= 0 && o.x + r <= vpWidth && o.y + r <= vpHeight;
}

/** Dois controles de toque encostam um no outro? */
function sobrepoem(a, b) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return d < (a.raio + b.raio);
}

export async function run() {
    pass = 0;
    fail = 0;

    const RESOLUCOES = [
        ['1280x720   16:9   (referencia)', 1280, 720, 1280],
        ['2400x1080  20:9', 2400, 1080, 1600],
        ['2340x1080  19.5:9', 2340, 1080, 1560],
        ['1920x1080  16:9   (desktop comum)', 1920, 1080, 1280],
        ['1366x768   16:9   (desktop comum)', 1366, 768, 1281],
    ];

    for (const [nome, telaW, telaH, larguraEsperada] of RESOLUCOES) {
        console.log('-- ' + nome + ' --');

        const cena = cenaFalsa(telaW, telaH);
        const W = cena.scale.gameSize.width;
        const H = cena.scale.gameSize.height;

        ok(W === larguraEsperada && H === 720, 'tamanho logico ' + W + ' x ' + H);

        const inputs = new InputManager(cena);
        const xp = new XpBar(cena, () => 0);
        const placar = new Scoreboard(cena, () => []);
        const morte = new DeathScreen(cena);
        const resultado = new ResultScreen(cena);

        // --- controles de toque -------------------------------------------
        const controles = [
            ['joystick', inputs.joystickBase, 120, H - 120],
            ['ataque', inputs.attackBase, W - 100, H - 120],
            ['dash', inputs.dashBtn, W - 185, H - 68],
            ['debug', inputs.debugBtn, W - 268, H - 68],
        ];

        let ancorados = true;
        let inteiros = true;
        for (const [rotulo, obj, x, y] of controles) {
            if (!obj) { ancorados = false; console.log('   (ausente: ' + rotulo + ')'); continue; }
            if (!perto(obj.x, x) || !perto(obj.y, y)) ancorados = false;
            if (!dentroDaTela(obj, W, H)) inteiros = false;
        }
        ok(ancorados, 'controles ancorados nos cantos');
        ok(inteiros, 'nenhum controle cortado pela borda');
        ok(inputs.debugBtn && inputs.debugBtn.visible, 'botao DEBUG presente e visivel');

        let livres = true;
        for (let i = 0; i < controles.length; i++) {
            for (let j = i + 1; j < controles.length; j++) {
                const a = controles[i][1];
                const b = controles[j][1];
                if (a && b && sobrepoem(a, b)) {
                    livres = false;
                    console.log('   (encostam: ' + controles[i][0] + ' x ' + controles[j][0] + ')');
                }
            }
        }
        ok(livres, 'controles nao se sobrepoem');

        // O miolo de cada controle nasce em cima da propria base.
        ok(perto(inputs.joystickThumb.x, inputs.joystickBase.x)
            && perto(inputs.joystickThumb.y, inputs.joystickBase.y), 'miolo do joystick sobre a base');
        ok(perto(inputs.attackThumb.x, inputs.attackBase.x)
            && perto(inputs.attackIcon.x, inputs.attackBase.x), 'miolo e espada sobre a base do ataque');
        ok(perto(inputs.dashIcon.x, inputs.dashBtn.x) && perto(inputs.debugLabel.x, inputs.debugBtn.x),
            'icones sobre os respectivos botoes');
        ok(perto(inputs.dashBtnX, inputs.dashBtn.x) && perto(inputs.dashBtnY, inputs.dashBtn.y),
            'centro guardado do dash acompanha o botao (fatia de recarga)');

        // --- HUD de canto ---------------------------------------------------
        ok(perto(xp.x, 16) && perto(xp.y, 42), 'barra de XP no canto superior esquerdo');
        ok(perto(xp.label.x, 16) && perto(xp.aviso.x, 16), 'rotulo e aviso de nivel alinhados com a barra');
        ok(perto(placar.text.x, W / 2) && perto(placar.text.y, 360), 'placar do TAB centralizado');

        // --- telas cheias ---------------------------------------------------
        ok(perto(morte.overlay.width, W) && perto(morte.overlay.height, H),
            'tela de morte cobre a tela inteira');
        ok(perto(morte.title.x, W / 2) && perto(morte.button.x, W / 2), 'tela de morte centralizada');
        ok(dentroDaTela(morte.button, W, H), 'botao RENASCER dentro da tela');

        ok(perto(resultado.overlay.width, W) && perto(resultado.overlay.height, H),
            'tela de resultado cobre a tela inteira');
        ok(perto(resultado.rematch.fundo.x, W / 2 - 150) && perto(resultado.menu.fundo.x, W / 2 + 150),
            'REVANCHE e MENU centralizados em volta do meio');
        ok(resultado.status.y < H && resultado.titulo.y > 0, 'titulo e status dentro da tela');

        // --- HUD de texto da Arena ------------------------------------------
        const arena = Object.create(Arena.prototype);
        arena.add = cena.add;
        arena.scale = cena.scale;
        arena.cameras = cena.cameras;
        arena.events = cena.events;
        arena.createHud.call(arena);

        ok(perto(arena.statusText.x, 16) && perto(arena.statusText.y, 16), 'status no canto superior esquerdo');
        ok(perto(arena.killFeed.x, W - 16) && arena.killFeed.originX === 1,
            'kill feed ancorado a direita (cresce para dentro)');
        ok(perto(arena.teamScoreText.x, W / 2) && arena.teamScoreText.originX === 0.5,
            'placar dos times centralizado no topo');
    }

    // ----------------------------------------------------------------------
    console.log('-- redimensionar em jogo --');
    {
        const cena = cenaFalsa(1280, 720);
        const inputs = new InputManager(cena);
        const xp = new XpBar(cena, () => 0);
        const placar = new Scoreboard(cena, () => []);
        const morte = new DeathScreen(cena);
        const resultado = new ResultScreen(cena);

        const arena = Object.create(Arena.prototype);
        arena.add = cena.add;
        arena.scale = cena.scale;
        arena.cameras = cena.cameras;
        arena.events = cena.events;
        arena.createHud.call(arena);

        const objetosAntes = cena.criados.length;

        // 1280 x 720 -> 1600 x 720, como quem gira um celular 20:9.
        cena.scale.setGameSize(1600, 720);

        ok(cena.criados.length === objetosAntes,
            'nenhum objeto criado no resize (' + objetosAntes + ' antes e depois)');

        ok(perto(inputs.attackBase.x, 1500) && perto(inputs.dashBtn.x, 1415)
            && perto(inputs.debugBtn.x, 1332), 'controles da direita seguiram a borda');
        ok(perto(inputs.joystickBase.x, 120), 'joystick nao se moveu (canto esquerdo)');
        ok(perto(inputs.attackThumb.x, 1500) && perto(inputs.attackIcon.x, 1500),
            'miolo e espada acompanharam a base');
        ok(perto(inputs.dashBtnX, 1415), 'centro da fatia de recarga acompanhou');
        ok(perto(placar.text.x, 800) && perto(morte.title.x, 800) && perto(resultado.titulo.x, 800),
            'telas centralizadas seguiram o novo centro');
        ok(perto(morte.overlay.width, 1600) && perto(resultado.overlay.width, 1600),
            'fundos escuros cobrem a largura nova');
        ok(perto(arena.killFeed.x, 1584) && perto(arena.teamScoreText.x, 800),
            'kill feed e placar de times acompanharam');
        ok(perto(xp.x, 16) && perto(arena.statusText.x, 16), 'canto esquerdo intacto');

        // E de volta, que e o caminho de quem gira o aparelho outra vez.
        cena.scale.setGameSize(1280, 720);
        ok(perto(inputs.attackBase.x, 1180) && perto(placar.text.x, 640),
            'voltar ao 16:9 devolve as posicoes originais');
        ok(cena.criados.length === objetosAntes, 'segundo resize tambem nao cria nada');
    }

    // ----------------------------------------------------------------------
    console.log('-- multitouch preservado --');
    {
        const cena = cenaFalsa(2400, 1080);
        const inputs = new InputManager(cena);

        // Cada controle so responde ao dedo que o pegou. Isto e o que faz
        // joystick + ataque funcionarem ao mesmo tempo.
        const dedoA = { id: 1, x: 120, y: 600 };
        const dedoB = { id: 2, x: 1500, y: 600 };

        inputs.moveStick.grab(dedoA);
        inputs.attackStick.grab(dedoB);
        ok(inputs.moveStick.active && inputs.attackStick.active, 'os dois controles ativos ao mesmo tempo');
        ok(inputs.moveStick.pointerId === 1 && inputs.attackStick.pointerId === 2, 'cada um com o seu pointer.id');
        ok(inputs.moveStick.owns(dedoA) && !inputs.moveStick.owns(dedoB), 'o joystick so ouve o dedo dele');
        ok(inputs.attackStick.owns(dedoB) && !inputs.attackStick.owns(dedoA), 'o ataque so ouve o dedo dele');

        // Soltar um NAO solta o outro (era o bug que o pointer.id resolveu).
        inputs.attackStick.release();
        ok(inputs.moveStick.active === true, 'soltar o ataque nao para o movimento');

        // O dash e o DEBUG sao um terceiro toque: teste de area, sem stick.
        ok(!sobrepoem(inputs.attackBase, inputs.dashBtn), 'ataque e dash continuam separados em 20:9');
        ok(!sobrepoem(inputs.dashBtn, inputs.debugBtn), 'dash e DEBUG continuam separados em 20:9');

        // Redimensionar com um dedo na tela solta os controles, de proposito:
        // a base mudou de lugar e o vetor antigo nao vale mais.
        inputs.moveStick.grab(dedoA);
        cena.scale.setGameSize(1280, 720);
        ok(!inputs.moveStick.active && inputs.moveStick.pointerId === null,
            'resize solta o que estava sendo segurado (sem pointer.id orfao)');
        ok(inputs.moveStick.force.x === 0 && inputs.moveStick.force.y === 0,
            'e zera o vetor, como o BLUR ja fazia');
    }

    return { pass, fail };
}
