import {
    HALF_WORLD_WIDTH, WORLD_WIDTH, WORLD_HEIGHT, SPAWN_ZONE, SPAWN_ATTEMPTS
} from '../constants/Scenario.js';

/** Desvios testados ao deslizar (30° e 60°). Espelha o servidor. */
const SLIDE_ANGLES = [Math.PI / 6, Math.PI / 3];

/** Avanço abaixo do qual o passo conta como "não saiu do lugar", em px. */
const SLIDE_MIN_AVANCO = 0.05;

export default class MapCollider {
    /**
     * Lê o PNG da máscara uma vez e guarda o terreno como BITSET.
     *
     * O `getImageData` devolve RGBA — 4 bytes por pixel, 16 MB para os
     * 2496 x 1684 da metade. Só que a máscara tem quatro classes de terreno e
     * nada mais: o valor exato do pixel não interessa a ninguém depois de
     * classificado. Guardar 1 bit por pixel por classe custa 3 x 513 KB, e o
     * RGBA, o canvas temporário e a textura do Phaser são liberados no fim do
     * construtor.
     *
     * É o mesmo formato do servidor (`sim/CollisionMask.ts`), que já nasceu
     * assim — os dois lados agora guardam o terreno do mesmo jeito, o que
     * também torna a comparação entre eles direta.
     */
    constructor(scene, textureKey) {
        this.width = WORLD_WIDTH;
        this.height = WORLD_HEIGHT;
        this.halfWidth = HALF_WORLD_WIDTH;

        // Pega a imagem base carregada pelo Phaser
        const srcImage = scene.textures.get(textureKey).getSourceImage();

        // Desenha num canvas em memória (apenas da metade original)
        const canvas = document.createElement('canvas');
        canvas.width = this.halfWidth;
        canvas.height = this.height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(srcImage, 0, 0);

        // Classifica cada pixel e joga fora o RGBA.
        this.buildTerrainBits(ctx.getImageData(0, 0, this.halfWidth, this.height).data);

        // Encolher o canvas devolve o backing store (outros 16 MB) sem esperar
        // o coletor: o `ImageData` acima já não é referenciado por ninguém.
        canvas.width = 0;
        canvas.height = 0;

        // A máscara NÃO é desenhada na tela — o mapa visível é `arena.png`.
        // Depois de virar bitset, a textura só ocuparia RAM e VRAM (mais 16 MB
        // de cada). Quem carrega é o `preload()` da cena, e é aqui que ela
        // deixa de ter uso, então é aqui que ela sai.
        scene.textures.remove(textureKey);
    }

    /**
     * Monta os três bitsets a partir do RGBA da metade esquerda.
     *
     * As classes são as mesmas de sempre, com os mesmos limiares (o limiar
     * perdoa o anti-aliasing do desenho):
     *
     *     chão   r > 128
     *     ponte  chão E g <= 128   (o vermelho 255,0,0)
     *     água   NÃO chão E b > 128
     *
     * `walk` é chão OU água — exatamente o `r > 128 || b > 128` que
     * `isWalkable` calculava a cada consulta. `bridge` é subconjunto de
     * `walk`; `water` também, e os dois são disjuntos entre si.
     */
    buildTerrainBits(rgba) {
        const total = this.halfWidth * this.height;
        const bytes = Math.ceil(total / 8);

        /** 1 bit por pixel: 1 = dá para andar (chão OU água). */
        this.walkBits = new Uint8Array(bytes);
        /** 1 bit por pixel: 1 = água. Subconjunto de `walkBits`. */
        this.waterBits = new Uint8Array(bytes);
        /** 1 bit por pixel: 1 = tabuleiro de ponte. Subconjunto de `walkBits`. */
        this.bridgeBits = new Uint8Array(bytes);

        for (let i = 0; i < total; i++) {
            const chao = rgba[i * 4] > 128;
            const ponte = chao && rgba[i * 4 + 1] <= 128;
            const agua = !chao && rgba[i * 4 + 2] > 128;

            const byte = i >> 3;
            const bit = 1 << (i & 7);

            if (chao || agua) this.walkBits[byte] |= bit;
            if (agua) this.waterBits[byte] |= bit;
            if (ponte) this.bridgeBits[byte] |= bit;
        }
    }

    /**
     * Índice do pixel nos bitsets, ou -1 fora do mapa.
     *
     * Concentra num lugar só o arredondamento, o teste de borda e o
     * espelhamento da metade direita — as três coisas que `isWalkable`,
     * `isWater` e `isBridge` repetiam idênticas.
     */
    bitIndex(x, y) {
        let px = Math.floor(x);
        const py = Math.floor(y);

        if (px < 0 || py < 0 || px >= this.width || py >= this.height) return -1;

        // Regra do espelhamento para a metade direita
        if (px >= this.halfWidth) px = this.width - 1 - px;

        return py * this.halfWidth + px;
    }

    /** Verifica se um ponto exato do mapa é caminhável (chão ou água). */
    isWalkable(x, y) {
        const i = this.bitIndex(x, y);
        return i >= 0 && (this.walkBits[i >> 3] & (1 << (i & 7))) !== 0;
    }

    /**
     * O ponto é água? Espelha `CollisionMask.isWater` do servidor.
     *
     * Água é o azul da máscara: navegável como o chão, só que mais lenta
     * (`WATER_SPEED_FACTOR`). Quem pinta é `scripts/paint-water.mjs`, no
     * servidor; aqui só se lê o bit.
     */
    isWater(x, y) {
        const i = this.bitIndex(x, y);
        return i >= 0 && (this.waterBits[i >> 3] & (1 << (i & 7))) !== 0;
    }

    /**
     * O ponto é tabuleiro de ponte? Espelha `CollisionMask.isBridge`.
     *
     * O vermelho (255,0,0) da máscara. É chão para todos os efeitos —
     * caminhável e com velocidade cheia; o que ele tem de diferente é a regra
     * de `canCross`. Quem pinta é `scripts/paint-bridges.mjs`, no servidor.
     */
    isBridge(x, y) {
        const i = this.bitIndex(x, y);
        return i >= 0 && (this.bridgeBits[i >> 3] & (1 << (i & 7))) !== 0;
    }

    /**
     * Dá para ir DAQUI até ALI, olhando só a classe do terreno? Espelha
     * `CollisionMask.canCross` do servidor.
     *
     * A única transição proibida do mapa é **água <-> ponte**: quem está no rio
     * não sobe no meio do tabuleiro pela lateral, e quem está no tabuleiro não
     * cai na água de lado. Terra <-> ponte (a ENTRADA, nas duas cabeceiras),
     * terra <-> água (qualquer margem) e cada classe consigo mesma continuam
     * livres.
     *
     * Os dois pontos são CENTROS DE ELIPSE, a mesma origem de `isWater`: o
     * corpo pode encostar na ponte sem o passo ser recusado, então ninguém
     * fica preso na borda.
     */
    canCross(fromX, fromY, toX, toY) {
        const daPonte = this.isBridge(fromX, fromY);
        const praPonte = this.isBridge(toX, toY);
        if (daPonte === praPonte) return true;

        return daPonte ? !this.isWater(toX, toY) : !this.isWater(fromX, fromY);
    }

    /**
     * O destino serve como próximo passo, vindo daqui? Espelha
     * `CollisionMask.aceita`: o corpo cabe lá (`canStand`) E o passo é
     * permitido (`canCross`). Todas as coordenadas são centros de elipse.
     */
    aceita(deX, deY, x, y, rx, ry) {
        return this.canStand(x, y, rx, ry) && this.canCross(deX, deY, x, y);
    }

    /**
     * O personagem cabe com o centro da elipse aqui?
     *
     * Cinco pontos com os raios a 70% — a mesma conta que
     * `PlayerBase.isPositionWalkable` fazia inline e que o servidor repete em
     * `CollisionMask.canStand`. Estar num lugar só evita que as três pontas
     * divirjam.
     */
    canStand(cx, cy, rx, ry) {
        const dx = rx * 0.7;
        const dy = ry * 0.7;
        // Diagonais sobre a mesma elipse (cos45 ≈ 0,7071): sem elas uma quina
        // entra pelo vão entre as pontas e o ombro do corpo fica na parede.
        const ix = dx * 0.7071;
        const iy = dy * 0.7071;

        return this.isWalkable(cx, cy) &&
               this.isWalkable(cx + dx, cy) &&
               this.isWalkable(cx - dx, cy) &&
               this.isWalkable(cx, cy + dy) &&
               this.isWalkable(cx, cy - dy) &&
               this.isWalkable(cx + ix, cy + iy) &&
               this.isWalkable(cx + ix, cy - iy) &&
               this.isWalkable(cx - ix, cy + iy) &&
               this.isWalkable(cx - ix, cy - iy);
    }

    /**
     * Maior fração do deslocamento que ainda cabe, 0..1. Espelha
     * `CollisionMask.maxAlong` do servidor: quatro cortes bastam para parar a
     * menos de 1 px da parede, num passo de quadro.
     */
    maxAlong(x, y, dx, dy, offsetY, rx, ry) {
        const cy = y + offsetY;
        if (this.aceita(x, cy, x + dx, cy + dy, rx, ry)) return 1;

        let baixo = 0;
        let alto = 1;
        for (let i = 0; i < 4; i++) {
            const meio = (baixo + alto) / 2;
            if (this.aceita(x, cy, x + dx * meio, cy + dy * meio, rx, ry)) baixo = meio;
            else alto = meio;
        }
        return baixo;
    }

    /**
     * Resolve um movimento contra a parede: tenta o destino, depois deslizar só
     * em X, depois só em Y, e por fim fica onde estava.
     *
     * Igual a `CollisionMask.resolveMove` do servidor — é o que mantém a
     * previsão local do modo online andando exatamente como a simulação
     * autoritativa, sem a reconciliação ter de desfazer nada.
     *
     * O parapeito da ponte (`canCross`) entra aqui como qualquer parede: quem
     * vem nadando encosta na lateral do tabuleiro e desliza por ela, sem
     * subir. Todo movimento dos dois modos passa por este método — offline via
     * `PlayerBase.constrainPosition`, online via `Arena.stepPrediction` —,
     * então a regra não precisa ser repetida em lugar nenhum.
     *
     * @param {number} offsetY Distância de `y` até o centro da elipse.
     */
    /**
     * Ponto livre mais próximo, em espiral curta. Espelha
     * `CollisionMask.nearestFree` do servidor.
     *
     * Rede de resgate para quando a posição de PARTIDA já é inválida (empurrão,
     * separação entre personagens, clamp da borda). Sem isto a bisseção parte de
     * um ponto ruim e o personagem desliza DENTRO da parede, preso.
     *
     * O passo é fino (2 px) de propósito: o resgate tem de devolver o corpo
     * para FORA da parede pelo caminho mais curto. Com passo grosso ele saltava
     * vários pixels, o movimento empurrava de volta contra a parede e o resgate
     * disparava de novo — o tremor que se via ao encostar num obstáculo.
     */
    nearestFree(x, y, offsetY, rx, ry) {
        for (let raio = 2; raio <= 96; raio += 2) {
            for (let i = 0; i < 8; i++) {
                const ang = (i / 8) * Math.PI * 2;
                const px = x + Math.cos(ang) * raio;
                const py = y + Math.sin(ang) * raio;
                // O resgate respeita o parapeito: quem foi espremido contra a
                // margem sai pela água, não aparecendo em cima da ponte.
                if (this.aceita(x, y + offsetY, px, py + offsetY, rx, ry)) return { x: px, y: py };
            }
        }
        return null;
    }

    resolveMove(prevX, prevY, nextX, nextY, offsetY, rx, ry) {
        if (!this.canStand(prevX, prevY + offsetY, rx, ry)) {
            const saida = this.nearestFree(prevX, prevY, offsetY, rx, ry);
            if (saida) return saida;
            return { x: prevX, y: prevY };
        }

        const dx = nextX - prevX;
        const dy = nextY - prevY;

        if (this.aceita(prevX, prevY + offsetY, nextX, nextY + offsetY, rx, ry)) {
            return { x: nextX, y: nextY };
        }

        // Bateu: vai na diagonal, em X ou em Y — o que render mais, e sempre
        // até ENCOSTAR. Parar seco deixava o personagem a um passo da parede.
        const tDiag = (dx !== 0 && dy !== 0) ? this.maxAlong(prevX, prevY, dx, dy, offsetY, rx, ry) : 0;
        const tX = dx !== 0 ? this.maxAlong(prevX, prevY, dx, 0, offsetY, rx, ry) : 0;
        const tY = dy !== 0 ? this.maxAlong(prevX, prevY, 0, dy, offsetY, rx, ry) : 0;

        const avancoDiag = tDiag * Math.hypot(dx, dy);
        const avancoX = tX * Math.abs(dx);
        const avancoY = tY * Math.abs(dy);

        // Nem a diagonal nem os eixos saíram do lugar: tenta deslizar pela
        // superfície. Espelha `CollisionMask.slideAround` do servidor — sem
        // isto a previsão pararia onde a simulação desliza.
        if (Math.max(avancoDiag, avancoX, avancoY) < SLIDE_MIN_AVANCO) {
            const desvio = this.slideAround(prevX, prevY, dx, dy, offsetY, rx, ry);
            if (desvio) return desvio;
        }

        if (avancoDiag >= avancoX && avancoDiag >= avancoY) {
            return { x: prevX + dx * tDiag, y: prevY + dy * tDiag };
        }
        if (avancoX >= avancoY) return { x: prevX + dx * tX, y: prevY };
        return { x: prevX, y: prevY + dy * tY };
    }

    /**
     * Deslize pela superfície quando nem a diagonal nem os eixos avançam.
     *
     * Espelho de `CollisionMask.slideAround`: gira o passo em `SLIDE_ANGLES`
     * para os dois lados, mantendo o tamanho, e fica com o que mais avança na
     * direção pedida. Contra uma parede reta de frente todos os giros também
     * batem, e a parada seca continua sendo o resultado.
     */
    slideAround(prevX, prevY, dx, dy, offsetY, rx, ry) {
        const passo = Math.hypot(dx, dy);
        if (passo < SLIDE_MIN_AVANCO) return null;

        const base = Math.atan2(dy, dx);
        const dirX = dx / passo;
        const dirY = dy / passo;

        let melhor = null;
        let melhorProjecao = SLIDE_MIN_AVANCO;

        for (const desvio of SLIDE_ANGLES) {
            for (const lado of [1, -1]) {
                const ang = base + lado * desvio;
                const gx = Math.cos(ang) * passo;
                const gy = Math.sin(ang) * passo;

                const t = this.maxAlong(prevX, prevY, gx, gy, offsetY, rx, ry);
                if (t <= 0) continue;

                const projecao = (gx * dirX + gy * dirY) * t;
                if (projecao <= melhorProjecao) continue;

                melhorProjecao = projecao;
                melhor = { x: prevX + gx * t, y: prevY + gy * t };
            }
        }

        return melhor;
    }

    /**
     * Sorteia uma posição de nascimento no castelo do time, em chão livre.
     *
     * Mesma regra do `World.placeAtSpawn` do servidor: sorteio dentro da zona
     * (espelhada para o time `enemy`) com teto de tentativas, aceitando só o
     * que passa pela máscara. Sem posição livre, devolve o centro da zona — em
     * vez de deixar o personagem em cima de uma muralha.
     *
     * @param {'ally'|'enemy'|'human'} team
     * @param {number} offsetY Distância de `y` até o centro da elipse.
     */
    findSpawn(team, rx, ry, offsetY) {
        const espelhar = team === 'enemy';
        const sorteia = (min, max) => min + Math.random() * (max - min);

        for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
            const bruteX = sorteia(SPAWN_ZONE.minX, SPAWN_ZONE.maxX);
            const x = espelhar ? WORLD_WIDTH - bruteX : bruteX;
            const y = sorteia(SPAWN_ZONE.minY, SPAWN_ZONE.maxY);

            if (this.canStand(x, y + offsetY, rx, ry)) return { x, y };
        }

        const centroX = (SPAWN_ZONE.minX + SPAWN_ZONE.maxX) / 2;
        return {
            x: espelhar ? WORLD_WIDTH - centroX : centroX,
            y: (SPAWN_ZONE.minY + SPAWN_ZONE.maxY) / 2
        };
    }

    /**
     * Joga um raio numa direção. Retorna quantos pixels há de caminho livre
     * antes de bater numa parede preta (0,0,0) — ou no parapeito da ponte, que
     * para o bot offline é obstáculo igual: sem isso ele acharia a lateral do
     * tabuleiro livre e ficaria empurrando a água contra ela.
     */
    getClearance(x, y, angle, maxDist = 200, step = 15) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        for (let d = step; d <= maxDist; d += step) {
            const px = x + cos * d;
            const py = y + sin * d;
            if (!this.isWalkable(px, py) || !this.canCross(x, y, px, py)) {
                return d;
            }
        }
        return maxDist;
    }
}