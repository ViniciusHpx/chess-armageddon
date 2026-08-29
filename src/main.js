import { Start } from './scenes/Start.js';
import { Arena } from './scenes/Arena.js';
import { askPlayerName, hideNameGate } from './ui/NameGate.js';
import { openLobby, hideLobby } from './ui/Lobby.js';
import {
    storedPlayerName, storePlayerName, setJoinChoice, resolveJoinChoice, resolveEndpoint
} from './net/netconfig.js';

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

const config = {
    type: Phaser.AUTO,
    title: 'Chess Armageddon',
    description: '',
    parent: 'game-container',
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    pixelArt: false,
    // O banner do Phaser no console custa pouco, mas não serve para nada em
    // produção — e no celular o console é o do WebView.
    banner: false,
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
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: false }
    }
}

new Phaser.Game(config);
