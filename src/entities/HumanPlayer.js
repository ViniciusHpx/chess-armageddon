import PlayerBase from './PlayerBase.js';
import { ATTACK_MOVE_FACTOR, RANKS } from '../constants/Hierarchy.js';

export default class HumanPlayer extends PlayerBase {
    constructor(scene, x, y) {
        super(scene, x, y, RANKS.PAWN.key, 'human', 0xffff00);

        // A máquina de carga vive no `PlayerBase`: aqui só se decide quando
        // apertar e quando soltar, a partir da entrada do jogador.

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
    die() {
        this._isDead = true;

        // Cancela ataque e carga em andamento
        this.finishAttack();
        this.cancelCharge();

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
            this.releaseCharge(this.scene.enemyPlayers);
        }

        if (this._isCharging) {
            this.updateCharge();
        }

        // Movimentação: durante o golpe anda devagar em vez de deslizar solto
        // com a velocidade anterior (ver ATTACK_MOVE_FACTOR).
        const { dx, dy } = movement;
        const speed = this._currentRank.speed *
            (this._isAttacking ? ATTACK_MOVE_FACTOR : 1);

        this.setVelocity(dx * speed, dy * speed);

        if (dx !== 0) this.setFlipX(dx < 0);

        if (!this._isAttacking) {
            this.handleVisualEffects(dx, dy);
        } else if (this.wasWalking) {
            this.stopWalkEffect();
            this.wasWalking = false;
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