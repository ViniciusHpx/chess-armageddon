# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Jogo 2D top-down de arena feito em **Phaser 3.90.0** (atenção: `project.config` declara 3.88.2, mas o `phaser.js` vendorizado é 3.90.0), JavaScript puro com ES Modules. Peças de xadrez lutam em times; matar inimigos promove a peça (peão → torre → cavalo → bispo → rainha) e acumula "aura".

**São dois modos, com arquiteturas opostas.** [main.js](src/main.js) escolhe pela URL:

- **`Arena`** (padrão) — multiplayer. A simulação roda em [`../chess-armageddon-server`](../chess-armageddon-server); aqui só se manda entrada e desenha. Ver *Modo online* no fim deste documento.
- **`Start`** (`?offline=1`) — o jogo original inteiro no navegador: física Arcade, bots locais, dano, promoção. **Nada nele foi alterado**; tudo que vem a seguir descreve este modo, salvo aviso.

## Comandos

Não há build system, package.json nem linter **no cliente** (os testes vivem no
servidor: `cd ../chess-armageddon-server && npm test`). Phaser (~7,8 MB) e o SDK do Colyseus (~440 KB) são *vendorizados* em `phaser.js` e `colyseus.js` na raiz e carregados por `<script>` em [index.html](index.html) — ou seja, `Phaser` e `Colyseus` são **globais**, nunca importados nos módulos de `src/`.

Como `src/main.js` é carregado com `type="module"`, abrir `index.html` via `file://` **não funciona** (CORS). Sirva por HTTP a partir da raiz do projeto:

```bash
python -m http.server 8000   # depois abra http://localhost:8000
```

Para jogar online, suba o servidor antes: `cd ../chess-armageddon-server && npm start`.

`colyseus.js` é cópia de `../chess-armageddon-server/node_modules/@colyseus/sdk/dist/colyseus.js`. Ao atualizar o SDK no servidor, copie de novo.

### Parâmetros de URL

| Parâmetro | Efeito |
| --- | --- |
| `?offline=1` | sobe a cena `Start` (jogo local, sem servidor) |
| `?name=Fulano` | nome exibido aos outros; **pula a tela de entrada** |
| `?server=wss://...` | aponta para outro servidor sem editar arquivo |
| tecla `H` | liga/desliga o desenho das hitboxes (só na `Arena`) |
| tecla `SHIFT` | dash/esquiva (mesmo botão azul do HUD, nos dois modos) |
| tecla `TAB` | mostra o placar de abates/mortes enquanto estiver pressionada (nos dois modos) |

### prompt_generator.ipynb

Notebook utilitário (não faz parte do jogo) que concatena todos os `src/**/*.js` em um prompt único e salva em `.prompt_history/` (gitignored). Não é dependência de execução — ignore-o ao alterar o jogo.

## Arquitetura

### Fluxo de update (manual, não automático)

`Start.update()` orquestra tudo explicitamente — as entidades **não** usam `preUpdate` do Phaser:

1. `InputManager.update()` — precisa rodar **antes** de `getAttackState()`, pois é ele que calcula os flags de borda (`justPressed`/`justReleased`); `getAttackState()` os consome e zera.
2. `player.update(movement, attackState)` — assinatura própria do `HumanPlayer`, diferente do `update` do Phaser.
3. `aiUpdate(time, delta)` para cada bot dos dois grupos.

Toda entidade **deve** terminar seu update chamando `commonUpdate()` ([PlayerBase.js:291](src/entities/PlayerBase.js#L291)), que faz depth-sorting por `y`, redesenha barra de vida, hitbox de debug, aura e brilho de carga. Esquecer essa chamada congela todos os visuais da entidade.

No evento `postupdate` da cena, a ordem é **resolver colisões → prender ao mapa**: `CollisionResolver.update()` separa os personagens e só então `clampToWorldBounds()` roda em todos, mantendo o clamp como última palavra sobre a posição. `setCollideWorldBounds` está **desligado** de propósito — o clamp manual mantém o sprite inteiro (não só o corpo) dentro do mapa.

### Hierarquia de entidades

`PlayerBase` (extends `Phaser.Physics.Arcade.Sprite`) → `HumanPlayer` e `AIPlayer`.

`PlayerBase` concentra: ranks/promoção, vida e dano, sistema de aura, e **todo o sistema de ataque** (formas, detecção de acerto, visual). As subclasses só implementam entrada/comportamento e sobrescrevem `die()`:
- `HumanPlayer.die()` — reseta para peão, zera aura, teleporta para (640, 360), shake de câmera, invulnerabilidade de 1 s.
- `AIPlayer.die()` — desativa e respawna em posição aleatória após 1 s.

### Times

A cena mantém dois grupos, `this.alliedPlayers` e `this.enemyPlayers` ([Start.js:36](src/scenes/Start.js#L36)). Cada `AIPlayer` resolve seus adversários por `this.team === 'ally' ? scene.enemyPlayers : scene.alliedPlayers`. Atenção às inconsistências existentes: o `HumanPlayer` tem `team = 'human'` (não `'ally'`) mas é adicionado ao grupo `alliedPlayers`, e seu `attack()` referencia `scene.enemyPlayers` diretamente. Ao mexer em times, verifique os dois caminhos.

### Cor dos times

Cada peça existe em duas artes: `assets/<peça>_<tamanho>.png` (clara) e `assets/<peça>_<tamanho>_b.png` (escura). As escuras são carregadas sob a chave `<rank>_black` e **os dois modos precisam carregar as dez**, senão a peça some ao trocar de time ou promover.

`skinKey(rankKey, team)` ([Hierarchy.js](src/constants/Hierarchy.js)) é o único lugar que decide a cor: time `enemy` → escura, qualquer outro → clara (inclusive o `'human'` do `HumanPlayer`, que joga pelos aliados apesar do nome). Quem chama:

- offline — `PlayerBase` no construtor e em `setRank()`, então promoção e respawn já saem na cor certa;
- online — `ArenaActor.applyRank()`, pelo campo `team` do estado.

A cor vem do time **absoluto**, nunca de `isOpponent`. `isOpponent` é relativo a quem olha: usá-lo pintaria a mesma peça de cores diferentes em cada tela. O relativo sobrou só na moldura de debug (`applyDebugColor()`: amarelo eu, verde meu time, vermelho o adversário).

### Placar e IA dos bots

**Placar.** [Scoreboard.js](src/ui/Scoreboard.js) é usado pelos dois modos e não sabe de onde vêm os dados: recebe uma função que devolve linhas `{name, team, kills, deaths, isLocal}`. Cada cena tem seu adaptador — `Arena.scoreRows()` lê o schema do servidor, `Start.scoreRows()` varre os grupos de sprites. Só monta a string com o painel aberto, e no máximo a cada 200 ms.

Os contadores **não zeram ao morrer nem ao promover** (só a aura zera): no online vivem no `Actor` e trafegam como `uint16` saturado; no offline vivem no `PlayerBase`. O TAB usa `addCapture` para o navegador não tirar o foco do canvas, e o painel se esconde no `BLUR`/`HIDDEN` — sem isso, um Alt+Tab com a tecla presa deixaria o placar preso aberto.

**IA de ataque.** `attackReach()` e `attackHalfBand()` ([Hierarchy.js](src/constants/Hierarchy.js), espelhando `constants.ts`) dizem até onde e em que faixa cada rank acerta. O bot só ataca quando o alvo está nesse alcance, medido entre **centros de elipse** — a mesma origem que `executeAttackHit` usa. Antes eram 100 px fixos para todo rank, medidos de `x`/`y`: o peão (alcance 80) atacava fora e a rainha (150) só colada.

A cadência é uma **taxa por segundo** convertida com `1 - exp(-taxa * dt)`, não uma chance por tick/quadro. Isso desamarra a agressividade de `TICK_MS` (servidor) e da taxa de quadros (offline). Bot não bate em alvo invulnerável — só gastaria o cooldown.

### Quando o bot carrega o golpe

Carregar **não** rende mais dano por segundo: o ciclo normal do bot (cooldown 700 ms + windup 160 ms) tira ~29/s, e o carregado, somando `chargeTime` + windup 260 + recuperação 340, fica em torno de ~24/s. Por isso o bot não carrega por padrão — carregar é ferramenta de situação. `botShouldCharge` (servidor) e `AIPlayer.shouldCharge` (offline) implementam a mesma regra:

1. **Finalização** — a vida do alvo está na janela em que o carregado mata e o normal não (`> DAMAGE_NORMAL` e `<= DAMAGE_CHARGED`). Abater promove e dá aura, o que vale bem mais que a diferença de dano.
2. **Aproximação** — o alvo está fora do alcance normal mas dentro do carregado, que dobra o alcance. Carregar aí é de graça: não havia golpe possível de qualquer forma.

O bot compara os dois extremos da escala — `chargeAreaMult(0)` e
`chargeAreaMult(1)` — em vez dos antigos `1` e `2` cravados. Ele solta a carga
cheia (não parcial): decidir soltar no meio exigiria prever o movimento do alvo,
e o ganho não paga a complexidade. Os limites são os mesmos do jogador; não
existe número especial para bot.

Daí `canHit`/`botCanHit` receberem o `mult` (1 ou 2), o mesmo fator que `executeAttackHit` aplica às dimensões da forma.

Enquanto carrega, o bot **continua perseguindo** e solta assim que o alvo entra no alcance dobrado. Dois freios evitam que ele trave: se o alvo morre ou some, a carga é cancelada sem gastar golpe; se o alvo foge, `BOT_CHARGE_HOLD_MS` (1,2 s após a carga completar) faz soltar assim mesmo — errar e recomeçar é melhor que ficar parado segurando para sempre.

No online o `chargeRatio` do bot também é atualizado, então o brilho de carga aparece para os outros jogadores: dá para ver o bot preparando o golpe.

### Empurrão do golpe (knockback)

Todo golpe que **conecta** empurra o alvo para longe do atacante. A direção sai do centro da elipse do atacante para a do alvo, calculada por alvo — um golpe que pega três inimigos espalha os três em leque, cada um para o lado em que estava.

A força é `knockbackSpeed(power, massaDoAlvo)`, definida nos dois lados ([Hierarchy.js](src/constants/Hierarchy.js) e `constants.ts`), onde `power` é a potência da carga (0..1). Duas escolhas deliberadas de balanceamento, ambas para não ficar discrepante:

- a carga cheia multiplica por **1,8**, não por 2 como o dano: dobrar dano e empurrão juntos arremessaria o alvo para fora da briga sem chance de revidar;
- divide pela **raiz** da massa, não pela massa: com a massa crua a torre (massa 4) mal se mexeria e o peão voaria quatro vezes mais longe.

O empurrão decai exponencialmente (`KNOCKBACK_DECAY_MS` de constante de tempo), então o deslocamento total é ≈ `velocidade × τ`: 63 px num peão com golpe leve, 113 com carga cheia, 33 numa torre.

Empurrões **não somam**: `receiveKnockback` substitui a velocidade em curso em vez de acumular, então dois acertos seguidos não arremessam ninguém.

Três armadilhas que já custaram caro aqui:

1. **Integre na posição, não em `body.velocity`.** Somar na velocidade parece natural, mas `AIPlayer.aiUpdate` retorna cedo enquanto o golpe está em curso, sem redefinir a velocidade — a soma se acumulava quadro após quadro e arremessava a peça. Offline isso vive em `PlayerBase.applyKnockback`, que move `x`/`y` e chama `body.updateFromGameObject()`, como o `CollisionResolver`.
2. **O `delta` vem da cena**, passado por `commonUpdate(deltaMs)`. Ler `scene.game.loop.delta` não serve: vale 0 com o jogo pausado (aba em segundo plano), e o empurrão congelava em vez de decair.
3. **Alvo invulnerável não leva empurrão.** `takeDamage` já recusa o dano; sem a guarda explícita, quem acabou de renascer era arrastado pelo mapa sem perder vida.

No online nada disso está no cliente: o `World` do servidor integra o empurrão junto com a velocidade e o `ArenaActor` só desenha a posição que chega. A previsão local **não** modela o empurrão, então levar um golpe gera erro de posição — é o mesmo resto que a reconciliação já absorve na colisão entre personagens.

### Ranks (src/constants/Hierarchy.js)

`RANKS` é a fonte única de verdade para velocidade, vida, massa, tamanho do sprite, tempo de carga, forma de ataque e o encadeamento de promoção (`next`). `size.width/height` **deve** bater com o `frameWidth/frameHeight` do spritesheet declarado no `preload()` — `applyRankPhysics()` deriva o raio da elipse de colisão a partir desse `size` (base: 128×128 → rx 50 / ry 25).

`mass` controla só o empurrão entre personagens (ver abaixo); é lida via `getCollisionMass()` e não tem relação com `body.mass` do Arcade.

### Colisão entre personagens

**Não existe `physics.add.collider` entre os personagens** — o corpo Arcade é um retângulo que apenas circunscreve a elipse real, o que causava colisão fantasma nos cantos e separação axis-aligned (personagens enganchando). A separação é feita em [CollisionResolver.js](src/utils/CollisionResolver.js), chamado no `postupdate`.

Como todas as elipses têm a mesma proporção (`rx = 2 * ry`, garantido por `applyRankPhysics` com sprites quadrados), o resolver multiplica o eixo Y por `ELLIPSE_RATIO`: no espaço resultante toda elipse vira um círculo de raio `collisionRx` e a separação é um empurrão radial exato. A correção é dividida entre os dois pela massa (cada um absorve a fração da massa **do outro**), com `SEPARATION_STRENGTH` suavizando e `OVERLAP_SLOP` (0,5 px) evitando tremedeira. Corpos inativos ou com `body.enable = false` são ignorados.

Os passes trabalham sobre **cópias** das posições, não sobre `body.center` — este só é recalculado no `preUpdate` do frame seguinte. No fim, cada correção é aplicada ao sprite e seguida de `body.updateFromGameObject()` para ressincronizar o corpo ainda no mesmo frame. Se um novo rank tiver sprite não-quadrado, a premissa `rx = 2 * ry` quebra e o resolver perde a exatidão.

### Sistema de ataque

Colisão de ataque é **geometria custom**, não física do Phaser. Cada entidade tem uma elipse lógica (`collisionRx`/`collisionRy`, centrada em `getEllipseCenter()`); os helpers estáticos de `PlayerBase` (`rectangleOverlapsEllipse`, `circleOverlapsEllipse`, `diamondOverlapsEllipse`) testam a forma do golpe contra ela.

Formas suportadas: `rectangle`, `circle`, `lshape`, `diamond`. **Adicionar uma nova forma exige editar dois `switch` paralelos** que precisam ficar em sincronia: `drawAttackVisual()` (visual) e `executeAttackHit()` (dano) — a geometria é duplicada entre eles.

Sequência: `performAttack()` marca `_isAttacking`, e um `delayedCall(200)` aplica o hit e finaliza. `_attackHitEnemies` (Set) evita dano duplo no mesmo golpe.

**Carga contínua.** Segurar o botão não escolhe entre dois golpes: define uma
**potência** `power = tempo segurado / rank.chargeTime`, limitada a 1. Era um
booleano `charged`; hoje dano, área, empurrão, windup e recuperação saem todos
dessa potência, e os extremos continuam valendo exatamente o que valiam.

| Carga | Dano | Área | Empurrão num peão | Windup | Recuperação |
| --- | --- | --- | --- | --- | --- |
| 0% (toque) | 25,0 | 1,00× | 63 px | 160 ms | 60 ms |
| 25% | 27,7 | 1,25× | 71 px | 185 ms | 130 ms |
| 50% | 33,2 | 1,50× | 83 px | 210 ms | 200 ms |
| 75% | 40,8 | 1,75× | 98 px | 235 ms | 270 ms |
| 100% | 50,0 | 2,00× | 113 px | 260 ms | 340 ms |

Cada atributo é `min + (max - min) * power^expoente`, e **o expoente é o botão
de balanceamento**:

- **dano** (`DAMAGE_CHARGE_EXP` 1,6) — concentra o ganho no fim: parar no meio
  da carga não é jogada ótima, ou se bate rápido ou se vai até o fim;
- **área** (`AREA_CHARGE_EXP` 1) — linear de propósito. É a área que decide se
  o golpe acerta, e o jogador (e o bot, via `botCanHit`) precisa conseguir
  prever onde ele pega;
- **empurrão** (`KNOCKBACK_CHARGE_EXP` 1,3) — no meio dos dois, para uma carga
  curta não jogar o alvo para fora do próprio alcance de quem bateu.

**Os tetos não dependem de ninguém se comportar.** O clamp mora dentro de
`chargePower()`: segurar dez segundos, mandar `"a" 0` vinte vezes seguidas ou
travar o jogo a 5 FPS dá exatamente o mesmo golpe de 100%.

**Leve × carregado** é troca de tempo por alcance, não de DPS. O ciclo leve
(160 + 60 ms) repete a cada 220 ms; o cheio custa `chargeTime` + 260 + 340 ms.
Contra um alvo só, a invulnerabilidade de 500 ms (`HIT_INVULN_MS`) limita os
dois, e o leve rende mais dano por segundo. O carregado paga por: alcance
dobrado (pega quem está fugindo), empurrão que cria espaço, e matar em dois
golpes em vez de quatro.

**Recuperação (`attackRecoveryMs`)** é nova e vale para humanos e bots: antes o
humano não tinha cooldown nenhum e segurar o botão rendia golpe atrás de golpe.
É ela que faz o servidor recusar carga cedo demais — o freio de spam.

A máquina de carga (`startCharging` / `updateCharge` / `releaseCharge` / `cancelCharge`) mora no `PlayerBase`, não no `HumanPlayer`: humano e bot usam exatamente a mesma, e o que muda entre eles é só **quem decide** apertar e soltar — a entrada do jogador de um lado, `AIPlayer.decideAttack`/`stepCharge` do outro.

### Dash / esquiva

Impulso curto na direção do movimento (parado, para o lado que a peça olha),
com invulnerabilidade no começo e cooldown. Existe nos dois modos e vale
também para os bots.

| Constante | Valor | O que é |
| --- | --- | --- |
| `DASH_DISTANCE` | 220 px | distância percorrida, exata |
| `DASH_DURATION_MS` | 220 ms | duração nominal (define `DASH_SPEED`) |
| `DASH_TIMEOUT_MS` | 440 ms | teto de segurança, só para dash travado |
| `DASH_COOLDOWN_MS` | 1500 ms | espera, contada do INÍCIO do dash |
| `DASH_INVULN_MS` | 160 ms | janela de invulnerabilidade |
| `BOT_DASH_COOLDOWN_MS` | 3000 ms | cooldown dos bots |
| `BOT_DODGE_CHANCE` | 0,35 | chance por golpe percebido |
| `BOT_DODGE_REACTION_MS` | 90 ms | atraso de reação dentro do windup |
| `BOT_DODGE_RANGE_SLACK` | 1,25 | folga sobre o alcance do atacante |

Os valores vivem em `constants.ts` (servidor) e são espelhados em
[Hierarchy.js](src/constants/Hierarchy.js). **Distância e duração precisam bater
nos dois lados** — é com elas que a previsão local anda antes de o `dashing`
voltar no estado.

**Não é teleporte nem empurrão:** o dash só substitui `vx`/`vy` enquanto dura,
então colisão entre personagens e clamp do mapa continuam valendo sem nada
novo.

**A distância termina o dash, não o relógio.** `dashRemaining` (px) é decrementado
a cada passo e a velocidade do último passo é limitada pelo que falta. Sem isso,
o servidor (ticks de 50 ms) e o cliente (quadros de ~16 ms) paravam em pontos
diferentes e sobrava um resto de ~20 px por dash para a reconciliação desfazer.
`dashUntil` ficou como teto: solta quem travou contra outro personagem e nunca
consumiria o resto.

**Invulnerabilidade** reusa o `invulnUntil`/`_isInvulnerable` que já existiam, com
`Math.max` — o dash nunca encurta uma invulnerabilidade de dano ou de respawn. No
offline ela vive num campo próprio (`_dashInvulnUntil`) e `isInvulnerable()` soma
os dois, porque o `_isInvulnerable` é ligado/desligado por `delayedCall` e um
cancelaria o outro.

**Autoridade no online.** O cliente manda `"d"` **sem corpo**: direção, distância,
duração e cooldown saem todos do `World.requestDash`, que recusa se o ator estiver
morto, congelado, atacando ou em recarga. Spam cai nesse `return` (e, em rajada,
no `maxMessagesPerSecond` da sala). O botão desenha `ActorState.dashCd`, ou seja, o
cooldown do próprio servidor — não há contador local para adulterar.

O pacote de entrada é enviado **antes** do `"d"`, porque a direção sai da última
entrada recebida: sem isso os dois lados poderiam dashar para lados diferentes.

**A reconciliação fica suspensa durante o dash** (`emDash` em
[Arena.js](src/scenes/Arena.js)). O `ack` significa "apliquei sua entrada até
aqui", não "terminei seu dash": o servidor confirma a sequência no primeiro tick e
só então gasta 220 ms empurrando o personagem, então corrigir contra ele nesse
intervalo puxava a previsão para trás e o dash rendia menos de um terço na tela.
O salto por `SNAP_DISTANCE` continua ativo, para respawn no meio do dash não
deixar a previsão presa.

**Esquiva dos bots.** `World.tryBotDodge` (online) e `AIPlayer.tryDodge` (offline)
usam a mesma regra: filtros baratos primeiro (cooldown → existe golpe inimigo em
curso → atacante dentro do alcance de perigo → tempo de reação cumprido) e então
**um** sorteio por golpe, com a chave `attackHitAt` do atacante guardada em
`dodgeRolledFor`. Sorteando a cada tick, os 200 ms de windup dariam ~4 chances
(12 a 60 FPS) e o bot esquivaria de tudo. Bot no meio do próprio golpe não
esquiva — a mesma restrição vale para o jogador.

**Feedback visual** em [DashFx.js](src/utils/DashFx.js), compartilhado pelas duas
hierarquias de personagem: squash/stretch no eixo do movimento e três fantasmas
que somem. É disparado por evento — na subida de `dashing` para os outros
jogadores (`ArenaActor.checkDashFx`) e no toque para o dono do ator, que não
espera o patch.

### Aura

Ganha por abate conforme `AURA_KILL_VALUES`, zerada na morte. Controla apenas o visual: `AURA_THRESHOLDS` define a cor do emissor de partículas e a frequência escala até `maxAuraForFreq = 210`. A textura `aura-particle` é gerada por canvas em runtime — existe código duplicado que a cria tanto em `Start.create()` quanto em `PlayerBase._createAuraEmitter()`.

### Input

`InputManager` unifica teclado (WASD / setas + Espaço) e touch (joystick virtual + botão de ataque, ambos com `setScrollFactor(0)`) em duas saídas: `getMovementVector()` → `{dx, dy}` normalizado, e `getAttackState()` → `{held, justPressed, justReleased}`.

## Convenções

- Comentários e mensagens de commit em **português**; commits seguem Conventional Commits (`feat:`, `feat(player):`).
- Cada `Graphics` é redesenhado do zero a cada frame (`clear()` + redraw) — são 4 por entidade.
- Ordenação visual: `setDepth(this.y)`, com offsets fixos para os overlays (hitbox `y-1`, aura `y+99`, barra de vida `y+100`, carga `y+101`).

## Pendências conhecidas

- `assets/map_collision_3548_1774.png` é pré-carregado como `'collision_map'` mas **nunca usado** — colisão com o cenário ainda não foi implementada.
- Dimensões do mapa (3548×1774) estão hardcoded em `Start.create()`.
- A hitbox de debug é sempre desenhada (não há flag para desligar).

## Modo online (cena `Arena`)

Arquitetura **oposta** à da cena `Start`: aqui o cliente não simula nada. O
servidor autoritativo ([`../chess-armageddon-server`](../chess-armageddon-server))
roda posição, colisão, dano, morte, promoção, aura e os bots a 20 ticks/s; o
cliente manda entrada e desenha o estado que volta.

### Arquivos

| Arquivo | Papel |
| --- | --- |
| [src/scenes/Arena.js](src/scenes/Arena.js) | conecta, cria/destrói atores, envia entrada, prevê o próprio movimento |
| [src/entities/ArenaActor.js](src/entities/ArenaActor.js) | **só desenho**: sprite, barra de vida, hitbox, aura, brilho de carga, forma do golpe |
| [src/net/netconfig.js](src/net/netconfig.js) | endpoint do servidor e nome do jogador |
| [src/utils/DashFx.js](src/utils/DashFx.js) | efeito visual do dash, usado pelos dois modos |
| [src/utils/ChargeGlow.js](src/utils/ChargeGlow.js) | indicador de carga do ataque, usado pelos dois modos |
| [src/ui/NameGate.js](src/ui/NameGate.js) | tela de entrada do nome (HTML, roda antes do Phaser) |

Reaproveitados sem alteração dos dois modos: `InputManager`, `DeathScreen`,
`Hierarchy.js`.

### Nome do jogador

A tela que pede o nome é **HTML** (marcação e CSS em [index.html](index.html), lógica em [NameGate.js](src/ui/NameGate.js)), não uma cena do Phaser, e roda em [main.js](src/main.js) **antes** de `new Phaser.Game()`. Dois motivos, nessa ordem:

1. `InputManager` registra captura de Espaço e das setas; o Phaser chama `preventDefault()` nelas e o campo de texto perderia essas teclas. Antes do jogo existir, não há captura nenhuma.
2. Um `<input>` de verdade abre o teclado virtual no celular — um campo desenhado no canvas não abre.

Enquanto a tela está aberta o Phaser **ainda não subiu**: o `await askPlayerName()` no topo do módulo segura a criação do jogo. O `#name-gate` é opaco e cobre a tela inteira, então nada aparece atrás.

O nome mora em `sessionStorage`, não em `localStorage`. Assim ele:

- sobrevive à morte (o respawn é um `room.send('r')` na mesma conexão — o servidor nunca relê o nome);
- sobrevive a um F5;
- **morre junto com a aba**, que é o pedido: abrir o jogo de novo pede um nome novo.

Trocar de armazenamento é o único lugar a mexer se essa regra mudar: `storedPlayerName()`/`storePlayerName()` em [netconfig.js](src/net/netconfig.js). Modo offline não exibe nomes e pula a tela.

O limite de 16 caracteres aparece em três lugares e é o do `sanitizeName()` do servidor: `maxlength` do input, `MAX_LENGTH` do `NameGate` e `MAX_NAME_LENGTH` do `netconfig`.

`ArenaActor` estende `GameObjects.Sprite`, **não** `Physics.Arcade.Sprite`: sem
corpo Arcade não existe uma segunda simulação para divergir da do servidor.
`PlayerBase` continua sendo usado só pela cena `Start`.

### Previsão e reconciliação por sequência

O personagem local anda no mesmo quadro da tecla (`stepPrediction`), aplicando
as mesmas regras do servidor (velocidade do rank, parado durante o golpe).

O ponto delicado é contra o que reconciliar. A posição autoritativa que chega no
patch é de um RTT atrás; puxar a previsão direto para ela deixa o boneco
permanentemente adiantado em `velocidade × RTT` e sendo arrastado de volta todo
quadro — anda, volta, anda. Com o servidor num datacenter fora do país isso passa
de 50 px e fica impossível de ignorar.

Por isso cada pacote de entrada leva uma sequência (`s`) e o servidor devolve em
`ActorState.ack` a última que já aplicou. O cliente guarda, para cada pacote
enviado, **quanto aquele pacote moveu o boneco localmente** (`pendingInputs`), e
o alvo da reconciliação passa a ser:

```
alvo = posição do servidor + soma dos deslocamentos com seq > ack
```

ou seja, a posição autoritativa mais o que ainda estava viajando quando o patch
foi gerado. O atraso da rede sai da conta; sobra só divergência de verdade
(empurrão de outro personagem, clamp na borda), que é pequena — daí
`RECONCILE_RATE` poder ser 10/s. Acima de `SNAP_DISTANCE` (250 px) a previsão
salta e o histórico é descartado, porque suavizar um respawn faria o boneco
atravessar o mapa deslizando.

Guarda-se o deslocamento **efetivo** (medido depois do clamp), não
`velocidade × dt`: encostado numa parede a janela registra zero e o alvo não foge
para fora do mapa.

### Interpolação dos outros personagens

Os demais atores não são previstos — são desenhados **no passado**.
`room.onStateChange` empilha em cada `ArenaActor` a posição de cada patch com a
hora real de chegada (`pushSnapshot`), e `interpolatedPosition` desenha em
`now - INTERP_DELAY_MS` (120 ms) interpolando entre as duas amostras que cercam
esse instante. Se o buffer secar, segura na última amostra em vez de extrapolar:
chutar o futuro produz exatamente o solavanco de ida e volta que o buffer existe
para evitar. Salto maior que 250 px entre patches é respawn, não movimento, e
limpa o buffer.

O atraso precisa cobrir o intervalo entre patches (50 ms) com folga para jitter.
Encurtá-lo demais faz os bonecos travarem quando os patches chegam em rajada.

### Entrada

Enviada a cada 50 ms (`INPUT_SEND_MS`, o mesmo `TICK_MS` do servidor), e na hora
quando o vetor muda — respeitado um piso de 30 ms para uma rajada de teclas não
estourar o `maxMessagesPerSecond` da sala. A taxa fixa não é só keepalive: é ela
que dá à reconciliação janelas de tempo bem delimitadas para numerar.

O servidor guarda o último vetor e o descarta após 2 s sem pacote — sem isso, uma
aba em segundo plano (o Phaser pausa o loop e para de enviar) deixaria o boneco
andando sozinho até a borda do mapa. Pela mesma razão a cena manda `{0,0}` nos
eventos `BLUR`/`HIDDEN` do jogo (`haltInput`).

Pacote com sequência menor ou igual à já processada é descartado pelo servidor
(`World.setInput`), mas ainda conta como sinal de vida.

A carga do ataque é cronometrada **pelo servidor**: o cliente só informa
*apertei* e *soltei*. O brilho de carga local usa o relógio do cliente para não
atrasar; o dos outros jogadores vem do campo `chargeRatio` do estado.

### Contratos com o servidor

Duas coisas têm de bater exatamente entre os dois lados, senão o golpe acerta
fora do que aparece na tela:

1. **`RANKS`** — `../chess-armageddon-server/src/sim/constants.ts` é a fonte de
   verdade; [Hierarchy.js](src/constants/Hierarchy.js) é a cópia de desenho.
   `RANK_ORDER` define o `uint8` que trafega: **a ordem não pode mudar de um lado só**.
   O mesmo vale para `TEAM_ORDER` (espelha `TEAM_INDEX` lá): inverter de um
   lado só troca a cor de todos os personagens.
2. **A fórmula do centro da elipse** — `ArenaActor.getEllipseCenter()` aqui e
   `Actor.ellipseCenter()` lá. Ela reproduz o `body.center` do Arcade sem ter um
   corpo: `centerY = y + altura/2 - collisionRx + collisionRy * 4/3`.

O golpe trafega como `ActorState.atkPower` (uint8, 0..100): é a potência **já
decidida pelo servidor**, não o tempo de carga. O cliente desenha a área com
esse número, então a forma que aparece na tela é a mesma que causou o dano — se
cada lado recalculasse a partir do tempo, os arredondamentos divergiriam.

O cliente nunca manda potência, dano ou área: só `"a" 1` e `"a" 0`. Quem
cronometra é `World.releaseAttack`, com o relógio da sala.

Adicionar uma forma de ataque nova agora exige **cinco** `switch` em sincronia:
`drawAttackVisual()` do `PlayerBase` (offline), `drawAttackVisual()` do
`ArenaActor` (desenho online), `executeAttackHit()` do `World` (dano online) e
os dois pares `attackReach()`/`attackHalfBand()` (alcance da IA), um em cada
lado. Esquecer os últimos não quebra o golpe — só faz o bot mirar errado.

### Diferenças de comportamento em relação ao offline

Três, todas decididas no servidor e comentadas lá: o lado do L do cavalo é
congelado no início do golpe, cada um renasce no lado do próprio time e o alvo
sai do time real (offline o `HumanPlayer` batia em `scene.enemyPlayers` mesmo
tendo `team = 'human'`).

### Movimento durante o golpe

Nos dois modos, quem ataca continua andando a `ATTACK_MOVE_FACTOR` (0,6) da
velocidade do rank pelos `ATTACK_WINDUP_MS`. Antes o servidor zerava a
velocidade e o offline deslizava solto com a velocidade do quadro anterior.

Parar seco no online ficava pior do que os 200 ms sugerem: o cliente só volta a
andar quando o `attacking` cai no estado, então a parada real é
`RTT + 200 ms + tick`.

A previsão local aplica o fator a partir do **envio** do ataque
(`localAttackPending` em [Arena.js](src/scenes/Arena.js)), não da confirmação.
Aplicá-lo só na confirmação deixava o cliente andando rápido durante o RTT em
que o servidor já tinha desacelerado; a reconciliação desfazia esse trecho e o
boneco dava um passo para trás a cada golpe. Como o fator do cliente entra antes
do servidor e sai antes também, o resto é pequeno e no sentido do movimento.
