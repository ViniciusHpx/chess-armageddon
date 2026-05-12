import Player from '../entities/Player.js';
import InputManager from '../utils/InputManager.js';

export class Start extends Phaser.Scene {
    preload() {
        // O carregamento dos assets aqui na Scene
        this.load.image('grass', 'assets/grass.png');
        this.load.spritesheet('pawn', 'assets/pawn_256.png', { frameWidth: 256, frameHeight: 256 });
    }

    create() {
        // 1. Defina o tamanho do mapa (ex: 3000x2000 pixels)
        const mapWidth = 3000;
        const mapHeight = 2000;

        // 2. Configure os limites do mundo físico
        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);

        // 3. Adicione o fundo (TileSprite é ótimo para grama que se repete)
        this.grass = this.add.tileSprite(0, 0, mapWidth, mapHeight, 'grass');
        this.grass.setOrigin(0, 0); // Começa no topo esquerdo

        // 4. Crie o player
        this.player = new Player(this, 640, 360); 
        this.inputs = new InputManager(this);

        // --- LÓGICA DA CÂMERA ---
        
        // 5. Faz a câmera seguir o player
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

        // 6. Impede que a câmera mostre o que está fora do mapa
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    }

    update() {
        const movement = this.inputs.getMovementVector();
        this.player.update(movement);
    }
}