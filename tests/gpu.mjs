/**
 * Trabalho de desenho por quadro (Fase F).
 *
 * O que está sob teste:
 *
 *   1. **equivalência** — a barra de vida em coordenadas locais mais a posição
 *      do `Graphics` cai exatamente nos mesmos pixels de mundo que a versão
 *      antiga, que desenhava em coordenadas absolutas;
 *   2. **trabalho evitado** — quantas operações de `Graphics` cada quadro
 *      dispara, com o personagem parado, andando, tomando dano, atacando e com
 *      as hitboxes ligadas. As operações são CONTADAS, não estimadas;
 *   3. **o contador de draw calls** — que ele soma o que o Phaser informa nos
 *      eventos de pipeline e zera a cada quadro.
 *
 * Não dá para automatizar aqui (ver as instruções manuais): FPS e tempo de
 * GPU reais, que saem do `renderReport()` no aparelho.
 */
import './stubs.mjs';

const { paintHealthBar, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT, HEALTH_BAR_OFFSET_Y } =
    await import('./src/utils/HealthBar.mjs');
const { installRenderProbe } = await import('./src/utils/RenderProbe.mjs');
const ArenaActor = (await import('./src/entities/ArenaActor.mjs')).default;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };

/** `Graphics` que anota tudo o que recebe, incluindo a própria posição. */
function graphicsFalso() {
    const ops = [];
    const g = {
        x: 0, y: 0, visible: true, ops,
        conta(nome) { return ops.filter((o) => o[0] === nome).length; },
        zera() { ops.length = 0; },
    };
    const registra = (nome) => (...args) => { ops.push([nome, ...args]); return g; };
    for (const nome of [
        'clear', 'fillStyle', 'lineStyle', 'fillRect', 'strokeRect', 'fillCircle',
        'strokeCircle', 'strokeEllipse', 'fillEllipse', 'beginPath', 'closePath',
        'arc', 'strokePath', 'fillPath', 'moveTo', 'lineTo', 'fillPoints',
        'strokePoints', 'fillTriangle', 'strokeTriangle', 'setDepth',
    ]) g[nome] = registra(nome);

    g.setPosition = (x, y) => { g.x = x; g.y = y; ops.push(['setPosition', x, y]); return g; };
    g.setVisible = (v) => { g.visible = v; ops.push(['setVisible', v]); return g; };
    return g;
}

/** Retângulos em coordenadas de MUNDO que um `Graphics` acabou de desenhar. */
function retangulosDeMundo(g) {
    return g.ops
        .filter((o) => o[0] === 'fillRect')
        .map(([, x, y, w, h]) => ({ x: g.x + x, y: g.y + y, w, h }));
}

/** A conta ANTIGA: retângulos em coordenadas absolutas. */
function barraAntiga(x, y, percent) {
    const largura = 40;
    const altura = 5;
    const bx = x - largura / 2;
    const by = y - 70;
    return [
        { x: bx, y: by, w: largura, h: altura },
        { x: bx, y: by, w: largura * Math.max(0, percent), h: altura },
    ];
}

/** Ator online montado à mão: só o que o desenho por quadro toca. */
function atorFalso({ x = 100, y = 200, hp = 100, maxHp = 100, aura = 0 } = {}) {
    const a = Object.create(ArenaActor.prototype);

    a.x = x;
    a.y = y;
    a.isLocal = false;
    a.localCharging = false;
    a.debugColor = 0x00ff00;

    // `rank`, `collisionRx` e `collisionRy` sao getters derivados do rank:
    // basta dizer qual peca e o resto sai sozinho, como no jogo.
    a._rankKey = 'PAWN';

    a.actorState = {
        rank: 0, team: 0,
        hp, maxHp, aura, attacking: false, charging: false, chargeRatio: 0,
        atkPower: 0, atkDir: 0, atkSide: 1, alive: true, flipX: false, invuln: false,
    };

    a.healthBar = graphicsFalso();
    a.debugGraphics = graphicsFalso();
    a.attackGraphics = graphicsFalso();
    a.chargeGlowGraphics = graphicsFalso();
    a.nameLabel = graphicsFalso();

    a.auraEmitter = {
        tint: 0, frequency: 0, escritas: 0, started: 0, stopped: 0,
        start() { this.started++; }, stop() { this.stopped++; },
        setDepth() {}, setVisible() {},
    };
    // Conta escritas em tint/frequency sem mudar o comportamento.
    let tint = 0;
    let freq = 0;
    Object.defineProperty(a.auraEmitter, 'tint', {
        get: () => tint, set: (v) => { tint = v; a.auraEmitter.escritas++; },
    });
    Object.defineProperty(a.auraEmitter, 'frequency', {
        get: () => freq, set: (v) => { freq = v; a.auraEmitter.escritas++; },
    });

    a._auraEmitterActive = false;
    a.scene = { showHitboxes: false, time: { now: 0 } };
    a.setDepth = () => a;

    a._initDrawCache();
    return a;
}

/**
 * Operações de DESENHO de um `Graphics`: as que constroem o desenho.
 *
 * `setDepth`, `setPosition` e `setVisible` ficam de fora de propósito — são
 * transformações, o mesmo que o Phaser já faz para qualquer sprite, e mover a
 * barra em vez de redesenhá-la é justamente o que esta fase passou a fazer.
 */
const TRANSFORMACOES = new Set(['setDepth', 'setPosition', 'setVisible']);

function opsDeDesenho(g) {
    return g.ops.filter((o) => !TRANSFORMACOES.has(o[0])).length;
}

/** Total de operações de desenho em todos os Graphics do ator. */
function opsDoAtor(a) {
    return opsDeDesenho(a.healthBar) + opsDeDesenho(a.debugGraphics)
        + opsDeDesenho(a.attackGraphics) + opsDeDesenho(a.chargeGlowGraphics);
}

function zeraOps(a) {
    a.healthBar.zera();
    a.debugGraphics.zera();
    a.attackGraphics.zera();
    a.chargeGlowGraphics.zera();
}

export async function run() {
    pass = 0;
    fail = 0;

    // ----------------------------------------------------------------------
    console.log('-- 1. barra de vida: mesmos pixels da versao antiga --');
    {
        let iguais = true;
        let casos = 0;

        for (const x of [0, 100, 640.5, 4991]) {
            for (const y of [0, 200, 359.25, 1683]) {
                for (const pct of [0, 0.01, 0.5, 0.999, 1]) {
                    const g = graphicsFalso();
                    g.setPosition(x, y + HEALTH_BAR_OFFSET_Y);
                    g.zera();
                    paintHealthBar(g, pct);

                    const novos = retangulosDeMundo(g);
                    const velhos = barraAntiga(x, y, pct);
                    casos++;

                    if (novos.length !== velhos.length) { iguais = false; continue; }
                    for (let i = 0; i < novos.length; i++) {
                        const n = novos[i];
                        const v = velhos[i];
                        if (Math.abs(n.x - v.x) > 1e-9 || Math.abs(n.y - v.y) > 1e-9
                            || Math.abs(n.w - v.w) > 1e-9 || Math.abs(n.h - v.h) > 1e-9) iguais = false;
                    }
                }
            }
        }

        ok(iguais, casos + ' combinacoes de posicao x vida: retangulos identicos aos de antes');
        ok(HEALTH_BAR_WIDTH === 40 && HEALTH_BAR_HEIGHT === 5 && HEALTH_BAR_OFFSET_Y === -70,
            'medidas preservadas: 40 x 5, 70 px acima do personagem');

        // Fracao fora da faixa nao vaza para o desenho.
        const g = graphicsFalso();
        paintHealthBar(g, 2);
        ok(retangulosDeMundo(g)[1].w === HEALTH_BAR_WIDTH, 'vida acima de 100% nao estoura a barra');
        g.zera();
        paintHealthBar(g, -1);
        ok(retangulosDeMundo(g)[1].w === 0, 'vida negativa nao desenha barra invertida');
    }

    // ----------------------------------------------------------------------
    console.log('-- 2. personagem parado: quanto trabalho por quadro --');
    {
        const a = atorFalso();

        a.commonUpdate();                 // primeiro quadro: desenha a barra
        const primeiro = opsDoAtor(a);
        ok(primeiro > 0, 'primeiro quadro desenha (' + primeiro + ' operacoes)');

        zeraOps(a);
        for (let i = 0; i < 60; i++) a.commonUpdate();
        const regime = opsDoAtor(a);

        ok(regime === 0, '60 quadros seguintes: ' + regime + ' operacoes de Graphics (era 240 -- 4 por quadro)');
        ok(a.healthBar.x === a.x && a.healthBar.y === a.y + HEALTH_BAR_OFFSET_Y,
            'a barra continua posicionada sobre o personagem');
    }

    // ----------------------------------------------------------------------
    console.log('-- 3. andando: a barra acompanha sem redesenhar --');
    {
        const a = atorFalso();
        a.commonUpdate();
        zeraOps(a);

        for (let i = 0; i < 60; i++) {
            a.x += 3;
            a.y += 1;
            a.commonUpdate();
        }

        ok(a.healthBar.conta('clear') === 0, 'nenhuma limpeza da barra em 60 quadros de movimento');
        ok(a.healthBar.conta('fillRect') === 0, 'nenhum retangulo redesenhado');
        ok(a.healthBar.x === a.x && a.healthBar.y === a.y + HEALTH_BAR_OFFSET_Y,
            'a barra acompanhou ate o fim (' + a.healthBar.x + ', ' + a.healthBar.y + ')');
    }

    // ----------------------------------------------------------------------
    console.log('-- 4. dano: a barra volta a ser desenhada --');
    {
        const a = atorFalso();
        a.commonUpdate();
        zeraOps(a);

        a.actorState.hp = 75;
        a.commonUpdate();
        ok(a.healthBar.conta('fillRect') === 2, 'o dano redesenha a barra (2 retangulos)');

        const largura = retangulosDeMundo(a.healthBar)[1].w;
        ok(largura === HEALTH_BAR_WIDTH * 0.75, 'a barra mostra 75% (' + largura + ' de ' + HEALTH_BAR_WIDTH + ')');

        zeraOps(a);
        for (let i = 0; i < 30; i++) a.commonUpdate();
        ok(opsDoAtor(a) === 0, 'e volta a nao desenhar nada enquanto a vida nao muda');
    }

    // ----------------------------------------------------------------------
    console.log('-- 5. hitboxes: so trabalham quando ligadas --');
    {
        const a = atorFalso();
        a.getEllipseCenter = () => ({ x: a.x, y: a.y });

        a.commonUpdate();
        zeraOps(a);

        for (let i = 0; i < 30; i++) a.commonUpdate();
        ok(opsDeDesenho(a.debugGraphics) === 0, 'desligadas: zero operacoes em 30 quadros (era 1 limpeza por quadro)');

        a.scene.showHitboxes = true;
        a.commonUpdate();
        ok(a.debugGraphics.conta('clear') === 1 && a.debugGraphics.conta('strokeEllipse') === 3,
            'ligadas: desenha as tres elipses');

        a.scene.showHitboxes = false;
        a.debugGraphics.zera();
        a.commonUpdate();
        ok(a.debugGraphics.conta('clear') === 1, 'desligar limpa UMA vez');

        a.debugGraphics.zera();
        for (let i = 0; i < 30; i++) a.commonUpdate();
        ok(opsDeDesenho(a.debugGraphics) === 0, 'e depois volta a nao fazer nada');
    }

    // ----------------------------------------------------------------------
    console.log('-- 6. golpe: limpa ao acabar, uma vez --');
    {
        const a = atorFalso();
        a.getEllipseCenter = () => ({ x: a.x, y: a.y });

        a.commonUpdate();
        zeraOps(a);

        a.actorState.attacking = true;
        a.commonUpdate();
        ok(a.attackGraphics.conta('clear') === 1, 'atacando: limpa e desenha a forma');
        ok(opsDeDesenho(a.attackGraphics) > 1, 'a forma do golpe foi desenhada');

        a.attackGraphics.zera();
        a.actorState.attacking = false;
        a.commonUpdate();
        ok(a.attackGraphics.conta('clear') === 1, 'ao acabar, limpa UMA vez');

        a.attackGraphics.zera();
        for (let i = 0; i < 30; i++) a.commonUpdate();
        ok(opsDeDesenho(a.attackGraphics) === 0, 'e nao limpa mais (era 1 limpeza por quadro para sempre)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 7. aura: cor e cadencia so quando a aura muda --');
    {
        const a = atorFalso({ aura: 0 });

        a.commonUpdate();
        ok(a.auraEmitter.started === 0 && a.auraEmitter.escritas === 0, 'sem aura: emissor parado, nada escrito');

        a.actorState.aura = 40;
        a.commonUpdate();
        ok(a.auraEmitter.started === 1, 'aura > 0 liga o emissor');
        const apos = a.auraEmitter.escritas;
        ok(apos === 2, 'cor e cadencia escritas uma vez cada');

        for (let i = 0; i < 60; i++) a.commonUpdate();
        ok(a.auraEmitter.escritas === apos, '60 quadros com a mesma aura: nenhuma escrita nova (eram 120)');

        a.actorState.aura = 120;
        a.commonUpdate();
        ok(a.auraEmitter.escritas === apos + 2, 'abate novo reescreve cor e cadencia');

        a.actorState.aura = 0;
        a.commonUpdate();
        ok(a.auraEmitter.stopped === 1, 'morte para o emissor');
    }

    // ----------------------------------------------------------------------
    console.log('-- 8. visibilidade: so quando muda --');
    {
        const a = atorFalso();

        a.setVisualsVisible(true);
        const primeiras = a.healthBar.conta('setVisible');
        ok(primeiras === 1, 'primeira chamada aplica');

        for (let i = 0; i < 60; i++) a.setVisualsVisible(true);
        ok(a.healthBar.conta('setVisible') === 1, '60 chamadas iguais: nenhuma escrita nova (eram 60 x 6)');

        a.setVisualsVisible(false);
        ok(a.healthBar.conta('setVisible') === 2, 'mudar de valor aplica');
    }

    // ----------------------------------------------------------------------
    console.log('-- 9. carga: Graphics vazio nao e limpo --');
    {
        const a = atorFalso();
        a.commonUpdate();
        zeraOps(a);

        for (let i = 0; i < 60; i++) a.commonUpdate();
        ok(opsDeDesenho(a.chargeGlowGraphics) === 0,
            'sem carga: zero operacoes em 60 quadros (era 1 limpeza por quadro)');

        a.actorState.charging = true;
        a.actorState.chargeRatio = 50;
        a.commonUpdate();
        ok(a.chargeGlowGraphics.conta('clear') === 1 && a.chargeGlowGraphics.conta('fillCircle') === 1,
            'carregando: o brilho aparece normalmente');

        a.chargeGlowGraphics.zera();
        a.actorState.charging = false;
        a.commonUpdate();
        ok(a.chargeGlowGraphics.conta('clear') === 1, 'soltar limpa uma vez');
    }

    // ----------------------------------------------------------------------
    console.log('-- 10. pior caso: 10 atores --');
    {
        const atores = [];
        for (let i = 0; i < 10; i++) atores.push(atorFalso({ x: 100 + i * 50, aura: 100 }));

        for (const a of atores) a.commonUpdate();
        for (const a of atores) zeraOps(a);

        // Um segundo de jogo com todo mundo andando e com aura.
        for (let q = 0; q < 60; q++) {
            for (const a of atores) {
                a.x += 2;
                a.commonUpdate();
            }
        }

        const total = atores.reduce((s, a) => s + opsDoAtor(a), 0);
        // Antes, por ator e por quadro: barra de vida (1 clear + 2 fillStyle +
        // 2 fillRect) + 1 clear da hitbox + 1 clear da carga + 1 clear do
        // golpe = 8.
        const antes = 10 * 60 * 8;
        ok(total === 0, '10 atores x 60 quadros: ' + total + ' operacoes de Graphics (antes eram ' + antes + ')');

        const escritas = atores.reduce((s, a) => s + a.auraEmitter.escritas, 0);
        ok(escritas === 20, 'escritas no emissor: ' + escritas + ' (2 por ator, uma vez -- eram 1200)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 11. contador de draw calls --');
    {
        const ouvintes = { beforeFlush: [], pre: [], post: [] };

        const pipeline = {
            batch: [],
            on(evento, cb) { if (evento === 'pipelinebeforeflush') ouvintes.beforeFlush.push(cb); },
        };
        const semLote = { on(evento, cb) { if (evento === 'pipelinebeforeflush') ouvintes.beforeFlush.push(cb); } };

        const jogo = {
            renderer: {
                drawCount: undefined,
                pipelines: {
                    pipelines: {
                        each(cb) { cb('MultiPipeline', pipeline); cb('Utility', semLote); },
                    },
                },
            },
            events: {
                on(evento, cb) {
                    if (evento === 'prerender') ouvintes.pre.push(cb);
                    if (evento === 'postrender') ouvintes.post.push(cb);
                },
            },
            scene: { getScenes: () => [] },
        };

        const snapshot = installRenderProbe(jogo);

        // A primeira consulta liga os contadores; ainda nao ha quadro fechado.
        const inicial = snapshot();
        ok(inicial.drawCalls === 0 && inicial.flushes === 0, 'antes do primeiro quadro: zerado');
        ok(ouvintes.beforeFlush.length === 2, 'assinou os dois pipelines');
        ok(ouvintes.pre.length === 1 && ouvintes.post.length === 1, 'assinou inicio e fim de quadro');

        // Um flush de verdade avisa SÓ o ouvinte do pipeline que fez o flush.
        // Como os dois pipelines registram a mesma função, chamá-la uma vez por
        // flush reproduz o que o Phaser faz.
        const flush = (alvo) => ouvintes.beforeFlush[0](alvo);

        const quadro = (lotes) => {
            for (const cb of ouvintes.pre) cb();
            for (const n of lotes) {
                pipeline.batch = new Array(n).fill(0);
                flush(pipeline);
            }
            for (const cb of ouvintes.post) cb();
        };

        // Dois flushes: um com 3 trechos, outro com 5 -> 8 chamadas de desenho.
        quadro([3, 5]);
        const r1 = snapshot();
        ok(r1.flushes === 2, 'contou 2 flushes');
        ok(r1.drawCalls === 8, 'contou 8 draw calls (soma dos trechos de cada lote)');

        // Quadro seguinte, mais leve: o contador tem de ZERAR, nao acumular.
        quadro([1]);
        const r2 = snapshot();
        ok(r2.flushes === 1 && r2.drawCalls === 1, 'o quadro seguinte zera e reconta');

        // Pipeline sem `batch` conta como uma chamada, nao como zero.
        for (const cb of ouvintes.pre) cb();
        flush(semLote);
        for (const cb of ouvintes.post) cb();
        ok(snapshot().drawCalls === 1, 'pipeline sem lote conta 1 por flush');
    }

    // ----------------------------------------------------------------------
    console.log('-- 12. contagem de objetos de cena --');
    {
        const emissor = {
            type: 'ParticleEmitter',
            getAliveParticleCount: () => 16,
        };
        const cena = {
            sys: { isVisible: () => true },
            children: {
                list: [
                    { type: 'Sprite' }, { type: 'Sprite' },
                    { type: 'Image' },
                    { type: 'Graphics' }, { type: 'Graphics' }, { type: 'Graphics' },
                    { type: 'Text' },
                    { type: 'Arc', geom: {} },
                    emissor, emissor,
                ],
            },
            textures: { list: { grass: 1, pawn: 1, 'aura-particle': 1 } },
        };

        const jogo = {
            renderer: { pipelines: null },
            events: { on() {} },
            scene: { getScenes: () => [cena] },
        };

        const r = installRenderProbe(jogo)();
        ok(r.displayObjects === 10, 'objetos na lista de desenho: ' + r.displayObjects);
        ok(r.sprites === 2 && r.images === 1 && r.graphics === 3 && r.texts === 1 && r.shapes === 1,
            'separados por tipo');
        ok(r.emitters === 2 && r.particles === 32, 'particulas VIVAS somadas: ' + r.particles);
        ok(r.textures === 3, 'texturas carregadas: ' + r.textures);
        ok(r.drawCalls === null, 'sem renderizador WebGL, draw calls nao sao inventados (null)');
    }

    return { pass, fail };
}
