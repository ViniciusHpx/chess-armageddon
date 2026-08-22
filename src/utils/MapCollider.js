import { HALF_WORLD_WIDTH, WORLD_WIDTH, WORLD_HEIGHT } from '../constants/Scenario.js';

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