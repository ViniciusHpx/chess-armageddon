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

/**
 * Raio do miolo arrastável do controle de ataque.
 *
 * O controle ocupa o mesmo lugar e o mesmo tamanho do botão que ele substitui
 * (raio 50), então a distância até o botão de dash continua sendo maior que a
 * soma dos raios — não há como acertar os dois com o mesmo toque.
 */
const ATTACK_STICK_THUMB = 26;

/**
 * Um controle virtual arrastável: base fixa + miolo que segue o dedo.
 *
 * É a mesma mecânica que o joystick de movimento sempre teve, extraída porque
 * agora existem DOIS controles e reescrevê-la duas vezes deixaria os dois
 * divergindo (e é onde entraria a duplicação que o joystick de ataque não
 * precisa ter).
 *
 * A diferença que importa em relação ao código antigo é o `pointerId`: cada
 * controle guarda QUAL dedo o pegou e só reage àquele. Sem isso, o `pointerup`
 * de um dedo zerava o outro controle — o que já acontecia ao soltar o botão de
 * ataque (o joystick de movimento parava junto) e ficaria fatal agora, que os
 * dois são usados ao mesmo tempo.
 */
class VirtualStick {
    /**
     * @param {number} x Centro da base.
     * @param {number} y Centro da base.
     * @param {number} baseRadius
     * @param {number} thumbRadius
     * @param {number} grabRadius Distância do centro em que um toque pega o controle.
     */
    constructor(x, y, baseRadius, thumbRadius, grabRadius) {
        this.baseX = x;
        this.baseY = y;
        this.maxDist = baseRadius - thumbRadius;
        this.grabRadius = grabRadius;

        this.active = false;
        this.force = { x: 0, y: 0 };
        /** Dedo que está usando este controle; null = nenhum. */
        this.pointerId = null;
    }

    /** Este toque pega o controle? */
    grabs(pointer) {
        if (this.active) return false;
        const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.baseX, this.baseY);
        return dist <= this.grabRadius;
    }

    grab(pointer) {
        this.active = true;
        this.pointerId = pointer.id;
        this.moveTo(pointer);
    }

    /** O evento é deste controle? */
    owns(pointer) {
        return this.active && this.pointerId === pointer.id;
    }

    moveTo(pointer) {
        let dx = pointer.x - this.baseX;
        let dy = pointer.y - this.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.maxDist) {
            dx = (dx / dist) * this.maxDist;
            dy = (dy / dist) * this.maxDist;
        }

        this.thumbX = this.baseX + dx;
        this.thumbY = this.baseY + dy;
        this.force = { x: dx / this.maxDist, y: dy / this.maxDist };
        this.redraw();
    }

    release() {
        this.active = false;
        this.pointerId = null;
        this.force = { x: 0, y: 0 };
        this.thumbX = this.baseX;
        this.thumbY = this.baseY;
        this.redraw();
    }

    /** Reposiciona os objetos de tela. Sobrescrito por quem tem mais camadas. */
    redraw() {
        if (this.thumb) this.thumb.setPosition(this.thumbX, this.thumbY);
    }
}

export default class InputManager {
    constructor(scene) {
        this.scene = scene;

        // Dois controles ao mesmo tempo exigem dois dedos, e o Phaser nasce com
        // um só ponteiro de toque ativo (`activePointers`). Sem isto, o segundo
        // dedo simplesmente não gera evento nenhum e o ataque direcional não
        // funcionaria no celular.
        scene.input.addPointer(2);

        // Teclado
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd = scene.input.keyboard.addKeys({
            up: 'W', down: 'S', left: 'A', right: 'D'
        });
        this.spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.dashKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        this.createVirtualJoystick(120, scene.cameras.main.height - 120, 60, 30);
        this.createAttackStick();
        this.createDashButton();
        this.createDebugButton();

        // Estado do ataque unificado
        this._attackHeld = false;
        this._attackJustPressed = false;
        this._attackJustReleased = false;

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
        // O raio de pega é o de sempre (`maxDist + 50`): o joystick de
        // movimento continua tão tolerante quanto era.
        this.moveStick = new VirtualStick(x, y, baseR, thumbR, (baseR - thumbR) + 50);

        this.joystickBase = this.scene.add.circle(x, y, baseR, 0xffffff, 0.3);
        this.joystickBase.setScrollFactor(0);
        this.joystickBase.setDepth(CONTROLS_DEPTH);

        this.joystickThumb = this.scene.add.circle(x, y, thumbR, 0xffffff, 0.6);
        this.joystickThumb.setScrollFactor(0);
        this.joystickThumb.setDepth(CONTROLS_DEPTH + 1);

        this.moveStick.thumb = this.joystickThumb;
        this.moveStick.release();
    }

    /**
     * Controle de ATAQUE: o botão vermelho virou um joystick.
     *
     * Toca e ataca (como antes), arrasta e escolhe a direção, segura e o golpe
     * se repete — o ritmo é do `ATTACK_INTERVAL`, no servidor. Fica no mesmo
     * lugar, com o mesmo tamanho e a mesma cor do botão que substitui, então
     * quem só toca nem percebe a diferença.
     *
     * O ícone de espada anda com o miolo: é o retorno visual da direção
     * escolhida, sem nada novo desenhado por quadro.
     */
    createAttackStick() {
        const { width, height } = this.scene.cameras.main;
        const x = width - 100;
        const y = height - 120;
        const raio = 50;

        // Raio de pega = o próprio raio do controle. Maior que isso invadiria o
        // botão de dash, que está a ~100 px do centro daqui.
        this.attackStick = new VirtualStick(x, y, raio, ATTACK_STICK_THUMB, raio);

        this.attackBase = this.scene.add.circle(x, y, raio, ATTACK_BTN_COLOR, ATTACK_BTN_ALPHA)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH);
        this.attackBase.setStrokeStyle(3, ATTACK_BTN_STROKE, 0.9);

        this.attackThumb = this.scene.add.circle(x, y, ATTACK_STICK_THUMB, ATTACK_BTN_COLOR, 0.95)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 1);
        this.attackThumb.setStrokeStyle(2, ATTACK_BTN_STROKE, 0.9);

        this.createSwordTexture();

        // Espada na diagonal: em pé ela some no meio do círculo.
        this.attackIcon = this.scene.add.image(x, y, SWORD_TEXTURE)
            .setScrollFactor(0)
            .setDepth(CONTROLS_DEPTH + 2)
            .setAngle(-45)
            .setScale(0.78)
            .setAlpha(0.95);

        // O miolo e o ícone andam juntos.
        this.attackStick.redraw = () => {
            this.attackThumb.setPosition(this.attackStick.thumbX, this.attackStick.thumbY);
            this.attackIcon.setPosition(this.attackStick.thumbX, this.attackStick.thumbY);
        };
        this.attackStick.release();
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
        // Os dois controles são arrastáveis e podem estar em uso ao mesmo
        // tempo, então cada evento é roteado pelo id do DEDO — ver
        // `VirtualStick.owns`. Os raios de pega não se sobrepõem, então um
        // toque nunca pega os dois.
        this.scene.input.on('pointerdown', (pointer) => {
            if (this.moveStick.grabs(pointer)) this.moveStick.grab(pointer);
            else if (this.attackStick.grabs(pointer)) this.attackStick.grab(pointer);

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
            if (this.moveStick.owns(pointer)) this.moveStick.moveTo(pointer);
            if (this.attackStick.owns(pointer)) this.attackStick.moveTo(pointer);
        });

        // `pointerup` e `pointerupoutside` largam SÓ o controle daquele dedo.
        // Antes os dois zeravam o joystick de movimento sem olhar de quem era o
        // evento, então soltar o botão de ataque parava o personagem.
        const solta = (pointer) => {
            if (this.moveStick.owns(pointer)) this.moveStick.release();
            if (this.attackStick.owns(pointer)) this.attackStick.release();
        };

        this.scene.input.on('pointerup', solta);
        this.scene.input.on('pointerupoutside', solta);

        // Perder o foco com o dedo na tela não gera `pointerup`: sem isto os
        // controles ficariam presos e o personagem sairia andando e batendo
        // sozinho ao voltar. Espelha o `haltInput` das cenas.
        this._onBlur = () => {
            this.moveStick.release();
            this.attackStick.release();
        };
        this.scene.game.events.on(Phaser.Core.Events.BLUR, this._onBlur);
        this.scene.game.events.on(Phaser.Core.Events.HIDDEN, this._onBlur);
        this.scene.events.once('shutdown', () => this.destroy());
    }

    /**
     * Solta os listeners que não morrem com a cena.
     *
     * Os `scene.input.on` são limpos pelo Phaser junto com a cena, mas os de
     * `game.events` sobrevivem a ela — sem remover, uma troca de cena deixaria
     * o listener antigo apontando para controles destruídos.
     */
    destroy() {
        if (!this._onBlur) return;
        this.scene.game.events.off(Phaser.Core.Events.BLUR, this._onBlur);
        this.scene.game.events.off(Phaser.Core.Events.HIDDEN, this._onBlur);
        this._onBlur = null;
    }

    getMovementVector() {
        let dx = 0;
        let dy = 0;

        if (this.moveStick.active) {
            dx = this.moveStick.force.x;
            dy = this.moveStick.force.y;
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
     * MIRA do ataque: o arraste do controle de ataque, no mesmo formato
     * normalizado do vetor de movimento.
     *
     * Neutro (`{0, 0}`) significa "sem mira", e aí quem decide a direção é o
     * `flipX` do personagem — o comportamento de sempre. É o que o Espaço do
     * teclado devolve, então quem joga de teclado não muda nada.
     *
     * A zona morta e o encaixe nas oito direções NÃO são aplicados aqui: quem
     * faz isso é o servidor (`World.attackDir`), com as mesmas constantes. O
     * cliente só relata o arraste.
     */
    getAttackVector() {
        if (!this.attackStick.active) return { ax: 0, ay: 0 };
        return { ax: this.attackStick.force.x, ay: this.attackStick.force.y };
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

        // Controle de ataque (toque/mouse). Só a presença do dedo importa aqui;
        // a direção do arraste sai por `getAttackVector`.
        const stickDown = this.attackStick.active;

        if (!this._prevTouchAttackDown && stickDown) {
            this._attackJustPressed = true;
        }
        if (this._prevTouchAttackDown && !stickDown) {
            this._attackJustReleased = true;
        }
        this._prevTouchAttackDown = stickDown;

        // Estado mantido: teclado OU controle pressionado
        this._attackHeld = spaceDown || stickDown;

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