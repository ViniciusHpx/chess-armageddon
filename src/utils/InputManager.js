/** Botão de ataque: vermelho cheio, opaco o bastante para ler no mapa claro. */
const ATTACK_BTN_COLOR = 0xd91b1b;
const ATTACK_BTN_ALPHA = 0.75;
const ATTACK_BTN_STROKE = 0x6e0000;

const SWORD_TEXTURE = 'attack-sword-icon';

/**
 * Profundidade dos controles na tela.
 *
 * Precisa ficar acima dos personagens, e eles NÃO têm profundidade fixa:
 * `setDepth(this.y)` cresce com a posição no mapa e chega perto de 1900 na
 * borda de baixo (mais os overlays de barra de vida e carga). Com os 100 de
 * antes, qualquer peça que passasse por perto do canto inferior direito
 * cobria o botão.
 *
 * A faixa 8000 fica acima disso e continua abaixo do resto da interface, que
 * tem de cobrir os controles: HUD de texto (9000), placar do TAB (9500) e
 * tela de morte (10000).
 */
const CONTROLS_DEPTH = 8000;

/**
 * Botão de dash: menor que o de ataque e logo abaixo/à esquerda dele, dentro
 * do arco natural do polegar direito, longe o bastante para não haver toque
 * errado (a distância entre centros é maior que a soma dos raios).
 */
const DASH_BTN_COLOR = 0x2f7fd6;
const DASH_BTN_ALPHA = 0.7;
const DASH_BTN_STROKE = 0x0d3a68;
const DASH_BTN_RADIUS = 34;

/** Opacidade do botão enquanto o dash está em recarga. */
const DASH_BTN_DISABLED_ALPHA = 0.3;

const DASH_TEXTURE = 'dash-icon';

/**
 * Botão de DEBUG: mesmo molde do dash (círculo + rótulo, `setScrollFactor(0)`,
 * mesma faixa de profundidade), só que roxo e escrito DEBUG.
 *
 * A cor e a palavra existem para ele NÃO parecer mecânica do jogo: ataque é
 * vermelho, dash é azul, e nenhum dos dois tem texto. Fica à esquerda do dash,
 * fora do arco do polegar que aciona ataque e esquiva — apertar por engano no
 * meio da briga trocaria a peça.
 */
const DEBUG_BTN_COLOR = 0x7a3fb0;
const DEBUG_BTN_ALPHA = 0.7;
const DEBUG_BTN_STROKE = 0x2c1046;
const DEBUG_BTN_RADIUS = 30;

/**
 * Passo mínimo do indicador de recarga para valer um redesenho.
 *
 * O `Graphics` do indicador é limpo e redesenhado, então redesenhar a cada
 * quadro seria trabalho jogado fora: 0,02 dá ~50 redesenhos ao longo de todo o
 * cooldown, o suficiente para o movimento parecer contínuo.
 */
const DASH_CD_STEP = 0.02;

export default class InputManager {
    constructor(scene) {
        this.scene = scene;

        // Teclado
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd = scene.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D'
        });
        this.spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.dashKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

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
        this.createDashButton();
        this.createDebugButton();

        // Estado do ataque unificado
        this._attackHeld = false;
        this._attackJustPressed = false;
        this._attackJustReleased = false;

        this._touchAttackDown = false;       // dedo no botão de ataque (touch)
        this._prevTouchAttackDown = false;   // estado anterior para detecção de borda

        this._lastSpaceDown = false;         // estado anterior do espaço

        // Estado do dash. Só tem borda de descida: dash é um toque, não um
        // botão que se segura como o de ataque.
        this._dashJustPressed = false;
        this._lastShiftDown = false;

        // DEBUG: só borda de descida, como o dash — é um toque.
        this._debugJustPressed = false;

        this.setupTouchEvents();
    }

    createVirtualJoystick(x, y, baseR, thumbR) {
        this.joystickBase = this.scene.add.circle(x, y, baseR, 0xffffff, 0.3);
        this.joystickBase.setScrollFactor(0);
        this.joystickBase.setDepth(CONTROLS_DEPTH);

        this.joystickThumb = this.scene.add.circle(x, y, thumbR, 0xffffff, 0.6);
        this.joystickThumb.setScrollFactor(0);
        this.joystickThumb.setDepth(CONTROLS_DEPTH + 1);
    }

    createAttackButton() {
        const { width, height } = this.scene.cameras.main;
        const x = width - 100;
        const y = height - 120;
        const raio = 50;

        this.attackBtn = this.scene.add.circle(x, y, raio, ATTACK_BTN_COLOR, ATTACK_BTN_ALPHA)
            .setInteractive()
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH);
        this.attackBtn.setStrokeStyle(3, ATTACK_BTN_STROKE, 0.9);

        this.createSwordTexture();

        // Espada na diagonal: em pé ela some no meio do círculo.
        this.attackIcon = this.scene.add.image(x, y, SWORD_TEXTURE)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 1)
            .setAngle(-45)
            .setScale(0.78)
            .setAlpha(0.95);

        // A lógica de ataque é gerenciada via estado, não diretamente aqui
    }

    /**
     * Ícone de espada desenhado uma vez e virado textura.
     *
     * Não há arte de espada em `assets/`, e um glifo de texto (⚔) depende da
     * fonte do aparelho — no Android costuma sair como quadrado vazio.
     */
    createSwordTexture() {
        if (this.scene.textures.exists(SWORD_TEXTURE)) return;

        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });

        // Lâmina longa e fina: gorda demais o ícone vira um X no botão.
        g.fillStyle(0xffffff, 1);
        g.fillPoints([
            { x: 48, y: 4 },
            { x: 55, y: 20 },
            { x: 55, y: 60 },
            { x: 41, y: 60 },
            { x: 41, y: 20 }
        ], true);

        // Vinco central, um tom abaixo, para a lâmina não virar um borrão.
        g.fillStyle(0xc9cfdd, 1);
        g.fillRect(47, 16, 2, 44);

        // Guarda, cabo e pomo.
        g.fillStyle(0xffffff, 1);
        g.fillRect(27, 60, 42, 8);
        g.fillRect(43, 68, 10, 16);
        g.fillCircle(48, 86, 6);

        g.generateTexture(SWORD_TEXTURE, 96, 96);
        g.destroy();
    }

    createDashButton() {
        const { width, height } = this.scene.cameras.main;
        const x = width - 185;
        const y = height - 68;

        this.dashBtnX = x;
        this.dashBtnY = y;

        this.dashBtn = this.scene.add.circle(x, y, DASH_BTN_RADIUS, DASH_BTN_COLOR, DASH_BTN_ALPHA)
            .setInteractive()
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH);
        this.dashBtn.setStrokeStyle(3, DASH_BTN_STROKE, 0.9);

        this.createDashTexture();

        this.dashIcon = this.scene.add.image(x, y, DASH_TEXTURE)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 2)
            .setScale(0.62)
            .setAlpha(0.95);

        // Indicador de recarga: uma fatia escura por cima do botão, encolhendo
        // como um relógio. Fica entre o círculo e o ícone.
        this.dashCooldownGraphics = this.scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 1);

        // -1 força o primeiro desenho; depois só redesenha quando muda.
        this._dashCooldownRatio = 0;
        this._dashCooldownDrawn = -1;
        this.setDashCooldown(0);
    }

    /**
     * Botão de DEBUG, ao lado do de ataque.
     *
     * Reaproveita tudo o que o dash já usa — `add.circle` interativo,
     * `setScrollFactor(0)`, `CONTROLS_DEPTH`, o mesmo `pointerdown` do
     * `setupTouchEvents` — então não há componente, layout nem sistema de
     * entrada novo. O rótulo é um `Text` comum: aqui, ao contrário da espada e
     * das setas, texto serve, porque a palavra DEBUG é o ponto.
     */
    createDebugButton() {
        const { width, height } = this.scene.cameras.main;
        // Alinhado com o dash e à esquerda dele. A distância entre centros (83)
        // é maior que a soma dos raios (64), então não há como acertar os dois
        // com o mesmo toque.
        const x = width - 268;
        const y = height - 68;

        this.debugBtn = this.scene.add.circle(x, y, DEBUG_BTN_RADIUS, DEBUG_BTN_COLOR, DEBUG_BTN_ALPHA)
            .setInteractive()
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH);
        this.debugBtn.setStrokeStyle(3, DEBUG_BTN_STROKE, 0.9);

        this.debugLabel = this.scene.add.text(x, y, 'DEBUG', {
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#ffffff',
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 1)
            .setAlpha(0.95);
    }

    /**
     * Ícone do dash: duas setas de velocidade.
     *
     * Mesmo motivo da espada do ataque — não há arte em `assets/` e glifo de
     * texto depende da fonte do aparelho, então é desenhado e virado textura
     * uma única vez.
     */
    createDashTexture() {
        if (this.scene.textures.exists(DASH_TEXTURE)) return;

        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);

        // Duas setas apontando para a direita, a de trás menor e mais fraca:
        // lê como impulso, não como "avançar" de menu.
        g.fillPoints([
            { x: 34, y: 12 }, { x: 62, y: 48 }, { x: 34, y: 84 },
            { x: 34, y: 66 }, { x: 48, y: 48 }, { x: 34, y: 30 }
        ], true);

        g.fillStyle(0xffffff, 0.65);
        g.fillPoints([
            { x: 10, y: 20 }, { x: 33, y: 48 }, { x: 10, y: 76 },
            { x: 10, y: 60 }, { x: 20, y: 48 }, { x: 10, y: 36 }
        ], true);

        g.generateTexture(DASH_TEXTURE, 96, 96);
        g.destroy();
    }

    /**
     * Estado do botão de dash. Chamado pela cena a cada quadro com a fração de
     * cooldown que AINDA FALTA (1 = acabou de usar, 0 = pronto).
     *
     * No modo online esse valor vem do servidor (`ActorState.dashCd`), não de
     * um contador local: o botão mostra a mesma verdade que decide se o dash
     * vai ser aceito.
     */
    setDashCooldown(ratio) {
        const valor = Math.max(0, Math.min(1, ratio || 0));
        this._dashCooldownRatio = valor;

        const mudou = Math.abs(valor - this._dashCooldownDrawn) >= DASH_CD_STEP;
        const virou = (valor === 0) !== (this._dashCooldownDrawn === 0);
        if (!mudou && !virou) return;

        this._dashCooldownDrawn = valor;

        const pronto = valor === 0;
        const alpha = pronto ? 1 : DASH_BTN_DISABLED_ALPHA;
        this.dashBtn.setAlpha(pronto ? DASH_BTN_ALPHA : DASH_BTN_ALPHA * DASH_BTN_DISABLED_ALPHA);
        this.dashIcon.setAlpha(pronto ? 0.95 : alpha);

        const g = this.dashCooldownGraphics;
        g.clear();
        if (pronto) return;

        // Fatia que encolhe no sentido horário a partir do topo.
        const inicio = -Math.PI / 2;
        g.fillStyle(0x00121f, 0.55);
        g.slice(this.dashBtnX, this.dashBtnY, DASH_BTN_RADIUS - 2,
            inicio, inicio + Math.PI * 2 * valor, false);
        g.fillPath();
    }

    /** true enquanto o dash está em recarga (botão desabilitado). */
    get dashOnCooldown() {
        return this._dashCooldownRatio > 0;
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

            // Em recarga o toque é ignorado aqui mesmo: no online o servidor
            // recusaria de qualquer forma, e assim nem se gasta a mensagem.
            //
            // A flag é marcada no EVENTO, não amostrada em `update` como a do
            // ataque: um toque rápido começa e termina entre dois quadros, e
            // comparar o estado quadro a quadro perdia o dash. Ela fica presa
            // até `getDashState` consumir.
            if (!this.dashOnCooldown && this.dashBtn.getBounds().contains(pointer.x, pointer.y)) {
                this._dashJustPressed = true;
            }

            // DEBUG: mesma trava de borda do dash, pelo mesmo motivo — um
            // toque rápido começa e acaba entre dois quadros.
            if (this.debugBtn.getBounds().contains(pointer.x, pointer.y)) {
                this._debugJustPressed = true;
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

        // Dash: só a borda de descida interessa, do teclado (SHIFT) ou do botão.
        const shiftDown = this.dashKey.isDown;
        if (shiftDown && !this._lastShiftDown && !this.dashOnCooldown) {
            this._dashJustPressed = true;
        }
        this._lastShiftDown = shiftDown;

    }

    /**
     * Consome o toque de dash do quadro. Como `getAttackState`, zera a borda —
     * chame no máximo uma vez por quadro.
     */
    getDashState() {
        const state = { justPressed: this._dashJustPressed };
        this._dashJustPressed = false;
        return state;
    }

    /**
     * Consome o toque do botão DEBUG. Como `getDashState`, zera a borda —
     * chame no máximo uma vez por quadro.
     */
    getDebugState() {
        const state = { justPressed: this._debugJustPressed };
        this._debugJustPressed = false;
        return state;
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