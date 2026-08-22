import ArenaActor from '../entities/ArenaActor.js';
import InputManager from '../utils/InputManager.js';
import DeathScreen from '../ui/DeathScreen.js';
import Scoreboard from '../ui/Scoreboard.js';
import {
    ATTACK_MOVE_FACTOR, attackRecoveryMs, attackWindupMs, chargePower,
    DASH_COOLDOWN_MS, DASH_DISTANCE, DASH_SPEED, DASH_TIMEOUT_MS,
    RANKS, RANK_ORDER, TEAM_ORDER, WORLD_WIDTH, WORLD_HEIGHT
} from '../constants/Hierarchy.js';
import { playDashFx } from '../utils/DashFx.js';
import { ROOM_NAME, resolveEndpoint, resolvePlayerName } from '../net/netconfig.js';

/**
 * Cena multiplayer. Toda a regra do jogo mora em `chess-armageddon-server`;
 * aqui só se faz três coisas:
 *
 *   1. mandar a entrada do jogador ("i", "a", "r")
 *   2. desenhar os atores que chegam no schema
 *   3. prever localmente o próprio movimento, para o boneco andar no mesmo
 *      quadro da tecla em vez de esperar a ida e volta até o servidor
 *
 * A cena `Start` continua existindo com o jogo offline completo (bots locais,
 * física, dano) — acesse com `?offline=1`.
 */

/** Erro de posição, em pixels, a partir do qual não vale mais suavizar. */
const SNAP_DISTANCE = 250;

/**
 * Fração do erro corrigida por segundo ao reconciliar com o servidor.
 *
 * Pode ser alto porque, com a reconciliação por sequência, o erro que sobra é
 * pequeno e real (colisão, clamp) — não mais o atraso da rede.
 */
const RECONCILE_RATE = 10;

/** Variação mínima do vetor de entrada que justifica um pacote novo. */
const INPUT_EPSILON = 0.01;

/**
 * Intervalo fixo de envio da entrada, em ms. Casa com o TICK_MS do servidor.
 *
 * O envio a taxa fixa é o que torna a reconciliação possível: cada pacote
 * numerado delimita uma janela de tempo, e o cliente guarda o deslocamento que
 * produziu em cada uma. Sabendo por `ack` até que janela o servidor andou, ele
 * reaplica só as que ainda estavam no ar.
 *
 * Serve de keepalive também: o servidor solta o comando depois de
 * INPUT_TIMEOUT_MS (2 s) sem notícias.
 */
const INPUT_SEND_MS = 50;

/** Piso entre dois pacotes: mudar de direção envia na hora, mas sem estourar. */
const INPUT_MIN_GAP_MS = 30;

/** Janelas de entrada guardadas para reenvio (50 ms cada = 6 s de folga). */
const INPUT_HISTORY_MAX = 120;

/**
 * Teto para a previsão local do golpe.
 *
 * A previsão congela o boneco assim que o ataque é ENVIADO, e não quando o
 * `attacking` volta no estado: entre uma coisa e outra passa um RTT em que o
 * servidor já parou o personagem e o cliente ainda andava. Esse trecho andado
 * a mais era desfeito pela reconciliação — o passo para trás a cada golpe.
 *
 * Só que o servidor pode nunca confirmar (morri no caminho, não estava
 * carregando). Este teto destrava a previsão nesse caso; precisa ser folgado o
 * bastante para cobrir RTT + o windup máximo de quem joga longe.
 */
const LOCAL_ATTACK_MAX_MS = 1200;

export class Arena extends Phaser.Scene {
    constructor() {
        super('Arena');
    }

    preload() {
        this.load.image('grass', 'assets/map_3548_1774.png');

        this.load.spritesheet('pawn', 'assets/pawn_128.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tower', 'assets/tower_160.png', { frameWidth: 160, frameHeight: 160 });
        this.load.spritesheet('horse', 'assets/horse_144.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('bishop', 'assets/bishop_144.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('queen', 'assets/queen_160.png', { frameWidth: 160, frameHeight: 160 });

        // Peças escuras: o time `enemy` as veste (ver `skinKey` em Hierarchy.js).
        this.load.spritesheet('pawn_black', 'assets/pawn_128_b.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tower_black', 'assets/tower_160_b.png', { frameWidth: 160, frameHeight: 160 });
        this.load.spritesheet('horse_black', 'assets/horse_144_b.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('bishop_black', 'assets/bishop_144_b.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('queen_black', 'assets/queen_160_b.png', { frameWidth: 160, frameHeight: 160 });
    }

    create() {
        this.createAuraTexture();

        this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'grass').setOrigin(0);
        this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

        /** @type {Map<string, ArenaActor>} */
        this.actors = new Map();
        this.room = null;
        this.localTeam = null;
        this.cameraLocked = false;

        // Previsão local do próprio personagem.
        this.predX = 0;
        this.predY = 0;
        this.predReady = false;

        this.lastSentDx = 0;
        this.lastSentDy = 0;
        this.lastInputSentAt = 0;

        // Reconciliação: número do pacote de entrada e o histórico do que cada
        // pacote já enviado moveu localmente. Ver `stepPrediction`.
        this.inputSeq = 0;
        /** @type {{seq: number, ddx: number, ddy: number}[]} */
        this.pendingInputs = [];
        // Deslocamento acumulado desde o último pacote (a janela ainda aberta).
        this.segDx = 0;
        this.segDy = 0;

        this.localCharging = false;
        this.localChargeStart = 0;
        /**
         * Espelho local da recuperação do golpe (`Actor.attackReadyAt`).
         *
         * Não é autoridade — o servidor recusa sozinho um `startCharge` cedo
         * demais. Serve para o indicador de carga não acender numa carga que
         * vai ser recusada, o que apareceria como brilho fantasma seguido de
         * nada.
         */
        this.localAttackReadyAt = 0;

        // Golpe já enviado que o servidor ainda não confirmou no estado.
        // Ver `stepPrediction`: a previsão para de andar já no envio.
        this.localAttackPending = false;
        this.localAttackSentAt = 0;

        // Dash previsto localmente. O servidor continua sendo quem decide se
        // ele acontece — isto só evita esperar um RTT para o boneco sair do
        // lugar, que é justamente o tempo em que a esquiva serviria para algo.
        this.localDashUntil = 0;
        this.localDashDirX = 0;
        this.localDashDirY = 0;
        /** Distância que falta no dash previsto — mesma conta do servidor. */
        this.localDashRemaining = 0;
        // Cooldown otimista, só para o botão apagar na hora do toque. O valor
        // do servidor (`dashCd`) manda assim que chega.
        this.localDashReadyAt = 0;

        this.showHitboxes = false;

        this.inputs = new InputManager(this);
        this.deathScreen = new DeathScreen(this);
        this.scoreboard = new Scoreboard(this, () => this.scoreRows());

        this.createHud();

        this.input.keyboard.on('keydown-H', () => {
            this.showHitboxes = !this.showHitboxes;
        });

        // O Phaser pausa o loop quando a aba perde o foco, e aí ninguém mais
        // manda entrada. Sem avisar o servidor, ele continuaria aplicando o
        // último vetor e o boneco andaria sozinho até a borda do mapa.
        const halt = () => this.haltInput();
        this.game.events.on(Phaser.Core.Events.BLUR, halt);
        this.game.events.on(Phaser.Core.Events.HIDDEN, halt);

        this.connect();

        this.events.once('shutdown', () => {
            this.game.events.off(Phaser.Core.Events.BLUR, halt);
            this.game.events.off(Phaser.Core.Events.HIDDEN, halt);
            if (this.room) this.room.leave();
        });
    }

    /** Zera movimento e carga no servidor. Usado ao perder o foco da aba. */
    haltInput() {
        if (!this.room) return;

        this.sendInputPacket(0, 0, performance.now());

        if (this.localCharging) {
            this.localCharging = false;
            this.localAttackPending = true;
            this.localAttackSentAt = this.time.now;
            this.room.send('a', 0);
        }
    }

    /** Textura da partícula de aura: criada uma vez e reusada por todos. */
    createAuraTexture() {
        if (this.textures.exists('aura-particle')) return;

        const size = 8;
        const canvas = this.textures.createCanvas('aura-particle', size, size);
        const ctx = canvas.getContext();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        canvas.refresh();
    }

    createHud() {
        const style = {
            fontFamily: 'Arial, sans-serif',
            fontSize: '16px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        };

        this.statusText = this.add.text(16, 16, 'Conectando...', style)
            .setScrollFactor(0)
            .setDepth(9000);

        this.killFeed = this.add.text(this.cameras.main.width - 16, 16, '', {
            ...style,
            fontSize: '14px',
            align: 'right'
        })
            .setOrigin(1, 0)
            .setScrollFactor(0)
            .setDepth(9000);

        this.killFeedLines = [];
    }

    // -----------------------------------------------------------------------
    // REDE
    // -----------------------------------------------------------------------

    async connect() {
        const endpoint = resolveEndpoint();

        try {
            const client = new Colyseus.Client(endpoint);
            this.room = await client.joinOrCreate(ROOM_NAME, { name: resolvePlayerName() });
        } catch (error) {
            console.error(error);
            this.statusText.setText(
                `Falha ao conectar em ${endpoint}\n` +
                `${error && error.message ? error.message : error}\n` +
                'Suba o servidor (npm start) ou use ?server=wss://...'
            );
            return;
        }

        this.statusText.setText('');
        this.bindRoom(this.room);
    }

    bindRoom(room) {
        const $ = Colyseus.getStateCallbacks(room);

        $(room.state).actors.onAdd((actorState, key) => {
            const isLocal = key === room.sessionId;
            const actor = new ArenaActor(this, actorState, isLocal, this.isOpponent(actorState));
            this.actors.set(key, actor);

            if (isLocal) {
                this.localTeam = actorState.team;
                this.resetPrediction(actorState);
                this.refreshDebugColors();
            }
        });

        $(room.state).actors.onRemove((_actorState, key) => {
            const actor = this.actors.get(key);
            if (actor) actor.destroy();
            this.actors.delete(key);
        });

        // Cada patch é uma amostra do mundo com hora de chegada. Guardá-las aqui
        // (e não no quadro do Phaser) é o que permite aos outros personagens
        // serem desenhados no passado, interpolando entre duas amostras reais
        // em vez de correrem atrás do último valor recebido — ver ArenaActor.
        room.onStateChange(() => {
            const now = performance.now();
            for (const actor of this.actors.values()) actor.pushSnapshot(now);
        });

        room.onMessage('kill', ({ killer, victim }) => this.pushKillFeed(`${killer} matou ${victim}`));

        room.onLeave((code) => {
            this.statusText.setText(`Desconectado (código ${code}).\nRecarregue a página para voltar.`);
        });

        room.onError((code, message) => {
            console.error('erro na sala', code, message);
            this.statusText.setText(`Erro do servidor: ${message || code}`);
        });
    }

    /** Adversário = time diferente do meu. Antes de saber o meu, ninguém é. */
    isOpponent(actorState) {
        return this.localTeam !== null && actorState.team !== this.localTeam;
    }

    /**
     * A cor da peça vem do time absoluto, então não muda. Mas a moldura de
     * debug é relativa (verde = meu time, vermelho = adversário) e só pode ser
     * decidida depois que o time do jogador local chega.
     */
    refreshDebugColors() {
        for (const actor of this.actors.values()) {
            actor.isOpponent = this.isOpponent(actor.actorState);
            actor.applyDebugColor();
        }
    }

    pushKillFeed(line) {
        this.killFeedLines.push(line);
        if (this.killFeedLines.length > 5) this.killFeedLines.shift();
        this.killFeed.setText(this.killFeedLines.join('\n'));
    }

    // -----------------------------------------------------------------------
    // LOOP
    // -----------------------------------------------------------------------

    update(time, delta) {
        this.inputs.update();

        // Relógio dos pacotes. `this.time.now` só anda uma vez por quadro,
        // enquanto os patches chegam a qualquer momento: misturar os dois
        // desalinharia o buffer de interpolação em até um quadro.
        const now = performance.now();

        const localState = this.localState();

        if (localState) {
            this.sendInput(localState, now);
            this.stepPrediction(localState, delta);
            this.updateDeathScreen(localState);
        }

        for (const [key, actor] of this.actors) {
            const predicted = (key === this.room?.sessionId && this.predReady)
                ? { x: this.predX, y: this.predY }
                : null;

            actor.localCharging = actor.isLocal ? this.localCharging : false;
            actor.localChargeRatio = actor.isLocal ? this.localChargeRatio(localState) : 0;
            actor.sync(now, predicted);
        }

        this.inputs.setDashCooldown(this.dashCooldownRatio(localState));

        this.followLocalActor();
        this.scoreboard.update(time);
    }

    /**
     * Linhas do placar a partir do schema. Só roda com o painel aberto, então
     * percorrer o MapSchema aqui é barato — são no máximo TEAM_SIZE * 2 atores.
     */
    scoreRows() {
        const actors = this.room && this.room.state && this.room.state.actors;
        if (!actors) return [];

        const rows = [];
        actors.forEach((actorState, key) => {
            rows.push({
                name: actorState.name,
                team: TEAM_ORDER[actorState.team],
                kills: actorState.kills,
                deaths: actorState.deaths,
                isLocal: key === this.room.sessionId
            });
        });
        return rows;
    }

    localState() {
        // `room.state` já existe assim que o join resolve, mas os campos do
        // schema (o MapSchema `actors`) só nascem no primeiro patch — o
        // primeiro quadro depois de conectar cai aqui com `actors` undefined.
        const actors = this.room && this.room.state && this.room.state.actors;
        if (!actors) return null;
        return actors.get(this.room.sessionId) || null;
    }

    followLocalActor() {
        if (this.cameraLocked) return;
        const actor = this.actors.get(this.room?.sessionId);
        if (!actor) return;

        this.cameras.main.startFollow(actor, true, 0.1, 0.1);
        this.cameraLocked = true;
    }

    /**
     * Manda a entrada a taxa fixa (INPUT_SEND_MS), e na hora quando o vetor
     * muda — respeitado o piso de INPUT_MIN_GAP_MS, para uma rajada de teclas
     * não estourar o `maxMessagesPerSecond` do servidor.
     */
    sendInput(localState, now) {
        const { dx, dy } = this.inputs.getMovementVector();

        const desde = now - this.lastInputSentAt;
        const mudou = Math.abs(dx - this.lastSentDx) > INPUT_EPSILON ||
            Math.abs(dy - this.lastSentDy) > INPUT_EPSILON;

        if (desde >= INPUT_SEND_MS || (mudou && desde >= INPUT_MIN_GAP_MS)) {
            this.sendInputPacket(dx, dy, now);
        }

        const attack = this.inputs.getAttackState();

        if (attack.justPressed && localState.alive && this.time.now >= this.localAttackReadyAt) {
            this.localCharging = true;
            this.localChargeStart = this.time.now;
            this.room.send('a', 1);
        }

        const dash = this.inputs.getDashState();
        if (dash.justPressed) this.tryDash(localState, dx, dy, now);

        if (attack.justReleased) {
            if (this.localCharging && localState.alive) {
                this.localAttackPending = true;
                this.localAttackSentAt = this.time.now;

                // Mesma conta do servidor, com o relógio local: quanto tempo
                // este golpe ocupa antes de a próxima carga poder começar.
                const power = chargePower(
                    this.time.now - this.localChargeStart,
                    RANKS[RANK_ORDER[localState.rank]].chargeTime
                );
                this.localAttackReadyAt = this.time.now
                    + attackWindupMs(power) + attackRecoveryMs(power);
            }
            this.localCharging = false;
            this.room.send('a', 0);
        }
    }

    /**
     * Pede um dash ao servidor e já começa a prever o movimento.
     *
     * As condições testadas aqui são as MESMAS do `World.requestDash`, lidas do
     * estado que o servidor mandou (`dashCd`, `attacking`, `alive`). Prever um
     * dash que o servidor vai recusar criaria ~220 px de divergência para a
     * reconciliação desfazer na cara do jogador.
     *
     * O pacote de entrada é enviado ANTES do pedido: a direção do dash sai da
     * última entrada que o servidor recebeu, então os dois lados precisam estar
     * falando do mesmo vetor. Como o transporte preserva a ordem, o `i` chega
     * primeiro.
     */
    tryDash(localState, dx, dy, now) {
        if (!localState.alive || localState.attacking || this.localAttackPending) return;
        if (localState.dashCd > 0 || this.time.now < this.localDashReadyAt) return;


        this.sendInputPacket(dx, dy, now);
        this.room.send('d');

        let dirX = dx;
        let dirY = dy;
        if (dirX === 0 && dirY === 0) {
            // Parado: sai para o lado que a peça está olhando (mesma regra do
            // servidor, que só conhece o `flipX`).
            dirX = localState.flipX ? -1 : 1;
            dirY = 0;
        }
        const length = Math.hypot(dirX, dirY) || 1;

        this.localDashDirX = dirX / length;
        this.localDashDirY = dirY / length;
        this.localDashUntil = this.time.now + DASH_TIMEOUT_MS;
        this.localDashRemaining = DASH_DISTANCE;
        this.localDashReadyAt = this.time.now + DASH_COOLDOWN_MS;

        const actor = this.actors.get(this.room.sessionId);
        if (actor) {
            actor.markDashHandled();
            playDashFx(this, actor, this.localDashDirX, this.localDashDirY);
        }
    }

    /** Fração do cooldown do dash que falta, 0..1, para o botão desenhar. */
    dashCooldownRatio(localState) {
        // O campo só chega depois que muda pela primeira vez: com reflection do
        // schema, valor igual ao padrão nunca vira patch e fica `undefined` aqui.
        const bruto = localState ? localState.dashCd : 0;
        const doServidor = Number.isFinite(bruto) ? bruto / 100 : 0;
        const local = Math.max(0, this.localDashReadyAt - this.time.now) / DASH_COOLDOWN_MS;
        // O maior dos dois: o local cobre o RTT entre o toque e o primeiro
        // patch com o cooldown já contado, e o do servidor manda no resto.
        return Math.min(1, Math.max(doServidor, local));
    }

    /** Progresso da carga medido no cliente, só para o brilho não atrasar. */
    localChargeRatio(localState) {
        if (!this.localCharging || !localState) return 0;
        const chargeTime = RANKS[RANK_ORDER[localState.rank]].chargeTime;
        return Phaser.Math.Clamp((this.time.now - this.localChargeStart) / chargeTime, 0, 1);
    }

    /**
     * Envia um pacote de entrada e fecha a janela do pacote anterior.
     *
     * O deslocamento acumulado até agora (`segDx`/`segDy`) é fruto do vetor que
     * estava valendo, ou seja, do pacote `inputSeq`; ele vai para o histórico
     * sob esse número e uma janela nova começa zerada.
     */
    sendInputPacket(dx, dy, now) {
        if (this.inputSeq > 0) {
            this.pendingInputs.push({ seq: this.inputSeq, ddx: this.segDx, ddy: this.segDy });
            if (this.pendingInputs.length > INPUT_HISTORY_MAX) this.pendingInputs.shift();
        }
        this.segDx = 0;
        this.segDy = 0;

        this.inputSeq++;
        this.room.send('i', { dx, dy, s: this.inputSeq });

        this.lastSentDx = dx;
        this.lastSentDy = dy;
        this.lastInputSentAt = now;
    }

    /** Joga a previsão para a posição do servidor e esquece o que estava no ar. */
    resetPrediction(localState) {
        this.predX = localState.x;
        this.predY = localState.y;
        this.predReady = true;
        this.pendingInputs.length = 0;
        this.segDx = 0;
        this.segDy = 0;
        this.localAttackPending = false;
        this.localDashUntil = 0;
        this.localDashRemaining = 0;
    }

    /**
     * Previsão + reconciliação por sequência.
     *
     * O ponto de partida é sempre a posição autoritativa — mas ela é de um RTT
     * atrás. Reconciliar direto contra ela (como se fazia antes) deixava a
     * previsão permanentemente adiantada em `velocidade × RTT`: ~60 px com o
     * peão a 300 ms de latência. A cada quadro esse erro era puxado para trás,
     * e o boneco andava, voltava e andava de novo.
     *
     * Agora o servidor devolve em `ack` até que pacote de entrada ele já andou.
     * O alvo passa a ser a posição autoritativa MAIS o deslocamento das janelas
     * com sequência maior que `ack` — as que ainda estavam viajando quando o
     * patch foi gerado. O atraso da rede sai da conta e o que sobra é só
     * divergência de verdade (empurrão de outro personagem, clamp na borda),
     * que é pequena e rara.
     *
     * Guarda-se o deslocamento efetivo (depois do clamp), não `velocidade × dt`:
     * assim, encostado numa parede, a janela registra zero e o alvo não foge
     * para fora do mapa.
     */
    stepPrediction(localState, delta) {
        if (!this.predReady) return;

        const dt = delta / 1000;
        const size = RANKS[RANK_ORDER[localState.rank]].size;
        const halfW = size.width / 2;
        const halfH = size.height / 2;

        if (!localState.alive) {
            // Morto não anda, e o respawn é um teleporte: histórico não serve.
            this.resetPrediction(localState);
            return;
        }

        const antesX = this.predX;
        const antesY = this.predY;

        if (localState.attacking) {
            // Chegou a confirmação: daqui em diante quem manda é o estado.
            this.localAttackPending = false;
        } else if (this.localAttackPending &&
            this.time.now - this.localAttackSentAt > LOCAL_ATTACK_MAX_MS) {
            // O servidor pode ter recusado o golpe (morri, não estava
            // carregando). Sem este teto a previsão ficaria travada para sempre.
            this.localAttackPending = false;
        }

        const dashLocal = this.time.now < this.localDashUntil && this.localDashRemaining > 0;
        const emDash = dashLocal || localState.dashing;

        if (dashLocal) {
            // Dash manda na previsão enquanto dura, como no `stepPlayer` do
            // servidor. A velocidade é limitada pelo que falta percorrer (a
            // mesma conta de `Actor.consumeDashSpeed`), senão o último passo
            // passaria do alvo: o servidor integra em ticks de 50 ms e o
            // cliente em quadros, e a diferença virava resto para reconciliar.
            const speed = Math.min(DASH_SPEED, this.localDashRemaining / dt);
            this.localDashRemaining -= speed * dt;
            this.predX += this.localDashDirX * speed * dt;
            this.predY += this.localDashDirY * speed * dt;
        } else {
            // Golpe em curso: anda devagar, não para. O fator é o mesmo do
            // servidor; a previsão o aplica desde o ENVIO do ataque, e não desde
            // a confirmação, senão o RTT vira divergência e a reconciliação puxa
            // o boneco para trás.
            const atacando = localState.attacking || this.localAttackPending;
            const fator = atacando ? ATTACK_MOVE_FACTOR : 1;
            const { dx, dy } = this.inputs.getMovementVector();
            const speed = RANKS[RANK_ORDER[localState.rank]].speed * fator;
            this.predX += dx * speed * dt;
            this.predY += dy * speed * dt;
        }

        this.predX = Phaser.Math.Clamp(this.predX, halfW, WORLD_WIDTH - halfW);
        this.predY = Phaser.Math.Clamp(this.predY, halfH, WORLD_HEIGHT - halfH);

        this.segDx += this.predX - antesX;
        this.segDy += this.predY - antesY;

        // Alvo = posição do servidor + tudo que mandei depois do que ele confirmou.
        const ack = localState.ack;
        let alvoX = localState.x;
        let alvoY = localState.y;

        while (this.pendingInputs.length > 0 && this.pendingInputs[0].seq <= ack) {
            this.pendingInputs.shift();
        }
        for (const janela of this.pendingInputs) {
            alvoX += janela.ddx;
            alvoY += janela.ddy;
        }
        // A janela ainda aberta pertence a `inputSeq`; só conta se o servidor
        // não a confirmou (só acontece com latência perto de zero).
        if (this.inputSeq > ack) {
            alvoX += this.segDx;
            alvoY += this.segDy;
        }

        alvoX = Phaser.Math.Clamp(alvoX, halfW, WORLD_WIDTH - halfW);
        alvoY = Phaser.Math.Clamp(alvoY, halfH, WORLD_HEIGHT - halfH);

        const errorX = alvoX - this.predX;
        const errorY = alvoY - this.predY;

        if (Math.hypot(errorX, errorY) > SNAP_DISTANCE) {
            // Divergência grande (teleporte, queda longa de rede): suavizar aqui
            // faria o boneco atravessar o mapa deslizando.
            this.resetPrediction(localState);
            return;
        }

        // Durante o dash a reconciliação fica suspensa.
        //
        // O `ack` significa "já apliquei sua entrada até aqui", não "já terminei
        // seu dash": o servidor confirma a sequência no primeiro tick e só então
        // gasta 220 ms empurrando o personagem. Nesse meio-tempo o alvo é a
        // posição de quem ainda não dashou, e corrigir contra ela puxava a
        // previsão para trás justamente enquanto o impulso acontecia — o dash
        // rendia menos de um terço da distância na tela.
        //
        // Os dois lados percorrem a MESMA distância na mesma duração, então
        // basta esperar: quando o dash acaba dos dois lados, o resto é a
        // defasagem normal de rede e a reconciliação fecha em poucos quadros.
        // O salto acima (SNAP_DISTANCE) continua valendo, para respawn no meio
        // do dash não deixar a previsão presa longe.
        if (emDash) return;

        const t = Math.min(1, RECONCILE_RATE * dt);
        this.predX += errorX * t;
        this.predY += errorY * t;
    }

    /**
     * A tela some ao clicar em RENASCER, mas quem decide é o servidor: se o
     * pedido chegar antes da carência, ele é ignorado e a tela volta no quadro
     * seguinte. Melhor uma piscada do que o jogador preso olhando a arena.
     */
    updateDeathScreen(localState) {
        if (!localState.alive) {
            if (!this.deathScreen.isVisible) {
                this.localCharging = false;
                this.deathScreen.show(() => this.room.send('r'));
            }
        } else if (this.deathScreen.isVisible) {
            this.deathScreen.hide();
        }
    }
}
