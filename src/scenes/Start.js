import HumanPlayer from '../entities/HumanPlayer.js';
import AIPlayer from '../entities/AIPlayer.js';
import InputManager from '../utils/InputManager.js';
import CollisionResolver from '../utils/CollisionResolver.js';
import DeathScreen from '../ui/DeathScreen.js';
import Scoreboard from '../ui/Scoreboard.js';

export class Start extends Phaser.Scene {
    preload() {
        this.load.image('grass', 'assets/map_3548_1774.png');
        this.load.image('collision_map', 'assets/map_collision_3548_1774.png');

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

        const mapWidth = 3548;
        const mapHeight = 1774;

        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
        this.grass = this.add.tileSprite(0, 0, mapWidth, mapHeight, 'grass').setOrigin(0);

        // Grupos de times
        this.alliedPlayers = this.physics.add.group();
        this.enemyPlayers = this.physics.add.group();

        // Aliados (4 bots) e inimigos (5 bots). O nome só existe para o
        // placar do TAB; o offline não desenha nome sobre a cabeça.
        this.spawnBots(this.alliedPlayers, 'ally', 4, 1);
        this.spawnBots(this.enemyPlayers, 'enemy', 5, 5);

        // Jogador humano (pertence aos aliados)
        this.player = new HumanPlayer(this, 500, 700);
        this.player.displayName = 'Você';
        this.alliedPlayers.add(this.player);

        this.inputs = new InputManager(this);

        // Tela de morte (criada depois do InputManager para ficar acima da UI)
        this.deathScreen = new DeathScreen(this);
        this.scoreboard = new Scoreboard(this, () => this.scoreRows());

        // Câmera
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // Colisão entre personagens (sem dano por toque). Não usamos
        // `physics.add.collider` porque o corpo Arcade é retangular: a
        // separação real é feita sobre as elipses, em CollisionResolver.
        this.collisionResolver = new CollisionResolver(this, [this.alliedPlayers, this.enemyPlayers]);

        this.events.on('postupdate', () => {
            // Ordem importa: separa os personagens e só depois prende ao mapa,
            // para que o clamp continue sendo a última palavra sobre a posição.
            this.collisionResolver.update();

            this.alliedPlayers.getChildren().forEach(p => p.clampToWorldBounds());
            this.enemyPlayers.getChildren().forEach(p => p.clampToWorldBounds());
        });
    }

    update(time, delta) {
        this.inputs.update();

        const movement = this.inputs.getMovementVector();
        const attackState = this.inputs.getAttackState();

        if (!this.player._isDead) this.player.update(movement, attackState);

        this.alliedPlayers.getChildren().forEach(ai => {
            if (ai !== this.player) ai.aiUpdate(time, delta);
        });
        this.enemyPlayers.getChildren().forEach(ai => ai.aiUpdate(time, delta));

        this.scoreboard.update(time);
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
            const x = Phaser.Math.Between(800, 3000);
            const y = Phaser.Math.Between(200, 1500);
            const bot = new AIPlayer(this, x, y, team);
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