import { RANKS, AURA_KILL_VALUES, AURA_THRESHOLDS } from '../constants/Hierarchy.js';

export default class PlayerBase extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, textureKey, team, debugColor) {
        super(scene, x, y, textureKey);

        scene.add.existing(this);
        scene.physics.add.existing(this);

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

        this.attackGraphics = this.scene.add.graphics();
        this.attackGraphics.setDepth(1000);

        // Aura visual
        this.auraGraphics = this.scene.add.graphics();
        this.auraGraphics.setDepth(999);

        // Brilho de carga (canto superior direito)
        this.chargeGlowGraphics = this.scene.add.graphics();
        this.chargeGlowGraphics.setDepth(1001);

        this.debugColor = debugColor || 0xffffff;
        this.team = team;

        this._attackHitEnemies = new Set();
        this._attackEnemyGroup = null;

        // Sistema de aura
        this.aura = 0;

        // Flag para ataque carregado
        this._isChargedAttack = false;

        // Flag visual de carga (usado pela subclasse humana)
        this._isCharging = false;

        // Propriedades da elipse de colisão (definidas por applyRankPhysics)
        this.collisionRx = 50;
        this.collisionRy = 25;

        // Configura o corpo físico com a elipse inicial
        this.initPhysics();
        this.applyRankPhysics(this._currentRank);
    }

    initPhysics() {
        this.setCollideWorldBounds(true);
        // O tamanho e offset serão definidos em applyRankPhysics
    }

    /**
     * Calcula as dimensões da elipse de colisão com base no tamanho do personagem
     * e atualiza o corpo físico para que seu centro coincida com os pés.
     * MODIFICAÇÃO: O centro da elipse agora é deslocado para cima pelo valor de collisionRx
     */
    applyRankPhysics(rankConfig) {
        if (!this.body) return;

        const size = rankConfig.size;

        // Escala proporcional ao sprite original (128×128 → rx=50, ry=25)
        const baseRX = 50;
        const baseRY = 25;
        const baseW = 128;
        const baseH = 128;

        const scaleX = size.width / baseW;
        const scaleY = size.height / baseH;
        this.collisionRx = baseRX * scaleX;
        this.collisionRy = baseRY * scaleY;

        // Posição do centro da elipse: pés do personagem SUBINDO pelo collisionRx
        const feetX = size.width / 2;          // centro horizontal relativo ao sprite
        const feetY = size.height;             // base (pés) relativo ao sprite
        
        // AQUI ESTÁ A MODIFICAÇÃO: subimos o centro da elipse pelo valor de collisionRx
        const offsetX = feetX - this.collisionRx;
        const offsetY = (feetY - this.collisionRx) + (this.collisionRy / 3); // subindo pelo collisionRx

        this.body.setSize(this.collisionRx * 2, this.collisionRy * 2);
        this.body.setOffset(offsetX, offsetY);
    }

    promote() {
        const nextRankKey = this._currentRank.next;
        if (!nextRankKey) return; // rainha não promove
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
        this.applyRankPhysics(rankConfig);
    }

    resetToPawn() {
        this.setRank(RANKS.PAWN);
    }

    /**
     * Aplica dano. Retorna true se a entidade morreu.
     */
    takeDamage(amount) {
        if (this._isInvulnerable) return false;

        this.currentHealth -= amount;
        this.updateHealthBar();

        if (this.currentHealth <= 0) {
            this.die();
            return true;
        } else {
            this._isInvulnerable = true;
            this.scene.time.delayedCall(500, () => {
                this._isInvulnerable = false;
            });
            return false;
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

    /**
     * Desenha a elipse de debug (hitbox) na posição correta do corpo físico.
     */
    drawDebugHitbox() {
        this.debugGraphics.clear();
        const center = this.getEllipseCenter();
        const rx = this.collisionRx;
        const ry = this.collisionRy;

        if (rx <= 0 || ry <= 0) return;

        const thick = 3;
        const mid = 2;
        const thin = 2;

        this.debugGraphics.lineStyle(thick, 0x000000, 1);
        this.debugGraphics.strokeEllipse(center.x, center.y, rx * 2, ry * 2);

        const midRx = rx - (thick / 2 + mid / 2);
        const midRy = ry - (thick / 2 + mid / 2);
        if (midRx > 0 && midRy > 0) {
            this.debugGraphics.lineStyle(mid, this.debugColor, 1);
            this.debugGraphics.strokeEllipse(center.x, center.y, midRx * 2, midRy * 2);
        }

        const innerRx = midRx - (mid / 2 + thin / 2);
        const innerRy = midRy - (mid / 2 + thin / 2);
        if (innerRx > 0 && innerRy > 0) {
            this.debugGraphics.lineStyle(thin, 0x000000, 1);
            this.debugGraphics.strokeEllipse(center.x, center.y, innerRx * 2, innerRy * 2);
        }

        // Preenchimento leve para visualização
        this.debugGraphics.fillStyle(this.debugColor, 0.08);
        this.debugGraphics.fillEllipse(center.x, center.y, rx * 2, ry * 2);
    }

    setSkin(skinKey) {
        this.setTexture(skinKey);
    }

    /**
     * Adiciona aura ao matar um inimigo, baseado no rank dele.
     */
    addAuraFromKill(enemy) {
        const rankKey = enemy._currentRank.key;
        const auraValue = AURA_KILL_VALUES[rankKey] || 10;
        this.aura += auraValue;
    }

    /**
     * Reseta a aura para 0 (morte / respawn).
     */
    resetAura() {
        this.aura = 0;
    }

    /**
     * Desenha o efeito de aura de acordo com o nível atual.
     */
    drawAura() {
        this.auraGraphics.clear();
        if (this.aura <= 0) return;

        let auraColor = AURA_THRESHOLDS[0].color;
        for (let i = AURA_THRESHOLDS.length - 1; i >= 0; i--) {
            if (this.aura >= AURA_THRESHOLDS[i].minAura) {
                auraColor = AURA_THRESHOLDS[i].color;
                break;
            }
        }

        const baseRadius = 30;
        const maxExtraRadius = 40;
        const maxAuraForSize = 210;
        const extraRadius = Math.min(this.aura, maxAuraForSize) / maxAuraForSize * maxExtraRadius;
        const radius = baseRadius + extraRadius;

        const center = this.getEllipseCenter();
        this.auraGraphics.fillStyle(auraColor, 0.15);
        this.auraGraphics.fillCircle(center.x, center.y, radius);
        this.auraGraphics.lineStyle(2, auraColor, 0.6);
        this.auraGraphics.strokeCircle(center.x, center.y, radius);
    }

    /**
     * Brilho vermelho enquanto está carregando o ataque.
     */
    drawChargeGlow() {
        this.chargeGlowGraphics.clear();
        if (!this._isCharging) return;

        const offsetX = 20;
        const offsetY = -50;
        const x = this.x + offsetX;
        const y = this.y + offsetY;

        this.chargeGlowGraphics.fillStyle(0xff0000, 0.9);
        this.chargeGlowGraphics.fillCircle(x, y, 8);
        this.chargeGlowGraphics.lineStyle(1, 0xff6666, 1);
        this.chargeGlowGraphics.strokeCircle(x, y, 8);
    }

    commonUpdate() {
        this.setDepth(this.y);
        this.debugGraphics.setDepth(this.y - 1);
        this.healthBar.setDepth(this.y + 100);
        this.auraGraphics.setDepth(this.y + 99);
        this.chargeGlowGraphics.setDepth(this.y + 101);

        this.drawDebugHitbox();
        this.updateHealthBar();
        this.drawAura();
        this.drawChargeGlow();

        if (this._isAttacking && this._attackEnemyGroup) {
            this.drawAttackVisual(this._attackEnemyGroup);
        }
    }

    // -------------------------------------------------------------------
    // SISTEMA DE ATAQUE (normal e carregado)
    // -------------------------------------------------------------------

    /**
     * Retorna o centro da elipse de colisão.
     * Se o corpo físico não estiver ativo, calcula a posição dos pés manualmente.
     */
    getEllipseCenter() {
        if (this.body && this.body.enable) {
            return { x: this.body.center.x, y: this.body.center.y };
        }
        // Fallback: centro horizontal = x, pés = y + metade da altura do sprite
        return {
            x: this.x,
            y: this.y + this.displayHeight / 2
        };
    }

    performAttack(enemyGroup) {
        if (this._isAttacking) return;
        this._isAttacking = true;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = enemyGroup;

        this.scene.time.delayedCall(200, () => {
            this.executeAttackHit(enemyGroup);
            this.finishAttack();
        });
    }

    drawAttackVisual(enemyGroup) {
        const atk = this._currentRank.attack;
        const center = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const startX = center.x + dir * this.collisionRx;
        const startY = center.y;

        const mult = this._isChargedAttack ? 2 : 1;

        this.attackGraphics.clear();

        switch (atk.type) {
            case 'rectangle': {
                const w = atk.length * mult;
                const h = atk.width * mult;
                const x = dir === 1 ? startX : startX - w;
                const y = startY - h / 2;

                this.attackGraphics.fillStyle(0xff0000, 0.4);
                this.attackGraphics.fillRect(x, y, w, h);
                this.attackGraphics.lineStyle(2, 0xff0000);
                this.attackGraphics.strokeRect(x, y, w, h);
                break;
            }

            case 'circle': {
                const radius = atk.radius * mult;
                this.attackGraphics.lineStyle(3, 0xff0000, 0.6);
                this.attackGraphics.strokeCircle(center.x, center.y, radius);
                break;
            }

            case 'lshape': {
                const forwardLength = atk.forwardLength * mult;
                const sideLength = atk.sideLength * mult;
                const width = atk.width * mult;

                const forwardEndX = startX + dir * forwardLength;
                const forwardEndY = startY;
                const forwardW = forwardLength;
                const forwardH = width;
                const forwardX = dir === 1 ? startX : startX - forwardW;
                const forwardY = startY - forwardH / 2;

                this.attackGraphics.fillStyle(0xff0000, 0.4);
                this.attackGraphics.fillRect(forwardX, forwardY, forwardW, forwardH);
                this.attackGraphics.lineStyle(2, 0xff0000);
                this.attackGraphics.strokeRect(forwardX, forwardY, forwardW, forwardH);

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

                const sideW = width;
                const sideH = sideLength;
                const sideX = forwardEndX - sideW / 2;
                const sideY = forwardEndY + (sideSignY * sideLength / 2) - sideH / 2;

                this.attackGraphics.fillRect(sideX, sideY, sideW, sideH);
                this.attackGraphics.strokeRect(sideX, sideY, sideW, sideH);
                break;
            }

            case 'diamond': {
                const radius = atk.radius * mult;
                const cx = center.x;
                const cy = center.y;

                this.attackGraphics.fillStyle(0xff0000, 0.4);
                this.attackGraphics.beginPath();
                this.attackGraphics.moveTo(cx, cy - radius);
                this.attackGraphics.lineTo(cx + radius, cy);
                this.attackGraphics.lineTo(cx, cy + radius);
                this.attackGraphics.lineTo(cx - radius, cy);
                this.attackGraphics.closePath();
                this.attackGraphics.fillPath();
                this.attackGraphics.lineStyle(2, 0xff0000);
                this.attackGraphics.strokePath();
                break;
            }
        }
    }

    executeAttackHit(enemyGroup) {
        const atk = this._currentRank.attack;
        const attackerCenter = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const startX = attackerCenter.x + dir * this.collisionRx;
        const startY = attackerCenter.y;

        const mult = this._isChargedAttack ? 2 : 1;
        const damage = this._isChargedAttack ? 50 : 25;

        switch (atk.type) {
            case 'rectangle': {
                const w = atk.length * mult;
                const h = atk.width * mult;
                const x = dir === 1 ? startX : startX - w;
                const y = startY - h / 2;
                const rect = { x, y, w, h };

                for (const enemy of enemyGroup.getChildren()) {
                    if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;
                    const enemyCenter = enemy.getEllipseCenter();
                    // CORREÇÃO: passar enemyCenter.x e enemyCenter.y separadamente
                    if (PlayerBase.rectangleOverlapsEllipse(rect, enemyCenter.x, enemyCenter.y, enemy.collisionRx, enemy.collisionRy)) {
                        this.applyDamageToEnemy(enemy, damage);
                    }
                }
                break;
            }

            case 'circle': {
                const radius = atk.radius * mult;
                for (const enemy of enemyGroup.getChildren()) {
                    if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;
                    const enemyCenter = enemy.getEllipseCenter();
                    if (PlayerBase.circleOverlapsEllipse(attackerCenter.x, attackerCenter.y, radius, enemyCenter.x, enemyCenter.y, enemy.collisionRx, enemy.collisionRy)) {
                        this.applyDamageToEnemy(enemy, damage);
                    }
                }
                break;
            }

            case 'lshape': {
                const forwardLength = atk.forwardLength * mult;
                const sideLength = atk.sideLength * mult;
                const width = atk.width * mult;

                const forwardEndX = startX + dir * forwardLength;
                const forwardEndY = startY;
                const forwardW = forwardLength;
                const forwardH = width;
                const forwardX = dir === 1 ? startX : startX - forwardW;
                const forwardY = startY - forwardH / 2;
                const forwardRect = { x: forwardX, y: forwardY, w: forwardW, h: forwardH };

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

                const sideW = width;
                const sideH = sideLength;
                const sideX = forwardEndX - sideW / 2;
                const sideY = forwardEndY + (sideSignY * sideLength / 2) - sideH / 2;
                const sideRect = { x: sideX, y: sideY, w: sideW, h: sideH };

                for (const enemy of enemyGroup.getChildren()) {
                    if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;
                    const enemyCenter = enemy.getEllipseCenter();
                    // CORREÇÃO: passar enemyCenter.x e enemyCenter.y separadamente
                    if (PlayerBase.rectangleOverlapsEllipse(forwardRect, enemyCenter.x, enemyCenter.y, enemy.collisionRx, enemy.collisionRy) ||
                        PlayerBase.rectangleOverlapsEllipse(sideRect, enemyCenter.x, enemyCenter.y, enemy.collisionRx, enemy.collisionRy)) {
                        this.applyDamageToEnemy(enemy, damage);
                    }
                }
                break;
            }

            case 'diamond': {
                const radius = atk.radius * mult;
                for (const enemy of enemyGroup.getChildren()) {
                    if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;
                    const enemyCenter = enemy.getEllipseCenter();
                    if (PlayerBase.diamondOverlapsEllipse(attackerCenter.x, attackerCenter.y, radius, enemyCenter.x, enemyCenter.y, enemy.collisionRx, enemy.collisionRy)) {
                        this.applyDamageToEnemy(enemy, damage);
                    }
                }
                break;
            }
        }
    }

    // ---------------------------------------------------------------
    // MÉTODOS ESTÁTICOS DE COLISÃO GEOMÉTRICA (usam a elipse do alvo)
    // ---------------------------------------------------------------

    static ellipseContainsPoint(px, py, cx, cy, rx, ry) {
        const dx = px - cx;
        const dy = py - cy;
        // pequena tolerância (0.001) para bordas
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.001;
    }

    static rectangleOverlapsEllipse(rect, ellipseCx, ellipseCy, rx, ry) {
        if (rx <= 0 || ry <= 0) return false;
        const closestX = Phaser.Math.Clamp(ellipseCx, rect.x, rect.x + rect.w);
        const closestY = Phaser.Math.Clamp(ellipseCy, rect.y, rect.y + rect.h);
        return PlayerBase.ellipseContainsPoint(closestX, closestY, ellipseCx, ellipseCy, rx, ry);
    }

    static circleOverlapsEllipse(circleCx, circleCy, radius, ellipseCx, ellipseCy, rx, ry) {
        if (rx <= 0 || ry <= 0) return false;
        const dx = ellipseCx - circleCx;
        const dy = ellipseCy - circleCy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return true;

        const angle = Math.atan2(dy, dx);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const ellipseRadius = (rx * ry) / Math.sqrt((ry * cosA) ** 2 + (rx * sinA) ** 2);
        return dist <= radius + ellipseRadius;
    }

    /**
     * Verifica sobreposição entre um losango (diamond) centrado em (dCx, dCy)
     * com "radius" (distância do centro a cada vértice) e uma elipse (alvo).
     * Usa a equivalência |dx+dy| ≤ r && |dx-dy| ≤ r.
     */
    static diamondOverlapsEllipse(dCx, dCy, radius, eCx, eCy, rx, ry) {
        if (rx <= 0 || ry <= 0) return false;
        const dx = eCx - dCx;
        const dy = eCy - dCy;
        const u = dx + dy;
        const v = dx - dy;

        // Teste rápido: se o centro da elipse já está dentro do losango
        if (Math.abs(u) <= radius && Math.abs(v) <= radius) {
            return true;
        }

        // Encontra o ponto mais próximo do losango ao centro da elipse
        const closestU = Phaser.Math.Clamp(u, -radius, radius);
        const closestV = Phaser.Math.Clamp(v, -radius, radius);

        // Converte de volta para coordenadas originais
        const closestX = (closestU + closestV) / 2 + dCx;
        const closestY = (closestU - closestV) / 2 + dCy;

        return PlayerBase.ellipseContainsPoint(closestX, closestY, eCx, eCy, rx, ry);
    }

    // ---------------------------------------------------------------

    applyDamageToEnemy(enemy, damage) {
        this._attackHitEnemies.add(enemy);
        const killed = enemy.takeDamage(damage);
        if (killed) {
            this.addAuraFromKill(enemy);
            this.promote();
        }
    }

    finishAttack() {
        this.attackGraphics.clear();
        this._isAttacking = false;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = null;
        this._isChargedAttack = false;
    }
}