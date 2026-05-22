import HumanPlayer from '../entities/HumanPlayer.js';
import AIPlayer from '../entities/AIPlayer.js';
import InputManager from '../utils/InputManager.js';

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

        // Aliados (4 bots)
        for (let i = 0; i < 4; i++) {
            const x = Phaser.Math.Between(800, 3000);
            const y = Phaser.Math.Between(200, 1500);
            const ally = new AIPlayer(this, x, y, 'ally');
            this.alliedPlayers.add(ally);
        }

        // Inimigos (5 bots)
        for (let i = 0; i < 5; i++) {
            const x = Phaser.Math.Between(800, 3000);
            const y = Phaser.Math.Between(200, 1500);
            const enemy = new AIPlayer(this, x, y, 'enemy');
            this.enemyPlayers.add(enemy);
        }

        // Jogador humano (pertence aos aliados)
        this.player = new HumanPlayer(this, 500, 700);
        this.alliedPlayers.add(this.player);

        this.inputs = new InputManager(this);

        // Câmera
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // Colisões entre times (sem dano por toque)
        this.physics.add.collider(this.alliedPlayers, this.enemyPlayers);
        this.physics.add.collider(this.alliedPlayers, this.alliedPlayers);
        this.physics.add.collider(this.enemyPlayers, this.enemyPlayers);

        // Garante que todos os personagens fiquem dentro do mundo após a física
        this.events.on('postupdate', () => {
            this.alliedPlayers.getChildren().forEach(p => p.clampToWorldBounds());
            this.enemyPlayers.getChildren().forEach(p => p.clampToWorldBounds());
        });
    }

    update(time, delta) {
        this.inputs.update();

        const movement = this.inputs.getMovementVector();
        const attackState = this.inputs.getAttackState();

        this.player.update(movement, attackState);

        this.alliedPlayers.getChildren().forEach(ai => {
            if (ai !== this.player) ai.aiUpdate(time, delta);
        });
        this.enemyPlayers.getChildren().forEach(ai => ai.aiUpdate(time, delta));
    }
}