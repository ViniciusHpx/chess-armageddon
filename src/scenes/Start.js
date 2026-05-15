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

        // 3. Adicione o fundo (TileSprite é ótimo para grama que se repete)
        this.grass = this.add.tileSprite(0, 0, mapWidth, mapHeight, 'grass');
        this.grass.setOrigin(0, 0); // Começa no topo esquerdo

        // Criamos um objeto de textura para ler os pixels
        this.collisionTexture = this.textures.get('collision_map').getSourceImage();
        this.collisionCanvas = document.createElement('canvas');
        this.collisionCanvas.width = this.collisionTexture.width;
        this.collisionCanvas.height = this.collisionTexture.height;
        this.collisionContext = this.collisionCanvas.getContext('2d');
        this.collisionContext.drawImage(this.collisionTexture, 0, 0);

        // 4. Crie o player
        this.player = new Player(this, 500, 700, this.collisionContext);
        this.inputs = new InputManager(this);

        // --- LÓGICA DA CÂMERA ---
        
        // 5. Faz a câmera seguir o player
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

        // 6. Impede que a câmera mostre o que está fora do mapa
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // ----- SISTEMA DE TROCA DE SKIN -----
        // Ordem das skins
        this.skins = ['pawn', 'tower', 'horse'];
        this.currentSkinIndex = 0;  // começa com 'pawn'

        // Temporizador de 5 segundos, repetindo infinitamente
        this.time.addEvent({
            delay: 25000,
            callback: this.cycleSkin,
            callbackScope: this,
            loop: true
        });
    }

    cycleSkin() {
        this.currentSkinIndex = (this.currentSkinIndex + 1) % this.skins.length;
        const nextSkin = this.skins[this.currentSkinIndex];
        this.player.setSkin(nextSkin);
    }

    update() {
        const movement = this.inputs.getMovementVector();
        this.player.update(movement);
    }
}