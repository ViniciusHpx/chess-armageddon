import { viewportOf } from '../utils/Viewport.js';

/**
 * Tela de fim de partida: arte de VITÓRIA ou DERROTA, o placar final e as duas
 * saídas (REVANCHE e MENU).
 *
 * Segue o mesmo padrão do [DeathScreen](DeathScreen.js): objetos do Phaser
 * presos à câmera (`setScrollFactor(0)`) no degrau 10000 de profundidade, o
 * topo da escala de interface. As duas telas nunca aparecem juntas — quem
 * decide é a cena.
 *
 * Não sabe nada de Team Deathmatch, de times ou de rede: recebe pronto se
 * venceu, o placar e o que fazer em cada botão. Qualquer modo com condição de
 * vitória usa a mesma tela.
 */

/** Cores de cada resultado: só isso muda entre a arte da vitória e a da derrota. */
const PALETA = {
    win: { titulo: '#ffd76a', brilho: 0xffb300, faixa: 0x3a2c00, borda: 0xffd76a },
    lose: { titulo: '#ff6a6a', brilho: 0x8b1a1a, faixa: 0x2a0d0d, borda: 0xff6a6a }
};

/** Raios do fundo. Número ímpar para nenhum ficar exatamente na horizontal. */
const RAIOS = 15;

/**
 * Deslocamentos a partir do centro da tela. A tela inteira é montada em volta
 * de `CENTRO_Y`, um pouco acima do meio para os botões caberem abaixo do
 * título sem encostar na borda.
 */
const CENTRO_Y = -40;
const PLACAR_Y = 70;
const BOTOES_Y = 160;
const BOTOES_X = 150;
const STATUS_Y = 220;

export default class ResultScreen {
    constructor(scene) {
        this.scene = scene;
        this._onRematch = null;
        this._onMenu = null;

        this.viewport = viewportOf(scene);

        // Cor do último resultado mostrado. Guardada porque a arte é um
        // `Graphics` em coordenadas absolutas: mudar o tamanho da tela com a
        // tela de resultado aberta obriga a redesenhá-la.
        this._cores = null;

        this.overlay = scene.add.rectangle(0, 0, 1, 1, 0x000000, 0.78).setOrigin(0);

        // Arte do resultado: raios saindo do título e uma faixa atrás dele.
        // É desenhada (e não uma imagem) para acompanhar a cor do resultado
        // sem carregar dois arquivos que só diferem no tom.
        this.arte = scene.add.graphics();

        this.titulo = scene.add.text(0, 0, '', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '84px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 10
        }).setOrigin(0.5);

        this.placar = scene.add.text(0, 0, '', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '30px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.rematch = this.criarBotao(0, 0, 'REVANCHE');
        this.menu = this.criarBotao(0, 0, 'MENU');

        // Aviso de "esperando a sala nova": ocupa o lugar do que seria um
        // popup do navegador, que é justamente o que não se quer aqui.
        this.status = scene.add.text(0, 0, '', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '18px',
            color: '#cfcfcf'
        }).setOrigin(0.5);

        this.elements = [
            this.overlay, this.arte, this.titulo, this.placar, this.status,
            this.rematch.fundo, this.rematch.label, this.menu.fundo, this.menu.label
        ];
        this.elements.forEach((el) => {
            el.setScrollFactor(0);
            el.setDepth(10000);
            el.setVisible(false);
        });

        this.setInterativo(false);

        this.layout();
        this.viewport.onResize(() => this.layout());
    }

    /**
     * Cobre a tela toda e centraliza o conteúdo, como o `DeathScreen`.
     *
     * A arte só é redesenhada se já houve um resultado: antes disso não há cor
     * definida e não há nada na tela.
     */
    layout() {
        const vp = this.viewport;

        this.overlay.setPosition(0, 0).setSize(vp.width, vp.height);

        const centro = vp.center(0, CENTRO_Y);
        this.cx = centro.x;
        this.cy = centro.y;

        this.titulo.setPosition(centro.x, centro.y);
        this.placar.setPosition(centro.x, centro.y + PLACAR_Y);
        this.status.setPosition(centro.x, centro.y + STATUS_Y);

        this.moverBotao(this.rematch, centro.x - BOTOES_X, centro.y + BOTOES_Y);
        this.moverBotao(this.menu, centro.x + BOTOES_X, centro.y + BOTOES_Y);

        if (this._cores) this.desenharArte(this._cores);
    }

    /** @param {{fundo: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text}} botao */
    moverBotao(botao, x, y) {
        botao.fundo.setPosition(x, y);
        botao.label.setPosition(x, y);
    }

    /** Botão no mesmo estilo do RENASCER: retângulo + rótulo, com hover. */
    criarBotao(x, y, texto) {
        const fundo = this.scene.add.rectangle(x, y, 260, 70, 0x1e1e1e, 0.95)
            .setStrokeStyle(3, 0xffffff, 0.9);

        const label = this.scene.add.text(x, y, texto, {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '28px',
            color: '#ffffff'
        }).setOrigin(0.5);

        fundo.on('pointerover', () => fundo.setFillStyle(0x3a3a3a, 0.95));
        fundo.on('pointerout', () => fundo.setFillStyle(0x1e1e1e, 0.95));

        return { fundo, label };
    }

    /**
     * @param {object} opcoes
     * @param {boolean} opcoes.won  Venceu?
     * @param {string}  opcoes.score Placar final já formatado ("40 x 27").
     * @param {Function} opcoes.onRematch Clique em REVANCHE.
     * @param {Function} opcoes.onMenu    Clique em MENU.
     */
    show({ won, score, onRematch, onMenu }) {
        this._onRematch = onRematch;
        this._onMenu = onMenu;

        const cores = won ? PALETA.win : PALETA.lose;
        this._cores = cores;

        this.desenharArte(cores);
        this.titulo.setText(won ? 'VITÓRIA' : 'DERROTA').setColor(cores.titulo);
        this.placar.setText(score || '');
        this.status.setText('');

        this.elements.forEach((el) => el.setVisible(true));
        this.setInterativo(true);
    }

    /** Raios + faixa atrás do título, na cor do resultado. */
    desenharArte(cores) {
        const cx = this.cx;
        const cy = this.cy;

        this.arte.clear();

        this.arte.fillStyle(cores.brilho, 0.18);
        for (let i = 0; i < RAIOS; i++) {
            const a = (Math.PI * 2 * i) / RAIOS;
            const abertura = Math.PI / RAIOS / 1.6;
            // Os raios têm de sair da tela por todos os lados, em qualquer
            // proporção: o maior lado é sempre suficiente.
            const raio = Math.max(this.viewport.width, this.viewport.height);
            this.arte.beginPath();
            this.arte.moveTo(cx, cy);
            this.arte.lineTo(cx + Math.cos(a - abertura) * raio, cy + Math.sin(a - abertura) * raio);
            this.arte.lineTo(cx + Math.cos(a + abertura) * raio, cy + Math.sin(a + abertura) * raio);
            this.arte.closePath();
            this.arte.fillPath();
        }

        // Faixa em losango: as pontas inclinadas dão o ar de estandarte sem
        // precisar de arte importada.
        const meiaL = 460;
        const meiaA = 62;
        const bico = 60;
        this.arte.fillStyle(cores.faixa, 0.92);
        this.arte.lineStyle(4, cores.borda, 0.95);
        this.arte.beginPath();
        this.arte.moveTo(cx - meiaL, cy - meiaA);
        this.arte.lineTo(cx + meiaL, cy - meiaA);
        this.arte.lineTo(cx + meiaL - bico, cy);
        this.arte.lineTo(cx + meiaL, cy + meiaA);
        this.arte.lineTo(cx - meiaL, cy + meiaA);
        this.arte.lineTo(cx - meiaL + bico, cy);
        this.arte.closePath();
        this.arte.fillPath();
        this.arte.strokePath();
    }

    /** Mensagem de espera (a revanche está sendo criada, por exemplo). */
    setStatus(texto) {
        this.status.setText(texto || '');
    }

    hide() {
        this.elements.forEach((el) => el.setVisible(false));
        this.setInterativo(false);
    }

    get isVisible() {
        return this.overlay.visible;
    }

    setInterativo(ativo) {
        for (const [{ fundo }, callback] of [
            [this.rematch, () => this._onRematch && this._onRematch()],
            [this.menu, () => this._onMenu && this._onMenu()]
        ]) {
            fundo.off('pointerdown');
            if (!ativo) {
                fundo.disableInteractive();
                fundo.setFillStyle(0x1e1e1e, 0.95);
                continue;
            }

            fundo.setInteractive({ useHandCursor: true });
            fundo.on('pointerdown', (pointer, x, y, event) => {
                // Sem isto o clique vaza para o joystick/botão de ataque.
                if (event) event.stopPropagation();
                callback();
            });
        }
    }
}
