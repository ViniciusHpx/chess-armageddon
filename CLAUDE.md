# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Jogo 2D top-down de arena feito em **Phaser 3.90.0** (atenção: `project.config` declara 3.88.2, mas o `phaser.js` vendorizado é 3.90.0), JavaScript puro com ES Modules. Peças de xadrez lutam em times; matar inimigos dá XP, e a XP acumulada sobe o nível — que é a própria peça (peão → torre → cavalo → bispo → rainha) — além de acumular "aura".

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
| `?room=<id>` | entra direto nessa sala e **pula o lobby** (útil para abrir a mesma partida em duas abas) |
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
- `HumanPlayer.die()` — zera aura, shake de câmera e tela de morte; o respawn mantém a peça (só a XP do nível volta a zero), teleporta para (640, 360) e dá 1 s de invulnerabilidade.
- `AIPlayer.die()` — desativa e respawna em posição aleatória após 1 s, também mantendo a peça.

### Times

A cena mantém dois grupos, `this.alliedPlayers` e `this.enemyPlayers` ([Start.js:36](src/scenes/Start.js#L36)). Cada `AIPlayer` resolve seus adversários por `this.team === 'ally' ? scene.enemyPlayers : scene.alliedPlayers`. Atenção às inconsistências existentes: o `HumanPlayer` tem `team = 'human'` (não `'ally'`) mas é adicionado ao grupo `alliedPlayers`, e seu `attack()` referencia `scene.enemyPlayers` diretamente. Ao mexer em times, verifique os dois caminhos.

### Cor dos times

Cada peça existe em duas artes: `assets/<peça>_<tamanho>.png` (clara) e `assets/<peça>_<tamanho>_b.png` (escura). As escuras são carregadas sob a chave `<rank>_black` e **os dois modos precisam carregar as dez**, senão a peça some ao trocar de time ou promover.

`skinKey(rankKey, team)` ([Hierarchy.js](src/constants/Hierarchy.js)) é o único lugar que decide a cor: time `enemy` → escura, qualquer outro → clara (inclusive o `'human'` do `HumanPlayer`, que joga pelos aliados apesar do nome). Quem chama:

- offline — `PlayerBase` no construtor e em `setRank()`, então promoção e respawn já saem na cor certa;
- online — `ArenaActor.applyRank()`, pelo campo `team` do estado.

A cor vem do time **absoluto**, nunca de `isOpponent`. `isOpponent` é relativo a quem olha: usá-lo pintaria a mesma peça de cores diferentes em cada tela. O relativo sobrou só na moldura de debug (`applyDebugColor()`: amarelo eu, verde meu time, vermelho o adversário).

### Navegação dos bots

Antes o bot mirava o inimigo em linha reta. Com rio e muralha no mapa isso
significava encostar na parede e ficar empurrando: medido, 10 bots percorriam
117 px somados em 20 s, com 14 px de progresso líquido, e **nenhum** chegava a
um inimigo. A oscilação contra a parede também chegava ao cliente como
tremedeira — o que parecia "lag" era isso.

`NavGrid.ts` (servidor) resolve com um grid derivado da **mesma máscara de
colisão**: célula de 32 px, 156 × 53 = 8268 células, montado uma vez na subida
junto com os componentes conexos. A ponte tem ~96 px livres (3 células) — com
64 px ela sumiria do grid, e é justamente a travessia que o bot precisa achar.
A ponte é célula caminhável como qualquer outra, com o custo do chão.

As células usam os raios da **rainha** (a maior peça): rota aprovada ali serve
para qualquer rank.

**A única regra de terreno do grid é a mesma da colisão**: não existe aresta
entre uma célula de água e uma de ponte (`parapeito()`, o espelho grosseiro de
`CollisionMask.canCross`). Ela vale nos três lugares que decidem caminho — a
rotulagem dos componentes ("existe rota?"), a expansão do A* (inclusive as duas
ortogonais de cada diagonal) e a **linha de visão**, que sem isso enxergaria
"reta livre" atravessando a lateral do tabuleiro e o bot nem chegaria a pedir
rota. O bot então contorna até uma cabeceira, como qualquer um. Não há regra de
"rio" em lugar nenhum: a água segue sendo rota, só que mais cara.

**A água é rota, não barreira.** As células de água entram no grid como
qualquer outra, com custo `1 / WATER_SPEED_FACTOR` (1,25) por passo — que é
exatamente o tempo a mais que se leva ali. Assim o A* prefere ponte e terra
quando elas não são um desvio grande, e manda o bot nadar quando nadar é
mesmo mais rápido. Medido: com o rio atravessável, os bots passam ~24% do
tempo na água em vez de fila na ponte.

**O A* quase nunca roda.** A ordem em `World.navigateAngle` é do mais barato ao
mais caro:

1. **linha de visão livre** → vai direto e descarta a rota (caso comum);
2. **rota em andamento** → segue o waypoint;
3. **sem rota** → pede A*, respeitando `BOT_REPATH_MIN_MS` (700 ms por bot),
   `BOT_PATHS_PER_TICK` (2 na sala inteira) e a consulta O(1) de componentes,
   que descarta alvos inalcançáveis sem busca nenhuma.

O caminho é recalculado por **evento**: rota acabou, o alvo andou mais que
`BOT_REPATH_TARGET_MOVE` (220 px), ou o bot travou.

**Bot travado**: a cada `BOT_STUCK_CHECK_MS` (600 ms) compara-se o quanto ele
andou; abaixo de `BOT_STUCK_MIN_PROGRESS` (24 px) a rota é descartada e o
recálculo liberado na hora. É isso que tira o bot da margem e o manda à ponte.

Só limpar a rota não resolve **quina**: o A* devolve praticamente o mesmo
caminho e ele reencalha no mesmo canto. Por isso a travada também liga o
contorno (`BOT_UNSTICK_MS`, 500 ms), em que o bot ignora o waypoint e anda numa
direção de fuga. É movimento normal, sem teleporte.

Essa direção **é escolhida olhando o mapa**, não às cegas: `World.escapeAngle`
testa desvios crescentes (`BOT_UNSTICK_ANGLES`, 70° → 110° → 150°) para os dois
lados, começando pelo lado que ainda não foi tentado, e fica com o primeiro que
tem `BOT_UNSTICK_PROBE` (64 px) livres — medido com a MESMA linha de visão da
navegação e com o corpo do próprio bot, então um vão onde ele não cabe é
recusado. Antes era sempre a mesma tangente de 70°, que num canto fechado é
parede também: ele empacava de novo na janela seguinte. Medido em 120 s com 10
bots: travadas caíram de 207 para 147, e a maior sequência de travadas
consecutivas (o bot realmente preso) caiu de 4 para 2 — nenhuma sequência de 3
ou mais.

A rota sai **suavizada**: pontos que dá para pular em linha reta são
descartados, senão o bot andaria em escadinha de 32 px trocando de direção o
tempo todo. Cuidado ao mexer em `suaviza()` — a primeira versão entrava em
laço infinito quando nem o primeiro ponto tinha linha de visão, e derrubava o
processo com "invalid size error".

O movimento em si não mudou: o waypoint vira um ângulo e o resto é o mesmo
`vx/vy`, com a mesma colisão e a mesma velocidade — a separação entre
personagens continua cuidando de vários bots na mesma ponte.

**Custo medido**: tick médio 0,10 ms com 10–20 bots e 0,21 ms com 40, dos 50 ms
de orçamento. Em 30 s, nenhum bot fica quase parado e nenhum termina dentro de
parede. Tráfego: **1,5 KB/s por cliente**, 96 B por patch — nem CPU nem rede são
gargalo aqui.

### Placar e IA dos bots

**Placar.** [Scoreboard.js](src/ui/Scoreboard.js) é usado pelos dois modos e não sabe de onde vêm os dados: recebe uma função que devolve linhas `{name, team, kills, deaths, isLocal}`. Cada cena tem seu adaptador — `Arena.scoreRows()` lê o schema do servidor, `Start.scoreRows()` varre os grupos de sprites. Só monta a string com o painel aberto, e no máximo a cada 200 ms.

Os contadores **não zeram ao morrer nem ao promover** (só a aura zera): no online vivem no `Actor` e trafegam como `uint16` saturado; no offline vivem no `PlayerBase`. O TAB usa `addCapture` para o navegador não tirar o foco do canvas, e o painel se esconde no `BLUR`/`HIDDEN` — sem isso, um Alt+Tab com a tecla presa deixaria o placar preso aberto.

**IA de ataque.** `attackReach()` e `attackHalfBand()` ([Hierarchy.js](src/constants/Hierarchy.js), espelhando `constants.ts`) dizem até onde e em que faixa cada rank acerta. O bot só ataca quando o alvo está nesse alcance, medido entre **centros de elipse** — a mesma origem que `executeAttackHit` usa. Antes eram 100 px fixos para todo rank, medidos de `x`/`y`: o peão (alcance 80) atacava fora e a rainha (150) só colada.

A cadência é uma **taxa por segundo** convertida com `1 - exp(-taxa * dt)`, não uma chance por tick/quadro. Isso desamarra a agressividade de `TICK_MS` (servidor) e da taxa de quadros (offline). Bot não bate em alvo invulnerável — só gastaria o cooldown.

### Quando o bot carrega o golpe

Carregar **não** rende mais dano por segundo: o ciclo normal do bot (cooldown 700 ms + windup 160 ms) tira ~29/s, e o carregado, somando `chargeTime` + windup 260 + recuperação 340, fica em torno de ~24/s. Por isso o bot não carrega por padrão — carregar é ferramenta de situação. `botShouldCharge` (servidor) e `AIPlayer.shouldCharge` (offline) implementam a mesma regra:

1. **Finalização** — a vida do alvo está na janela em que o carregado mata e o normal não (`> DAMAGE_NORMAL` e `<= DAMAGE_CHARGED`). Abater dá XP e aura, o que vale bem mais que a diferença de dano.
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

### Mapa e colisão com o cenário

**Dimensões: 4992 × 1684.** Os assets (`assets/arena.png` e
`assets/arena_collision.png`) são a **metade esquerda**, 2496 × 1684; o mundo é essa
metade mais o espelho dela em X. Daí `WORLD_WIDTH = HALF_WORLD_WIDTH * 2`, e o
mesmo espelhamento vale para o desenho (duas imagens, a segunda com `flipX`) e
para a máscara (`px >= halfWidth → width - 1 - px`).

As dimensões vivem em [Scenario.js](src/constants/Scenario.js) (cliente) e em
`constants.ts` (servidor). Nada de número solto: `Hierarchy.js` chegou a ter uma
segunda cópia de `WORLD_WIDTH` e a `Arena` importava justamente a que já não
existia mais — os clamps viravam `NaN`.

**A máscara é a mesma imagem nos dois lados**, e ela tem **quatro classes de
terreno**, pela cor do pixel:

| Cor | Terreno | Regra |
| --- | --- | --- |
| branco (r > 128) | chão | velocidade cheia |
| azul (b > 128) | água | caminhável, `WATER_SPEED_FACTOR` (0,8) |
| vermelho (r > 128, g <= 128) | tabuleiro da ponte | chão, velocidade cheia; só não se entra vindo da água |
| preto | parede | não se anda |

O vermelho tem `r > 128` de propósito: para quem só pergunta "dá para andar?",
ponte é chão — a máscara nova responde igual à antiga.

O limiar (em vez de "é preto?") perdoa o anti-aliasing da borda. **Nove pontos
por teste** — centro, quatro pontas e quatro diagonais da elipse, a 70% dos
raios. As diagonais não são luxo: com só as pontas, uma quina entra pelo vão
entre elas e o ombro do corpo termina dentro da pedra.

**A água é pintada por script**, não à mão: `npm run paint:water` (no servidor)
cruza a ARTE (`arena.png`, onde rio e mar são azulados e o terreno é
amarronzado) com o que a máscara já marcava como bloqueado. Só os
**componentes conexos grandes** viram água — telhado azul de torre tem poucos
milhares de pixels e fica de fora. Depois disso, todo pixel bloqueado que está
a menos de 24 px **tanto da água quanto do chão** vira água também: é a faixa
rasa da beira, que a máscara antiga marcava como parede. Sem ela a água era
navegável mas cercada por uma mureta invisível, e ninguém conseguia entrar no
rio. Muralha de verdade não é tocada, porque o teste exige estar perto dos dois
lados ao mesmo tempo.

O script ainda faz uma terceira coisa: **limpa respingo**. A arte da água tem
pontos escuros (pedrinha, sombra, espuma) que a máscara marcava como parede.
Cada um deles é invisível na tela e proíbe uma área do **tamanho do corpo** —
as nove sondas de `canStand` batem no respingo de até meio corpo de distância.
Eram 267 desses no rio, e eram eles que travavam quem atravessava a água: sem
parede nenhuma à vista, o personagem parava. Blocos bloqueados menores que a
elipse do peão e cercados **só** de água viram água; ilha de verdade (grande, ou
que encoste em terra) não é tocada. Medido: travessias do rio com travamento
caíram de 10/10 para 0/10, e nenhuma delas precisa mais do resgate.

O resultado é revisável no editor de imagem e vai versionado; rodar de novo
numa máscara já pintada dá o mesmo resultado. (Cuidado: `paint:water` **não** é
idempotente — cada rodada come mais uma faixa de "praia", porque a água nova
cria margem nova. Rode uma vez e revise o resultado.)

### As pontes: só pela cabeceira

Com a água navegável, a ponte tinha virado enfeite: quem vinha nadando subia
no **meio** do tabuleiro, de lado, e atravessava. A regra é a de sempre — ponte
se entra pela cabeceira, vindo da terra —, e ela é uma **classe de terreno**,
não uma zona nem um gatilho.

**As pontes saem da própria máscara** (`npm run paint:bridges`, no servidor),
por um teste topológico em dois passos e sem uma única coordenada cravada:

1. **vão** — pixel de chão com água dos dois lados a menos de 160 px
   (esquerda/direita ou cima/baixo), medido sem atravessar parede. Isso pega o
   tabuleiro inteiro e para exatamente na margem — é ali a cabeceira;
2. **corte** — desses, sobram só os que **ligam duas massas de terra
   distintas**. Tirando a ponte, as duas ilhas ficam separadas; tirando uma
   língua de areia, nada muda. É esse passo que separa ponte de margem
   estreita.

Nesta máscara o teste acha **um** tabuleiro na metade esquerda (x 1273..1452,
y 695..787 — 92 px de largura útil, 16 740 px) e, como o mundo é o espelho da
metade, **isso são as duas pontes**: uma regra, um código, as duas atendidas. O
resultado é o mesmo para qualquer vão entre 100 e 200 px, então o número não é
ajuste fino. Ponte nova no mapa entra sozinha — inclusive nos testes, que
iteram sobre o que a máscara diz.

**A regra é uma transição proibida, e só uma: água <-> ponte.** Mora em
`CollisionMask.canCross` (servidor) e `MapCollider.canCross` (cliente), e vale
nos dois sentidos — é o parapeito. Continuam livres terra <-> ponte (a
cabeceira), terra <-> água (qualquer margem) e cada classe consigo mesma
(atravessar a ponte inteira, nadar o rio inteiro). Quem já está no tabuleiro
segue andando e sai pelo outro lado; a regra impede **entrar**, não passar.

Três decisões que evitam justamente os problemas que a ideia costuma trazer:

- **quem responde é o centro da elipse**, o mesmo ponto de `inWater` — não as
  nove sondas do corpo. Assim o corpo pode encostar na ponte sem o passo ser
  recusado, e ninguém fica entalado na borda. Medido encostando no parapeito:
  0 tremor (< 0,5 px em 20 ticks) e zero chamadas de `nearestFree`;
- **entra no `resolveMove`**, o funil por onde passa todo movimento dos dois
  lados — jogador, bot, empurrão de golpe, dash, e a própria correção da
  reconciliação. Não existe caminho de movimento que escape dele, então não há
  regra repetida nem diferença entre jogador e bot. Encostar no parapeito é
  encostar numa parede: o deslize em X/Y e o `slideAround` continuam valendo, e
  nadar rente à lateral funciona;
- **a ponte não é água**, então `isWater` continua `false` ali e a velocidade
  é a cheia. Nada de herdar o 0,8 só por passar por cima do rio.

O que NÃO passa pelo `resolveMove` é a separação entre personagens e o clamp da
borda, que escrevem posição direto — e por ali dava para subir na ponte sendo
empurrado por um aliado encostado na margem. A revalidação do tick
(`World.posicaoAceita`) fechou isso: além de caber, a posição do fim do tick tem
de ser alcançável a partir de `lastValid*`. Medido: sem a guarda, o empurrado
passa os 60 ticks em cima do tabuleiro; com ela, nenhum.

O cavalo em travessia (`dashPhasing`) atravessa o parapeito como atravessa
muralha: é a mesma suspensão da máscara, com o mesmo pouso validado. É
habilidade de peça, com cooldown, não a entrada lateral que se está fechando.

| Onde | O quê |
| --- | --- |
| [MapCollider.js](src/utils/MapCollider.js) | cliente: lê os pixels via `<canvas>` |
| `sim/CollisionMask.ts` | servidor: decodifica o PNG uma vez (pngjs) e vira bitset |

No servidor a decodificação acontece **uma vez por processo** (`World` guarda a
máscara num módulo compartilhado): ~512 KB de bits para os 2496×1684 da metade,
consultados por índice. Nenhum tick abre arquivo, decodifica imagem ou varre o
mapa.

**Deploy.** A arte é do cliente, mas a cópia em
`chess-armageddon-server/assets/arena_collision.png` é **versionada** (28 KB) — cliente
e servidor têm deploys separados e, no host do servidor, a pasta do cliente não
existe. Ao mudar a arte de colisão, repinte o que é derivado
(`npm run paint:bridges`, e `npm run paint:water` só se a água tiver mudado —
ele não é idempotente), rode `npm run sync:mask` no servidor e commite as duas
cópias. `COLLISION_MASK_PATH` sobrescreve o caminho se preciso.

O script lê o nome do arquivo do próprio `COLLISION_PATH` do cliente e **falha**
se não achar a origem. Antes o caminho estava escrito à mão nele: a arte foi
renomeada para `arena_collision.png`, o script passou a avisar e sair com
sucesso, e a cópia do servidor congelou numa versão antiga. Os dois lados
ficaram colidindo contra mapas diferentes (1688 pixels de diferença) — pouco
para se notar andando, o bastante para cliente e servidor discordarem sobre
atravessar uma parede.

A máscara é carregada em `app.config.ts`, **antes de o servidor aceitar
conexões**: faltando o arquivo (ou com tamanho diferente do esperado) ele não
sobe, e o log diz onde procurou. Carregar isso na primeira sala, como era antes,
produzia um sintoma enganoso: `/health` respondia 200, `POST
/matchmake/create/arena` devolvia 523 e o navegador acusava **CORS** — porque a
página de erro da borda não traz `Access-Control-Allow-Origin`. O CORS em si o
Colyseus já resolve sozinho.

**Resolução do movimento** (`resolveMove`, idêntica nos dois lados): três
candidatos — seguir na diagonal, deslizar em X, deslizar em Y —, cada um levado
até **encostar** por bisseção (`maxAlong`, 4 cortes: para a menos de 1 px da
parede). Vence o que rende mais deslocamento.

**E, se nenhum deles sair do lugar, `slideAround`**: o passo é girado em
`SLIDE_ANGLES` (30° e 60°) para os dois lados, mantendo o tamanho, e vence o que
mais avança na direção pedida. Os três candidatos de cima só sabem cortar em X e
em Y; contra uma borda INCLINADA — margem de ilha, quina de muralha — quem anda
num eixo puro (tecla é eixo puro) ficava com os três zerados e parava seco tendo
a superfície livre ao lado. Contra parede reta de frente os giros também batem
nela, então bater de frente continua sendo parada seca — deslizar só acontece
quando há superfície para deslizar. Custo: só no quadro em que o personagem
ficaria parado, no máximo quatro bisseções, e o deslocamento nunca passa do
passo do quadro. Medido no mapa inteiro (1032 caminhadas, 8 direções): quadros
parados caíram de 7,8% para 5,1%, e caminhadas travadas de 40 para 24 — o que
sobra é gente andando contra muralha de frente. A versão anterior era
tudo-ou-nada e parava o personagem a um passo da parede; o bot então empurrava o
vazio sem sair do lugar. A posição inválida **nunca é aceita** — não existe
"andou e voltou", que produziria teleporte e jitter.

**A correção da reconciliação também passa pela colisão** (`Arena.stepPrediction`).
Aplicada crua, ela empurrava a previsão frações de pixel para dentro da parede;
o resgate abaixo jogava o boneco para fora, a entrada trazia de volta, e o
resultado era o personagem **tremendo parado** contra o obstáculo. Medido antes:
45,8 px de amplitude e 7,6 px de erro contra o servidor; depois: 0,02 px e zero
inversões de sentido.

**O resgate é última linha, não caminho normal.** Medido depois das correções:
zero chamadas de `nearestFree` numa travessia de rio e em 120 s de combate com
10 bots, e nenhuma posição inválida. Se ele voltar a aparecer no caminho comum,
é sinal de que a colisão travou em algum lugar — o teste da travessia falha
justamente nisso.

**Partida inválida tem resgate.** Se o ponto de origem já está dentro da parede
(separação entre personagens, empurrão de golpe, clamp da borda), a bisseção
partiria de um ponto ruim e o personagem *deslizaria dentro* da muralha, preso
para sempre. `nearestFree` procura o ponto livre mais próximo numa espiral curta
(até 96 px, em passos de **2 px**) e devolve o personagem para lá. É um empurrão
de poucos pixels em estado já quebrado — não é o caminho normal de movimento.

O passo fino importa: com 8 px o resgate saltava para longe da parede, o
movimento empurrava de volta e ele disparava outra vez — a metade do ciclo de
tremor descrito acima.

No servidor o `tick` ficou: mover com colisão → separar personagens → clamp da
borda → **revalidar**. A revalidação existe porque a separação e o clamp podem
empurrar alguém para dentro da muralha; nesse caso o ator volta para
`lastValidX/Y`. `Actor.teleport()` é o jeito de reposicionar sem brigar com essa
rede (spawn, respawn, testes).

**A previsão do cliente online usa a mesma máscara** ([Arena.js](src/scenes/Arena.js)).
Sem isso o boneco entraria na parede localmente e a reconciliação o arrancaria de
volta a cada quadro. Medido contra a muralha oeste: o erro entre previsão e
servidor cai de 89 px para 1 px e os dois param no mesmo pixel.

### Spawn

Cada time nasce **no próprio castelo**: `SPAWN_ZONE` (retângulo do pátio,
espelhado em X para o time `enemy`) está em `constants.ts` e em
[Scenario.js](src/constants/Scenario.js).

O retângulo é generoso de propósito — o pátio tem construções internas, e quem
garante chão livre é a máscara. `World.placeAtSpawn` (online) e
`PlayerBase.moveToSpawn` (offline) sorteiam dentro da zona e validam: dentro do
mapa, fora de parede e — no servidor — a pelo menos `SPAWN_MIN_DISTANCE` de quem
já está lá. É rejection sampling com teto de tentativas (`SPAWN_ATTEMPTS`), sem
varrer o mapa e sem laço infinito quando o castelo enche.

**O castelo cura o próprio time**, mas NÃO na zona de nascimento inteira. A
área de cura é a `HEAL_ZONE` — um retângulo próprio, no fundo do pátio, e não a
`SPAWN_ZONE`. As duas existem nos dois lados (`constants.ts` e
[Scenario.js](src/constants/Scenario.js)) e servem a coisas diferentes:

| | `SPAWN_ZONE` | `HEAL_ZONE` |
| --- | --- | --- |
| Retângulo (metade esquerda) | x 150..900, y 560..1400 | x 220..840, y 540..980 |
| Para que serve | sorteio de nascimento | regeneração de vida |
| Por que esse tamanho | generoso: a máscara valida cada sorteio | recuado: o portão tem de ficar de fora |

A `SPAWN_ZONE` transborda a muralha sul — chega ao campo aberto abaixo do
castelo —, e curar ali significava curar na porta e até fora dela. Medida na
máscara com uma busca em largura a partir do campo aberto, ela tem pontos a
**808 px** de caminhada do lado de fora; o ponto menos profundo da `HEAL_ZONE`
está a **1672 px**, e o corredor do portão (x 192..456, y 1176..1300) fica
inteiro fora. O teste "a área de cura fica no fundo do pátio, longe do portão"
refaz essa medição, então mudar a arte do castelo sem mexer na zona quebra o
teste em vez de passar despercebido.

Quem está dentro recupera `BASE_HEAL_PER_SECOND` (**12/s** — peão cheio em
8,3 s, torre em 16,7 s) até o `maxHealth`, nunca além. Era 20/s. A zona testada
é sempre a do time do personagem, então a base inimiga não cura ninguém —
`insideHealZone(team, x, y)` faz o mesmo espelhamento em X do resto do mapa.

Não há temporizador por jogador nem estado de "está curando": `World.healInBase`
roda no tick (online) e `PlayerBase.healInBase` no `commonUpdate` (offline), e
sair da base simplesmente para de curar no tick seguinte. A vida é do servidor —
o cliente não tem como alegar que está na base.

**A névoa verde é a zona.** [HealZoneFx.js](src/utils/HealZoneFx.js) desenha a
`HEAL_ZONE` e o espelho dela: dois `Image` no mundo (um por castelo), uma
textura de 155 × 110 gerada uma vez por canvas, no molde do `aura-particle`.
Não há partícula, shader, `Graphics` por quadro nem nada por jogador — só um
tween de opacidade por castelo. Os dois modos chamam `createHealZoneFx(scene)`
logo depois de colocar a arte do mapa.

A textura é transparente no miolo e verde só numa faixa esfumaçada junto da
borda (o alfa cai de 0,54 a 0 dentro de `BANDA`, modulado por um ruído de
semente fixa), em `BlendModes.ADD` e depth 1 — acima da arte, abaixo de
qualquer personagem, que usa `setDepth(y)`.

Área desenhada e área que cura são **o mesmo número**: o `Image` recebe o
centro e o tamanho lidos de `HEAL_ZONE`, então mover a zona move a névoa sem
tocar no `HealZoneFx`. Nada de constante de desenho paralela — foi assim que se
evitou o clássico "o verde diz uma coisa e a cura faz outra".

Uma pegadinha: no spawn o offset até o centro da elipse tem de sair da geometria
do rank, **não** de `getEllipseCenter()` — aquele lê `body.center`, que só
sincroniza no `preUpdate` seguinte, e a validação testaria o pixel errado.

### Colisão entre personagens

**Não existe `physics.add.collider` entre os personagens** — o corpo Arcade é um retângulo que apenas circunscreve a elipse real, o que causava colisão fantasma nos cantos e separação axis-aligned (personagens enganchando). A separação é feita em [CollisionResolver.js](src/utils/CollisionResolver.js), chamado no `postupdate`.

Como todas as elipses têm a mesma proporção (`rx = 2 * ry`, garantido por `applyRankPhysics` com sprites quadrados), o resolver multiplica o eixo Y por `ELLIPSE_RATIO`: no espaço resultante toda elipse vira um círculo de raio `collisionRx` e a separação é um empurrão radial exato. A correção é dividida entre os dois pela massa (cada um absorve a fração da massa **do outro**), com `SEPARATION_STRENGTH` suavizando e `OVERLAP_SLOP` (0,5 px) evitando tremedeira. Corpos inativos ou com `body.enable = false` são ignorados.

Os passes trabalham sobre **cópias** das posições, não sobre `body.center` — este só é recalculado no `preUpdate` do frame seguinte. No fim, cada correção é aplicada ao sprite e seguida de `body.updateFromGameObject()` para ressincronizar o corpo ainda no mesmo frame. Se um novo rank tiver sprite não-quadrado, a premissa `rx = 2 * ry` quebra e o resolver perde a exatidão.

### Sistema de ataque

Colisão de ataque é **geometria custom**, não física do Phaser. Cada entidade tem uma elipse lógica (`collisionRx`/`collisionRy`, centrada em `getEllipseCenter()`); os helpers estáticos de `PlayerBase` (`rectangleOverlapsEllipse`, `circleOverlapsEllipse`, `diamondOverlapsEllipse`) testam a forma do golpe contra ela.

Formas suportadas: `rectangle`, `circle`, `lshape`, `diamond`. **Adicionar uma nova forma exige editar dois `switch` paralelos** que precisam ficar em sincronia: `drawAttackVisual()` (visual) e `executeAttackHit()` (dano) — a geometria é duplicada entre eles.

Sequência: `performAttack()` marca `_isAttacking`, e um `delayedCall(200)` aplica o hit e finaliza. `_attackHitEnemies` (Set) evita dano duplo no mesmo golpe.

**O ataque carregado está DESLIGADO** por `CHARGED_ATTACK_ENABLED` (`false` em
`constants.ts` e espelhado em [Hierarchy.js](src/constants/Hierarchy.js) — as
duas precisam ter o mesmo valor). Com a flag desligada, apertar o botão já sai
como golpe leve (potência 0) e ninguém entra em estado de carga: no servidor
`World.startCharge` chama `beginAttack(actor, 0)` e `botShouldCharge` devolve
`false`; offline, `HumanPlayer` usa `PlayerBase.attackLight()` (a própria
máquina de carga aberta e fechada no mesmo quadro) e `AIPlayer.shouldCharge`
devolve `false`; na `Arena`, a previsão local desacelera já no aperto. **Nada
foi removido** — os testes de carga do servidor continuam escritos e pulam
sozinhos (`itCarregado`). Voltar a flag para `true` nos dois lados reativa tudo
o que está descrito abaixo.

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

**Água deixa lento.** Dentro do rio ou do mar todo personagem anda a
`WATER_SPEED_FACTOR` (0,8) — jogador, bot, qualquer peça, sem exceção. O fator
entra no mesmo `movementFactor(attacking, charging, inWater)` que já era a
fonte única da velocidade, então ele MULTIPLICA o estado de combate (atacar
nadando é 0,6 × 0,8) e não existe em lugar nenhum um `speed *= 0.8` solto. Como
a velocidade é recalculada a partir da `rank.speed` a cada passo, sair da água
devolve os 100% sozinho e o freio nunca acumula.

Quem responde "está na água?" é a máscara, no centro da elipse — uma consulta
de bit por personagem por tick, sem zona, sem gatilho e sem estado guardado. No
online a resposta é do servidor (`World.inWater`); o cliente faz a mesma
consulta só para a previsão local não divergir.

**Carregar deixa lento.** Enquanto a carga está em curso o personagem anda a
`CHARGE_MOVE_FACTOR` (0,45) da velocidade — mais devagar que durante o próprio
golpe (0,6). Segurar a carga passa a custar posicionamento, não só tempo. Quem
decide o fator é `movementFactor(attacking, charging)`, definida no servidor e
espelhada em [Hierarchy.js](src/constants/Hierarchy.js): é a **única** fonte do
fator, usada pelo `stepPlayer`/`stepBot`, pela previsão da `Arena` e pelo modo
offline. Nada de recalcular velocidade solto em cada lugar — foi assim que
previsão e simulação ficaram idênticas (erro medido de 0,05 px enquanto carrega).

O estado que vale é o do servidor: o cliente só manda *apertei*/*soltei*, e a
lentidão sai do `charging` do próprio `Actor`. Soltar, cancelar (dash, morte) ou
ter a carga recusada devolve a velocidade no mesmo tick, porque o fator é lido
do estado — não existe timer paralelo para dessincronizar.

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

**O dash termina ao esbarrar em alguém.** Quem dashar contra outro personagem
(aliado ou inimigo — a separação não olha time) para junto dele em vez de
continuar empurrando pelo resto da distância. No servidor o `CollisionResolver`
guarda em `separationX/Y` o quanto empurrou cada ator no tick, e o `World`
cancela o dash quando esse empurrão é CONTRA o sentido do dash
(`DASH_STOP_PUSHBACK`); empurrão a favor não conta, senão dashar para longe de
quem está colado morreria na largada.

O que arrastava o personagem para trás, porém, era a **previsão**: ela só
consultava a máscara do mapa, então o boneco atravessava o outro e ia aos 220 px
enquanto o servidor o segurava na metade do caminho. Como a reconciliação fica
suspensa durante o dash, o erro (~100 px) só era cobrado no fim — e aí puxava
tudo de volta de uma vez. Hoje `Arena.dashHitsActor()` faz o mesmo teste de
elipses do resolver (Y × `ELLIPSE_RATIO`, distância entre centros) e encerra o
dash local no contato; só bloqueia quem está à frente, comparando a distância
nova com a atual.

**O cavalo atravessa estrutura no dash.** É o salto do cavalo do xadrez, e é
regra da **peça**: `canPhaseDash(rankKey)` (`DASH_PHASE_RANK`, espelhado em
[Hierarchy.js](src/constants/Hierarchy.js)) — humano e bot passam pelo mesmo
`World.startDash`, então os dois ganham a travessia ao virar cavalo e a perdem
ao promover.

A decisão é tomada **uma vez, no início do dash**, e testa só o ponto de
chegada (`dashLandsFree`: origem + direção × `DASH_DISTANCE`) com a mesma
`canStand` de qualquer movimento — as nove sondas da elipse, então não existe
pousar meio dentro da parede. A trajetória não é varrida: o que está no meio é
justamente o que se atravessa, e uma sonda por dash custa menos que percorrer o
caminho. Chegada reprovada (parede grossa, outra estrutura atrás, borda do
mapa) → `dashPhasing` fica `false` e o dash é o normal, parando na parede.

Enquanto `dashPhasing` está de pé, **só a máscara do cenário é suspensa** para
aquele ator: `moveWithCollision` aplica o destino direto, e a revalidação por
`lastValidX/Y` fica de fora (senão ela devolveria o cavalo ao ponto de partida a
cada tick, já que ele está dentro da parede por projeto). Continuam valendo o
clamp da borda, a separação entre personagens e o cooldown. A bandeira cai no
tick em que o dash termina — depois de o movimento daquele tick já ter sido
aplicado —, e aí a validação normal volta e aprova a chegada. Dash cancelado no
meio (morte, desconexão) cai na rede de segurança de sempre: posição inválida
volta para `lastValid`.

A previsão do cliente ([Arena.js](src/scenes/Arena.js)) repete a mesma decisão
com `MapCollider.canStand`; sem isso ela pararia na parede enquanto o servidor
atravessa, e a reconciliação arrastaria o boneco os 220 px depois. O modo
offline usa a mesma regra em `PlayerBase.startDash`/`constrainPosition`.

**Quem decide de verdade é o servidor**, e ele publica em
`ActorState.dashPhasing`. Isso existe porque a decisão é binária: bastava um
pixel de máscara ou a diferença de posição do RTT para os dois lados
discordarem, e aí o boneco ficava **preso na borda da parede** — o alvo da
reconciliação ficava do outro lado e a resolução contra o cenário barrava a
correção, quadro após quadro, até o jogador dashar de novo. Hoje a previsão
adota a travessia do servidor enquanto ela dura e, no fim, salta se ainda
sobrar mais de `PHASE_RESYNC_DISTANCE` (40 px) — o único caso em que a correção
suave não tem como chegar ao alvo.

E o pouso é garantido: `Actor.dashTargetX/Y` guarda o ponto aprovado, e se o
dash terminar em posição inválida (levou golpe no meio do voo, foi separado de
alguém) o ator vai para lá. Sem isso a rede de segurança o devolveria ao ponto
de PARTIDA, encostado na parede, como se não tivesse atravessado.

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

### Experiência e nível

O rank não sobe mais direto no abate: **o abate dá XP e o nível sai da XP
acumulada**. Regras, todas em `constants.ts` e espelhadas em
[Hierarchy.js](src/constants/Hierarchy.js):

| Constante | Valor |
| --- | --- |
| `XP_PER_KILL` | 30 |
| `XP_PER_LEVEL` | 100 |
| `MAX_LEVEL` | 5 (= `RANK_ORDER.length`) |

`levelFromXp(xp) = min(floor(xp / 100) + 1, MAX_LEVEL)`. Como nível e rank são a
mesma coisa (nível 1 = peão, 5 = rainha, na ordem de `RANK_ORDER`), **o nível não
é guardado nem trafega**: deriva do rank, e só a XP é estado. Mandar os dois
abriria espaço para discordarem.

**A XP nunca é gasta ao subir de nível** — 90 + 30 dá 120 XP e nível 2, não
"120 → zera". Por isso o nível é uma divisão da XP total, e não um contador que
esvazia. Passar do teto é inofensivo: `levelFromXp` satura e `rankKeyForLevel`
faz clamp, então rainha com 10 000 XP continua rainha.

Ponto único de progressão: `Actor.addExperience()` (online) e
`PlayerBase.addExperience()` (offline) — mesma lógica, chamadas de um lugar só,
no processamento do abate (`World.applyDamage` / `PlayerBase.applyDamageToEnemy`),
logo depois da aura. O abate paga uma vez: `takeDamage` só devolve `killed` uma
vez e o alvo já está em `hitThisAttack`.

**Morrer não rebaixa a peça**: o rank fica e a XP volta ao **piso do nível
atual** (`resetProgressOnDeath`) — cavalo com 220 XP renasce cavalo com 200, e a
barra volta a zero. Zerar a XP de verdade derrubaria o rank no primeiro
`addExperience` seguinte; não mexer nela tornaria a morte grátis. O piso é o
meio-termo: perde-se só o progresso rumo à próxima peça (a aura continua
zerando).

No online o cliente **não tem mensagem** para XP, nível ou rank — o protocolo é
só `"i"`, `"a"`, `"d"`, `"r"` e `"rm"`. `ActorState.xp` é escrita apenas pelo servidor.

A barra é a [XpBar](src/ui/XpBar.js), no padrão do `Scoreboard`: recebe uma
função que devolve a XP total e cada cena liga na sua fonte (schema na `Arena`,
`HumanPlayer` na `Start`). Mostra o progresso **dentro do nível**
(`xpProgress()` → 20/100), não a XP total, que passaria de 100 e encheria a
barra para sempre; no nível máximo mostra "MAX". Redesenha só quando a XP muda,
e o aviso de nível novo reaproveita um único `Text`.

### Aura

Ganha por abate conforme `AURA_KILL_VALUES`, zerada na morte. Controla apenas o visual: `AURA_THRESHOLDS` define a cor do emissor de partículas e a frequência escala até `maxAuraForFreq = 210`. A textura `aura-particle` é gerada por canvas em runtime — existe código duplicado que a cria tanto em `Start.create()` quanto em `PlayerBase._createAuraEmitter()`.

### Input

`InputManager` unifica teclado (WASD / setas + Espaço) e touch (joystick virtual + botão de ataque, ambos com `setScrollFactor(0)`) em duas saídas: `getMovementVector()` → `{dx, dy}` normalizado, e `getAttackState()` → `{held, justPressed, justReleased}`.

## Convenções

- Comentários e mensagens de commit em **português**; commits seguem Conventional Commits (`feat:`, `feat(player):`).
- Cada `Graphics` é redesenhado do zero a cada frame (`clear()` + redraw) — são 4 por entidade.
- Ordenação visual: `setDepth(this.y)`, com offsets fixos para os overlays (hitbox `y-1`, aura `y+99`, barra de vida `y+100`, carga `y+101`).
- Como a profundidade dos personagens é a posição no mapa, ela chega perto de **1900** na borda de baixo. Tudo que é interface fica acima dessa faixa, em degraus fixos: controles de toque (joystick e botões) em **8000**, HUD de texto em **9000**, placar do TAB em **9500** e tela de morte em **10000**. Elemento novo de tela precisa entrar nessa escala — com valor baixo, qualquer peça que passe perto o cobre.

## Pendências conhecidas

- Assets antigos (`map*.png`, `map_collision*.png`) continuam na pasta sem uso — o mapa em vigor é `arena.png` + `arena_collision.png`.
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
| [src/ui/XpBar.js](src/ui/XpBar.js) | barra de XP/nível, usada pelos dois modos |
| [src/ui/NameGate.js](src/ui/NameGate.js) | tela de entrada do nome (HTML, roda antes do Phaser) |
| [src/ui/Lobby.js](src/ui/Lobby.js) | lista/criação de salas (HTML, roda antes do Phaser) |

Reaproveitados sem alteração dos dois modos: `InputManager`, `DeathScreen`,
`Hierarchy.js`.

### Lobby e entrada na partida

O fluxo é `nome → lobby → sala`. As duas primeiras telas são **HTML** e rodam
antes de `new Phaser.Game()` — ver o porquê em *Nome do jogador*, logo abaixo;
vale igual para o lobby.

| Onde | O quê |
| --- | --- |
| [src/ui/Lobby.js](src/ui/Lobby.js) | lista as salas, cria sala, devolve a escolha |
| `netconfig.setJoinChoice/resolveJoinChoice` | guarda a escolha até a cena `Arena` conectar |
| `ArenaRoom.onCreate(options)` | sanea `bots` (0..`TEAM_SIZE`) e cria os bots |
| `ArenaRoom.publish()` | metadata + `lock()`/`unlock()` + `updateLobby()` |

**Sem polling.** A lista vem da `LobbyRoom` nativa do Colyseus (registrada em
`app.config.ts`), que empurra `rooms`, `+` e `-`. Quem dispara a atualização é a
própria `ArenaRoom`, chamando `updateLobby()` ao criar, ao alguém entrar e ao
alguém sair.

**Modo de jogo.** Quem cria escolhe entre `team_deathmatch`, `capture_the_flag` e
`free_for_all` (`GAME_MODES`). Hoje o modo é só um **rótulo**: nenhuma regra
depende dele ainda. Ele existe para a escolha ficar registrada, aparecer no
lobby e dar onde pendurar as regras depois.

- validado no servidor por allowlist (`sanitizeGameMode`); qualquer outra coisa
  — string arbitrária, número, objeto, ausente — vira `DEFAULT_GAME_MODE`
  (`team_deathmatch`, que é o comportamento que o jogo já tem), então cliente
  antigo e sala antiga continuam funcionando;
- vai para a `metadata` (o lobby mostra antes de entrar) e para
  `ArenaState.mode` como **índice** em `GAME_MODES`, no mesmo padrão de `rank` e
  `team` — a ordem da lista é contrato de rede, modo novo entra no fim;
- é escrito uma vez, na criação, e só pelo servidor. Não há mensagem para o
  cliente trocar o modo de uma sala.

**Slots.** Cada time tem `TEAM_SIZE` (5) slots. Quem cria escolhe quantos
nascem bot; o resto fica vazio. Entrando um humano: **slot vazio primeiro**, e
só se o time estiver completo é que um bot cede o lugar (`World.findBot`, o
primeiro encontrado — quem escolhe é o servidor). Sem slot e sem bot, `onJoin`
lança `ServerError(4001)` e o cliente mostra "sala cheia".

**Sem `WAITING`/`PLAYING`.** A arena é deathmatch contínuo — não há início nem
fim de partida, a simulação roda desde `onCreate`. Um campo de status seria
estado redundante (e mais um jeito de divergir do `World`). O que importa é
"aceita gente?", e isso é o `lock()` nativo: sala travada some da listagem e
recusa entrada. Ela destrava sozinha quando abre vaga.

**Saída.** Ir embora de propósito (botão MENU, revanche, fechar a aba) manda um
`room.leave()` **consentido**, e aí o jogador sai na hora e a sala vazia é
descartada pelo Colyseus. Sem isso a saída virava "queda de conexão": o servidor
segurava a vaga pelos 20 s de reconexão e a sala continuava na lista com um
jogador que já tinha ido. `Arena.leaveRoom()` é idempotente e está ligada ao
botão, ao `pagehide` e ao `shutdown` da cena — o `pagehide` só antecipa o caso
comum; a garantia continua sendo a desconexão detectada pelo servidor, que cobre
travamento e queda de rede.

`onLeave` mantém os 20 s de reconexão que já existiam; expirada a
janela, `dropPlayer` remove o ator e **repõe um bot só até `botsPerTeam`** — o
número escolhido na criação. Assim uma sala feita com 0 bots nunca ganha bots,
e o slot simplesmente volta a ficar vago.

**Corrida pelo último slot.** `onJoin` roda uma vez por vez na sala, e a decisão
(`pickTeam` → `hasSlot`) acontece dentro dele: o segundo pedido já enxerga o
slot ocupado e é recusado. Não há checagem no cliente para burlar.

### Fim de partida e revanche

Só o `team_deathmatch` tem condição de vitória: a `ArenaRoom` repassa
`TEAM_KILL_LIMIT` (40) ao `World.killLimit` na criação, e nos outros modos ele
fica em 0 (arena sem fim, como sempre foi).

O placar é do **time**, não somado dos atores: `World.teamKills` é incrementado
em `registerTeamKill`, no mesmo ponto do abate — assim ele sobrevive à saída do
jogador que matou. Batido o limite, `World.winner` é escrito ali mesmo e o
`tick` passa a **retornar antes de tudo**, inclusive do relógio: a simulação
inteira congela. A sala espelha o resultado em `ArenaState` (`scoreAlly`,
`scoreEnemy`, `winner` como índice em `TEAM_ORDER`, -1 = em curso), trava com
`lock()` e recusa entrada nova (`ServerError(4002)`).

O cliente **não decide nada**: a [ResultScreen](src/ui/ResultScreen.js) aparece
por causa de `winner` e some por causa dele. Ela é desenhada no padrão do
`DeathScreen` (depth 10000, presa à câmera) e não sabe de modo, time nem rede —
recebe `won`, o placar e os dois callbacks.

**Revanche.** O cliente só manda `"rm"`; quem cria a sala é a `ArenaRoom`, uma
vez por partida, com os mesmos bots e o mesmo modo. A trava `rematchCriando`
existe porque `matchMaker.createRoom` é assíncrono — sem ela, dois cliques no
mesmo instante criariam duas salas. O id vai para `state.rematchRoomId`, que
todos recebem: quem aceitar depois entra na **mesma** sala.

Entrar é recarregar a página com `?room=<id>` (`reloadIntoRoom` em
[netconfig.js](src/net/netconfig.js)), reusando o fluxo que já pulava o lobby;
o MENU faz o oposto (`reloadIntoLobby`, tira o `?room=`). Recarregar em vez de
reiniciar a cena não deixa resto de conexão nem de listener da partida
anterior.

**A sala nova precisa esperar o recarregamento.** Sala criada e vazia se
descarta sozinha em 15 s (`seatReservationTimeout`) — menos do que leva
recarregar Phaser e a arte. Por isso o `onCreate` desliga o `autoDispose` e um
`clock.setTimeout` o devolve depois de `ROOM_JOIN_GRACE_SECONDS` (90 s); quem
entra religa na hora. Sem isso a revanche morria antes de o jogador chegar, e o
sintoma era enganoso: `joinById` numa sala inexistente faz a borda devolver
**522**, e a página de erro dela não traz `Access-Control-Allow-Origin` — o
navegador acusa **CORS**, como no caso da máscara de colisão. `/health`
respondendo 200 e `joinOrCreate` funcionando, com só o `joinById` falhando, é a
assinatura desse caso.

Falhar ao entrar por id não deixa mais o jogador olhando "Failed to fetch": a
`Arena` avisa e volta ao lobby sozinha.

**O time oposto sai de graça**: o `pickTeam()` que já existia escolhe o time com
menos humanos, então o segundo a chegar na sala da revanche cai no lado
contrário ao do primeiro. Não há regra de "dois jogadores" em lugar nenhum.

### Nome do jogador

A tela que pede o nome é **HTML** (marcação e CSS em [index.html](index.html), lógica em [NameGate.js](src/ui/NameGate.js)), não uma cena do Phaser, e roda em [main.js](src/main.js) **antes** de `new Phaser.Game()`. Dois motivos, nessa ordem:

1. `InputManager` registra captura de Espaço e das setas; o Phaser chama `preventDefault()` nelas e o campo de texto perderia essas teclas. Antes do jogo existir, não há captura nenhuma.
2. Um `<input>` de verdade abre o teclado virtual no celular — um campo desenhado no canvas não abre.

A tela **nasce escondida** (`<div id="name-gate" hidden>`) e quem a mostra é o
`askPlayerName()`. Começar visível fazia-a piscar em toda carga de página que já
tinha nome — o F5 e, principalmente, a revanche, que entra na sala nova
recarregando a página.

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
