export class Start extends Phaser.Scene {

    constructor() {
        super('Start');
    }

    preload() {
        this.load.image('grass', 'assets/grass.png');
        this.load.spritesheet('pawn', 'assets/pawn_spritesheet.png', { frameWidth: 256, frameHeight: 256 });
        this.load.audio('footstep', 'assets/grass-footstep.mp3');
    }

    create() {
        // Fundo
        this.grass = this.add.tileSprite(640, 360, 1280, 720, 'grass');
        this.cameras.main.setBounds(0, 0, 1280, 720);

        // Personagem com física
        this.pawn = this.physics.add.sprite(640, 360, 'pawn');
        this.pawn.setCollideWorldBounds(true);
        this.pawn.body.setSize(128, 64);
        this.pawn.body.setOffset(64, 192);

        // Som de passos (em loop, inicialmente pausado)
        this.footstepSound = this.sound.add('footstep', { loop: true, volume: 0.5 });
        this.wasWalking = false; // flag para controlar início/parada do som

        // Teclado
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D'
        });

        // Joystick virtual
        this.createVirtualJoystick();
    }

    update() {
        this.handleMovement();
    }

    handleMovement() {
        const speed = 200;
        let dx = 0;
        let dy = 0;

        const left  = this.cursors.left.isDown || this.wasd.left.isDown;
        const right = this.cursors.right.isDown || this.wasd.right.isDown;
        const up    = this.cursors.up.isDown || this.wasd.up.isDown;
        const down  = this.cursors.down.isDown || this.wasd.down.isDown;

        if (left)  dx -= 1;
        if (right) dx += 1;
        if (up)    dy -= 1;
        if (down)  dy += 1;

        if (this.joystickActive) {
            dx = this.joystickForce.x;
            dy = this.joystickForce.y;
        }

        const isMoving = (dx !== 0 || dy !== 0);

        if (isMoving) {
            // Normaliza o vetor
            const length = Math.sqrt(dx * dx + dy * dy);
            dx = (dx / length) * speed;
            dy = (dy / length) * speed;

            // Espelha o sprite com base na direção horizontal
            if (dx < 0) {
                this.pawn.setFlipX(true);   // virado para a esquerda
            } else if (dx > 0) {
                this.pawn.setFlipX(false);  // virado para a direita
            }
            // Se dx == 0 (movimento só vertical), mantém o último flip
        }

        this.pawn.setVelocity(dx, dy);

        // Controle do som de passos
        if (isMoving && !this.wasWalking) {
            this.footstepSound.play();
            this.wasWalking = true;
        } else if (!isMoving && this.wasWalking) {
            this.footstepSound.stop();
            this.wasWalking = false;
        }
    }

    // ─── Joystick ───
    createVirtualJoystick() {
        const baseX = 120;
        const baseY = this.cameras.main.height - 120;
        const baseRadius = 60;
        const thumbRadius = 30;

        this.joystickBase = this.add.circle(baseX, baseY, baseRadius, 0xffffff, 0.3);
        this.joystickBase.setScrollFactor(0);

        this.joystickThumb = this.add.circle(baseX, baseY, thumbRadius, 0xffffff, 0.6);
        this.joystickThumb.setScrollFactor(0);

        this.joystickActive = false;
        this.joystickForce = { x: 0, y: 0 };
        this.joystickBaseX = baseX;
        this.joystickBaseY = baseY;
        this.joystickMaxDist = baseRadius - thumbRadius;

        this.input.on('pointerdown', (pointer) => {
            const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.joystickBaseX, this.joystickBaseY);
            if (dist <= baseRadius + 30) {
                this.joystickActive = true;
                this.updateJoystick(pointer);
            }
        });

        this.input.on('pointermove', (pointer) => {
            if (this.joystickActive) {
                this.updateJoystick(pointer);
            }
        });

        this.input.on('pointerup', () => {
            this.joystickActive = false;
            this.joystickThumb.setPosition(this.joystickBaseX, this.joystickBaseY);
            this.joystickForce = { x: 0, y: 0 };
        });
    }

    updateJoystick(pointer) {
        let dx = pointer.x - this.joystickBaseX;
        let dy = pointer.y - this.joystickBaseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.joystickMaxDist) {
            dx = (dx / dist) * this.joystickMaxDist;
            dy = (dy / dist) * this.joystickMaxDist;
        }

        this.joystickThumb.setPosition(this.joystickBaseX + dx, this.joystickBaseY + dy);

        this.joystickForce = {
            x: dx / this.joystickMaxDist,
            y: dy / this.joystickMaxDist
        };
    }
}