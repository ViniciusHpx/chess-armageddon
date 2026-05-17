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

        this.debugColor = debugColor || 0xffffff;
        this.team = team; // 'human', 'ally', 'enemy'
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
        // Deve ser sobrescrito pelas subclasses
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
    }
}