import PlayerBase from './PlayerBase.js';
import { RANKS } from '../constants/Hierarchy.js';

export default class HumanPlayer extends PlayerBase {
    constructor(scene, x, y) {
        super(scene, x, y, RANKS.PAWN.key, 'human', 0xffff00);

        // Estado de carga do ataque
        this._isCharging = false;
        this._chargeStartTime = 0;
        this._chargeComplete = false;

        // Morto: aguardando o clique em RENASCER na tela de morte
        this._isDead = false;
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
        this._chargeRatio = 0; // reseta o progresso visual
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
        this._chargeRatio = 0; // limpa o indicador
    }

    /**
     * Atualiza o progresso da carga enquanto o botão está segurado.
     */
    updateCharge() {
        if (!this._isCharging) return;
        const elapsed = this.scene.time.now - this._chargeStartTime;
        const ratio = Phaser.Math.Clamp(elapsed / this._currentRank.chargeTime, 0, 1);
        this._chargeRatio = ratio; // atualiza a cor do brilho

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
        this._isDead = true;

        // Cancela ataque e carga em andamento
        this.finishAttack();
        this._isCharging = false;
        this._chargeComplete = false;
        this._chargeRatio = 0;

        this.stopWalkEffect();
        this.wasWalking = false;
        this.setVelocity(0, 0);

        this.resetAura();
        this.auraEmitter.stop();
        this._auraEmitterActive = false;

        // Some do mundo: inativo é ignorado pela IA e pelo CollisionResolver
        this.setActive(false);
        this.setVisible(false);
        this.body.enable = false;
        this.setVisualsVisible(false);

        this.scene.cameras.main.shake(200, 0.01);

        this.scene.deathScreen.show(() => this.respawn());
    }

    /**
     * Renasce como peão no centro do mapa (acionado pelo botão da tela de morte).
     */
    respawn() {
        this.resetToPawn();
        this.maxHealth = RANKS.PAWN.health;
        this.currentHealth = this.maxHealth;

        this.setPosition(640, 360);
        this.setVelocity(0, 0);

        this.setActive(true);
        this.setVisible(true);
        this.body.enable = true;
        this.body.updateFromGameObject();
        this.setVisualsVisible(true);
        this.updateHealthBar();

        this._isDead = false;

        this._isInvulnerable = true;
        this.scene.time.delayedCall(1000, () => {
            this._isInvulnerable = false;
        });
    }

    update(movement, attackState, deltaMs) {
        // Morto: ignora entrada até renascer
        if (this._isDead) return;

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
        if (!this._isAttacking) {
            const { dx, dy } = movement;
            const speed = this._currentRank.speed;

            this.setVelocity(dx * speed, dy * speed);

            if (dx !== 0) this.setFlipX(dx < 0);

            this.handleVisualEffects(dx, dy);
        } else {
            if (this.wasWalking) {
                this.stopWalkEffect();
                this.wasWalking = false;
            }
        }

        this.commonUpdate(deltaMs);
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