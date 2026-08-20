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

export function resolveEndpoint() {
    const fromQuery = new URLSearchParams(window.location.search).get("server");
    if (fromQuery) return fromQuery;

    if (SERVER_ENDPOINT) return SERVER_ENDPOINT;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
}

/** Nome exibido aos outros jogadores. Vem de `?name=`, senão é sorteado. */
export function resolvePlayerName() {
    const fromQuery = new URLSearchParams(window.location.search).get("name");
    if (fromQuery) return fromQuery.slice(0, 16);

    const saved = window.localStorage.getItem("ca:name");
    if (saved) return saved;

    const generated = `Peão ${Math.floor(Math.random() * 1000)}`;
    window.localStorage.setItem("ca:name", generated);
    return generated;
}
