export default class InputManager {
    constructor(scene) {
        this.scene = scene;

        // Teclado
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd = scene.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D'
        });
        this.spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // Joystick virtual
        this.joystickActive = false;
        this.joystickForce = { x: 0, y: 0 };
        const baseX = 120;
        const baseY = scene.cameras.main.height - 120;
        const baseRadius = 60;
        const thumbRadius = 30;
        this.joystickBaseX = baseX;
        this.joystickBaseY = baseY;
        this.joystickMaxDist = baseRadius - thumbRadius;

        this.createVirtualJoystick(baseX, baseY, baseRadius, thumbRadius);
        this.createAttackButton();

        // Estado do ataque unificado
        this._attackHeld = false;
        this._attackJustPressed = false;
        this._attackJustReleased = false;

        this._touchAttackDown = false;       // dedo no botão de ataque (touch)
        this._prevTouchAttackDown = false;   // estado anterior para detecção de borda

        this._lastSpaceDown = false;         // estado anterior do espaço

        this.setupTouchEvents();
    }

    createVirtualJoystick(x, y, baseR, thumbR) {
        this.joystickBase = this.scene.add.circle(x, y, baseR, 0xffffff, 0.3);
        this.joystickBase.setScrollFactor(0);
        this.joystickBase.setDepth(100);

        this.joystickThumb = this.scene.add.circle(x, y, thumbR, 0xffffff, 0.6);
        this.joystickThumb.setScrollFactor(0);
        this.joystickThumb.setDepth(101);
    }

    createAttackButton() {
        const { width, height } = this.scene.cameras.main;
        this.attackBtn = this.scene.add.circle(width - 100, height - 120, 50, 0xff0000, 0.4)
            .setInteractive()
            .setScrollFactor(0)
            .setDepth(100);
        // A lógica de ataque é gerenciada via estado, não diretamente aqui
    }

    setupTouchEvents() {
        // Joystick e ataque
        this.scene.input.on('pointerdown', (pointer) => {
            const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.joystickBaseX, this.joystickBaseY);
            if (dist <= this.joystickMaxDist + 50) {
                this.joystickActive = true;
                this.updateJoystickPosition(pointer);
            }

            if (this.attackBtn.getBounds().contains(pointer.x, pointer.y)) {
                this._touchAttackDown = true;
            }
        });

        this.scene.input.on('pointermove', (pointer) => {
            if (this.joystickActive) {
                this.updateJoystickPosition(pointer);
            }
        });

        this.scene.input.on('pointerup', (pointer) => {
            this.joystickActive = false;
            this.joystickThumb.setPosition(this.joystickBaseX, this.joystickBaseY);
            this.joystickForce = { x: 0, y: 0 };

            if (this._touchAttackDown) {
                this._touchAttackDown = false;
            }
        });

        this.scene.input.on('pointerupoutside', (pointer) => {
            this.joystickActive = false;
            this.joystickThumb.setPosition(this.joystickBaseX, this.joystickBaseY);
            this.joystickForce = { x: 0, y: 0 };

            if (this._touchAttackDown) {
                this._touchAttackDown = false;
            }
        });
    }

    updateJoystickPosition(pointer) {
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

    getMovementVector() {
        let dx = 0;
        let dy = 0;

        if (this.joystickActive) {
            dx = this.joystickForce.x;
            dy = this.joystickForce.y;
        } else {
            if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
            if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
            if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
            if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

            if (dx !== 0 || dy !== 0) {
                const length = Math.sqrt(dx * dx + dy * dy);
                dx /= length;
                dy /= length;
            }
        }

        return { dx, dy };
    }

    /**
     * Deve ser chamado a cada frame ANTES de getAttackState.
     */
    update() {
        // Teclado (espaço)
        const spaceDown = this.spaceKey.isDown;

        if (spaceDown && !this._lastSpaceDown) {
            this._attackJustPressed = true;
        }
        if (!spaceDown && this._lastSpaceDown) {
            this._attackJustReleased = true;
        }
        this._lastSpaceDown = spaceDown;

        // Touch (botão de ataque)
        if (!this._prevTouchAttackDown && this._touchAttackDown) {
            this._attackJustPressed = true;
        }
        if (this._prevTouchAttackDown && !this._touchAttackDown) {
            this._attackJustReleased = true;
        }
        this._prevTouchAttackDown = this._touchAttackDown;

        // Estado mantido: teclado OU touch pressionado
        this._attackHeld = spaceDown || this._touchAttackDown;
    }

    getAttackState() {
        const state = {
            held: this._attackHeld,
            justPressed: this._attackJustPressed,
            justReleased: this._attackJustReleased
        };
        // Limpa os flags de borda para o próximo frame
        this._attackJustPressed = false;
        this._attackJustReleased = false;
        return state;
    }
}