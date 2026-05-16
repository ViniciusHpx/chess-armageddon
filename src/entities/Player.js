// Player.js
import { RANKS } from '../constants/Hierarchy.js';

export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, RANKS.PAWN.key);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.initPhysics();

        this._currentRank = RANKS.PAWN;
        this._isAttacking = false;
        this.wasWalking = false;
        this._walkTween = null;

        // Debug visual da hitbox
        this.debugGraphics = this.scene.add.graphics();
        this.debugGraphics.setDepth(1000);
    }

    initPhysics() {
        this.setCollideWorldBounds(true);
        this.body.setCircle(20, 44, 108);
    }

    promote() {
        const nextRankKey = this._currentRank.next;
        this.setRank(RANKS[nextRankKey]);
        this.setTint(0x00ff00);
        this.scene.time.delayedCall(200, () => this.clearTint());
    }

    setRank(rankConfig) {
        this._currentRank = rankConfig;
        this.setTexture(rankConfig.key);
    }

    resetToPawn() {
        this.setRank(RANKS.PAWN);
    }

    attack() {
        if (this._isAttacking) return;
        this._isAttacking = true;

        this.scene.tweens.add({
            targets: this,
            x: this.flipX ? this.x - 30 : this.x + 30,
            duration: 100,
            yoyo: true,
            onComplete: () => this._isAttacking = false
        });

        this.executeHitCheck();
    }

    executeHitCheck() {
        const { width, height, offset } = this._currentRank.hitbox;
        const hitX = this.flipX ? this.x - offset : this.x + offset;

        const zone = this.scene.add.zone(hitX, this.y, width, height);
        this.scene.physics.add.existing(zone);

        this.scene.physics.overlap(zone, this.scene.enemies, (z, enemy) => {
            if (enemy.die) {
                enemy.die();
                this.promote();
            }
        });
        this.scene.time.delayedCall(100, () => zone.destroy());
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    update(movement) {
        if (this._isAttacking) return;

        const { dx, dy } = movement;
        const speed = this._currentRank.speed;

        this.setVelocity(dx * speed, dy * speed);

        // Depth dinâmico
        this.setDepth(this.y);
        this.debugGraphics.setDepth(this.y - 1);

        if (dx !== 0) this.setFlipX(dx < 0);

        this.handleVisualEffects(dx, dy);
        this.drawDebugHitbox();
    }

    handleVisualEffects(dx, dy) {
        const isMoving = (dx !== 0 || dy !== 0);
        if (isMoving && !this._wasWalking) {
            this.startWalkEffect();
            this._wasWalking = true;
        } else if (!isMoving && this._wasWalking) {
            this.stopWalkEffect();
            this._wasWalking = false;
        }
    }

    startWalkEffect() {
        this._walkTween = this.scene.tweens.add({
            targets: this,
            scaleY: 0.9,
            scaleX: 1.05,
            angle: { from: -5, to: 5 },
            duration: 150,
            yoyo: true,
            repeat: -1,
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

    drawDebugHitbox() {
        this.debugGraphics.clear();

        // Usa a posição do sprite (centro visual) em vez do centro do corpo físico
        // para evitar que a elipse "pule" quando o sprite é escalado pela animação de andar.
        const centerX = this.x - 5;
        const centerY = this.y + 48; // 20px acima dos pés

        // Raios base (20% maiores que os anteriores 40/20)
        const baseRx = 48; // 40 * 1.2
        const baseRy = 24; // 20 * 1.2

        // Espessuras das bordas
        const thick = 3;  // borda preta externa
        const mid = 2;    // borda branca do meio
        const thin = 2;   // borda preta interna

        // 1. Borda preta externa (maior)
        this.debugGraphics.lineStyle(thick, 0x000000, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, baseRx * 2, baseRy * 2);

        // 2. Borda branca central (um pouco menor)
        const midRx = baseRx - (thick / 2 + mid / 2);
        const midRy = baseRy - (thick / 2 + mid / 2);
        this.debugGraphics.lineStyle(mid, 0xffffff, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, midRx * 2, midRy * 2);

        // 3. Borda preta interna (menor ainda)
        const innerRx = midRx - (mid / 2 + thin / 2);
        const innerRy = midRy - (mid / 2 + thin / 2);
        this.debugGraphics.lineStyle(thin, 0x000000, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, innerRx * 2, innerRy * 2);
    }
}