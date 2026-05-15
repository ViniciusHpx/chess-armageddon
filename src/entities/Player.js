// Player.js
import { RANKS } from '../constants/Hierarchy.js';

export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        // Inicializa a classe pai (Sprite) com a skin inicial de Peão
        super(scene, x, y, RANKS.PAWN.key);

        // Adiciona o objeto à cena e ao sistema de física
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.initPhysics();

        // Estados Internos
        this._currentRank = RANKS.PAWN; // Estado atual do rank
        this._isAttacking = false;  // Bloqueia movimento durante o ataque
        this.wasWalking = false;    // Controle para disparar tweens de caminhada
        this._walkTween = null;     // Armazena a animação ativa de movimento
    }

    initPhysics() {
        this.setCollideWorldBounds(true);   // Impede sair do mapa
        // Ajusta a caixa de colisão para os "pés" da peça
        this.body.setSize(80, 40);
        this.body.setOffset(24, 88);
    }

    // Lógica de evolução: troca o rank atual pelo definido na propriedade 'next'
    promote() {
        const nextRankKey = this._currentRank.next;
        this.setRank(RANKS[nextRankKey]);

        // Feedback visual de evolução 
        this.setTint(0x00ff00);
        this.scene.time.delayedCall(200, () => this.clearTint());
    }

    // Aplica as propriedades do rank 
    setRank(rankConfig) {
        this._currentRank = rankConfig;
        this.setTexture(rankConfig.key);
    }

    // Retorna o jogador ao estado inicial
    resetToPawn() {
        this.setRank(RANKS.PAWN);
    }

    attack() {
        if (this._isAttacking) return; // Evita spam de ataque
        this._isAttacking = true;

        // Animação de "investida" rápida para frente e volta
        this.scene.tweens.add({
            targets: this,
            x: this.flipX ? this.x - 30 : this.x + 30,
            duration: 100,
            yoyo: true,
            onComplete: () => this._isAttacking = false
        });

        this.executeHitCheck();
    }

    // Cria uma zona temporária de dano baseada no rank atual
    executeHitCheck() {
        const { width, height, offset } = this._currentRank.hitbox;
        // Posiciona a hitbox à frente do personagem dependendo da direção
        const hitX = this.flipX ? this.x - offset : this.x + offset;

        // Zone é um objeto invisível usado apenas para detecção de física
        const zone = this.scene.add.zone(hitX, this.y, width, height);
        this.scene.physics.add.existing(zone);

        // Verifica sobreposição entre a zona de ataque e o grupo de inimigos
        this.scene.physics.overlap(zone, this.scene.enemies, (z, enemy) => {
            if (enemy.die) {
                enemy.die();    // Mata o inimigo
                this.promote(); // Promove o jogador
            }
        });
        // Remove a zona após 100ms
        this.scene.time.delayedCall(100, () => zone.destroy());
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    // Loop de atualização do jogador chamado pela Scene
    update(movement) {
        if (this._isAttacking) return;

        const { dx, dy } = movement;
        const speed = this._currentRank.speed;

        // Aplica velocidade baseada na normalização do InputManager
        this.setVelocity(dx * speed, dy * speed);

        if (dx !== 0) this.setFlipX(dx < 0);

        this.handleVisualEffects(dx, dy);
    }

    // Controla o início e fim dos efeitos visuais de movimento
    handleVisualEffects(dx, dy) {
        const isMoving = (dx !== 0 || dy !==0);
        if (isMoving && !this._wasWalking) {
            this.startWalkEffect();
            this._wasWalking = true;
        } else if (!isMoving && this._wasWalking) {
            this.stopWalkEffect();
            this._wasWalking = false;
        }
    }

    canMoveTo(x, y) {
        // Arredonda as coordenadas para o canvas
        const px = Math.floor(x);
        const py = Math.floor(y);

        // Se estiver fora dos limites da imagem, bloqueia
        if (px < 0 || px >= this.collisionContext.canvas.width || py < 0 || py >= this.collisionContext.canvas.height) {
            return false;
        }

        // Pega os dados do pixel [R, G, B, A]
        const pixel = this.collisionContext.getImageData(px, py, 1, 1).data;
        
        // O índice 3 é o Alpha (transparência). 0 = transparente, 255 = opaco.
        // Se Alpha > 0, significa que há cor ali, logo é uma área "andável".
        return pixel[3] > 0;
    }

    startWalkEffect() {
        // Criamos um efeito de "pular" e "achatar" levemente
        this.walkTween = this.scene.tweens.add({
            targets: this,
            scaleY: 0.9,          // Achata um pouco (Squash)
            scaleX: 1.05,         // Alarga um pouco (Stretch)
            angle: { from: -5, to: 5 }, // Balança para os lados
            duration: 150,        // Velocidade do passo
            yoyo: true,           // Volta ao normal
            repeat: -1,           // Infinito enquanto caminha
            ease: 'Sine.easeInOut'
        });
    }

    stopWalkEffect() {
       if (this._walkTween) {
            this._walkTween.stop();
            this._walkTween = null;
            this.setAngle(0);
            this.setScale(1);
        }
    }
}