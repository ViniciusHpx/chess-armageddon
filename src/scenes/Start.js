import Player from '../entities/Player.js';
import InputManager from '../utils/InputManager.js';

export class Start extends Phaser.Scene {
    preload() {
        // O carregamento dos assets aqui na Scene
        this.load.image('grass', 'assets/grass.png');
        this.load.spritesheet('pawn', 'assets/pawn_256.png', { frameWidth: 256, frameHeight: 256 });
    }

    create() {
        this.grass = this.add.tileSprite(640, 360, 1280, 720, 'grass');

        // Passamos a 'this' (a própria cena) para que o Player 
        // possa acessar o sistema de física e som que carregamos acima
        this.player = new Player(this, 640, 360); 
        this.inputs = new InputManager(this);
    }

    update() {
        const movement = this.inputs.getMovementVector();
        this.player.update(movement);
    }
}