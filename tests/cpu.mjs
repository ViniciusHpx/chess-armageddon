/**
 * Custo de CPU por quadro (Fase G).
 *
 * O que está sob teste:
 *
 *   1. o **medidor** (`cpuReport`) — que ele mede as três fases do quadro pelos
 *      eventos do Phaser, calcula média/p50/p95/máximo corretamente, conta as
 *      entidades certas nos dois modos e é honesto sobre o que não sabe;
 *   2. as duas mudanças implementadas — o laço de atores e o placar de times —
 *      com ênfase em **comportamento igual ao de antes**.
 *
 * Não dá para automatizar aqui (ver as instruções manuais): o tempo real de
 * quadro num aparelho, a atribuição por subsistema (DevTools) e o tempo de GPU.
 */
import './stubs.mjs';

const { installCpuProbe } = await import('./src/utils/CpuProbe.mjs');
const { Arena } = await import('./src/scenes/Arena.mjs');
const { GAME_MODES, TEAM_KILL_LIMIT } = await import('./src/constants/Hierarchy.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };

/** Jogo falso com o laço do Phaser sob controle do teste. */
function jogoFalso(cena) {
    const ouvintes = { pre: [], preRender: [], post: [] };

    return {
        ouvintes,
        loop: { actualFps: 60, targetFps: 60 },
        events: {
            on(evento, cb) {
                if (evento === 'prestep') ouvintes.pre.push(cb);
                if (evento === 'prerender') ouvintes.preRender.push(cb);
                if (evento === 'postrender') ouvintes.post.push(cb);
            },
        },
        scene: { getScenes: () => (cena ? [cena] : []) },
    };
}

/**
 * Roda um quadro com durações escolhidas.
 *
 * `performance.now` é substituído por um relógio de teste: o medidor tem de
 * devolver exatamente os números que o relógio deu, sem arredondamento perdido.
 */
function rodaQuadro(jogo, relogio, msLogica, msDesenho) {
    for (const cb of jogo.ouvintes.pre) cb();
    relogio.avanca(msLogica);
    for (const cb of jogo.ouvintes.preRender) cb();
    relogio.avanca(msDesenho);
    for (const cb of jogo.ouvintes.post) cb();
}

function relogioFalso() {
    let t = 1000;
    const original = globalThis.performance.now;
    globalThis.performance.now = () => t;
    return {
        avanca(ms) { t += ms; },
        get agora() { return t; },
        restaura() { globalThis.performance.now = original; },
    };
}

/** Cena `Arena` mínima, só com o que o `update` toca. */
function arenaFalsa(atores) {
    const cena = Object.create(Arena.prototype);
    const sincronizados = [];

    Object.assign(cena, {
        actors: new Map(atores.map((a) => [a.chave, a])),
        room: { sessionId: 'eu', state: {}, send() {} },
        conectado: true,
        predReady: true,
        predX: 640,
        predY: 360,
        localTeam: 0,
        localCharging: false,
        inputSeq: 0,
        pendingInputs: [],
        cameraLocked: true,
        ressincronizar: false,
        sincronizados,
        teamScoreText: { text: '', escritas: 0, setText(t) { this.text = t; this.escritas++; } },
        inputs: {
            update() {}, setDashCooldown() {},
            getDebugState: () => ({ justPressed: false }),
        },
        xpBar: { update() {} },
        scoreboard: { update() {} },
        time: { now: 0 },
    });

    cena._placarMeu = null;
    cena._placarOutro = null;

    // Fora do que se está medindo.
    cena.sendInput = () => {};
    cena.stepPrediction = () => {};
    cena.updateDeathScreen = () => {};
    cena.updateMatchEnd = () => {};
    cena.followLocalActor = () => {};
    cena.dashCooldownRatio = () => 0;
    cena.localChargeRatio = () => 0.5;
    cena.localState = () => null;

    return cena;
}

function atorFalso(chave, isLocal) {
    return {
        chave, isLocal,
        recebeu: [],
        localCharging: null,
        localChargeRatio: null,
        sync(now, predicted) { this.recebeu.push(predicted); },
    };
}

export async function run() {
    pass = 0;
    fail = 0;

    // ----------------------------------------------------------------------
    console.log('-- 1. medidor: arma na primeira consulta --');
    {
        const jogo = jogoFalso(null);
        const cpu = installCpuProbe(jogo);

        ok(jogo.ouvintes.pre.length === 0, 'antes da primeira consulta: nenhum ouvinte (custo zero)');

        const primeiro = cpu();
        ok(primeiro.armado === false, 'a primeira consulta avisa que acabou de armar');
        ok(primeiro.amostras === 0, 'e ainda nao tem amostra');
        ok(jogo.ouvintes.pre.length === 1 && jogo.ouvintes.preRender.length === 1
            && jogo.ouvintes.post.length === 1, 'assinou as tres marcacoes do quadro');

        cpu();
        ok(jogo.ouvintes.pre.length === 1, 'consultar de novo nao assina duas vezes');
    }

    // ----------------------------------------------------------------------
    console.log('-- 2. medidor: separa logica de desenho --');
    {
        const relogio = relogioFalso();
        try {
            const jogo = jogoFalso(null);
            const cpu = installCpuProbe(jogo);
            cpu();

            rodaQuadro(jogo, relogio, 4, 2);
            const r = cpu();

            ok(r.armado === true && r.amostras === 1, 'um quadro medido');
            ok(r.logica.media === 4, 'logica = 4 ms (PRE_STEP -> PRE_RENDER)');
            ok(r.desenho.media === 2, 'desenho = 2 ms (PRE_RENDER -> POST_RENDER)');
            ok(r.quadro.media === 6, 'quadro = 6 ms (a soma)');
            ok(r.orcamentoMs === 1000 / 60, 'orcamento do quadro a 60 fps: ' + r.orcamentoMs.toFixed(2) + ' ms');
        } finally {
            relogio.restaura();
        }
    }

    // ----------------------------------------------------------------------
    console.log('-- 3. medidor: media, mediana, p95 e maximo --');
    {
        const relogio = relogioFalso();
        try {
            const jogo = jogoFalso(null);
            const cpu = installCpuProbe(jogo);
            cpu();

            // 99 quadros de 10 ms e 1 engasgo de 100 ms.
            for (let i = 0; i < 99; i++) rodaQuadro(jogo, relogio, 10, 0);
            rodaQuadro(jogo, relogio, 100, 0);

            const r = cpu();
            ok(r.amostras === 100, '100 amostras');
            ok(r.quadro.p50 === 10, 'p50 = 10 ms: a mediana ignora o engasgo');
            ok(r.quadro.max === 100, 'max = 100 ms: o engasgo aparece');
            ok(r.quadro.media === 10.9, 'media = 10,9 ms: quase nao mostra o engasgo');
            ok(r.quadro.p95 === 10, 'p95 = 10 ms com um engasgo em cem');

            // 5 em 104 ainda e 4,8% e o p95 continua limpo — e esse e o ponto
            // do percentil. Passando de 5%, ele acusa.
            for (let i = 0; i < 4; i++) rodaQuadro(jogo, relogio, 100, 0);
            ok(cpu().quadro.p95 === 10, '5 engasgos em 104 (4,8%): p95 ainda limpo');

            for (let i = 0; i < 1; i++) rodaQuadro(jogo, relogio, 100, 0);
            ok(cpu().quadro.p95 === 100, '6 engasgos em 105 (5,7%): o p95 acusa');
        } finally {
            relogio.restaura();
        }
    }

    // ----------------------------------------------------------------------
    console.log('-- 4. medidor: anel de tamanho fixo --');
    {
        const relogio = relogioFalso();
        try {
            const jogo = jogoFalso(null);
            const cpu = installCpuProbe(jogo);
            cpu();

            for (let i = 0; i < 600; i++) rodaQuadro(jogo, relogio, 5, 1);
            const r = cpu();

            ok(r.amostras === 240, '600 quadros medidos, ' + r.amostras + ' guardados (~4 s a 60 fps)');
            ok(r.quadro.media === 6, 'e as contas continuam certas');
        } finally {
            relogio.restaura();
        }
    }

    // ----------------------------------------------------------------------
    console.log('-- 5. medidor: contagem online --');
    {
        const cena = {
            sys: { isVisible: () => true },
            actors: new Map([
                ['eu', { snapshots: [{ t: 100 }, { t: 150 }, { t: 200 }] }],
                ['bot1', { snapshots: [{ t: 100 }, { t: 150 }] }],
            ]),
            pendingInputs: [1, 2, 3],
            conectado: true,
            inputSeq: 40,
        };

        const jogo = jogoFalso(cena);
        const cpu = installCpuProbe(jogo);
        const r = cpu();

        ok(r.modo === 'online', 'reconheceu o modo online');
        ok(r.entidades.atores === 2, 'contou os atores');
        ok(r.entidades.amostrasDeInterpolacao === 5, 'somou as amostras do buffer de interpolacao');
        ok(r.entidades.entradasPendentes === 3, 'contou as entradas ainda nao confirmadas');
        ok(r.intervaloEntrePatchesMs === 50,
            'intervalo entre patches lido do proprio buffer: ' + r.intervaloEntrePatchesMs + ' ms');
        ok(r.entradasPorSegundo === null, 'taxa de envio so na segunda consulta');

        // Segunda consulta: 20 pacotes a mais.
        const relogio = relogioFalso();
        try {
            relogio.avanca(1000);
            cena.inputSeq = 60;
            const r2 = cpu();
            ok(r2.entradasPorSegundo !== null, 'a segunda consulta ja da a taxa (' + r2.entradasPorSegundo + '/s)');
        } finally {
            relogio.restaura();
        }
    }

    // ----------------------------------------------------------------------
    console.log('-- 6. medidor: contagem offline --');
    {
        const cena = {
            sys: { isVisible: () => true },
            alliedPlayers: { getLength: () => 5 },
            enemyPlayers: { getLength: () => 5 },
        };

        const r = installCpuProbe(jogoFalso(cena))();
        ok(r.modo === 'offline', 'reconheceu o modo offline');
        ok(r.entidades.aliados === 5 && r.entidades.inimigos === 5, '4 bots por time + o jogador: 5 e 5');
        ok(r.intervaloEntrePatchesMs === null, 'offline nao tem patch');
    }

    // ----------------------------------------------------------------------
    console.log('-- 7. medidor: honesto sobre o que nao mede --');
    {
        const r = installCpuProbe(jogoFalso(null))();
        ok(/DevTools/.test(r.atribuicaoPorSubsistema), 'atribuicao por subsistema: aponta o DevTools');
        ok(/nao exposto/.test(r.tempoDeGpu), 'tempo de GPU: diz que o navegador nao expoe');
        ok(r.quadro.media === null, 'sem amostra, nao inventa numero (null, nao zero)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 8. laco de atores: mesma decisao de antes --');
    {
        const eu = atorFalso('eu', true);
        const bot1 = atorFalso('bot1', false);
        const bot2 = atorFalso('bot2', false);
        const cena = arenaFalsa([eu, bot1, bot2]);

        cena.update(0, 16);

        ok(eu.recebeu.length === 1 && eu.recebeu[0] !== null, 'o ator local recebe a posicao prevista');
        ok(eu.recebeu[0].x === 640 && eu.recebeu[0].y === 360, 'e ela e a previsao da cena');
        ok(bot1.recebeu[0] === null && bot2.recebeu[0] === null,
            'os outros recebem null e caem na interpolacao');
        ok(eu.localCharging === false && bot1.localChargeRatio === 0,
            'carga local so vale para o ator local');

        // Sem previsao pronta, nem o local recebe.
        cena.predReady = false;
        cena.update(0, 16);
        ok(eu.recebeu[1] === null, 'sem previsao pronta, ninguem recebe posicao prevista');

        // A regra e `isLocal`, que o `onAdd` derivou de `key === sessionId`.
        // Trocar o `sessionId` depois NAO pode mudar quem e o local.
        cena.predReady = true;
        cena.room.sessionId = 'outro';
        cena.update(0, 16);
        ok(eu.recebeu[2] !== null && bot1.recebeu[2] === null,
            'o ator local continua sendo o mesmo (isLocal, nao a chave do momento)');
    }

    // ----------------------------------------------------------------------
    console.log('-- 9. placar de times: so escreve quando muda --');
    {
        const cena = arenaFalsa([]);
        cena.room.state = { mode: GAME_MODES.indexOf('team_deathmatch'), scoreAlly: 0, scoreEnemy: 0 };

        cena.updateTeamScore();
        ok(cena.teamScoreText.escritas === 1, 'primeiro quadro escreve');
        ok(cena.teamScoreText.text === 'SEU TIME 0  x  0 INIMIGOS   (até ' + TEAM_KILL_LIMIT + ')',
            'texto igual ao de antes: "' + cena.teamScoreText.text + '"');

        for (let i = 0; i < 60; i++) cena.updateTeamScore();
        ok(cena.teamScoreText.escritas === 1,
            '60 quadros sem abate: nenhuma escrita nova (eram 60 strings montadas e jogadas fora)');

        cena.room.state.scoreAlly = 3;
        cena.updateTeamScore();
        ok(cena.teamScoreText.escritas === 2, 'um abate escreve de novo');
        ok(cena.teamScoreText.text === 'SEU TIME 3  x  0 INIMIGOS   (até ' + TEAM_KILL_LIMIT + ')',
            'com o placar novo');

        // O time do jogador manda no lado: inverter o time inverte a leitura.
        cena.localTeam = 1;
        cena.updateTeamScore();
        ok(cena.teamScoreText.text === 'SEU TIME 0  x  3 INIMIGOS   (até ' + TEAM_KILL_LIMIT + ')',
            'pelo time inimigo o placar aparece invertido');

        // Modo sem condicao de vitoria: limpa e nao volta a escrever.
        cena.room.state.mode = GAME_MODES.indexOf('free_for_all');
        cena.updateTeamScore();
        ok(cena.teamScoreText.text === '', 'modo sem vitoria limpa o placar');
        const apos = cena.teamScoreText.escritas;
        for (let i = 0; i < 30; i++) cena.updateTeamScore();
        ok(cena.teamScoreText.escritas === apos, 'e nao fica reescrevendo vazio');
    }

    return { pass, fail };
}
