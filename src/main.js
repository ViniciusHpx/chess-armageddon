import { Start } from './scenes/Start.js';
import { Arena } from './scenes/Arena.js';
import { askPlayerName, hideNameGate } from './ui/NameGate.js';
import { openLobby, hideLobby } from './ui/Lobby.js';
import {
    storedPlayerName, storePlayerName, setJoinChoice, resolveJoinChoice, resolveEndpoint
} from './net/netconfig.js';
import { logicalSize, installViewportScaling } from './utils/Viewport.js';
import { installRenderPolicy } from './utils/RenderPolicy.js';

/**
 * Dois modos, escolhidos pela URL:
 *
 *   Arena  (padrão)     multiplayer contra o servidor autoritativo
 *   Start  (?offline=1) o jogo antigo rodando inteiro no navegador
 *
 * O Phaser sobe a PRIMEIRA cena da lista. A física Arcade só é usada pela
 * `Start`; a `Arena` não cria corpos — quem simula lá é o servidor.
 */
const offline = new URLSearchParams(window.location.search).has('offline');

/**
 * Pergunta o nome ANTES de instanciar o jogo. Depois de `new Phaser.Game()`,
 * o `InputManager` passa a capturar Espaço e setas e o campo de texto perderia
 * essas teclas. O modo offline não exibe nomes, então pula a tela.
 */
if (offline || storedPlayerName()) {
    hideNameGate();
} else {
    storePlayerName(await askPlayerName());
}

/**
 * Lobby: fica entre o nome e a partida. Roda aqui, também antes do Phaser,
 * pela mesma razão da tela de nome — sem o jogo no ar, nenhuma captura de
 * teclado disputa com o HTML.
 *
 * Pulado no modo offline (não há servidor) e quando `?room=` já diz em qual
 * sala entrar.
 */
if (!offline && !resolveJoinChoice()) {
    const client = new Colyseus.Client(resolveEndpoint());
    setJoinChoice(await openLobby(client));
}
hideLobby();

/**
 * Tamanho LÓGICO do jogo: altura sempre 720, largura conforme a proporção da
 * tela. Ver `utils/Viewport.js` — é o FOV vertical fixo.
 *
 * Calculado aqui, e não depois de o jogo subir, para a primeira cena já nascer
 * com a medida certa: montar o HUD em 1280 × 720 para só então reposicionar
 * tudo apareceria como um tranco no primeiro quadro.
 */
const { width, height } = logicalSize(window.innerWidth, window.innerHeight);

const config = {
    type: Phaser.AUTO,
    title: 'Chess Armageddon',
    description: '',
    parent: 'game-container',
    width,
    height,
    backgroundColor: '#000000',
    pixelArt: false,
    // O banner do Phaser no console custa pouco, mas não serve para nada em
    // produção — e no celular o console é o do WebView.
    banner: false,

    /**
     * Pipelines de Pre FX: não criar.
     *
     * O projeto não usa efeito nenhum — nem `preFX`, nem `postFX`, nem
     * `setPostPipeline` —, mas o Phaser monta a piscina inteira no boot de
     * qualquer forma: três render targets do tamanho do canvas MAIS uma escada
     * de alvos quadrados de 32 em 32 px até a menor dimensão dele
     * (`phaser.js:175660-175681`). Com as 720 linhas da Fase D isso dá 22
     * degraus, três alvos cada — cerca de 44 MiB de VRAM parada, além dos
     * ~11 MiB dos três de tela cheia.
     *
     * Nada do que aparece na tela muda: os pipelines de fato usados continuam
     * sendo o `MultiPipeline` (ou o `MobilePipeline` no celular) e o
     * `UtilityPipeline`, registrados fora deste bloco (`phaser.js:175344`).
     * Voltar atrás é apagar esta linha.
     *
     * Fica na RAIZ da configuração, e não dentro de `render`: o Phaser a lê com
     * `GetValue(config, 'disablePreFX', false)` (`phaser.js:16145`), sem
     * consultar o sub-objeto `render`. Dentro dele seria ignorada em silêncio.
     *
     * Ver `utils/RenderPolicy.js` para a conta.
     */
    disablePreFX: true,

    scene: offline ? [Start, Arena] : [Arena, Start],
    render: {
        /**
         * MSAA do contexto WebGL: desligado.
         *
         * É `antialiasGL`, e NÃO `antialias`. Os dois parecem a mesma coisa e
         * não são: `antialias` também escolhe o filtro das texturas
         * (`phaser.js:182276` — com ele em `false`, tudo passa a NEAREST), e a
         * névoa da zona de cura depende de filtro LINEAR para borrar uma
         * textura de 155 × 110 esticada até o tamanho do pátio (ver
         * `HealZoneFx.js`). Desligar `antialias` deixaria a névoa quadriculada.
         *
         * `antialiasGL` mexe só no atributo do `getContext` e, nas palavras da
         * própria documentação do Phaser, "does not impact any subsequent
         * textures that are created". É o que se quer: o MSAA é caro em GPU
         * móvel e este jogo não tem geometria serrilhada para suavizar — a arte
         * é toda textura.
         */
        antialiasGL: false,

        /**
         * Pede a GPU rápida em aparelhos com duas. Sem efeito visual; em
         * celular, o navegador costuma ignorar, mas não custa nada.
         */
        powerPreference: 'high-performance'

        /**
         * `roundPixels` ficou de FORA de propósito, apesar de constar do plano.
         * Dois motivos, os dois verificados no build vendorizado:
         *
         *   1. só vale com zoom inteiro (`phaser.js:10817` exige
         *      `Number.isInteger(zoomX)`), e a Fase D vai usar zoom fracionário
         *      para travar o campo de visão vertical — ele se desligaria sozinho;
         *   2. aqui tudo se move em subpixel: a câmera segue o jogador com
         *      interpolação, a previsão local anda em frações de pixel e os
         *      outros personagens são interpolados entre dois patches. Arredondar
         *      a posição de desenho vira degrau visível justamente no que mais se
         *      olha.
         */
    },
    scale: {
        /**
         * Continua `FIT`, e de propósito.
         *
         * O que muda é o tamanho lógico acima: ele nasce com a MESMA proporção
         * da tela, e duas proporções iguais fazem o FIT preencher tudo sem
         * sobrar barra. O `autoCenter` só age quando a proporção é travada
         * pelos limites do `Viewport` (retrato, ultralargo) — aí a barra existe
         * e é melhor centralizada.
         */
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: false }
    }
}

const game = new Phaser.Game(config);

// A partir daqui, girar o aparelho ou redimensionar a janela recalcula o
// tamanho lógico. Quem reposiciona o HUD são os próprios componentes, cada um
// inscrito no `Viewport` da sua cena.
installViewportScaling(game);

// Vigia o tamanho do buffer de desenho e publica `renderReport()` no console.
// Não configura nada: o buffer já sai correto do tamanho lógico acima.
installRenderPolicy(game);
