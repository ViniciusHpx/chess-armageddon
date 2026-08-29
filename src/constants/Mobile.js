/**
 * Configuração da adaptação para celular, num lugar só.
 *
 * Existe para os números e as chaves de mobile não ficarem espalhados por cena,
 * entidade e HUD — é o mesmo motivo pelo qual `Hierarchy.js` concentra o
 * balanceamento e `Scenario.js` concentra o mapa.
 *
 * As fases seguintes penduram aqui o que for delas (teto de DPR, viewport,
 * reconexão). Por ora só o que a Fase A precisa.
 */

/**
 * O botão DEBUG aparece?
 *
 * Ele avança a peça no ciclo (peão → ... → rainha → peão) sem custar XP: é
 * ferramenta de teste, e num celular fica no alcance do polegar direito, junto
 * do ataque e do dash. Um toque errado no meio da briga troca a peça do
 * jogador — no desktop dá para conviver, num aparelho de toque não.
 *
 * Desligado aqui, `InputManager` não cria o botão e `getDebugState()` passa a
 * devolver sempre `justPressed: false`. Nada mais muda: a mensagem `"dbg"` do
 * protocolo continua existindo e o servidor continua aceitando — quem quiser
 * testar promoção é só voltar esta flag para `true`.
 */
export const DEBUG_BUTTON_ENABLED = false;
