import PlayerBase from './PlayerBase.js';
import { RANKS, attackHalfBand, attackReach } from '../constants/Hierarchy.js';

/**
 * Tempo mínimo entre dois golpes do mesmo bot. Espelha
 * `BOT_ATTACK_COOLDOWN_MS` do servidor — era 2000 ms.
 */
const ATTACK_COOLDOWN_MS = 700;

/**
 * Golpes por segundo que o bot tenta desferir com alvo ao alcance.
 *
 * Taxa por SEGUNDO, não chance por quadro: a conversão usa o delta real, então
 * a agressividade não muda com a taxa de quadros. Antes era `0.02` por quadro,
 * que a 60 fps dava um comportamento e a 30 fps outro.
 */
const ATTACK_RATE_PER_SECOND = 3;

/** Folga somada ao alcance: o alvo se mexe durante os 200 ms do golpe. */
const ATTACK_RANGE_SLACK = 20;

export default class AIPlayer extends PlayerBase {
    constructor(scene, x, y, team) {
        const debugColor = team === 'ally' ? 0x00ff00 : 0xff0000;
        super(scene, x, y, RANKS.PAWN.key, team, debugColor);

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
            this.commonUpdate(delta);
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

        // --- ATAQUE ---
        this._attackCooldown -= delta;
        if (this._attackCooldown <= 0 && nearestEnemy && this.canHit(nearestEnemy)) {
            // Taxa por segundo convertida na chance deste quadro.
            const chance = 1 - Math.exp(-ATTACK_RATE_PER_SECOND * (delta / 1000));
            if (Math.random() < chance) {
                this.attack(nearestEnemy, enemies);
                this._attackCooldown = ATTACK_COOLDOWN_MS;
            }
        }

        this.commonUpdate(delta);
    }

    /**
     * O golpe tem chance real de acertar este alvo?
     *
     * Reproduz de forma barata o que `executeAttackHit` testaria: distância
     * dentro do alcance do rank e — para os golpes retos — alvo na faixa à
     * frente. Antes eram 100 px fixos para todo rank, medidos de `x`/`y` em vez
     * do centro da elipse de onde o dano realmente sai.
     */
    canHit(enemy) {
        if (enemy._isInvulnerable) return false; // só gastaria o cooldown

        const from = this.getEllipseCenter();
        const to = enemy.getEllipseCenter();
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        const reach = this.collisionRx + attackReach(this._currentRank)
            + enemy.collisionRx + ATTACK_RANGE_SLACK;
        // Compara os quadrados: dispensa a raiz quadrada a cada quadro.
        if (dx * dx + dy * dy > reach * reach) return false;

        // `Infinity` nos golpes radiais passa direto, sem ramificação extra.
        return Math.abs(dy) <= attackHalfBand(this._currentRank) + enemy.collisionRy;
    }

    /**
     * @param {PlayerBase} target Alvo já escolhido por `aiUpdate` — antes este
     *        método varria o grupo de novo só para descobrir o mesmo inimigo.
     * @param {Phaser.GameObjects.Group} enemies Grupo passado ao `performAttack`.
     */
    attack(target, enemies) {
        if (this._isAttacking) return;
        this.setFlipX(target.x < this.x);
        this.performAttack(enemies);
    }
}