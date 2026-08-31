import { viewportOf } from '../utils/Viewport.js';

/**
 * Placar de abates e mortes, exibido enquanto o TAB está pressionado.
 *
 * A classe não sabe de onde vêm os dados: recebe uma função que devolve as
 * linhas já normalizadas. É o que permite os dois modos usarem o mesmo painel,
 * com origens completamente diferentes — o schema do servidor na `Arena`, os
 * grupos de sprites na `Start`.
 *
 * @typedef {object} ScoreRow
 * @property {string} name
 * @property {'ally'|'enemy'} team
 * @property {number} kills
 * @property {number} deaths
 * @property {boolean} isLocal Marca a linha do próprio jogador.
 */

/** Redesenha no máximo a cada tanto de ms enquanto o painel está aberto. */
const REFRESH_MS = 200;

/** Corta o nome antes de ele desalinhar as colunas. */
const NAME_WIDTH = 16;

const PADDING_X = 28;
const PADDING_Y = 22;

export default class Scoreboard {
    /**
     * @param {Phaser.Scene} scene
     * @param {() => ScoreRow[]} getRows Fonte das linhas, consultada só quando
     *        o painel está aberto.
     */
    constructor(scene, getRows) {
        this.scene = scene;
        this.getRows = getRows;
        this._nextRefreshAt = 0;

        this.viewport = viewportOf(scene);

        this.panel = scene.add.graphics();

        this.text = scene.add.text(0, 0, '', {
            // Monoespaçada de propósito: as colunas são alinhadas com espaços,
            // o que troca dez objetos de texto por um só.
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: '18px',
            color: '#ffffff',
            align: 'left'
        }).setOrigin(0.5);

        this.elements = [this.panel, this.text];
        this.elements.forEach((el) => {
            el.setScrollFactor(0);
            el.setDepth(9500); // acima do HUD, abaixo da tela de morte (10000)
            el.setVisible(false);
        });

        this._bindToggleKey();

        this.layout();
        this.viewport.onResize(() => this.layout());
    }

    /**
     * Centralizado na tela. O fundo é dimensionado pelo texto (`_drawPanel`),
     * então basta mover o texto e redesenhar — e só se o painel estiver aberto,
     * porque fechado não há nada para redesenhar.
     */
    layout() {
        const { x, y } = this.viewport.center();
        this.text.setPosition(x, y);

        if (this.isVisible) this._drawPanel();
    }

    /**
     * TAB abre e fecha. `addCapture` impede o comportamento padrão do
     * navegador (mover o foco para fora do canvas), que largaria o jogo.
     */
    _bindToggleKey() {
        const keyboard = this.scene.input.keyboard;
        keyboard.addCapture('TAB');

        this._onDown = () => this.show();
        this._onUp = () => this.hide();

        keyboard.on('keydown-TAB', this._onDown);
        keyboard.on('keyup-TAB', this._onUp);

        // Alt+Tab com o TAB pressionado tira o foco da janela e o `keyup`
        // nunca chega — sem isto o painel ficaria preso aberto por cima do
        // jogo. Mesmo motivo do `haltInput` da cena `Arena`.
        const game = this.scene.game;
        game.events.on(Phaser.Core.Events.BLUR, this._onUp);
        game.events.on(Phaser.Core.Events.HIDDEN, this._onUp);

        this.scene.events.once('shutdown', () => {
            keyboard.off('keydown-TAB', this._onDown);
            keyboard.off('keyup-TAB', this._onUp);
            keyboard.removeCapture('TAB');
            game.events.off(Phaser.Core.Events.BLUR, this._onUp);
            game.events.off(Phaser.Core.Events.HIDDEN, this._onUp);
        });
    }

    show() {
        if (this.isVisible) return;
        this.elements.forEach((el) => el.setVisible(true));
        this._nextRefreshAt = 0;
        this.refresh();
    }

    hide() {
        this.elements.forEach((el) => el.setVisible(false));
    }

    get isVisible() {
        return this.text.visible;
    }

    /**
     * Chamada a cada quadro pela cena. Só faz trabalho com o painel aberto, e
     * ainda assim no máximo a cada REFRESH_MS: o placar muda devagar e
     * remontar a string a 60 fps seria desperdício puro.
     */
    update(time) {
        if (!this.isVisible || time < this._nextRefreshAt) return;
        this._nextRefreshAt = time + REFRESH_MS;
        this.refresh();
    }

    refresh() {
        const rows = this.getRows();
        this.text.setText(this._buildText(rows));
        this._drawPanel();
    }

    /** @param {ScoreRow[]} rows */
    _buildText(rows) {
        const lines = ['        P L A C A R', ''];

        for (const [team, title] of [['ally', 'ALIADOS'], ['enemy', 'INIMIGOS']]) {
            lines.push(this._formatRow(title, 'K', 'D', false));

            const teamRows = rows
                .filter((row) => row.team === team)
                .sort(compareRows);

            if (teamRows.length === 0) {
                lines.push('  —');
            } else {
                for (const row of teamRows) {
                    lines.push(this._formatRow(row.name, row.kills, row.deaths, row.isLocal));
                }
            }

            lines.push('');
        }

        lines.pop(); // a última linha em branco só aumentaria o painel
        return lines.join('\n');
    }

    _formatRow(name, kills, deaths, isLocal) {
        const marker = isLocal ? '▸ ' : '  ';
        const label = String(name).slice(0, NAME_WIDTH).padEnd(NAME_WIDTH, ' ');
        return `${marker}${label}${String(kills).padStart(3, ' ')}${String(deaths).padStart(5, ' ')}`;
    }

    /** Fundo dimensionado pelo texto já montado — nunca sobra nem falta. */
    _drawPanel() {
        const bounds = this.text.getBounds();
        const x = bounds.x - PADDING_X;
        const y = bounds.y - PADDING_Y;
        const w = bounds.width + PADDING_X * 2;
        const h = bounds.height + PADDING_Y * 2;

        this.panel.clear();
        this.panel.fillStyle(0x000000, 0.78);
        this.panel.fillRoundedRect(x, y, w, h, 10);
        this.panel.lineStyle(3, 0xffffff, 0.85);
        this.panel.strokeRoundedRect(x, y, w, h, 10);
    }
}

/** Mais abates primeiro; empate desempata por menos mortes, depois por nome. */
function compareRows(a, b) {
    if (a.kills !== b.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    return a.name.localeCompare(b.name);
}
