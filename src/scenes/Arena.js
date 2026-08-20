import ArenaActor from '../entities/ArenaActor.js';
import InputManager from '../utils/InputManager.js';
import DeathScreen from '../ui/DeathScreen.js';
import { RANKS, RANK_ORDER, WORLD_WIDTH, WORLD_HEIGHT } from '../constants/Hierarchy.js';
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

/** Fração do erro corrigida por segundo ao reconciliar com o servidor. */
const RECONCILE_RATE = 4;

/** Variação mínima do vetor de entrada que justifica um pacote novo. */
const INPUT_EPSILON = 0.01;

/**
 * Reenvio da entrada mesmo sem mudança, em ms.
 *
 * O servidor guarda o último vetor recebido e o descarta depois de
 * INPUT_TIMEOUT_MS (2 s) sem notícias. Este keepalive é o que prova que o
 * cliente continua vivo enquanto o jogador segura a mesma tecla.
 */
const INPUT_KEEPALIVE_MS = 500;

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

        this.localCharging = false;
        this.localChargeStart = 0;

        this.showHitboxes = false;

        this.inputs = new InputManager(this);
        this.deathScreen = new DeathScreen(this);

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

        this.room.send('i', { dx: 0, dy: 0 });
        this.lastSentDx = 0;
        this.lastSentDy = 0;
        this.lastInputSentAt = this.time.now;

        if (this.localCharging) {
            this.localCharging = false;
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
                this.predX = actorState.x;
                this.predY = actorState.y;
                this.predReady = true;
                this.refreshTints();
            }
        });

        $(room.state).actors.onRemove((_actorState, key) => {
            const actor = this.actors.get(key);
            if (actor) actor.destroy();
            this.actors.delete(key);
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

    /** Recalcula o tint de todos quando o time do jogador local fica conhecido. */
    refreshTints() {
        for (const actor of this.actors.values()) {
            actor.isOpponent = this.isOpponent(actor.actorState);
            actor.applyTeamTint();
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

        const localState = this.localState();

        if (localState) {
            this.sendInput(localState);
            this.stepPrediction(localState, delta);
            this.updateDeathScreen(localState);
        }

        for (const [key, actor] of this.actors) {
            const predicted = (key === this.room?.sessionId && this.predReady)
                ? { x: this.predX, y: this.predY }
                : null;

            actor.localCharging = actor.isLocal ? this.localCharging : false;
            actor.localChargeRatio = actor.isLocal ? this.localChargeRatio(localState) : 0;
            actor.sync(delta, predicted);
        }

        this.followLocalActor();
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

    /** Manda pacote quando o vetor muda, ou de tempos em tempos como keepalive. */
    sendInput(localState) {
        const { dx, dy } = this.inputs.getMovementVector();

        const mudou = Math.abs(dx - this.lastSentDx) > INPUT_EPSILON ||
            Math.abs(dy - this.lastSentDy) > INPUT_EPSILON;
        const vencido = this.time.now - this.lastInputSentAt > INPUT_KEEPALIVE_MS;

        if (mudou || vencido) {
            this.room.send('i', { dx, dy });
            this.lastSentDx = dx;
            this.lastSentDy = dy;
            this.lastInputSentAt = this.time.now;
        }

        const attack = this.inputs.getAttackState();

        if (attack.justPressed && localState.alive) {
            this.localCharging = true;
            this.localChargeStart = this.time.now;
            this.room.send('a', 1);
        }

        if (attack.justReleased) {
            this.localCharging = false;
            this.room.send('a', 0);
        }
    }

    /** Progresso da carga medido no cliente, só para o brilho não atrasar. */
    localChargeRatio(localState) {
        if (!this.localCharging || !localState) return 0;
        const chargeTime = RANKS[RANK_ORDER[localState.rank]].chargeTime;
        return Phaser.Math.Clamp((this.time.now - this.localChargeStart) / chargeTime, 0, 1);
    }

    /**
     * Previsão + reconciliação do próprio personagem.
     *
     * Anda localmente com as mesmas regras do servidor (velocidade do rank,
     * parado durante o golpe) e, a cada quadro, puxa a posição prevista em
     * direção à autoritativa. A previsão não modela a separação entre
     * personagens nem o clamp exato, então o erro cresce ao encostar em alguém
     * — é justamente esse resto que a reconciliação absorve.
     */
    stepPrediction(localState, delta) {
        if (!this.predReady) return;

        const dt = delta / 1000;

        if (!localState.alive) {
            this.predX = localState.x;
            this.predY = localState.y;
            return;
        }

        if (!localState.attacking) {
            const { dx, dy } = this.inputs.getMovementVector();
            const speed = RANKS[RANK_ORDER[localState.rank]].speed;
            this.predX += dx * speed * dt;
            this.predY += dy * speed * dt;
        }

        const size = RANKS[RANK_ORDER[localState.rank]].size;
        this.predX = Phaser.Math.Clamp(this.predX, size.width / 2, WORLD_WIDTH - size.width / 2);
        this.predY = Phaser.Math.Clamp(this.predY, size.height / 2, WORLD_HEIGHT - size.height / 2);

        const errorX = localState.x - this.predX;
        const errorY = localState.y - this.predY;

        if (Math.hypot(errorX, errorY) > SNAP_DISTANCE) {
            // Divergência grande (respawn, teleporte, lag longo): suavizar aqui
            // faria o boneco atravessar o mapa deslizando.
            this.predX = localState.x;
            this.predY = localState.y;
            return;
        }

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
