/**
 * Tela de morte: overlay escuro com "VOCÊ MORREU" e um botão de renascer.
 * Fica fixo na câmera (setScrollFactor(0)) e acima de toda a UI de input.
 */
import { viewportOf } from '../utils/Viewport.js';
import { TEXT_RESOLUTION } from '../utils/RenderPolicy.js';

/** Deslocamentos a partir do centro da tela. */
const TITULO_Y = -80;
const BOTAO_Y = 40;

export default class DeathScreen {
    constructor(scene) {
        this.scene = scene;
        this._onRespawn = null;

        this.viewport = viewportOf(scene);

        // Fundo escurecido — bloqueia visualmente a arena.
        //
        // Usa a tela INTEIRA, não a área útil: escurecer é para cobrir tudo,
        // inclusive o que fica sob o notch. Quem respeita o recorte é o
        // conteúdo clicável, e este está no centro.
        this.overlay = scene.add.rectangle(0, 0, 1, 1, 0x000000, 0.65)
            .setOrigin(0);

        this.title = scene.add.text(0, 0, 'VOCÊ MORREU', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '64px',
            color: '#ff3b3b',
            stroke: '#000000',
            strokeThickness: 8,
            resolution: TEXT_RESOLUTION
        }).setOrigin(0.5);

        // Botão de renascer (retângulo + label)
        this.button = scene.add.rectangle(0, 0, 260, 70, 0x1e1e1e, 0.95)
            .setStrokeStyle(3, 0xffffff, 0.9)
            .setInteractive({ useHandCursor: true });

        this.buttonLabel = scene.add.text(0, 0, 'RENASCER', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '32px',
            color: '#ffffff',
            resolution: TEXT_RESOLUTION
        }).setOrigin(0.5);

        this.elements = [this.overlay, this.title, this.button, this.buttonLabel];
        this.elements.forEach(el => {
            el.setScrollFactor(0);
            el.setDepth(10000);
            el.setVisible(false);
        });

        // Feedback de hover
        this.button.on('pointerover', () => this.button.setFillStyle(0x3a3a3a, 0.95));
        this.button.on('pointerout', () => this.button.setFillStyle(0x1e1e1e, 0.95));

        this.button.on('pointerdown', (pointer, x, y, event) => {
            // Evita que o clique vaze para o joystick/botão de ataque
            if (event) event.stopPropagation();
            this.hide();
            if (this._onRespawn) this._onRespawn();
        });

        this.button.disableInteractive();

        this.layout();
        this.viewport.onResize(() => this.layout());
    }

    /** Cobre a tela toda e centraliza o conteúdo. */
    layout() {
        const vp = this.viewport;

        this.overlay.setPosition(0, 0).setSize(vp.width, vp.height);

        const titulo = vp.center(0, TITULO_Y);
        this.title.setPosition(titulo.x, titulo.y);

        const botao = vp.center(0, BOTAO_Y);
        this.button.setPosition(botao.x, botao.y);
        this.buttonLabel.setPosition(botao.x, botao.y);
    }

    /**
     * Exibe a tela. `onRespawn` é chamado ao clicar em RENASCER.
     */
    show(onRespawn) {
        this._onRespawn = onRespawn;
        this.elements.forEach(el => el.setVisible(true));
        this.button.setInteractive({ useHandCursor: true });
    }

    hide() {
        this.elements.forEach(el => el.setVisible(false));
        this.button.disableInteractive();
        this.button.setFillStyle(0x1e1e1e, 0.95);
    }

    get isVisible() {
        return this.overlay.visible;
    }
}
