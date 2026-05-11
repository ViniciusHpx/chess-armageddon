// Player.js
export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        // Inicializa o Sprite com a textura 'pawn' carregada na cena
        super(scene, x, y, 'pawn');

        // Adiciona o objeto à cena e ao sistema de física
        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Configurações de colisão e corpo físico
        this.setCollideWorldBounds(true);
        this.body.setSize(128, 64);
        this.body.setOffset(64, 192);

        // Atributos de RPG (Stats)
        this.stats = {
            hp: 100,
            maxHp: 100,
            shield: 50,
            maxShield: 100,
            speed: 200,
            attackDamage: 10,
            specialAttackDamage: 25
        };

        // Som de passos (instanciado a partir do áudio carregado na Scene)
        this.footstepSound = scene.sound.add('footstep', { loop: true, volume: 0.5 });
        this.wasWalking = false; // Controle para não disparar o play() repetidamente
    }

    /**
     * @param {Object} movement - Objeto contendo { dx, dy } normalizados (de -1 a 1)
     */
    update(movement) {
        const { dx, dy } = movement;

        // Aplica a velocidade baseada nos stats do player
        this.setVelocity(dx * this.stats.speed, dy * this.stats.speed);

        // Lógica de espelhar o sprite (Flip)
        if (dx < 0) {
            this.setFlipX(true);  // Esquerda
        } else if (dx > 0) {
            this.setFlipX(false); // Direita
        }

        // Controle do som de passos
        const isMoving = (dx !== 0 || dy !== 0);

        if (isMoving && !this.wasWalking) {
            this.footstepSound.play();
            this.wasWalking = true;
        } else if (!isMoving && this.wasWalking) {
            this.footstepSound.stop();
            this.wasWalking = false;
        }
    }

    // Exemplo de método para o especial da torre que você mencionou
    healShield(amount) {
        this.stats.shield += amount;
        if (this.stats.shield > this.stats.maxShield) {
            this.stats.shield = this.stats.maxShield;
        }
        console.log(`Escudo regenerado: ${this.stats.shield}`);
    }

    takeDamage(amount) {
        // Primeiro retira do escudo
        if (this.stats.shield > 0) {
            this.stats.shield -= amount;
            if (this.stats.shield < 0) {
                this.stats.hp += this.stats.shield; // O que sobrou tira do HP
                this.stats.shield = 0;
            }
        } else {
            this.stats.hp -= amount;
        }

        if (this.stats.hp <= 0) {
            console.log("Player morreu!");
            // Lógica de Game Over aqui
        }
    }
}