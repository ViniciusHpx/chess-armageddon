/**
 * Tela de nome, exibida antes de tudo.
 *
 * É HTML puro (a marcação vive em `index.html`), e não uma cena do Phaser, por
 * dois motivos:
 *
 *   1. `InputManager` registra captura para Espaço e setas — o Phaser chama
 *      `preventDefault()` nessas teclas, e digitar espaço num campo de texto
 *      deixaria de funcionar. Como esta tela roda ANTES de `new Phaser.Game()`,
 *      não existe captura nenhuma ainda.
 *   2. Um `<input>` de verdade abre o teclado virtual no celular, coisa que um
 *      campo desenhado no canvas não faz.
 */

/** Mesmo limite do `sanitizeName()` do servidor — cortar aqui evita surpresa. */
const MAX_LENGTH = 16;

/**
 * Mostra a tela e resolve com o nome escolhido. Só retorna quando o jogador
 * confirma, e nunca resolve com string vazia.
 *
 * @returns {Promise<string>}
 */
export function askPlayerName() {
    const gate = document.getElementById('name-gate');
    const input = document.getElementById('name-input');
    const button = document.getElementById('name-submit');

    return new Promise((resolve) => {
        const clean = () => input.value.trim().slice(0, MAX_LENGTH);

        // Sem nome não dá para entrar: o botão só acende com algo digitado.
        const refresh = () => {
            button.disabled = clean().length === 0;
        };

        const submit = () => {
            const name = clean();
            if (!name) return;

            input.removeEventListener('input', refresh);
            input.removeEventListener('keydown', onKeyDown);
            button.removeEventListener('click', submit);

            hideNameGate();
            resolve(name);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Enter') submit();
        };

        input.addEventListener('input', refresh);
        input.addEventListener('keydown', onKeyDown);
        button.addEventListener('click', submit);

        gate.hidden = false;
        refresh();
        input.focus();
    });
}

/**
 * Esconde a tela sem perguntar nada. Usado quando o nome já veio de outro
 * lugar (`?name=` na URL) ou no modo offline, que não exibe nomes.
 */
export function hideNameGate() {
    const gate = document.getElementById('name-gate');
    if (gate) gate.hidden = true;
}
