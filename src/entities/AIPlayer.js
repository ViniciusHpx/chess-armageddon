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

        // Durante o ataque, apenas mantém os visuais e não altera o movimento
        if (this._isAttacking) {
            this.commonUpdate();
            return;
        }

        // Define o grupo de inimigos (adversários)
        const enemies = this.team === 'ally' ? this.scene.enemyPlayers : this.scene.alliedPlayers;

        // --- LÓGICA DE PERSEGUIÇÃO AO INIMIGO MAIS PRÓXIMO ---
        let nearestEnemy = null;
        let nearestDist = Infinity;

        for (const enemy of enemies.getChildren()) {
            if (!enemy.active) continue;
            const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestEnemy = enemy;
            }
        }

        let moveAngle;
        const margin = 100;
        const bounds = this.scene.physics.world.bounds;

        if (nearestEnemy) {
            // Ângulo em direção ao inimigo
            moveAngle = Phaser.Math.Angle.Between(this.x, this.y, nearestEnemy.x, nearestEnemy.y);
        } else {
            // Nenhum inimigo ativo → mantém o comportamento de vagar
            this.wanderTimer -= delta;
            if (this.wanderTimer <= 0) {
                this.wanderAngle = Math.random() * Math.PI * 2;
                this.setRandomTimer();
            }
            moveAngle = this.wanderAngle;
        }

        // --- EVASÃO DE BORDAS (evita que saiam do mapa) ---
        if (this.x < margin && Math.cos(moveAngle) < 0) {
            moveAngle = 0; // força ir para direita
        } else if (this.x > bounds.width - margin && Math.cos(moveAngle) > 0) {
            moveAngle = Math.PI; // força ir para esquerda
        }

        if (this.y < margin && Math.sin(moveAngle) < 0) {
            moveAngle = Math.PI / 2; // força ir para baixo
        } else if (this.y > bounds.height - margin && Math.sin(moveAngle) > 0) {
            moveAngle = -Math.PI / 2; // força ir para cima
        }

        // Aplica velocidade reduzida (25% do speed do rank, conforme original)
        const speed = this._currentRank.speed * 0.25;
        const vx = Math.cos(moveAngle) * speed;
        const vy = Math.sin(moveAngle) * speed;
        this.setVelocity(vx, vy);

        // Orientação do sprite durante o movimento
        if (vx < 0) this.setFlipX(true);
        else if (vx > 0) this.setFlipX(false);

        // --- LÓGICA DE ATAQUE (MANTIDA COMO ESTAVA) ---
        this._attackCooldown -= delta;
        if (this._attackCooldown <= 0) {
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

        // Garante que o bot ataque virado para o inimigo mais próximo
        let closestEnemy = null;
        let closestDist = Infinity;
        for (const enemy of enemies.getChildren()) {
            if (!enemy.active) continue;
            const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
            if (dist < closestDist) {
                closestDist = dist;
                closestEnemy = enemy;
            }
        }

        if (closestEnemy) {
            this.setFlipX(closestEnemy.x < this.x);
        }

        this.performAttack(enemies);
    }
}