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
 * Ele avança a peça no ciclo (peão → ... → rainha → peão) sem custar XP. É
 * ferramenta de DESENVOLVIMENTO: serve para trocar de peça na hora e conferir
 * alcance, tamanho, promoção e travessia do cavalo sem ter de matar cinco
 * inimigos antes.
 *
 * Fica LIGADO enquanto o jogo está em desenvolvimento e teste — inclusive no
 * navegador e no aparelho, que é onde a validação acontece. Quem desliga é o
 * build de produção, mais adiante, junto com o resto das ferramentas de teste;
 * até lá, mexer nisto só atrapalha quem está validando.
 *
 * Desligado, `InputManager` não cria o botão e `getDebugState()` passa a
 * devolver sempre `justPressed: false`. Nada mais muda: a mensagem `"dbg"` do
 * protocolo continua existindo e o servidor continua aceitando.
 */
export const DEBUG_BUTTON_ENABLED = true;
