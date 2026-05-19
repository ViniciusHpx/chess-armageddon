import PlayerBase from './PlayerBase.js';
import { RANKS } from '../constants/Hierarchy.js';

export default class AIPlayer extends PlayerBase {
    constructor(scene, x, y, team) {
        const debugColor = team === 'ally' ? 0x00ff00 : 0xff0000;
        super(scene, x, y, RANKS.PAWN.key, team, debugColor);

        // Aplica tint conforme o time:
        // - Aliados: NENHUM tint (mantém a cor original do sprite)
        // - Inimigos: cinza escuro (0xFBA1AD)
        if (team === 'enemy') {
            this.setTint(0xFBA1AD);
        }
        // Aliados NÃO recebem tint

        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 0;
        this.setRandomTimer();

        this._attackCooldown = 0;
    }

    setRandomTimer() {
        this.wanderTimer = Phaser.Math.Between(1000, 3000);
    }

    die() {
        this.setActive(false);
        this.setVisible(false);
        this.body.enable = false;

        this.resetAura(); // reseta aura ao morrer

        this.scene.time.delayedCall(1000, () => this.respawn());
    }

    respawn() {
        const worldBounds = this.scene.physics.world.bounds;
        const margin = 100;
        const x = Phaser.Math.Between(margin, worldBounds.width - margin);
        const y = Phaser.Math.Between(margin, worldBounds.height - margin);

        this.setPosition(x, y);
        this.resetToPawn();
        this.maxHealth = RANKS.PAWN.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

        // Reaplica o tint ao ressuscitar (importante para inimigos)
        if (this.team === 'enemy') {
            this.setTint(0xFBA1AD);
        } else {
            this.clearTint(); // garante que aliado não tenha tint
        }

        this.setActive(true);
        this.setVisible(true);
        this.body.enable = true;
        this._isInvulnerable = true;
        this.scene.time.delayedCall(500, () => {
            this._isInvulnerable = false;
        });

        this.resetAura(); // garante aura zerada no respawn
    }

    aiUpdate(time, delta) {
        if (!this.active) return;
        if (this._isAttacking) {
            this.commonUpdate();
            return;
        }

        this.wanderTimer -= delta;
        if (this.wanderTimer <= 0) {
            this.wanderAngle = Math.random() * Math.PI * 2;
            this.setRandomTimer();
        }

        const margin = 100;
        const bounds = this.scene.physics.world.bounds;
        if (this.x < margin) {
            this.wanderAngle = 0;
        } else if (this.x > bounds.width - margin) {
            this.wanderAngle = Math.PI;
        }
        if (this.y < margin) {
            this.wanderAngle = Math.PI / 2;
        } else if (this.y > bounds.height - margin) {
            this.wanderAngle = -Math.PI / 2;
        }

        const speed = this._currentRank.speed * 0.25; // IA se move mais devagar que o jogador PARA FINS DE DEBUG
        const vx = Math.cos(this.wanderAngle) * speed;
        const vy = Math.sin(this.wanderAngle) * speed;
        this.setVelocity(vx, vy);

        if (vx < 0) this.setFlipX(true);
        else if (vx > 0) this.setFlipX(false);

        this._attackCooldown -= delta;
        if (this._attackCooldown <= 0) {
            const enemies = this.team === 'ally' ? this.scene.enemyPlayers : this.scene.alliedPlayers;
            let enemyInRange = false;
            for (const enemy of enemies.getChildren()) {
                if (!enemy.active) continue;
                if (Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y) < 100) {
                    enemyInRange = true;
                    break;
                }
            }

            if (enemyInRange && Math.random() < 0.02) {
                this.attack();
                this._attackCooldown = 2000;
            }
        }

        this.commonUpdate();
    }

    attack() {
        if (this._isAttacking) return;
        const enemies = this.team === 'ally' ? this.scene.enemyPlayers : this.scene.alliedPlayers;
        this.performAttack(enemies);
    }
}