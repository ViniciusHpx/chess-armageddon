# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Jogo 2D top-down de arena feito em **Phaser 3.90.0** (atenção: `project.config` declara 3.88.2, mas o `phaser.js` vendorizado é 3.90.0), JavaScript puro com ES Modules. Peças de xadrez lutam em times; matar inimigos promove a peça (peão → torre → cavalo → bispo → rainha) e acumula "aura".

**São dois modos, com arquiteturas opostas.** [main.js](src/main.js) escolhe pela URL:

- **`Arena`** (padrão) — multiplayer. A simulação roda em [`../chess-armageddon-server`](../chess-armageddon-server); aqui só se manda entrada e desenha. Ver *Modo online* no fim deste documento.
- **`Start`** (`?offline=1`) — o jogo original inteiro no navegador: física Arcade, bots locais, dano, promoção. **Nada nele foi alterado**; tudo que vem a seguir descreve este modo, salvo aviso.

## Comandos

Não há build system, package.json, linter ou testes. Phaser (~7,8 MB) e o SDK do Colyseus (~440 KB) são *vendorizados* em `phaser.js` e `colyseus.js` na raiz e carregados por `<script>` em [index.html](index.html) — ou seja, `Phaser` e `Colyseus` são **globais**, nunca importados nos módulos de `src/`.

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

**Ataque carregado:** segurar o botão por `rank.chargeTime` dobra alcance (`mult = 2`) e dano (50 em vez de 25). Os valores de dano estão hardcoded em `executeAttackHit()` ([PlayerBase.js:451](src/entities/PlayerBase.js#L451)).

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

Adicionar uma forma de ataque nova agora exige **três** `switch` em sincronia:
`drawAttackVisual()` do `PlayerBase` (offline), `drawAttackVisual()` do
`ArenaActor` (desenho online) e `executeAttackHit()` do `World` (dano online).

### Diferenças de comportamento em relação ao offline

Quatro, todas decididas no servidor e comentadas lá: o personagem fica parado
durante o golpe (offline ele deslizava 200 ms), o lado do L do cavalo é
congelado no início do golpe, cada um renasce no lado do próprio time e o alvo
sai do time real (offline o `HumanPlayer` batia em `scene.enemyPlayers` mesmo
tendo `team = 'human'`).
