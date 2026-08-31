/**
 * Ciclo de vida da conexão da cena `Arena`: segundo plano, queda, reconexão e
 * saída voluntária.
 *
 * O que está sob teste é a MÁQUINA DE ESTADO da cena, não o Phaser nem o
 * Colyseus. Por isso a sala é uma `FakeRoom` que reproduz a superfície do
 * `Room` do SDK 0.17 que a cena usa — inclusive o detalhe que sustenta o
 * desenho todo: reconectar reaproveita o MESMO objeto `Room`, então listeners
 * e decoder sobrevivem e não há o que refazer.
 *
 * Não dá para automatizar aqui (ver as instruções de teste manual):
 *   - o socket de verdade caindo e voltando contra o servidor;
 *   - o navegador do celular congelando/descartando a página em segundo plano;
 *   - o `pagehide` real com `persisted` verdadeiro (depende do bfcache).
 */
import { CloseCode } from './stubs.mjs';

const { Arena } = await import('./src/scenes/Arena.mjs');
const { tuneReconnection, RECONNECTION_SECONDS } = await import('./src/net/netconfig.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ', m); } else { fail++; console.log('FAIL ', m); } };
const linha1 = (t) => String(t).split(String.fromCharCode(10))[0];

// --------------------------------------------------------------------------
// Sala falsa: reproduz a superficie do `Room` do SDK 0.17 que a cena usa,
// incluindo o fato de o objeto ser o MESMO antes e depois de reconectar.
// --------------------------------------------------------------------------
class FakeRoom {
    constructor() {
        this.sessionId = 'eu';
        this.aberto = true;
        this.enviados = [];
        this.enfileirados = [];
        this.leaveCalls = [];
        this.state = { actors: new Map(), winner: -1, mode: 0, scoreAlly: 0, scoreEnemy: 0, rematchRoomId: '' };
        this.reconnection = {
            enabled: true, retryCount: 0, maxRetries: 15, delay: 100,
            minDelay: 100, maxDelay: 5000, minUptime: 5000,
            backoff: (tentativa, delay) => Math.floor(Math.pow(2, tentativa) * delay),
            maxEnqueuedMessages: 10, enqueuedMessages: [], isReconnecting: false,
        };
        this._cbs = { onAdd: [], onRemove: [], state: [], msg: [], drop: [], reconnect: [], leave: [], error: [] };
    }
    onStateChange(cb) { this._cbs.state.push(cb); }
    onMessage(t, cb) { this._cbs.msg.push(cb); }
    onDrop(cb) { this._cbs.drop.push(cb); }
    onReconnect(cb) { this._cbs.reconnect.push(cb); }
    onLeave(cb) { this._cbs.leave.push(cb); }
    onError(cb) { this._cbs.error.push(cb); }
    send(tipo, corpo) {
        // Mesma regra do SDK: com o socket fechado a mensagem e ENFILEIRADA e
        // despejada na volta - e disso que a cena tem de se proteger.
        if (this.aberto) this.enviados.push([tipo, corpo]);
        else this.enfileirados.push([tipo, corpo]);
    }
    leave(consented = true) { this.leaveCalls.push(consented); this.aberto = false; }

    // --- eventos que o SDK dispara ---
    cair() { this.aberto = false; this.reconnection.isReconnecting = true; this._cbs.drop.forEach((c) => c(1006, 'drop')); }
    voltar() { this.aberto = true; this.reconnection.isReconnecting = false; this._cbs.reconnect.forEach((c) => c()); }
    desistir() { this._cbs.leave.forEach((c) => c(CloseCode.FAILED_TO_RECONNECT, 'no more retries')); }
    encerrar(code) { this._cbs.leave.forEach((c) => c(code)); }
}

function novaCena(room) {
    const cena = Object.create(Arena.prototype);
    const timers = [];

    Object.assign(cena, {
        actors: new Map(), room, localTeam: 0, cameraLocked: true,
        conectado: true, saindo: false, ressincronizar: false,
        predX: 0, predY: 0, predReady: false,
        lastSentDx: 0, lastSentDy: 0, lastSentAx: 0, lastSentAy: 0, lastInputSentAt: 999,
        inputSeq: 0, pendingInputs: [], segDx: 0, segDy: 0,
        localCharging: true, localChargeStart: 0, localAttackReadyAt: 0,
        localAttackPending: false, localAttackSentAt: 0,
        localDashUntil: 0, localDashRemaining: 0, localDashPhasing: false,
        wantRematch: false, showHitboxes: false,
        statusText: { texto: '', setText(t) { this.texto = t; } },
        time: { now: 0, delayedCall: (ms, cb) => { timers.push({ ms, cb }); return {}; } },
        inputs: {
            update() {}, setDashCooldown() {},
            getMovementVector: () => ({ dx: 0, dy: 0 }),
            getAttackVector: () => ({ ax: 0, ay: 0 }),
            getAttackState: () => ({ held: false, justPressed: false, justReleased: false }),
            getDashState: () => ({ justPressed: false }),
            getDebugState: () => ({ justPressed: false }),
        },
        xpBar: { update() {} }, scoreboard: { update() {} },
        deathScreen: { isVisible: false, show(cb) { this.isVisible = true; this.cb = cb; }, hide() { this.isVisible = false; } },
        resultScreen: { isVisible: false, show() {}, hide() {}, setStatus() {} },
        timers,
    });

    // Sob teste esta o CICLO DE VIDA, nao a previsao nem o HUD: estes viram
    // contadores para se poder afirmar que foram (ou nao) chamados.
    cena.enviosDeEntrada = 0;
    cena.passosDePrevisao = 0;
    cena.sendInput = () => { cena.enviosDeEntrada++; };
    cena.stepPrediction = () => { cena.passosDePrevisao++; };
    cena.dashCooldownRatio = () => 0;
    cena.updateMatchEnd = () => {};
    cena.updateTeamScore = () => {};
    cena.followLocalActor = () => {};
    return cena;
}

const ator = (x, y) => ({ x, y, rank: 0, team: 0, alive: true, dashCd: 0, xp: 0, kills: 0, deaths: 0, name: 'eu' });

export async function run() {
    pass = 0;
    fail = 0;

    // --------------------------------------------------------------------------
    console.log('-- 1. conexao normal --');
    {
        const room = new FakeRoom();
        room.state.actors.set('eu', ator(100, 200));
        const cena = novaCena(room);
        cena.bindRoom(room);

        const c = room._cbs;
        ok(c.onAdd.length === 1 && c.onRemove.length === 1, 'onAdd/onRemove registrados uma vez');
        ok(c.state.length === 1 && c.msg.length === 1, 'onStateChange e onMessage(kill) registrados uma vez');
        ok(c.drop.length === 1 && c.reconnect.length === 1, 'onDrop e onReconnect registrados uma vez');
        ok(c.leave.length === 1 && c.error.length === 1, 'onLeave e onError registrados uma vez');

        cena.update(0, 16);
        ok(cena.enviosDeEntrada === 1 && cena.passosDePrevisao === 1, 'conectado: entrada enviada e previsao andando');
    }

    // --------------------------------------------------------------------------
    console.log('-- 2. reconexao ajustada a janela do servidor --');
    {
        const room = new FakeRoom();
        tuneReconnection(room);
        const r = room.reconnection;

        let soma = 0;
        for (let i = 1; i <= r.maxRetries; i++) soma += Math.min(r.maxDelay, Math.max(r.minDelay, r.backoff(i, r.delay)));
        const proxima = Math.min(r.maxDelay, Math.max(r.minDelay, r.backoff(r.maxRetries + 1, r.delay)));

        ok(r.maxRetries >= 1, 'ao menos uma tentativa (' + r.maxRetries + ')');
        ok(soma <= RECONNECTION_SECONDS * 1000, 'tentativas cabem na janela (' + (soma / 1000).toFixed(1) + 's de ' + RECONNECTION_SECONDS + 's)');
        ok(soma + proxima > RECONNECTION_SECONDS * 1000, 'nao sobra tentativa util fora da janela');
        ok(r.minUptime <= 1000, 'minUptime baixo o bastante para quem cai logo apos entrar (' + r.minUptime + 'ms)');
    }

    // --------------------------------------------------------------------------
    console.log('-- 3. saida voluntaria --');
    {
        const room = new FakeRoom();
        const cena = novaCena(room);
        cena.bindRoom(room);
        cena.leaveRoom();

        ok(room.leaveCalls.length === 1 && room.leaveCalls[0] === true, 'leave() consentido com socket em pe');
        ok(cena.room === null && cena.saindo === true && cena.conectado === false, 'cena solta a sala e marca saida');
        ok(room.reconnection.enabled === false && room.reconnection.maxRetries === 0, 'reconexao automatica cancelada');

        room.encerrar(CloseCode.CONSENTED);
        ok(cena.timers.length === 0, 'saida consentida nao agenda volta ao lobby');
        ok(cena.statusText.texto === '', 'saida consentida nao mostra erro');

        cena.leaveRoom();
        ok(room.leaveCalls.length === 1, 'leaveRoom e idempotente');
    }

    // --------------------------------------------------------------------------
    console.log('-- 4/5. perda temporaria e tentativa de reconexao --');
    {
        const room = new FakeRoom();
        room.state.actors.set('eu', ator(100, 200));
        const cena = novaCena(room);
        cena.bindRoom(room);

        room.cair();
        ok(cena.conectado === false, 'queda marca desconectado');
        ok(cena.room === room, 'a sala NAO e descartada: e ela que guarda a sessao');
        ok(cena.localCharging === false, 'carga em curso e solta na queda');
        ok(/Conex/.test(cena.statusText.texto), 'aviso na tela: "' + linha1(cena.statusText.texto) + '"');
        ok(cena.saindo === false, 'queda nao e confundida com saida voluntaria');

        const antes = cena.enviosDeEntrada;
        cena.update(0, 16);
        cena.haltInput();
        ok(cena.enviosDeEntrada === antes && cena.passosDePrevisao === 0, 'caido: nao envia entrada nem preve');
        ok(room.enfileirados.length === 0, 'caido: nada cai na fila do SDK');
    }

    // --------------------------------------------------------------------------
    console.log('-- 6. reconexao bem-sucedida --');
    {
        const room = new FakeRoom();
        room.state.actors.set('eu', ator(100, 200));
        const cena = novaCena(room);
        cena.bindRoom(room);

        // Atores ja desenhados. Sao bonecos de teste: o ArenaActor de verdade
        // precisa de canvas, e quem esta sob teste e o ciclo de vida, nao ele.
        cena.actors.set('eu', { isLocal: false, destroy() {}, sync() {} });
        cena.actors.set('bot1', { isLocal: false, destroy() {}, sync() {} });
        const atoresAntes = cena.actors.size;
        const cbsAntes = JSON.stringify(Object.keys(room._cbs).map((k) => room._cbs[k].length));

        room.cair();
        // O personagem andou no servidor enquanto o cliente estava fora.
        room.state.actors.get('eu').x = 640;
        room.state.actors.get('eu').y = 360;
        room.voltar();

        ok(cena.conectado === true, 'volta marca conectado');
        ok(cena.statusText.texto === '', 'aviso de queda some');
        ok(cena.ressincronizar === true, 'previsao marcada para ressincronizar');

        cena.update(0, 16);
        ok(cena.ressincronizar === false, 'ressincronizacao consumida uma vez');
        ok(cena.predX === 640 && cena.predY === 360, 'previsao parte da posicao do servidor');
        ok(cena.pendingInputs.length === 0, 'historico de entradas antigo descartado');
        ok(cena.enviosDeEntrada === 1 && cena.passosDePrevisao === 1, 'envio e previsao voltam a rodar');

        const cbsDepois = JSON.stringify(Object.keys(room._cbs).map((k) => room._cbs[k].length));
        ok(cbsAntes === cbsDepois, 'nenhum listener registrado de novo apos reconectar');
        ok(cena.actors.size === atoresAntes, 'nenhum ator duplicado (' + cena.actors.size + ')');

        cena.predX = 1;
        cena.update(0, 16);
        ok(cena.predX === 1, 'ressincronizacao nao se repete no quadro seguinte');
    }

    // --------------------------------------------------------------------------
    console.log('-- 7. reconexao esgotada --');
    {
        const room = new FakeRoom();
        const cena = novaCena(room);
        cena.bindRoom(room);

        room.cair();
        room.desistir();

        ok(cena.conectado === false, 'segue desconectado');
        ok(/lobby/i.test(cena.statusText.texto), 'avisa e volta ao lobby: "' + linha1(cena.statusText.texto) + '"');
        ok(cena.timers.length === 1, 'uma unica volta ao lobby agendada');

        let voltou = false;
        globalThis.window.location.reload = () => { voltou = true; };
        cena.timers[0].cb();
        ok(voltou === true, 'o agendamento realmente leva ao lobby');
    }

    // --------------------------------------------------------------------------
    console.log('-- 8. segundo plano e volta ao jogo --');
    {
        const room = new FakeRoom();
        room.state.actors.set('eu', ator(100, 200));
        const cena = novaCena(room);
        cena.bindRoom(room);

        // (a) trocar de aplicativo: o Phaser entrega HIDDEN, que so solta controles
        cena.haltInput();
        ok(room.leaveCalls.length === 0, 'HIDDEN/BLUR nao sai da sala');
        ok(cena.room === room && cena.conectado === true, 'segue na partida em segundo plano');
        ok(room.enviados.some((m) => m[0] === 'i') && room.enviados.some((m) => m[0] === 'a'), 'controles soltos no servidor');

        // (b) bfcache: a pagina pode voltar viva
        cena.handlePageHide({ persisted: true });
        ok(room.leaveCalls.length === 0, 'pagehide com persisted NAO sai da sala');
        ok(cena.room === room, 'sessao preservada para a volta');

        // (c) a pagina esta indo embora de verdade
        cena.handlePageHide({ persisted: false });
        ok(room.leaveCalls.length === 1 && room.leaveCalls[0] === true, 'pagehide sem persisted sai consentido');
    }

    // --------------------------------------------------------------------------
    console.log('-- 9. saida voluntaria com a conexao ja caida --');
    {
        const room = new FakeRoom();
        const cena = novaCena(room);
        cena.bindRoom(room);

        room.cair();
        cena.leaveRoom();
        ok(room.leaveCalls.length === 1 && room.leaveCalls[0] === false, 'sem socket, fecha em vez de tentar avisar');
        ok(room.reconnection.enabled === false, 'reconexao cancelada tambem neste caminho');
    }

    return { pass, fail };
}
