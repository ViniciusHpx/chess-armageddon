import {
    HALF_WORLD_WIDTH, WORLD_WIDTH, WORLD_HEIGHT, SPAWN_ZONE, SPAWN_ATTEMPTS
} from '../constants/Scenario.js';

/** Desvios testados ao deslizar (30° e 60°). Espelha o servidor. */
const SLIDE_ANGLES = [Math.PI / 6, Math.PI / 3];

/** Avanço abaixo do qual o passo conta como "não saiu do lugar", em px. */
const SLIDE_MIN_AVANCO = 0.05;

export default class MapCollider {
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
        
        // Extrai a array 1D de bytes (RGBA)
        this.pixelData = ctx.getImageData(0, 0, this.halfWidth, this.height).data;
    }

    /** Verifica se um ponto exato do mapa é caminhável (branco). */
    isWalkable(x, y) {
        let px = Math.floor(x);
        let py = Math.floor(y);

        if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;

        // Regra do espelhamento para a metade direita
        if (px >= this.halfWidth) {
            px = this.width - 1 - px;
        }

        // Calcula o índice no array de bytes (pixel = y * largura + x) * 4 canais
        const index = (py * this.halfWidth + px) * 4;
        const r = this.pixelData[index];
        const b = this.pixelData[index + 2];

        // Branco (vermelho > 128) é chão; azul é água, e dá para andar nos dois.
        // O limiar (em vez de "é preto?") perdoa o anti-aliasing do desenho.
        return r > 128 || b > 128;
    }

    /**
     * O ponto é água? Espelha `CollisionMask.isWater` do servidor.
     *
     * Água é o azul da máscara: navegável como o chão, só que mais lenta
     * (`WATER_SPEED_FACTOR`). Quem pinta é `scripts/paint-water.mjs`, no
     * servidor; aqui só se lê o pixel.
     */
    isWater(x, y) {
        let px = Math.floor(x);
        const py = Math.floor(y);

        if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
        if (px >= this.halfWidth) px = this.width - 1 - px;

        const index = (py * this.halfWidth + px) * 4;
        return this.pixelData[index] <= 128 && this.pixelData[index + 2] > 128;
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
        if (this.canStand(x + dx, y + dy + offsetY, rx, ry)) return 1;

        let baixo = 0;
        let alto = 1;
        for (let i = 0; i < 4; i++) {
            const meio = (baixo + alto) / 2;
            if (this.canStand(x + dx * meio, y + dy * meio + offsetY, rx, ry)) baixo = meio;
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
                if (this.canStand(px, py + offsetY, rx, ry)) return { x: px, y: py };
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

        if (this.canStand(nextX, nextY + offsetY, rx, ry)) return { x: nextX, y: nextY };

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
     * antes de bater numa parede preta (0,0,0).
     */
    getClearance(x, y, angle, maxDist = 200, step = 15) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        for (let d = step; d <= maxDist; d += step) {
            if (!this.isWalkable(x + cos * d, y + sin * d)) {
                return d;
            }
        }
        return maxDist;
    }
}