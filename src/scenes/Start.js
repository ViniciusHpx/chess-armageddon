import Player from '../entities/Player.js';
import InputManager from '../utils/InputManager.js';

export class Start extends Phaser.Scene {
    preload() {
        // O carregamento dos assets aqui na Scene
        this.load.image('grass', 'assets/map_3548_1774.png');
        this.load.image('collision_map', 'assets/map_collision_3548_1774.png');

        this.load.spritesheet('pawn', 'assets/pawn_128.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tower', 'assets/tower_128.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('horse', 'assets/horse_128.png', { frameWidth: 128, frameHeight: 128 });
    }

    create() {
        // 1. Defina o tamanho do mapa (ex: 3000x2000 pixels)
        const mapWidth = 3548;
        const mapHeight = 1774;

        // 2. Configure os limites do mundo físico
        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
        this.add.tileSprite(0, 0, mapWidth, mapHeight, 'grass').setOrigin(0);

        // 3. Adicione o fundo (TileSprite é ótimo para grama que se repete)
        this.grass = this.add.tileSprite(0, 0, mapWidth, mapHeight, 'grass');
        this.grass.setOrigin(0, 0); // Começa no topo esquerdo

        // Grupo dinâmico para otimização de colisões com inimigos
        this.enemies = this.physics.add.group();
        this.spawnEnemies(15);

        // 4. Crie o player
        this.player = new Player(this, 500, 700, this.collisionContext);
        this.inputs = new InputManager(this);

        // --- LÓGICA DA CÂMERA ---
        
        // 5. Faz a câmera seguir o player
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

        // 6. Impede que a câmera mostre o que está fora do mapa
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // Colisão Player vs Inimigos: Se o player tocar sem estar atacando, ele morre
        this.physics.add.collider(this.player, this.enemies, (player, enemy) => {
            if (!player._isAttacking) {
                player.resetToPawn();
                // Opcional: Voltar para o spawn
                player.setPosition(640, 360);
                this.cameras.main.shake(200, 0.01);
            }
        });
    }

    // Sistema de Spawn: gera inimigos em posições aleatórias dentro do mapa
    spawnEnemies(count) {
        for (let i = 0; i < count; i++) {
            const x = Phaser.Math.Between(800, 3000);
            const y = Phaser.Math.Between(200, 1500);
            const bot = this.enemies.create(x, y, 'pawn').setTint(0x555555);
            bot.body.setCollideWorldBounds(true);
            
            // Método para o bot morrer
            bot.die = () => {
                bot.destroy();
                // Spawnar outro bot depois de um tempo para manter a arena cheia
                this.time.delayedCall(3000, () => this.spawnEnemies(1));
            };
        }
    }

    cycleSkin() {
        this.currentSkinIndex = (this.currentSkinIndex + 1) % this.skins.length;
        const nextSkin = this.skins[this.currentSkinIndex];
        this.player.setSkin(nextSkin);
    }

    update() {
        const movement = this.inputs.getMovementVector();
        this.player.update(movement);

        // Teclado Espaço
        if (Phaser.Input.Keyboard.JustDown(this.inputs.spaceKey)) {
            this.player.attack();
        }
    }
}