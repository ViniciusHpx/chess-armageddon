import {
    levelFromRank, levelFromXp, rankKeyForLevel, XP_PER_KILL, XP_PER_LEVEL,
    attackRecoveryMs, attackWindupMs, chargeAreaMult, chargeDamage, chargePower,
    DASH_COOLDOWN_MS, DASH_DISTANCE, DASH_INVULN_MS, DASH_SPEED, DASH_TIMEOUT_MS,
    RANKS, AURA_KILL_VALUES, AURA_THRESHOLDS, skinKey,
    KNOCKBACK_DECAY_MS, KNOCKBACK_MIN_SPEED, knockbackSpeed
} from '../constants/Hierarchy.js';
import { playDashFx } from '../utils/DashFx.js';
import { paintChargeGlow } from '../utils/ChargeGlow.js';

export default class PlayerBase extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, textureKey, team, debugColor) {
        super(scene, x, y, textureKey);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this._currentRank = RANKS.PAWN;
        this._isAttacking = false;
        this._isInvulnerable = false;
        /** Experiência acumulada; o nível sai dela. Ver `addExperience`. */
        this.xp = 0;
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

        // Brilho de carga (canto superior direito)
        this.chargeGlowGraphics = this.scene.add.graphics();
        this.chargeGlowGraphics.setDepth(1001);

        this.debugColor = debugColor || 0xffffff;
        this.team = team;

        /**
         * Nome e placar da partida, lidos pelo painel do TAB. Sobrevivem à
         * morte e à promoção de propósito — só a aura zera ao morrer.
         */
        this.displayName = 'Anônimo';
        this.kills = 0;
        this.deaths = 0;

        // A peça veste a cor do time. Precisa vir depois de `this.team` e
        // antes de `applyRankPhysics`, que lê o tamanho do frame da textura.
        this.setTexture(skinKey(this._currentRank.key, this.team));

        this._attackHitEnemies = new Set();
        this._attackEnemyGroup = null;

        // Sistema de aura
        this.aura = 0;

        // Flag para ataque carregado
        /**
         * Potência do golpe em curso, de 0 (toque) a 1 (carga cheia).
         * Era o booleano `_isChargedAttack`; dano, área e empurrão saem dela.
         */
        this._chargePower = 0;
        /** Instante do impacto do golpe em curso (0 = nenhum). */
        this._attackHitAt = 0;
        /** Instante a partir do qual pode atacar ou carregar de novo. */
        this._attackReadyAt = 0;

        // Máquina de carga do ataque, compartilhada por humano e bot.
        this._isCharging = false;
        this._chargeRatio = 0;   // 0 a 1, progresso — alimenta o brilho
        this._chargeStartTime = 0;
        this._chargeComplete = false;

        // Propriedades da elipse de colisão (definidas por applyRankPhysics)
        this.collisionRx = 50;
        this.collisionRy = 25;

        // Empurrão em curso, em px/s. Somado à velocidade em `commonUpdate`,
        // depois que a entidade já definiu a dela — assim vale mesmo enquanto
        // o alvo ataca ou anda contra o golpe.
        this._knockbackVx = 0;
        this._knockbackVy = 0;

        // Dash / esquiva. Os instantes são do relógio da cena (`scene.time.now`),
        // como o resto dos temporizadores do modo offline.
        this._dashUntil = 0;
        this._dashReadyAt = 0;
        /** Distância que falta percorrer no dash, em px. */
        this._dashRemaining = 0;
        this._dashDirX = 0;
        this._dashDirY = 0;
        /** Invulnerabilidade do dash. Separada de `_isInvulnerable` para os
         *  `delayedCall` do dano e do respawn não cortarem uma a outra. */
        this._dashInvulnUntil = 0;

        // Inicializa o emissor de partículas da aura (se ainda não existir a textura)
        this._createAuraEmitter();

        // Configura o corpo físico com a elipse inicial
        this.initPhysics();
        this.applyRankPhysics(this._currentRank);
    }

    /**
     * Cria (ou recicla) a textura da partícula da aura e adiciona o emissor.
     */
    _createAuraEmitter() {
        const scene = this.scene;
        const textureKey = 'aura-particle';
        if (!scene.textures.exists(textureKey)) {
            const size = 8;
            const canvas = scene.textures.createCanvas(textureKey, size, size);
            const ctx = canvas.getContext();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            canvas.refresh();
        }

        this.auraEmitter = scene.add.particles(0, 0, textureKey, {
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
        this.auraEmitter.setDepth(this.y + 99);
        this._auraEmitterActive = false;
    }

    /**
     * Atualiza o emissor de partículas da aura com cor e taxa conforme o nível.
     */
    updateAuraVisual() {
        if (this.aura > 0 && !this._auraEmitterActive) {
            this.auraEmitter.start();
            this._auraEmitterActive = true;
        } else if (this.aura <= 0 && this._auraEmitterActive) {
            this.auraEmitter.stop();
            this._auraEmitterActive = false;
        }

        if (this.aura > 0) {
            let auraColor = AURA_THRESHOLDS[0].color;
            for (let i = AURA_THRESHOLDS.length - 1; i >= 0; i--) {
                if (this.aura >= AURA_THRESHOLDS[i].minAura) {
                    auraColor = AURA_THRESHOLDS[i].color;
                    break;
                }
            }

            this.auraEmitter.tint = auraColor;

            const maxAuraForFreq = 210;
            const baseFreq = 150;
            const minFreq = 50;
            const ratio = Phaser.Math.Clamp(this.aura / maxAuraForFreq, 0, 1);
            this.auraEmitter.frequency = Phaser.Math.Linear(baseFreq, minFreq, ratio);
        }
    }

    initPhysics() {
        // Desabilitamos a colisão automática com os limites do mundo,
        // pois agora usaremos clamping manual para manter o sprite inteiro dentro.
        this.body.setCollideWorldBounds(false);
    }

    applyRankPhysics(rankConfig) {
        if (!this.body) return;

        const size = rankConfig.size;

        const baseRX = 50;
        const baseRY = 25;
        const baseW = 128;
        const baseH = 128;

        const scaleX = size.width / baseW;
        const scaleY = size.height / baseH;
        this.collisionRx = baseRX * scaleX;
        this.collisionRy = baseRY * scaleY;

        const feetX = size.width / 2;
        const feetY = size.height;

        const offsetX = feetX - this.collisionRx;
        const offsetY = (feetY - this.collisionRx) + (this.collisionRy / 3);

        this.body.setSize(this.collisionRx * 2, this.collisionRy * 2);
        this.body.setOffset(offsetX, offsetY);
    }

    /** Nível atual, derivado do rank — não é guardado em lugar nenhum. */
    get level() {
        return levelFromRank(this._currentRank);
    }

    /**
     * Soma XP e sobe o rank se a XP total já der para isso. Ponto único de
     * progressão do modo offline, espelhando `Actor.addExperience`: a XP não é
     * gasta ao subir de nível, só acumula.
     *
     * @returns {boolean} true se o nível mudou.
     */
    addExperience(amount) {
        if (!(amount > 0)) return false;

        this.xp += amount;
        const nivel = levelFromXp(this.xp);
        if (nivel <= this.level) return false;

        this.setRank(RANKS[rankKeyForLevel(nivel)]);
        this.maxHealth = this._currentRank.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

        this.setTint(0x00ff00);
        this.scene.time.delayedCall(200, () => this.clearTint());
        return true;
    }

    setRank(rankConfig) {
        this._currentRank = rankConfig;
        this.setTexture(skinKey(rankConfig.key, this.team));
        this.applyRankPhysics(rankConfig);
    }

    /**
     * Perda ao morrer: o rank fica, a barra volta a zero.
     *
     * A XP cai para o piso do nível atual (a XP mínima do rank que já se tem),
     * espelhando `Actor.resetProgressOnDeath`. Zerar de verdade derrubaria o
     * rank no `addExperience` seguinte; não mexer tornaria a morte grátis.
     */
    resetProgressOnDeath() {
        this.xp = (this.level - 1) * XP_PER_LEVEL;
        this.maxHealth = this._currentRank.health;
        this.currentHealth = this.maxHealth;
        this.clearKnockback();
    }

    /**
     * Recebe o empurrão de um golpe.
     *
     * @param {PlayerBase} attacker Quem bateu; a direção sai do centro da
     *        elipse dele para a desta peça.
     * @param {number} power Potência do golpe, 0..1.
     */
    receiveKnockback(attacker, power) {
        const from = attacker.getEllipseCenter();
        const to = this.getEllipseCenter();
        let dx = to.x - from.x;
        let dy = to.y - from.y;
        let length = Math.hypot(dx, dy);

        // Centros praticamente coincidentes: sem direção definida, empurra
        // para onde o atacante está olhando.
        if (length < 1e-3) {
            dx = attacker.flipX ? -1 : 1;
            dy = 0;
            length = 1;
        }

        // O empurrão SUBSTITUI o anterior em vez de somar: golpes em sequência
        // não acumulam velocidade e ninguém sai arremessado por levar dois
        // acertos seguidos.
        const speed = knockbackSpeed(power, this.getCollisionMass());
        this._knockbackVx = (dx / length) * speed;
        this._knockbackVy = (dy / length) * speed;
    }

    clearKnockback() {
        this._knockbackVx = 0;
        this._knockbackVy = 0;
    }

    /**
     * Move a peça pelo empurrão do quadro e o faz decair.
     *
     * Recebe o `delta` da cena em vez de ler `scene.game.loop.delta`: o valor
     * do loop é 0 enquanto o jogo está pausado (aba em segundo plano), e usá-lo
     * deixava o empurrão congelado em vez de decair.
     *
     * Integra direto na POSIÇÃO, como o servidor, em vez de somar em
     * `body.velocity`: há caminhos que não redefinem a velocidade no quadro
     * (`AIPlayer.aiUpdate` retorna cedo enquanto o golpe está em curso), e ali
     * a soma se acumularia quadro após quadro até arremessar a peça.
     *
     * O decaimento é exponencial, então independe da taxa de quadros.
     */
    applyKnockback(deltaMs) {
        if (this._knockbackVx === 0 && this._knockbackVy === 0) return;
        if (!this.active || !this.body) return;
        if (!(deltaMs > 0)) return; // quadro sem tempo decorrido não move nada

        const dt = deltaMs / 1000;

        this.x += this._knockbackVx * dt;
        this.y += this._knockbackVy * dt;
        // Ressincroniza o corpo ainda neste quadro, como faz o CollisionResolver.
        this.body.updateFromGameObject();

        const decay = Math.exp(-deltaMs / KNOCKBACK_DECAY_MS);
        this._knockbackVx *= decay;
        this._knockbackVy *= decay;

        if (Math.hypot(this._knockbackVx, this._knockbackVy) < KNOCKBACK_MIN_SPEED) {
            this.clearKnockback();
        }
    }

    /**
     * Dá o impulso do dash, se a habilidade estiver pronta.
     *
     * Só define direção e prazos: quem move é `dashVelocity()`, chamada pelo
     * update da entidade. Assim o dash passa pelo mesmo caminho de sempre —
     * `setVelocity` → física → `CollisionResolver` → `clampToWorldBounds` — e
     * não atravessa ninguém nem sai do mapa.
     *
     * @param {number} dirX Direção desejada (não precisa ser unitária).
     * @param {number} dirY
     * @param {number} [cooldownMs] Cooldown próprio (bots usam um maior).
     * @returns {boolean} true se o dash começou.
     */
    startDash(dirX, dirY, cooldownMs = DASH_COOLDOWN_MS) {
        const now = this.scene.time.now;
        if (!this.active || now < this._dashReadyAt) return false;
        // Durante o golpe não: o dash arrastaria a hitbox do ataque para cima
        // do alvo depois do windup já ter começado.
        if (this._isAttacking) return false;

        let dx = dirX;
        let dy = dirY;
        if (dx === 0 && dy === 0) {
            dx = this.flipX ? -1 : 1;
            dy = 0;
        }
        const length = Math.hypot(dx, dy) || 1;

        this._dashDirX = dx / length;
        this._dashDirY = dy / length;
        this._dashUntil = now + DASH_TIMEOUT_MS;
        this._dashRemaining = DASH_DISTANCE;
        // O cooldown conta do INÍCIO: mexer na duração não muda a cadência.
        this._dashReadyAt = now + cooldownMs;
        this._dashInvulnUntil = now + DASH_INVULN_MS;

        // Carga em curso é cancelada: sair rolando com o golpe engatilhado
        // deixaria o alcance carregado de graça depois da esquiva.
        if (this._isCharging) this.cancelCharge();

        if (dx !== 0) this.setFlipX(dx < 0);

        playDashFx(this.scene, this, this._dashDirX, this._dashDirY);
        return true;
    }

    /**
     * Velocidade do dash neste quadro, ou `null` se não estiver em dash.
     *
     * A velocidade é limitada pelo que falta percorrer, então a distância total
     * é exatamente `DASH_DISTANCE` seja qual for a taxa de quadros — o último
     * quadro sai mais devagar em vez de passar do alvo.
     *
     * @param {number} deltaMs Delta do quadro, vindo do update da entidade.
     */
    dashVelocity(deltaMs) {
        if (!this.isDashing) return null;

        const dt = (deltaMs > 0 ? deltaMs : this.scene.game.loop.delta) / 1000;
        if (!(dt > 0)) return { vx: 0, vy: 0 };

        const speed = Math.min(DASH_SPEED, this._dashRemaining / dt);
        this._dashRemaining -= speed * dt;
        return { vx: this._dashDirX * speed, vy: this._dashDirY * speed };
    }

    get isDashing() {
        return this.scene.time.now < this._dashUntil && this._dashRemaining > 0;
    }

    /** Fração do cooldown do dash que ainda falta, 0..1 (0 = pronto). */
    dashCooldownRatio(cooldownMs = DASH_COOLDOWN_MS) {
        const falta = this._dashReadyAt - this.scene.time.now;
        if (falta <= 0) return 0;
        return Math.min(1, falta / cooldownMs);
    }

    /** Corta um dash em curso (morte, respawn). Não mexe no cooldown. */
    cancelDash() {
        this._dashUntil = 0;
        this._dashRemaining = 0;
        this._dashDirX = 0;
        this._dashDirY = 0;
    }

    /**
     * Invulnerável por qualquer motivo: dano recente/respawn
     * (`_isInvulnerable`) ou a janela do dash.
     */
    isInvulnerable() {
        return this._isInvulnerable || this.scene.time.now < this._dashInvulnUntil;
    }

    takeDamage(amount) {
        if (this.isInvulnerable()) return false;

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
        this.resetProgressOnDeath();
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

    addAuraFromKill(enemy) {
        const rankKey = enemy._currentRank.key;
        const auraValue = AURA_KILL_VALUES[rankKey] || 10;
        this.aura += auraValue;
    }

    resetAura() {
        this.aura = 0;
    }

    /** Indicador de carga; o desenho vive em `ChargeGlow.js`, usado nos dois modos. */
    drawChargeGlow() {
        this.chargeGlowGraphics.clear();
        if (!this._isCharging) return;

        paintChargeGlow(
            this.chargeGlowGraphics,
            this.x + 20,
            this.y - 50,
            this._chargeRatio,
            this.scene.time.now
        );
    }

    /**
     * Liga/desliga todos os Graphics e o emissor de aura da entidade.
     * Necessário ao esconder o personagem (morte), pois cada Graphics guarda
     * o último desenho e continuaria visível mesmo com o sprite invisível.
     */
    setVisualsVisible(visible) {
        this.healthBar.setVisible(visible);
        this.debugGraphics.setVisible(visible);
        this.attackGraphics.setVisible(visible);
        this.chargeGlowGraphics.setVisible(visible);
        this.auraEmitter.setVisible(visible);
    }

    /** @param {number} deltaMs Delta do quadro, vindo do `update` da cena. */
    commonUpdate(deltaMs = 0) {
        this.applyKnockback(deltaMs);

        this.setDepth(this.y);
        this.debugGraphics.setDepth(this.y - 1);
        this.healthBar.setDepth(this.y + 100);
        this.auraEmitter.setDepth(this.y + 99);
        this.chargeGlowGraphics.setDepth(this.y + 101);

        this.drawDebugHitbox();
        this.updateHealthBar();
        this.updateAuraVisual();
        this.drawChargeGlow();

        if (this._isAttacking && this._attackEnemyGroup) {
            this.drawAttackVisual(this._attackEnemyGroup);
        }
    }

    /**
     * Mantém o sprite inteiro dentro dos limites do mundo.
     * Deve ser chamado após a simulação física (ex.: no evento 'postupdate' da cena).
     */
    clampToWorldBounds() {
        const bounds = this.scene.physics.world.bounds;
        const halfW = this.displayWidth / 2;
        const halfH = this.displayHeight / 2;

        this.x = Phaser.Math.Clamp(this.x, bounds.x + halfW, bounds.right - halfW);
        this.y = Phaser.Math.Clamp(this.y, bounds.y + halfH, bounds.bottom - halfH);
    }

    // -------------------------------------------------------------------
    // SISTEMA DE ATAQUE
    // -------------------------------------------------------------------

    getEllipseCenter() {
        if (this.body && this.body.enable) {
            return { x: this.body.center.x, y: this.body.center.y };
        }
        return {
            x: this.x,
            y: this.y + this.displayHeight / 2
        };
    }

    /**
     * Peso usado pelo CollisionResolver: quanto maior, menos o personagem é
     * empurrado por quem esbarra nele.
     */
    getCollisionMass() {
        return this._currentRank.mass || 1;
    }

    performAttack(enemyGroup) {
        if (this._isAttacking) return;
        if (this.scene.time.now < this._attackReadyAt) return;
        this._isAttacking = true;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = enemyGroup;
        // Quando este golpe vai acertar. Serve de chave para a esquiva dos bots
        // (`AIPlayer.tryDodge`), que precisa saber se ainda dá tempo de reagir.
        // O atraso cresce com a carga: o toque rápido sai antes, o golpe cheio
        // se anuncia por mais tempo.
        const windup = attackWindupMs(this._chargePower);
        this._attackHitAt = this.scene.time.now + windup;
        // Recuperação depois do impacto: é o freio de spam e a desvantagem do
        // golpe carregado.
        this._attackReadyAt = this._attackHitAt + attackRecoveryMs(this._chargePower);

        this.scene.time.delayedCall(windup, () => {
            // Pode ter morrido/sido desativado durante o delay
            if (this.active) this.executeAttackHit(enemyGroup);
            this.finishAttack();
        });
    }

    drawAttackVisual(enemyGroup) {
        const atk = this._currentRank.attack;
        const center = this.getEllipseCenter();
        const dir = this.flipX ? -1 : 1;
        const startX = center.x + dir * this.collisionRx;
        const startY = center.y;

        const mult = chargeAreaMult(this._chargePower);

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

        // Área e dano da MESMA potência, os dois já com teto embutido
        // (AREA_MULT_MAX e DAMAGE_MAX). A geometria abaixo não mudou: continua
        // recebendo um multiplicador, agora fracionário.
        const mult = chargeAreaMult(this._chargePower);
        const damage = chargeDamage(this._chargePower);

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

    static ellipseContainsPoint(px, py, cx, cy, rx, ry) {
        const dx = px - cx;
        const dy = py - cy;
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

    static diamondOverlapsEllipse(dCx, dCy, radius, eCx, eCy, rx, ry) {
        if (rx <= 0 || ry <= 0) return false;
        const dx = eCx - dCx;
        const dy = eCy - dCy;
        const u = dx + dy;
        const v = dx - dy;

        if (Math.abs(u) <= radius && Math.abs(v) <= radius) {
            return true;
        }

        const closestU = Phaser.Math.Clamp(u, -radius, radius);
        const closestV = Phaser.Math.Clamp(v, -radius, radius);

        const closestX = (closestU + closestV) / 2 + dCx;
        const closestY = (closestU - closestV) / 2 + dCy;

        return PlayerBase.ellipseContainsPoint(closestX, closestY, eCx, eCy, rx, ry);
    }

    // -----------------------------------------------------------------------
    // CARGA DO ATAQUE
    //
    // Vive aqui, e não no `HumanPlayer`, porque o bot usa exatamente a mesma
    // máquina: o que muda entre os dois é só QUANDO cada um decide carregar.
    // -----------------------------------------------------------------------

    startCharging() {
        if (this._isAttacking || this._isCharging) return;
        // Recuperação do golpe anterior: segurar o botão sem parar não encadeia
        // golpes.
        if (this.scene.time.now < this._attackReadyAt) return;
        this._isCharging = true;
        this._chargeStartTime = this.scene.time.now;
        this._chargeComplete = false;
        this._chargeRatio = 0;
    }

    /** Avança o progresso da carga. Precisa rodar todo quadro enquanto carrega. */
    updateCharge() {
        if (!this._isCharging) return;

        const elapsed = this.scene.time.now - this._chargeStartTime;
        this._chargeRatio = Phaser.Math.Clamp(elapsed / this._currentRank.chargeTime, 0, 1);
        if (elapsed >= this._currentRank.chargeTime) this._chargeComplete = true;
    }

    /**
     * Solta a carga. A potência é contínua: um toque rápido sai em 0 (golpe
     * leve) e o `chargeTime` do rank cumprido sai em 1 (golpe máximo). Segurar
     * além disso não adianta — o teto está dentro de `chargePower`.
     *
     * @param {Phaser.GameObjects.Group} enemyGroup Alvos do golpe.
     */
    releaseCharge(enemyGroup) {
        if (!this._isCharging) return;

        const elapsed = this.scene.time.now - this._chargeStartTime;
        const power = chargePower(elapsed, this._currentRank.chargeTime);
        this.cancelCharge();

        if (this._isAttacking) return;

        this._chargePower = power;
        this.performAttack(enemyGroup);
    }

    /** Abandona a carga sem golpe nenhum. */
    cancelCharge() {
        this._isCharging = false;
        this._chargeComplete = false;
        this._chargeRatio = 0;
    }

    applyDamageToEnemy(enemy, damage) {
        this._attackHitEnemies.add(enemy);

        // Golpe que não conecta não empurra. Sem esta guarda, quem acabou de
        // renascer (ou de levar dano) seria arrastado pelo mapa sem perder
        // vida — `takeDamage` recusa o dano, mas o empurrão passaria.
        if (enemy.isInvulnerable()) return;

        const killed = enemy.takeDamage(damage);

        // Cada alvo é empurrado na SUA direção (deste atacante para ele), então
        // um golpe que pega três inimigos os espalha em leque, não em bloco.
        enemy.receiveKnockback(this, this._chargePower);

        if (killed) {
            this.addAuraFromKill(enemy);
            this.addExperience(XP_PER_KILL);
            this.kills++;
            enemy.deaths++;
        }
    }

    finishAttack() {
        this.attackGraphics.clear();
        this._isAttacking = false;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = null;
        this._chargePower = 0;
    }

    // No final da classe PlayerBase...

    /** Verifica o centro e as bordas da elipse para o personagem não atravessar paredes */
    isPositionWalkable(mapCollider) {
        if (!mapCollider) return true;

        const center = this.getEllipseCenter();
        const rx = this.collisionRx * 0.7; // Margem menor que 100% para perdoar resvalos
        const ry = this.collisionRy * 0.7;

        return mapCollider.isWalkable(center.x, center.y) &&
               mapCollider.isWalkable(center.x + rx, center.y) &&
               mapCollider.isWalkable(center.x - rx, center.y) &&
               mapCollider.isWalkable(center.x, center.y + ry) &&
               mapCollider.isWalkable(center.x, center.y - ry);
    }

    /** 
     * Substitua seu método "clampToWorldBounds" atual por este aqui.
     */
    constrainPosition(mapCollider) {
        const bounds = this.scene.physics.world.bounds;
        const halfW = this.displayWidth / 2;
        const halfH = this.displayHeight / 2;

        let newX = Phaser.Math.Clamp(this.x, bounds.x + halfW, bounds.right - halfW);
        let newY = Phaser.Math.Clamp(this.y, bounds.y + halfH, bounds.bottom - halfH);
        this.setPosition(newX, newY);

        // Deslizamento (Sliding) contra pixels pretos
        if (mapCollider && this._prevX !== undefined && this._prevY !== undefined) {
            if (!this.isPositionWalkable(mapCollider)) {
                
                // Bateu. Tenta deslizar mantendo só o eixo X
                this.setPosition(newX, this._prevY);
                if (!this.isPositionWalkable(mapCollider)) {
                    
                    // Não deu. Tenta deslizar mantendo só o eixo Y
                    this.setPosition(this._prevX, newY);
                    if (!this.isPositionWalkable(mapCollider)) {
                        
                        // Quina absoluta, volta para onde estava no frame passado
                        this.setPosition(this._prevX, this._prevY);
                    }
                }
            }
        }

        this.body.updateFromGameObject(); // Atualiza a hitbox Arcade

        // Guarda histórico para o deslize do próximo frame
        this._prevX = this.x;
        this._prevY = this.y;
    }
}