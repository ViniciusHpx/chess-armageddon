/**
 * Lobby: escolher entre criar uma sala ou entrar numa existente.
 *
 * HTML puro (marcação e CSS em `index.html`), pelos mesmos motivos da
 * [tela de nome](NameGate.js): roda ANTES de `new Phaser.Game()`, então não
 * disputa teclado com o `InputManager` e os botões funcionam no celular sem
 * nada desenhado no canvas.
 *
 * A lista NÃO é consultada de tempos em tempos: o lobby do Colyseus empurra
 * `rooms` (lista inteira, uma vez), `+` (sala criada ou mudou) e `-` (sala
 * sumiu). Quem dispara essas mudanças é a `ArenaRoom`, chamando `updateLobby()`
 * quando alguém entra ou sai.
 *
 * Esta tela não sabe nada de times, bots ou slots: só mostra o que veio na
 * metadata e devolve a escolha. Toda a regra é do servidor.
 */

const MAX_BOTS = 5;

/**
 * Abre o lobby e resolve com a escolha do jogador.
 *
 * @param {object} client Cliente Colyseus já construído.
 * @returns {Promise<{ create: true, bots: number } | { roomId: string }>}
 */
export async function openLobby(client) {
    const el = {
        gate: document.getElementById('lobby'),
        list: document.getElementById('lobby-list'),
        status: document.getElementById('lobby-status'),
        create: document.getElementById('lobby-create'),
        form: document.getElementById('lobby-form'),
        bots: document.getElementById('lobby-bots'),
        confirm: document.getElementById('lobby-confirm'),
        cancel: document.getElementById('lobby-cancel')
    };

    el.gate.hidden = false;
    el.form.hidden = true;
    el.status.textContent = 'Procurando salas...';

    /** @type {Map<string, {roomId: string, clients: number, maxClients: number, metadata: object}>} */
    const salas = new Map();

    let lobby;
    try {
        lobby = await client.joinOrCreate('lobby');
    } catch (erro) {
        // Sem lobby ainda dá para jogar: cair para "criar sala" evita deixar o
        // jogador preso numa tela que não carrega.
        el.status.textContent = 'Lobby indisponível. Crie uma sala para jogar.';
        console.error(erro);
    }

    return new Promise((resolve) => {
        const escolher = (escolha) => {
            desligar();
            el.gate.hidden = true;
            resolve(escolha);
        };

        const aoClicarNaLista = (evento) => {
            const id = evento.target?.dataset?.roomId;
            if (id) escolher({ roomId: id });
        };

        const abrirForm = () => { el.form.hidden = false; };
        const fecharForm = () => { el.form.hidden = true; };
        const confirmar = () => {
            const bots = Math.min(MAX_BOTS, Math.max(0, Number(el.bots.value) || 0));
            escolher({ create: true, bots });
        };

        /** Todos os listeners saem juntos: a tela some e não volta. */
        const desligar = () => {
            el.list.removeEventListener('click', aoClicarNaLista);
            el.create.removeEventListener('click', abrirForm);
            el.cancel.removeEventListener('click', fecharForm);
            el.confirm.removeEventListener('click', confirmar);
            if (lobby) lobby.leave();
        };

        el.list.addEventListener('click', aoClicarNaLista);
        el.create.addEventListener('click', abrirForm);
        el.cancel.addEventListener('click', fecharForm);
        el.confirm.addEventListener('click', confirmar);

        if (!lobby) return;

        lobby.onMessage('rooms', (lista) => {
            salas.clear();
            for (const sala of lista) salas.set(sala.roomId, sala);
            desenhar(el, salas);
        });

        lobby.onMessage('+', ([roomId, sala]) => {
            salas.set(roomId, sala);
            desenhar(el, salas);
        });

        lobby.onMessage('-', (roomId) => {
            salas.delete(roomId);
            desenhar(el, salas);
        });
    });
}

export function hideLobby() {
    const gate = document.getElementById('lobby');
    if (gate) gate.hidden = true;
}

/**
 * Redesenha a lista inteira. São poucas salas e a lista só muda por evento,
 * então trocar o `innerHTML` é mais simples (e mais barato) que reconciliar
 * item a item.
 */
function desenhar(el, salas) {
    const arenas = [...salas.values()].filter((s) => s.name === 'arena');

    if (arenas.length === 0) {
        el.list.innerHTML = '';
        el.status.textContent = 'Nenhuma sala aberta. Crie a primeira.';
        return;
    }

    el.status.textContent = `${arenas.length} sala(s) aberta(s)`;
    el.list.innerHTML = arenas.map(cartao).join('');
}

function cartao(sala) {
    const meta = sala.metadata || {};
    const players = meta.players ?? sala.clients ?? 0;
    const capacity = meta.capacity ?? sala.maxClients ?? 0;
    const bots = meta.bots ?? 0;
    const cheia = players >= capacity;

    // O id vira o rótulo da sala: é curto, único e já vem do servidor.
    const nome = `Sala #${String(sala.roomId).slice(0, 4).toUpperCase()}`;

    return `
        <li class="lobby-room">
            <div>
                <strong>${nome}</strong>
                <span>Jogadores: ${players}/${capacity} &middot; Bots: ${bots}</span>
            </div>
            <button type="button" data-room-id="${sala.roomId}" ${cheia ? 'disabled' : ''}>
                ${cheia ? 'CHEIA' : 'ENTRAR'}
            </button>
        </li>
    `;
}
