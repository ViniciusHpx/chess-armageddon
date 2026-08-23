import {
    HALF_WORLD_WIDTH, WORLD_WIDTH, WORLD_HEIGHT, SPAWN_ZONE, SPAWN_ATTEMPTS
} from '../constants/Scenario.js';

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

        // Se o canal vermelho for > 128 tratamos como branco/livre.
        // Isso dá segurança caso a borda da imagem tenha algum "anti-aliasing" cinza.
        return r > 128;
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
        return this.isWalkable(cx, cy) &&
               this.isWalkable(cx + dx, cy) &&
               this.isWalkable(cx - dx, cy) &&
               this.isWalkable(cx, cy + dy) &&
               this.isWalkable(cx, cy - dy);
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
    resolveMove(prevX, prevY, nextX, nextY, offsetY, rx, ry) {
        if (this.canStand(nextX, nextY + offsetY, rx, ry)) return { x: nextX, y: nextY };
        if (this.canStand(nextX, prevY + offsetY, rx, ry)) return { x: nextX, y: prevY };
        if (this.canStand(prevX, nextY + offsetY, rx, ry)) return { x: prevX, y: nextY };
        return { x: prevX, y: prevY };
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