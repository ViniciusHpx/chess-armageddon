import PlayerBase from './PlayerBase.js';
import { RANKS } from '../constants/Hierarchy.js';

export default class HumanPlayer extends PlayerBase {
    constructor(scene, x, y) {
        super(scene, x, y, RANKS.PAWN.key, 'human', 0xffff00);
    }

    attack() {
        if (this._isAttacking) return;
        this.performAttack(this.scene.enemyPlayers);
    }

    die() {
        this.resetToPawn();
        this.maxHealth = RANKS.PAWN.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

        this.setPosition(640, 360);

        this.scene.cameras.main.shake(200, 0.01);

        this._isInvulnerable = true;
        this.scene.time.delayedCall(1000, () => {
            this._isInvulnerable = false;
        });
    }

    update(movement) {
        // Movimentação normal apenas se não estiver atacando
        if (!this._isAttacking) {
            const { dx, dy } = movement;
            const speed = this._currentRank.speed;

            this.setVelocity(dx * speed, dy * speed);

            if (dx !== 0) this.setFlipX(dx < 0);

            this.handleVisualEffects(dx, dy);
        } else {
            // Durante o ataque, para o personagem (sem velocidade)
            this.setVelocity(0, 0);
        }

        // Sempre chama commonUpdate para atualizar elipse, barra de vida e ataque visual
        this.commonUpdate();
    }

    handleVisualEffects(dx, dy) {
        const isMoving = (dx !== 0 || dy !== 0);
        if (isMoving && !this.wasWalking) {
            this.startWalkEffect();
            this.wasWalking = true;
        } else if (!isMoving && this.wasWalking) {
            this.stopWalkEffect();
            this.wasWalking = false;
        }
    }

    startWalkEffect() {
        this._walkTween = this.scene.tweens.add({
            targets: this,
            scaleY: 0.95,
            scaleX: 1.05,
            angle: { from: -1, to: 1 },
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
}