/**
 * Endereço do servidor autoritativo (chess-armageddon-server).
 *
 * Ordem de resolução:
 *   1. `?server=wss://...` na URL — útil para testar um deploy sem editar nada
 *   2. SERVER_ENDPOINT abaixo, se preenchido
 *   3. o próprio host da página (funciona quando o cliente é servido pelo
 *      mesmo domínio do servidor)
 *
 * Precisa ser `wss://` (e não `ws://`): a página é servida por HTTPS e o
 * browser bloqueia conexão insegura vinda de origem segura (mixed content).
 *
 * Para rodar contra o servidor local, não edite este arquivo — abra
 * `http://localhost:8000/?server=ws://localhost:2567`.
 */
const SERVER_ENDPOINT = "wss://chess-armageddon-server.onrender.com";

export const ROOM_NAME = "arena";
export const LOBBY_ROOM_NAME = "lobby";

/**
 * Escolha feita no lobby: criar uma sala nova ou entrar numa existente.
 *
 * Fica aqui (e não num parâmetro da cena) porque quem decide é o `main.js`,
 * ANTES de o Phaser existir — a cena só lê na hora de conectar.
 *
 * `?room=<id>` na URL pula o lobby e entra direto: serve para abrir a mesma
 * sala em duas abas sem repetir o fluxo.
 *
 * @type {{ create?: true, bots?: number, roomId?: string } | null}
 */
let joinChoice = null;

export function setJoinChoice(choice) {
    joinChoice = choice;
}

export function resolveJoinChoice() {
    const fromQuery = new URLSearchParams(window.location.search).get("room");
    if (fromQuery) return { roomId: fromQuery };
    return joinChoice;
}

export function resolveEndpoint() {
    const fromQuery = new URLSearchParams(window.location.search).get("server");
    if (fromQuery) return fromQuery;

    if (SERVER_ENDPOINT) return SERVER_ENDPOINT;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
}

/**
 * O nome vive em `sessionStorage`, não em `localStorage`: assim ele sobrevive
 * a um F5 e à morte do personagem (que nem reconecta), mas morre junto com a
 * aba — abrir o jogo de novo pede um nome novo.
 */
const NAME_STORAGE_KEY = "ca:name";

/** Mesmo limite do `sanitizeName()` do servidor. */
const MAX_NAME_LENGTH = 16;

/**
 * Nome já conhecido, ou `null` se ainda é preciso perguntar.
 * `?name=` tem prioridade e pula a tela de entrada.
 */
export function storedPlayerName() {
    const fromQuery = new URLSearchParams(window.location.search).get("name");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim().slice(0, MAX_NAME_LENGTH);

    return window.sessionStorage.getItem(NAME_STORAGE_KEY);
}

/** Guarda o nome escolhido na tela de entrada pelo resto da sessão da aba. */
export function storePlayerName(name) {
    window.sessionStorage.setItem(NAME_STORAGE_KEY, name.trim().slice(0, MAX_NAME_LENGTH));
}

/**
 * Nome exibido aos outros jogadores, usado pela `Arena` ao entrar na sala.
 * A essa altura o `main.js` já garantiu que existe um; a string vazia é só uma
 * rede de segurança — o servidor a substitui por "Jogador <id>".
 */
export function resolvePlayerName() {
    return storedPlayerName() || "";
}
