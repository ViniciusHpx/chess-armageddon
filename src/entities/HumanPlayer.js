import PlayerBase from './PlayerBase.js';
import { RANKS } from '../constants/Hierarchy.js';

export default class HumanPlayer extends PlayerBase {
    constructor(scene, x, y) {
        super(scene, x, y, RANKS.PAWN.key, 'human', 0xffff00);

        // Estado de carga do ataque
        this._isCharging = false;
        this._chargeStartTime = 0;
        this._chargeComplete = false;
    }

    // Ataque normal (usado quando o botão é apenas pressionado sem carga completa)
    attack() {
        if (this._isAttacking) return;
        this.performAttack(this.scene.enemyPlayers);
    }

    /**
     * Inicia o processo de carga (botão pressionado).
     */
    startCharging() {
        if (this._isAttacking || this._isCharging) return;
        this._isCharging = true;
        this._chargeStartTime = this.scene.time.now;
        this._chargeComplete = false;
    }

    /**
     * Solta o botão de ataque. Executa ataque normal ou carregado.
     */
    releaseAttack() {
        if (!this._isCharging) return;

        const elapsed = this.scene.time.now - this._chargeStartTime;
        const chargeTime = this._currentRank.chargeTime;

        if (elapsed >= chargeTime) {
            this._performChargedAttack();
        } else {
            this.attack();
        }

        // Finaliza a carga
        this._isCharging = false;
        this._chargeComplete = false;
    }

    /**
     * Atualiza o progresso da carga enquanto o botão está segurado.
     */
    updateCharge() {
        if (!this._isCharging) return;
        const elapsed = this.scene.time.now - this._chargeStartTime;
        if (elapsed >= this._currentRank.chargeTime) {
            this._chargeComplete = true;
            // O brilho já está ativo, pode-se adicionar som ou outro feedback
        }
    }

    _performChargedAttack() {
        if (this._isAttacking) return;
        this._isChargedAttack = true; // ativa dobro de dano e alcance
        this.performAttack(this.scene.enemyPlayers);
    }

    die() {
        this.resetToPawn();
        this.maxHealth = RANKS.PAWN.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

        this.resetAura(); // reseta aura ao morrer

        this.setPosition(640, 360);

        this.scene.cameras.main.shake(200, 0.01);

        this._isInvulnerable = true;
        this.scene.time.delayedCall(1000, () => {
            this._isInvulnerable = false;
        });

        // Cancela qualquer carga em andamento
        this._isCharging = false;
        this._chargeComplete = false;
    }

    update(movement, attackState) {
        // Entrada de ataque
        if (attackState.justPressed) {
            this.startCharging();
        }
        if (attackState.justReleased) {
            this.releaseAttack();
        }

        if (this._isCharging) {
            this.updateCharge();
        }

        // Movimentação (bloqueada durante ataque ou carga)
        if (!this._isAttacking && !this._isCharging) {
            const { dx, dy } = movement;
            const speed = this._currentRank.speed;

            this.setVelocity(dx * speed, dy * speed);

            if (dx !== 0) this.setFlipX(dx < 0);

            this.handleVisualEffects(dx, dy);
        } else {
            this.setVelocity(0, 0);
            if (this.wasWalking) {
                this.stopWalkEffect();
                this.wasWalking = false;
            }
        }

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