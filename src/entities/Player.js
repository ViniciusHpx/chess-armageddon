export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, collisionContext) {
        super(scene, x, y, 'pawn');
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.collisionContext = collisionContext; // Armazena o mapa de colisão
        this.setCollideWorldBounds(true);
        
        // Ajuste o corpo para ser menor, facilitando a navegação em corredores
        this.body.setSize(40, 20); 
        this.body.setOffset(44, 100); 

        this.stats = { speed: 200 };
        this.wasWalking = false;
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    update(movement) {
        const { dx, dy } = movement;
        
        // Calculamos a próxima posição teórica
        const nextX = this.x + (dx * this.stats.speed * 0.016); // 0.016 é aprox. 1 frame a 60fps
        const nextY = this.y + (dy * this.stats.speed * 0.016);

        // Checamos se o pixel na posição (nextX, nextY) é visível no mapa de colisão
        if (this.canMoveTo(nextX, nextY)) {
            this.setVelocity(dx * this.stats.speed, dy * this.stats.speed);
        } else {
            // Se bater, tentamos permitir movimento apenas em um eixo (deslizar na parede)
            if (this.canMoveTo(nextX, this.y)) {
                this.setVelocity(dx * this.stats.speed, 0);
            } else if (this.canMoveTo(this.x, nextY)) {
                this.setVelocity(0, dy * this.stats.speed);
            } else {
                this.setVelocity(0, 0);
            }
        }

        // Lógica visual de flip e tweens (mantida igual)
        if (dx < 0) this.setFlipX(true);
        else if (dx > 0) this.setFlipX(false);

        const isMoving = (this.body.velocity.x !== 0 || this.body.velocity.y !== 0);
        if (isMoving && !this.wasWalking) {
            this.startWalkEffect();
            this.wasWalking = true;
        } else if (!isMoving && this.wasWalking) {
            this.stopWalkEffect();
            this.wasWalking = false;
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