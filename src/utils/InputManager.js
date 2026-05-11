// utils/InputManager.js
export default class InputManager {
    constructor(scene) {
        this.scene = scene;

        // Configuração Teclado
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd = scene.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D'
        });

        // Configuração Joystick (Variáveis de Estado)
        this.joystickActive = false;
        this.joystickForce = { x: 0, y: 0 };
        
        // Configurações visuais do Joystick (pode ajustar aqui se quiser)
        const baseX = 120;
        const baseY = scene.cameras.main.height - 120;
        const baseRadius = 60;
        const thumbRadius = 30;
        this.joystickBaseX = baseX;
        this.joystickBaseY = baseY;
        this.joystickMaxDist = baseRadius - thumbRadius;

        // Criação Visual do Joystick
        this.createVirtualJoystick(baseX, baseY, baseRadius, thumbRadius);

        // Configuração dos Eventos de Toque
        this.setupTouchEvents();
    }

    createVirtualJoystick(x, y, baseR, thumbR) {
        // Base do Joystick
        this.joystickBase = this.scene.add.circle(x, y, baseR, 0xffffff, 0.3);
        this.joystickBase.setScrollFactor(0); // Garante que fique fixo na tela
        this.joystickBase.setDepth(100);     // Garante que fique acima do cenário

        // Botão (Thumb) do Joystick
        this.joystickThumb = this.scene.add.circle(x, y, thumbR, 0xffffff, 0.6);
        this.joystickThumb.setScrollFactor(0);
        this.joystickThumb.setDepth(101);     // Acima da base
    }

    setupTouchEvents() {
        // Detecta o clique/toque inicial
        this.scene.input.on('pointerdown', (pointer) => {
            const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.joystickBaseX, this.joystickBaseY);
            // Verifica se o toque foi perto o suficiente da base
            if (dist <= this.joystickMaxDist + 50) { 
                this.joystickActive = true;
                this.updateJoystickPosition(pointer);
            }
        });

        // Detecta o movimento enquanto o dedo está pressionado
        this.scene.input.on('pointermove', (pointer) => {
            if (this.joystickActive) {
                this.updateJoystickPosition(pointer);
            }
        });

        // Detecta quando o dedo solta a tela
        this.scene.input.on('pointerup', () => {
            this.joystickActive = false;
            // Reseta a posição do botão para o centro
            this.joystickThumb.setPosition(this.joystickBaseX, this.joystickBaseY);
            // Reseta a força para zero
            this.joystickForce = { x: 0, y: 0 };
        });
    }

    updateJoystickPosition(pointer) {
        let dx = pointer.x - this.joystickBaseX;
        let dy = pointer.y - this.joystickBaseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Limita o movimento do botão dentro do raio da base
        if (dist > this.joystickMaxDist) {
            dx = (dx / dist) * this.joystickMaxDist;
            dy = (dy / dist) * this.joystickMaxDist;
        }

        // Atualiza a posição visual do botão
        this.joystickThumb.setPosition(this.joystickBaseX + dx, this.joystickBaseY + dy);

        // Calcula a força normalizada (de -1 a 1) para o movimento
        this.joystickForce = {
            x: dx / this.joystickMaxDist,
            y: dy / this.joystickMaxDist
        };
    }

    getMovementVector() {
        let dx = 0;
        let dy = 0;

        // Se o joystick estiver sendo usado, ele tem prioridade
        if (this.joystickActive) {
            dx = this.joystickForce.x;
            dy = this.joystickForce.y;
        } else {
            // Senão, lê o teclado
            if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
            if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
            if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
            if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

            // Normaliza o teclado (joystick já vem normalizado)
            if (dx !== 0 || dy !== 0) {
                const length = Math.sqrt(dx * dx + dy * dy);
                dx /= length;
                dy /= length;
            }
        }

        return { dx, dy };
    }
}