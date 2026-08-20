import { RANKS, RANK_ORDER, AURA_THRESHOLDS } from '../constants/Hierarchy.js';

/**
 * Personagem no modo ONLINE: só desenho.
 *
 * Ao contrário de `PlayerBase`, esta classe não tem física, IA, vida nem
 * ataque — quem decide tudo isso é o servidor. Aqui só chega o `ActorState` do
 * schema e vira pixels: sprite, barra de vida, hitbox, aura, brilho de carga e
 * a forma do golpe.
 *
 * Por isso estende `GameObjects.Sprite` (e não `Physics.Arcade.Sprite`): sem
 * corpo Arcade não há uma segunda simulação para divergir da do servidor.
 */
export default class ArenaActor extends Phaser.GameObjects.Sprite {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} actorState Entrada do MapSchema vinda do servidor.
     * @param {boolean} isLocal Se é o personagem controlado por este cliente.
     * @param {boolean} isOpponent Se está no time adversário ao do jogador local.
     */
    constructor(scene, actorState, isLocal, isOpponent) {
        const rank = RANKS[RANK_ORDER[actorState.rank]];
        super(scene, actorState.x, actorState.y, rank.key);

        scene.add.existing(this);

        this.actorState = actorState;
        this.isLocal = isLocal;
        this.isOpponent = isOpponent;

        this._rankKey = RANK_ORDER[actorState.rank];
        this.debugColor = isLocal ? 0xffff00 : (isOpponent ? 0xff0000 : 0x00ff00);

        this.healthBar = scene.add.graphics();
        this.debugGraphics = scene.add.graphics();
        this.attackGraphics = scene.add.graphics();
        this.chargeGlowGraphics = scene.add.graphics();

        // Emissor de aura. A textura 'aura-particle' é criada uma única vez
        // pela cena — aqui só é consumida.
        this.auraEmitter = scene.add.particles(0, 0, 'aura-particle', {
            follow: this,
            followOffset: { x: 0, y: -10 },
            speed: { min: 30, max: 80 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.6, end: 0 },
            alpha: { start: 0.7, end: 0 },
            lifespan: { min: 400, max: 800 },
            frequency: 150,
            blendMode: 'ADD',
            emitting: false
        });
        this._auraEmitterActive = false;

        this.nameLabel = scene.add.text(0, 0, actorState.name, {
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            color: isLocal ? '#ffff00' : '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        // Posição suavizada. O servidor manda 20 correções por segundo; o jogo
        // desenha a 60 fps, então cada quadro caminha um pouco em direção ao
        // último valor recebido em vez de saltar.
        this.renderX = actorState.x;
        this.renderY = actorState.y;

        this.applyRank();
        this.applyTeamTint();
    }

    get rank() {
        return RANKS[this._rankKey];
    }

    get collisionRx() {
        return 50 * (this.rank.size.width / 128);
    }

    get collisionRy() {
        return 25 * (this.rank.size.height / 128);
    }

    /**
     * Centro da elipse de colisão. Mesma fórmula de `Actor.ellipseCenter()` no
     * servidor — se as duas divergirem, o golpe acerta fora do desenho.
     */
    getEllipseCenter() {
        return {
            x: this.x,
            y: this.y + this.rank.size.height / 2 - this.collisionRx + (this.collisionRy * 4) / 3
        };
    }

    applyRank() {
        this.setTexture(this.rank.key);
    }

    /** Adversários levam tint rosado; o time do jogador local fica natural. */
    applyTeamTint() {
        if (this.isOpponent) this.setTint(0xFBA1AD);
        else this.clearTint();
    }

    // -----------------------------------------------------------------------
    // SINCRONIZAÇÃO
    // -----------------------------------------------------------------------

    /**
     * @param {number} delta ms desde o quadro anterior.
     * @param {?{x: number, y: number}} predicted Posição prevista localmente;
     *        só o personagem do próprio jogador recebe uma.
     */
    sync(delta, predicted) {
        const s = this.actorState;

        const rankKey = RANK_ORDER[s.rank];
        if (rankKey !== this._rankKey) {
            this._rankKey = rankKey;
            this.applyRank();
            this.applyTeamTint();
            // Piscada verde na promoção (era `promote()` no offline).
            this.setTintFill(0x00ff00);
            this.scene.time.delayedCall(120, () => this.applyTeamTint());
        }

        if (!s.alive) {
            this.setVisible(false);
            this.setVisualsVisible(false);
            return;
        }

        this.setVisible(true);
        this.setVisualsVisible(true);

        if (predicted) {
            this.renderX = predicted.x;
            this.renderY = predicted.y;
        } else {
            // Suavização exponencial independente do frame rate: com
            // SMOOTHING=0.25 por 16,7 ms, o erro cai ~75% a cada 60 ms.
            const t = 1 - Math.pow(1 - 0.25, delta / 16.67);
            this.renderX += (s.x - this.renderX) * t;
            this.renderY += (s.y - this.renderY) * t;
        }

        this.setPosition(this.renderX, this.renderY);
        this.setFlipX(s.flipX);
        this.setAlpha(s.invuln ? 0.55 : 1);

        this.commonUpdate();
    }

    // -----------------------------------------------------------------------
    // DESENHO (portado de PlayerBase, sem a parte de simulação)
    // -----------------------------------------------------------------------

    commonUpdate() {
        this.setDepth(this.y);
        this.debugGraphics.setDepth(this.y - 1);
        this.healthBar.setDepth(this.y + 100);
        this.auraEmitter.setDepth(this.y + 99);
        this.chargeGlowGraphics.setDepth(this.y + 101);
        this.nameLabel.setDepth(this.y + 102);

        this.drawDebugHitbox();
        this.drawHealthBar();
        this.updateAuraVisual();
        this.drawChargeGlow();
        this.drawNameLabel();

        this.attackGraphics.clear();
        if (this.actorState.attacking) this.drawAttackVisual();
    }

    drawNameLabel() {
        this.nameLabel.setPosition(this.x, this.y - 85);
    }

    drawHealthBar() {
        const barWidth = 40;
        const barHeight = 5;
        const x = this.x - barWidth / 2;
        const y = this.y - 70;

        this.healthBar.clear();
        this.healthBar.fillStyle(0x000000, 0.7);
        this.healthBar.fillRect(x, y, barWidth, barHeight);

        const maxHp = this.actorState.maxHp || 1;
        const percent = Math.max(0, this.actorState.hp / maxHp);
        this.healthBar.fillStyle(0xff0000, 1);
        this.healthBar.fillRect(x, y, barWidth * percent, barHeight);
    }

    drawDebugHitbox() {
        this.debugGraphics.clear();
        if (!this.scene.showHitboxes) return;

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

        this.debugGraphics.fillStyle(this.debugColor, 0.08);
        this.debugGraphics.fillEllipse(center.x, center.y, rx * 2, ry * 2);
    }

    updateAuraVisual() {
        const aura = this.actorState.aura;

        if (aura > 0 && !this._auraEmitterActive) {
            this.auraEmitter.start();
            this._auraEmitterActive = true;
        } else if (aura <= 0 && this._auraEmitterActive) {
            this.auraEmitter.stop();
            this._auraEmitterActive = false;
        }
        if (aura <= 0) return;

        let auraColor = AURA_THRESHOLDS[0].color;
        for (let i = AURA_THRESHOLDS.length - 1; i >= 0; i--) {
            if (aura >= AURA_THRESHOLDS[i].minAura) {
                auraColor = AURA_THRESHOLDS[i].color;
                break;
            }
        }
        this.auraEmitter.tint = auraColor;

        const maxAuraForFreq = 210;
        const ratio = Phaser.Math.Clamp(aura / maxAuraForFreq, 0, 1);
        this.auraEmitter.frequency = Phaser.Math.Linear(150, 50, ratio);
    }

    /**
     * Brilho de carga. O jogador local usa o próprio cronômetro (`localCharge`)
     * para o brilho responder no mesmo quadro do clique; os outros usam o
     * progresso que veio do servidor.
     */
    drawChargeGlow() {
        this.chargeGlowGraphics.clear();

        const charging = this.isLocal ? this.localCharging : this.actorState.charging;
        if (!charging) return;

        const ratio = Phaser.Math.Clamp(
            this.isLocal ? this.localChargeRatio : this.actorState.chargeRatio / 100,
            0, 1
        );

        const x = this.x + 20;
        const y = this.y - 50;
        const g = Phaser.Math.Linear(255, 0, ratio);
        const color = Phaser.Display.Color.GetColor(255, g, g);

        this.chargeGlowGraphics.fillStyle(color, 0.9);
        this.chargeGlowGraphics.fillCircle(x, y, 8);
        this.chargeGlowGraphics.lineStyle(1, color, 1);
        this.chargeGlowGraphics.strokeCircle(x, y, 8);
    }

    /**
     * Forma do golpe. Precisa bater com `World.executeAttackHit()` no servidor:
     * é a mesma geometria, uma desenhando e a outra causando dano.
     */
    drawAttackVisual() {
        const atk = this.rank.attack;
        const center = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const startX = center.x + dir * this.collisionRx;
        const startY = center.y;
        const mult = this.actorState.charged ? 2 : 1;

        const g = this.attackGraphics;
        g.setDepth(this.y + 1);

        switch (atk.type) {
            case 'rectangle': {
                const w = atk.length * mult;
                const h = atk.width * mult;
                const x = dir === 1 ? startX : startX - w;
                const y = startY - h / 2;

                g.fillStyle(0xff0000, 0.4);
                g.fillRect(x, y, w, h);
                g.lineStyle(2, 0xff0000);
                g.strokeRect(x, y, w, h);
                break;
            }

            case 'circle': {
                g.lineStyle(3, 0xff0000, 0.6);
                g.strokeCircle(center.x, center.y, atk.radius * mult);
                break;
            }

            case 'lshape': {
                const forwardLength = atk.forwardLength * mult;
                const sideLength = atk.sideLength * mult;
                const width = atk.width * mult;

                const forwardX = dir === 1 ? startX : startX - forwardLength;
                const forwardY = startY - width / 2;

                g.fillStyle(0xff0000, 0.4);
                g.fillRect(forwardX, forwardY, forwardLength, width);
                g.lineStyle(2, 0xff0000);
                g.strokeRect(forwardX, forwardY, forwardLength, width);

                // O lado da perna do L vem do servidor, congelado no início do
                // golpe — não é recalculado aqui.
                const forwardEndX = startX + dir * forwardLength;
                const sideX = forwardEndX - width / 2;
                const sideY = startY + (this.actorState.atkSide * sideLength) / 2 - sideLength / 2;

                g.fillRect(sideX, sideY, width, sideLength);
                g.strokeRect(sideX, sideY, width, sideLength);
                break;
            }

            case 'diamond': {
                const radius = atk.radius * mult;
                const cx = center.x;
                const cy = center.y;

                g.fillStyle(0xff0000, 0.4);
                g.beginPath();
                g.moveTo(cx, cy - radius);
                g.lineTo(cx + radius, cy);
                g.lineTo(cx, cy + radius);
                g.lineTo(cx - radius, cy);
                g.closePath();
                g.fillPath();
                g.lineStyle(2, 0xff0000);
                g.strokePath();
                break;
            }
        }
    }

    /**
     * Liga/desliga os Graphics. Cada um guarda o último desenho, então some o
     * sprite sem isto e as barras continuam flutuando na tela.
     */
    setVisualsVisible(visible) {
        this.healthBar.setVisible(visible);
        this.debugGraphics.setVisible(visible);
        this.attackGraphics.setVisible(visible);
        this.chargeGlowGraphics.setVisible(visible);
        this.auraEmitter.setVisible(visible);
        this.nameLabel.setVisible(visible);
    }

    destroy(fromScene) {
        this.healthBar.destroy();
        this.debugGraphics.destroy();
        this.attackGraphics.destroy();
        this.chargeGlowGraphics.destroy();
        this.auraEmitter.destroy();
        this.nameLabel.destroy();
        super.destroy(fromScene);
    }
}
