import { RANKS, COLLISION_ELLIPSE } from '../constants/Hierarchy.js';

export default class PlayerBase extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, textureKey, team, debugColor) {
        super(scene, x, y, textureKey);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.initPhysics();

        this._currentRank = RANKS.PAWN;
        this._isAttacking = false;
        this._isInvulnerable = false;
        this.wasWalking = false;
        this._walkTween = null;

        this.maxHealth = this._currentRank.health;
        this.currentHealth = this.maxHealth;

        this.healthBar = this.scene.add.graphics();
        this.healthBar.setDepth(1000);

        this.debugGraphics = this.scene.add.graphics();
        this.debugGraphics.setDepth(1000);

        // Gráfico para a área de ataque (placeholder)
        this.attackGraphics = this.scene.add.graphics();
        this.attackGraphics.setDepth(1000);

        this.debugColor = debugColor || 0xffffff;
        this.team = team; // 'human', 'ally', 'enemy'

        // Conjunto para evitar múltiplos acertos no mesmo ataque
        this._attackHitEnemies = new Set();
        // Grupo inimigo alvo do ataque atual
        this._attackEnemyGroup = null;
    }

    initPhysics() {
        this.setCollideWorldBounds(true);

        const { RX, RY } = COLLISION_ELLIPSE;
        this.body.setSize(RX * 2, RY * 2);
        this.body.setOffset(0, 48);
    }

    promote() {
        const nextRankKey = this._currentRank.next;
        this.setRank(RANKS[nextRankKey]);

        this.maxHealth = this._currentRank.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

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

    takeDamage(amount) {
        if (this._isInvulnerable) return;

        this.currentHealth -= amount;
        this.updateHealthBar();

        if (this.currentHealth <= 0) {
            this.die();
        } else {
            this._isInvulnerable = true;
            this.scene.time.delayedCall(500, () => {
                this._isInvulnerable = false;
            });
        }
    }

    die() {
        // Será sobrescrito pelas subclasses
        this.resetToPawn();
        this.maxHealth = RANKS.PAWN.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();
    }

    createHealthBar() {
        const barWidth = 40;
        const barHeight = 5;
        const x = this.x - barWidth / 2;
        const y = this.y - 70;

        this.healthBar.clear();

        this.healthBar.fillStyle(0x000000, 0.7);
        this.healthBar.fillRect(x, y, barWidth, barHeight);

        const healthPercent = Math.max(0, this.currentHealth / this.maxHealth);
        this.healthBar.fillStyle(0xff0000, 1);
        this.healthBar.fillRect(x, y, barWidth * healthPercent, barHeight);
    }

    updateHealthBar() {
        this.createHealthBar();
    }

    drawDebugHitbox() {
        this.debugGraphics.clear();

        const centerX = this.x;
        const centerY = this.y + 48;

        const { RX: baseRx, RY: baseRy } = COLLISION_ELLIPSE;

        const thick = 3;
        const mid = 2;
        const thin = 2;

        this.debugGraphics.lineStyle(thick, 0x000000, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, baseRx * 2, baseRy * 2);

        const midRx = baseRx - (thick / 2 + mid / 2);
        const midRy = baseRy - (thick / 2 + mid / 2);
        this.debugGraphics.lineStyle(mid, this.debugColor, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, midRx * 2, midRy * 2);

        const innerRx = midRx - (mid / 2 + thin / 2);
        const innerRy = midRy - (mid / 2 + thin / 2);
        this.debugGraphics.lineStyle(thin, 0x000000, 1);
        this.debugGraphics.strokeEllipse(centerX, centerY, innerRx * 2, innerRy * 2);
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    commonUpdate() {
        this.setDepth(this.y);
        this.debugGraphics.setDepth(this.y - 1);
        this.healthBar.setDepth(this.y + 100);
        this.drawDebugHitbox();
        this.updateHealthBar();

        // Redesenha a área de ataque a cada frame enquanto ataca
        if (this._isAttacking && this._attackEnemyGroup) {
            this.drawAttackVisual(this._attackEnemyGroup);
        }
    }

    // -------------------------------------------------------------------
    // NOVO SISTEMA DE ATAQUE
    // -------------------------------------------------------------------

    /**
     * Retorna o centro da elipse de colisão (pés do personagem).
     */
    getEllipseCenter() {
        return { x: this.x, y: this.y + 48 };
    }

    /**
     * Inicia o ataque.
     * @param {Phaser.Physics.Arcade.Group} enemyGroup grupo de inimigos a atingir
     */
    performAttack(enemyGroup) {
        if (this._isAttacking) return;
        this._isAttacking = true;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = enemyGroup;

        // Após 200ms, executa a verificação de acerto e finaliza
        this.scene.time.delayedCall(200, () => {
            this.executeAttackHit(enemyGroup);
            this.finishAttack();
        });
    }

    /**
     * Desenha a área de ataque de acordo com o rank atual (chamado a cada frame).
     */
    drawAttackVisual(enemyGroup) {
        const atk = this._currentRank.attack;
        const ellipse = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const ellipseRX = COLLISION_ELLIPSE.RX;
        const startX = ellipse.x + dir * ellipseRX;
        const startY = ellipse.y;

        this.attackGraphics.clear();

        switch (atk.type) {
            case 'rectangle': {
                const w = atk.length;
                const h = atk.width;
                const x = dir === 1 ? startX : startX - w;
                const y = startY - h / 2;

                this.attackGraphics.fillStyle(0xff0000, 0.4);
                this.attackGraphics.fillRect(x, y, w, h);
                this.attackGraphics.lineStyle(2, 0xff0000);
                this.attackGraphics.strokeRect(x, y, w, h);
                break;
            }

            case 'circle': {
                this.attackGraphics.lineStyle(3, 0xff0000, 0.6);
                this.attackGraphics.strokeCircle(ellipse.x, ellipse.y, atk.radius);
                break;
            }

            case 'lshape': {
                // Segmento frontal (horizontal)
                const forwardEndX = startX + dir * atk.forwardLength;
                const forwardEndY = startY; // mesmo Y, pois é horizontal
                const forwardW = atk.forwardLength;
                const forwardH = atk.width;
                const forwardX = dir === 1 ? startX : startX - forwardW;
                const forwardY = startY - forwardH / 2;

                this.attackGraphics.fillStyle(0xff0000, 0.4);
                this.attackGraphics.fillRect(forwardX, forwardY, forwardW, forwardH);
                this.attackGraphics.lineStyle(2, 0xff0000);
                this.attackGraphics.strokeRect(forwardX, forwardY, forwardW, forwardH);

                // Determina direção do segmento lateral baseada no inimigo mais próximo
                let sideSignY = 1;
                if (enemyGroup) {
                    let nearest = null;
                    let minDist = Infinity;
                    for (const e of enemyGroup.getChildren()) {
                        if (!e.active) continue;
                        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
                        if (d < minDist) {
                            minDist = d;
                            nearest = e;
                        }
                    }
                    if (nearest) {
                        sideSignY = nearest.y > this.y ? 1 : -1;
                    }
                }

                // Segmento lateral (vertical)
                const sideLength = atk.sideLength;
                const sideW = atk.width;
                const sideH = sideLength;
                const sideX = forwardEndX - sideW / 2;
                const sideY = forwardEndY + (sideSignY * sideLength / 2) - sideH / 2;

                this.attackGraphics.fillRect(sideX, sideY, sideW, sideH);
                this.attackGraphics.strokeRect(sideX, sideY, sideW, sideH);
                break;
            }
        }
    }

    /**
     * Verifica quais inimigos estão na área de ataque e aplica dano.
     */
    executeAttackHit(enemyGroup) {
        const atk = this._currentRank.attack;
        const ellipse = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const ellipseRX = COLLISION_ELLIPSE.RX;
        const startX = ellipse.x + dir * ellipseRX;
        const startY = ellipse.y;

        switch (atk.type) {
            case 'rectangle': {
                const w = atk.length;
                const h = atk.width;
                const x = dir === 1 ? startX : startX - w;
                const y = startY - h / 2;
                this.checkZoneOverlap(x, y, w, h, enemyGroup);
                break;
            }

            case 'circle': {
                for (const enemy of enemyGroup.getChildren()) {
                    if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;
                    const dist = Phaser.Math.Distance.Between(ellipse.x, ellipse.y, enemy.x, enemy.y);
                    if (dist <= atk.radius) {
                        this.applyDamageToEnemy(enemy);
                    }
                }
                break;
            }

            case 'lshape': {
                // Segmento frontal
                const forwardEndX = startX + dir * atk.forwardLength;
                const forwardEndY = startY;
                const forwardW = atk.forwardLength;
                const forwardH = atk.width;
                const forwardX = dir === 1 ? startX : startX - forwardW;
                const forwardY = startY - forwardH / 2;
                this.checkZoneOverlap(forwardX, forwardY, forwardW, forwardH, enemyGroup);

                // Determina direção lateral da mesma forma que no visual
                let sideSignY = 1;
                if (enemyGroup) {
                    let nearest = null;
                    let minDist = Infinity;
                    for (const e of enemyGroup.getChildren()) {
                        if (!e.active) continue;
                        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
                        if (d < minDist) {
                            minDist = d;
                            nearest = e;
                        }
                    }
                    if (nearest) {
                        sideSignY = nearest.y > this.y ? 1 : -1;
                    }
                }

                const sideLength = atk.sideLength;
                const sideW = atk.width;
                const sideH = sideLength;
                const sideX = forwardEndX - sideW / 2;
                const sideY = forwardEndY + (sideSignY * sideLength / 2) - sideH / 2;

                this.checkZoneOverlap(sideX, sideY, sideW, sideH, enemyGroup);
                break;
            }
        }
    }

    /**
     * Cria uma zona temporária e verifica sobreposição com o grupo inimigo.
     */
    checkZoneOverlap(x, y, w, h, enemyGroup) {
        const zone = this.scene.add.zone(x + w / 2, y + h / 2, w, h);
        this.scene.physics.add.existing(zone, false);

        this.scene.physics.overlap(zone, enemyGroup, (z, enemy) => {
            if (enemy.active && !this._attackHitEnemies.has(enemy)) {
                this.applyDamageToEnemy(enemy);
            }
        });

        this.scene.time.delayedCall(0, () => zone.destroy());
    }

    /**
     * Aplica dano a um inimigo e controla promoção.
     */
    applyDamageToEnemy(enemy) {
        this._attackHitEnemies.add(enemy);
        enemy.takeDamage(25);
        if (enemy.currentHealth <= 0) {
            this.promote();   // promove se matou
        }
    }

    /**
     * Finaliza o ataque: limpa gráficos e libera o estado.
     */
    finishAttack() {
        this.attackGraphics.clear();
        this._isAttacking = false;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = null;
    }
}