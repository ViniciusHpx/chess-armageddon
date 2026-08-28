import PlayerBase from './PlayerBase.js';
import { CHARGED_ATTACK_ENABLED, movementFactor, RANKS } from '../constants/Hierarchy.js';

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
     * Renasce no centro do mapa (acionado pelo botão da tela de morte),
     * mantendo o rank e com a barra de XP zerada.
     */
    respawn() {
        this.resetProgressOnDeath();

        this.moveToSpawn(this.scene.mapCollider, 640, 360);
        this.setVelocity(0, 0);

        this.setActive(true);
        this.setVisible(true);
        this.body.enable = true;
        this.body.updateFromGameObject();
        this.setVisualsVisible(true);
        this.updateHealthBar();

        this._isDead = false;
        this.cancelDash();

        this._isInvulnerable = true;
        this.scene.time.delayedCall(1000, () => {
            this._isInvulnerable = false;
        });
    }

    /**
     * @param {{dx: number, dy: number}} movement Vetor de movimento.
     * @param {{held: boolean, justPressed: boolean, justReleased: boolean}} attackState
     * @param {{justPressed: boolean}} dashState
     * @param {number} deltaMs
     * @param {{ax: number, ay: number}} [attackAim] MIRA do ataque, vinda do
     *        controle de ataque. Neutra (ou ausente, no caso do teclado)
     *        significa "sem mira", e aí o golpe sai pelo `flipX` — o
     *        comportamento de sempre.
     */
    update(movement, attackState, dashState, deltaMs, attackAim) {
        // Morto: ignora entrada até renascer
        if (this._isDead) return;

        // A mira é lida ANTES de qualquer golpe sair: é dela que
        // `performAttack` congela a direção. Guardar no personagem (em vez de
        // passar por parâmetro) é o mesmo desenho do servidor, onde a mira mora
        // no `Actor` e o bot simplesmente nunca escreve nela.
        this._aimDx = attackAim ? attackAim.ax : 0;
        this._aimDy = attackAim ? attackAim.ay : 0;

        // Entrada de dash. Antes do ataque de propósito: pedir dash com o
        // golpe já em curso é recusado dentro de `startDash`.
        if (dashState && dashState.justPressed) {
            this.startDash(movement.dx, movement.dy);
        }

        // Entrada de ataque.
        //
        // Com a carga desligada, `held` (e não só `justPressed`) é o gatilho: é
        // isso que faz o golpe se repetir enquanto o controle está pressionado.
        // O ritmo é o `_attackReadyAt`, cujo piso é `ATTACK_INTERVAL` — e
        // `attackLight` sai na hora se já está atacando ou em recuperação,
        // então chamar todo quadro não encadeia golpe nem cria temporizador
        // paralelo.
        //
        // Com a carga LIGADA nada disso vale: segurar significa carregar, e
        // repetir atropelaria a carga.
        if (CHARGED_ATTACK_ENABLED) {
            if (attackState.justPressed) this.startCharging();
        } else if (attackState.held && !this.isDashing) {
            this.attackLight(this.scene.enemyPlayers);
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

        // Dash manda na velocidade enquanto dura; a entrada não desvia nem
        // freia o impulso.
        const dash = this.dashVelocity(deltaMs);
        if (dash) {
            this.setVelocity(dash.vx, dash.vy);
        } else {
            const speed = this._currentRank.speed *
                movementFactor(this._isAttacking, this._isCharging, this.isInWater());

            this.setVelocity(dx * speed, dy * speed);

            if (dx !== 0) this.setFlipX(dx < 0);
        }

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