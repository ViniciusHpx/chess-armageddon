import HumanPlayer from '../entities/HumanPlayer.js';
import AIPlayer from '../entities/AIPlayer.js';
import InputManager from '../utils/InputManager.js';
import CollisionResolver from '../utils/CollisionResolver.js';
import DeathScreen from '../ui/DeathScreen.js';
import Scoreboard from '../ui/Scoreboard.js';
import XpBar from '../ui/XpBar.js';
import MapCollider from '../utils/MapCollider.js'; // Importação
import { createHealZoneFx } from '../utils/HealZoneFx.js';
import { COLLISION_PATH, ARENA_PATH, WORLD_WIDTH, WORLD_HEIGHT, HALF_WORLD_WIDTH } from '../constants/Scenario.js';

export class Start extends Phaser.Scene {
    preload() {
        this.load.image('grass', ARENA_PATH);
        this.load.image('collision_map', COLLISION_PATH);

        this.load.spritesheet('pawn', 'assets/pawn_128.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tower', 'assets/tower_160.png', { frameWidth: 160, frameHeight: 160 });
        this.load.spritesheet('horse', 'assets/horse_144.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('bishop', 'assets/bishop_144.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('queen', 'assets/queen_160.png', { frameWidth: 160, frameHeight: 160 });

        this.load.spritesheet('pawn_black', 'assets/pawn_128_b.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tower_black', 'assets/tower_160_b.png', { frameWidth: 160, frameHeight: 160 });
        this.load.spritesheet('horse_black', 'assets/horse_144_b.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('bishop_black', 'assets/bishop_144_b.png', { frameWidth: 144, frameHeight: 144 });
        this.load.spritesheet('queen_black', 'assets/queen_160_b.png', { frameWidth: 160, frameHeight: 160 });
    }

    create() {
        if (!this.textures.exists('aura-particle')) {
            const size = 8;
            const canvas = this.textures.createCanvas('aura-particle', size, size);
            const ctx = canvas.getContext();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            canvas.refresh();
        }

        const mapWidth = WORLD_WIDTH;
        const mapHeight = WORLD_HEIGHT;

        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);

        this.mapCollider = new MapCollider(this, 'collision_map');

        this.add.image(0, 0, 'grass').setOrigin(0, 0); // Metade esquerda original
        this.add.image(HALF_WORLD_WIDTH, 0, 'grass').setOrigin(0, 0).setFlipX(true);

        // Névoa verde nos dois castelos, marcando onde a base regenera vida.
        // Sai da mesma `HEAL_ZONE` que decide a cura — ver HealZoneFx.js.
        createHealZoneFx(this);

        // Grupos de times
        this.alliedPlayers = this.physics.add.group();
        this.enemyPlayers = this.physics.add.group();

        // Aliados (4 bots) e inimigos (5 bots). O nome só existe para o
        // placar do TAB; o offline não desenha nome sobre a cabeça.
        this.spawnBots(this.alliedPlayers, 'ally', 4, 1);
        this.spawnBots(this.enemyPlayers, 'enemy', 5, 5);

        // Jogador humano (pertence aos aliados)
        this.player = new HumanPlayer(this, 500, 700);
        this.player.moveToSpawn(this.mapCollider, 500, 700);
        this.player.displayName = 'Você';
        this.alliedPlayers.add(this.player);

        // Moldura de debug das elipses, ligada pela tecla `H` — a mesma flag e
        // a mesma tecla da `Arena`. Antes o offline desenhava a moldura sempre,
        // por não ter flag nenhuma.
        this.showHitboxes = false;
        this.input.keyboard.on('keydown-H', () => {
            this.showHitboxes = !this.showHitboxes;
        });

        this.inputs = new InputManager(this);

        // Tela de morte (criada depois do InputManager para ficar acima da UI)
        this.deathScreen = new DeathScreen(this);
        this.scoreboard = new Scoreboard(this, () => this.scoreRows());
        this.xpBar = new XpBar(this, () => this.player.xp);

        // Câmera
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // Colisão entre personagens (sem dano por toque). Não usamos
        // `physics.add.collider` porque o corpo Arcade é retangular: a
        // separação real é feita sobre as elipses, em CollisionResolver.
        this.collisionResolver = new CollisionResolver(this, [this.alliedPlayers, this.enemyPlayers]);

        this.events.on('postupdate', () => {
            this.collisionResolver.update();

            // Troque clampToWorldBounds por constrainPosition
            this.alliedPlayers.getChildren().forEach(p => p.constrainPosition(this.mapCollider));
            this.enemyPlayers.getChildren().forEach(p => p.constrainPosition(this.mapCollider));
        });
    }

    update(time, delta) {
        this.inputs.update();

        const movement = this.inputs.getMovementVector();
        const attackState = this.inputs.getAttackState();
        const dashState = this.inputs.getDashState();
        // Mira do ataque: independente do movimento, é ela que deixa andar para
        // um lado e bater para outro.
        const attackAim = this.inputs.getAttackVector();

        if (!this.player._isDead) {
            // O golpe que SAIU consome a mira: o controle de ataque volta ao
            // centro e o próximo golpe exige uma direção nova. Golpe recusado
            // (recuperação em curso) não consome nada — o jogador continua
            // apontado para onde estava.
            if (this.player.update(movement, attackState, dashState, delta, attackAim)) {
                this.inputs.consumeAttackAim();
            }
        }

        // DEBUG: avança a peça no ciclo. Offline não há autoridade nenhuma —
        // o próprio personagem é o estado —, então chama direto o mesmo
        // `debugCycleRank` que o servidor chama no modo online.
        if (this.inputs.getDebugState().justPressed) this.player.debugCycleRank();

        // Recarga do botão de dash. Offline o cooldown mora no próprio
        // personagem; online ele vem do servidor. O botão não sabe a diferença.
        this.inputs.setDashCooldown(this.player.dashCooldownRatio());

        this.alliedPlayers.getChildren().forEach(ai => {
            if (ai !== this.player) ai.aiUpdate(time, delta);
        });
        this.enemyPlayers.getChildren().forEach(ai => ai.aiUpdate(time, delta));

        this.scoreboard.update(time);
        this.xpBar.update(time);
    }

    /**
     * @param {Phaser.GameObjects.Group} group
     * @param {'ally'|'enemy'} team
     * @param {number} count Quantos bots criar.
     * @param {number} firstNumber Número do primeiro bot, para os nomes não
     *        se repetirem entre os dois times.
     */
    spawnBots(group, team, count, firstNumber) {
        for (let i = 0; i < count; i++) {
            // Posição provisória; `moveToSpawn` põe no castelo do time,
            // validando contra a máscara de colisão.
            const bot = new AIPlayer(this, 0, 0, team);
            bot.moveToSpawn(this.mapCollider, 500, 700);
            bot.displayName = `Bot ${firstNumber + i}`;
            group.add(bot);
        }
    }

    /**
     * Linhas do placar. O `HumanPlayer` tem `team = 'human'` mas joga pelos
     * aliados, então o time vem do grupo em que está — e não do campo.
     */
    scoreRows() {
        const rows = [];

        const collect = (group, team) => {
            for (const entity of group.getChildren()) {
                rows.push({
                    name: entity.displayName,
                    team,
                    kills: entity.kills,
                    deaths: entity.deaths,
                    isLocal: entity === this.player
                });
            }
        };

        collect(this.alliedPlayers, 'ally');
        collect(this.enemyPlayers, 'enemy');
        return rows;
    }
}