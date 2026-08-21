import { Start } from './scenes/Start.js';
import { Arena } from './scenes/Arena.js';
import { askPlayerName, hideNameGate } from './ui/NameGate.js';
import { storedPlayerName, storePlayerName } from './net/netconfig.js';

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

const config = {
    type: Phaser.AUTO,
    title: 'Chess Armageddon',
    description: '',
    parent: 'game-container',
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    pixelArt: false,
    scene: offline ? [Start, Arena] : [Arena, Start],
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
