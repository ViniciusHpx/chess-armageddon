// Player.js
export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'pawn');
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setCollideWorldBounds(true);
        this.body.setSize(128, 64);
        this.body.setOffset(64, 192);

        this.stats = { speed: 200 };
        this.wasWalking = false;
        this.walkTween = null;
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    update(movement) {
        const { dx, dy } = movement;
        this.setVelocity(dx * this.stats.speed, dy * this.stats.speed);

        if (dx < 0) this.setFlipX(true);
        else if (dx > 0) this.setFlipX(false);

        const isMoving = (dx !== 0 || dy !== 0);

        // Lógica para disparar o efeito visual
        if (isMoving && !this.wasWalking) {
            this.startWalkEffect();
            this.wasWalking = true;
        } else if (!isMoving && this.wasWalking) {
            this.stopWalkEffect();
            this.wasWalking = false;
        }
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
        if (this.walkTween) {
            this.walkTween.stop();
            this.walkTween = null;
            
            // Reseta as propriedades para o estado original
            this.scene.tweens.add({
                targets: this,
                scaleX: 1,
                scaleY: 1,
                angle: 0,
                duration: 200,
                ease: 'Back.out'
            });
        }
    }
}