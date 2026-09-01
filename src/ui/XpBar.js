import { xpProgress, RANKS, RANK_ORDER } from '../constants/Hierarchy.js';
import { viewportOf, HUD_MARGIN } from '../utils/Viewport.js';
import { TEXT_RESOLUTION } from '../utils/RenderPolicy.js';

/**
 * Barra de experiência do jogador local, usada pelos dois modos.
 *
 * Segue o padrão do [Scoreboard](Scoreboard.js): não sabe de onde vêm os
 * números — recebe uma função que devolve a XP total, e cada cena liga na sua
 * fonte (schema do servidor na `Arena`, o próprio `HumanPlayer` na `Start`).
 *
 * Só redesenha quando a XP muda. Chamado uma vez por quadro, mas o corpo do
 * `update` é uma comparação de número na maioria deles.
 */

/** Faixa da interface: acima dos personagens, junto do HUD de texto. */
const DEPTH = 9000;

/**
 * Distância entre o topo útil da tela e a barra.
 *
 * São os mesmos 42 px de antes, agora escritos como o que sempre foram: a
 * margem padrão do HUD mais uma linha de texto, para a barra cair logo abaixo
 * do status da `Arena` (no modo offline aquela linha não existe, e o espaço em
 * branco não incomoda).
 */
const ALTURA_DA_LINHA_DE_STATUS = 26;

const LARGURA = 200;
const ALTURA = 12;

const COR_FUNDO = 0x101820;
const COR_BARRA = 0x49c0ff;
const COR_BARRA_MAX = 0xffc83a;

/** Nome da peça em português, para o aviso. As chaves dos ranks são em inglês. */
const NOME_DA_PECA = {
    pawn: 'PEÃO',
    tower: 'TORRE',
    horse: 'CAVALO',
    bishop: 'BISPO',
    queen: 'RAINHA'
};

/** Quanto tempo o aviso de nível novo fica na tela. */
const AVISO_MS = 1400;

export default class XpBar {
    /**
     * @param {Phaser.Scene} scene
     * @param {() => number} getXp XP total do jogador local.
     */
    constructor(scene, getXp) {
        this.scene = scene;
        this.getXp = getXp;

        this.viewport = viewportOf(scene);

        this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);

        const estilo = {
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            resolution: TEXT_RESOLUTION
        };
        this.label = scene.add.text(0, 0, '', estilo)
            .setScrollFactor(0)
            .setDepth(DEPTH);

        // Aviso de nível novo. Um Text só, reaproveitado — nada é criado por
        // evento.
        this.aviso = scene.add.text(0, 0, '', { ...estilo, fontSize: '18px', color: '#ffe08a' })
            .setScrollFactor(0)
            .setDepth(DEPTH)
            .setVisible(false);
        this.avisoAte = 0;

        this._xpDesenhado = -1;
        this._nivelAnterior = null;

        this.layout();
        this.viewport.onResize(() => this.layout());
    }

    /**
     * Ancorada no canto superior esquerdo da área útil.
     *
     * O `-1` no fim marca a barra como não desenhada: ela é um `Graphics` com
     * coordenadas absolutas, então mudar de canto exige redesenhar. Acontece no
     * quadro seguinte, junto com o `update` que já existe.
     */
    layout() {
        const { x, y } = this.viewport.topLeft(HUD_MARGIN, HUD_MARGIN + ALTURA_DA_LINHA_DE_STATUS);
        this.x = x;
        this.y = y;

        this.label.setPosition(x, y + ALTURA + 3);
        this.aviso.setPosition(x, y - 20);

        this._xpDesenhado = -1;
    }

    /** @param {number} time Relógio da cena, só para expirar o aviso. */
    update(time) {
        const xp = this.getXp();

        if (xp !== this._xpDesenhado) {
            this._xpDesenhado = xp;
            this.redraw(xp, time);
        }

        if (this.aviso.visible && time >= this.avisoAte) this.aviso.setVisible(false);
    }

    redraw(xp, time) {
        const { level, into, need, max } = xpProgress(xp);

        // Nível novo: aviso curto com o nome da peça. `_nivelAnterior` nulo é o
        // primeiro quadro (ou um respawn) — aí não há o que anunciar.
        if (this._nivelAnterior !== null && level > this._nivelAnterior) {
            const chave = RANKS[RANK_ORDER[level - 1]].key;
            const peca = NOME_DA_PECA[chave] || chave.toUpperCase();
            this.aviso.setText(`NÍVEL ${level}! ${peca}`).setVisible(true);
            this.avisoAte = time + AVISO_MS;
        }
        this._nivelAnterior = level;

        const preenchido = Math.max(0, Math.min(1, into / need));
        const g = this.graphics;
        g.clear();

        g.fillStyle(COR_FUNDO, 0.75);
        g.fillRect(this.x, this.y, LARGURA, ALTURA);

        g.fillStyle(max ? COR_BARRA_MAX : COR_BARRA, 0.95);
        g.fillRect(this.x, this.y, LARGURA * preenchido, ALTURA);

        g.lineStyle(2, 0x000000, 0.8);
        g.strokeRect(this.x, this.y, LARGURA, ALTURA);

        this.label.setText(max
            ? `NÍVEL ${level} · MAX · ${xp} XP`
            : `NÍVEL ${level} · ${into}/${need} XP`);
    }
}
