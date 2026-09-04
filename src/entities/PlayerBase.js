import {
    levelFromRank, levelFromXp, rankKeyForLevel, MAX_LEVEL, XP_PER_KILL, XP_PER_LEVEL,
    attackRecoveryMs, attackWindupMs, chargeAreaMult, chargeDamage, chargePower,
    DASH_COOLDOWN_MS, DASH_DISTANCE, DASH_INVULN_MS, DASH_SPEED, DASH_TIMEOUT_MS,
    RANKS, AURA_KILL_VALUES, AURA_THRESHOLDS, skinKey, canPhaseDash,
    KNOCKBACK_DECAY_MS, KNOCKBACK_MIN_SPEED, knockbackSpeed,
    ATTACK_INTERVAL, attackAimAngle
} from '../constants/Hierarchy.js';
import { insideHealZone, BASE_HEAL_PER_SECOND } from '../constants/Scenario.js';
import { playDashFx } from '../utils/DashFx.js';
import { paintChargeGlow } from '../utils/ChargeGlow.js';
import { paintHealthBar, HEALTH_BAR_OFFSET_Y } from '../utils/HealthBar.js';
import {
    attackShapes, attackShapeHitsEllipse, attackSideFor, drawAttackShape,
    ellipseContainsPoint, rectangleOverlapsEllipse, circleOverlapsEllipse,
    diamondOverlapsEllipse
} from '../utils/AttackGeometry.js';

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

        /**
         * MIRA do ataque, independente do vetor de movimento: é ela que deixa o
         * jogador andar para um lado e bater para outro.
         *
         * Quem escreve é a entidade que tem entrada de jogador
         * (`HumanPlayer.update`) e o BOT (`AIPlayer`, mirando no alvo antes de
         * bater) — os dois pelo mesmo campo e pela mesma `attackAimAngle`.
         */
        this._aimDx = 0;
        this._aimDy = 0;
        /**
         * Direção do golpe em curso, em RADIANOS e contínua em 360°.
         * Congelada em `performAttack`: mudá-la no meio do golpe faria o dano
         * sair de onde não apareceu.
         */
        this._atkAngle = 0;

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
        /** Dash de travessia em curso (cavalo) — ver `dashLandsFree`. */
        this._dashPhasing = false;
        /** Invulnerabilidade do dash. Separada de `_isInvulnerable` para os
         *  `delayedCall` do dano e do respawn não cortarem uma a outra. */
        this._dashInvulnUntil = 0;

        this._initDrawCache();

        // Inicializa o emissor de partículas da aura (se ainda não existir a textura)
        this._createAuraEmitter();

        // Configura o corpo físico com a elipse inicial
        this.initPhysics();
        this.applyRankPhysics(this._currentRank);
    }

    /**
     * Cria (ou recicla) a textura da partícula da aura e adiciona o emissor.
     */
    /**
     * Últimos valores DESENHADOS. Existem para o `commonUpdate` poder pular
     * trabalho que não mudou: um `Graphics` guarda o que foi desenhado, e
     * refazer o mesmo desenho a cada quadro não muda um pixel.
     */
    _initDrawCache() {
        this._vidaDesenhada = -1;
        this._auraAplicada = -1;
        this._debugDesenhado = false;
        this._cargaDesenhada = false;
        this._visuaisVisiveis = null;
    }


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

        // Cor e cadência são propriedades do emissor: uma vez escritas, valem
        // até mudarem. A aura muda por abate e por morte, não por quadro.
        if (this.aura > 0 && this.aura !== this._auraAplicada) {
            this._auraAplicada = this.aura;
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

        this.applyLevel(nivel);
        return true;
    }

    /**
     * Vira a peça do nível pedido: rank, vida máxima, vida cheia e o pisca
     * verde da promoção. Espelha `Actor.applyLevel` do servidor.
     *
     * É o corpo do que `addExperience` já fazia, isolado para a promoção de
     * debug passar EXATAMENTE por aqui. Sprite, física da elipse, velocidade,
     * alcance e forma do golpe saem todos de `setRank`/`applyRankPhysics`.
     */
    applyLevel(nivel) {
        this.setRank(RANKS[rankKeyForLevel(nivel)]);
        this.maxHealth = this._currentRank.health;
        this.currentHealth = this.maxHealth;
        this.updateHealthBar();

        this.setTint(0x00ff00);
        this.scene.time.delayedCall(200, () => this.clearTint());
    }

    /**
     * FERRAMENTA DE DEBUG: avança uma peça, e da rainha volta ao peão.
     * Espelha `Actor.debugCycleRank` + `World.debugCycleRank` do servidor.
     *
     * A XP vai para o PISO do nível de destino (a conta de
     * `resetProgressOnDeath`), então nada no caminho normal de XP é afrouxado:
     * quem volta a peão volta com 0 e torna a subir matando.
     *
     * Golpe e carga em curso são cancelados — as duas máquinas guardam números
     * derivados do rank, e trocar a peça no meio deixaria um golpe de rainha
     * saindo de um peão. Não há guarda de posição aqui como no servidor: o
     * `resolveMove` do `constrainPosition` já resgata partida inválida no
     * quadro seguinte, que é justamente o caso de virar rainha num vão apertado.
     */
    debugCycleRank() {
        if (!this.active || this.currentHealth <= 0) return;

        if (this._isCharging) this.cancelCharge();
        this.cancelDash();

        const alvo = this.level >= MAX_LEVEL ? 1 : this.level + 1;
        this.xp = (alvo - 1) * XP_PER_LEVEL;
        this.applyLevel(alvo);
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
        // Cavalo salta a estrutura, desde que caiba do outro lado. Decidido
        // aqui, no ponto por onde passam jogador e bot — é regra da peça.
        this._dashPhasing = canPhaseDash(this._currentRank.key)
            && this.dashLandsFree(this._dashDirX, this._dashDirY);
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

    /**
     * O dash inteiro cabe do outro lado da estrutura?
     *
     * Espelha `World.dashLandsFree`: só o PONTO DE CHEGADA é testado, com a
     * mesma `canStand` do `MapCollider` (as nove sondas da elipse), e a borda
     * do mapa reprova a travessia — ali o dash volta a ser o normal.
     */
    dashLandsFree(dirX, dirY) {
        const mapCollider = this.scene.mapCollider;
        if (!mapCollider) return false;

        const x = this.x + dirX * DASH_DISTANCE;
        const y = this.y + dirY * DASH_DISTANCE;

        const bounds = this.scene.physics.world.bounds;
        const halfW = this.displayWidth / 2;
        const halfH = this.displayHeight / 2;
        if (x < bounds.x + halfW || x > bounds.right - halfW) return false;
        if (y < bounds.y + halfH || y > bounds.bottom - halfH) return false;

        const offsetY = halfH - this.collisionRx + (this.collisionRy * 4) / 3;
        return mapCollider.canStand(x, y + offsetY, this.collisionRx, this.collisionRy);
    }

    /** Corta um dash em curso (morte, respawn). Não mexe no cooldown. */
    cancelDash() {
        this._dashPhasing = false;
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

    /**
     * O personagem está com o corpo na água?
     *
     * Espelha `World.inWater` do servidor: uma consulta no centro da elipse,
     * sem estado guardado — a cada quadro se olha onde ele está.
     */
    isInWater() {
        const mapCollider = this.scene.mapCollider;
        if (!mapCollider) return false;

        const centro = this.getEllipseCenter();
        return mapCollider.isWater(centro.x, centro.y);
    }

    /**
     * Cura contínua dentro do castelo do PRÓPRIO time — espelha o
     * `World.healInBase` do servidor.
     *
     * Roda no `commonUpdate`, que toda entidade já chama todo quadro: não há
     * temporizador por personagem nem estado de "está curando". Sair da base
     * simplesmente para de curar no quadro seguinte, e a vida nunca passa de
     * `maxHealth`. O castelo do outro time não cura: a zona testada é sempre a
     * do time do próprio personagem.
     */
    healInBase(deltaMs) {
        if (!this.active || this.currentHealth <= 0) return;
        if (this.currentHealth >= this.maxHealth) return;
        if (!insideHealZone(this.team, this.x, this.y)) return;

        this.currentHealth = Math.min(
            this.maxHealth,
            this.currentHealth + BASE_HEAL_PER_SECOND * (deltaMs / 1000)
        );
    }

    /**
     * A barra ANDA junto com o personagem, mas só é REDESENHADA quando a vida
     * muda — ver `utils/HealthBar.js`. Antes eram uma limpeza e dois
     * retângulos por personagem por quadro, refazendo sempre o mesmo desenho.
     */
    createHealthBar() {
        this.healthBar.setPosition(this.x, this.y + HEALTH_BAR_OFFSET_Y);

        const healthPercent = Math.max(0, this.currentHealth / this.maxHealth);
        if (healthPercent === this._vidaDesenhada) return;

        this._vidaDesenhada = healthPercent;
        paintHealthBar(this.healthBar, healthPercent);
    }

    updateHealthBar() {
        this.createHealthBar();
    }

    /**
     * Moldura de debug da elipse. Ligada pela tecla `H`, como na `Arena`.
     *
     * Era desenhada SEMPRE: três `strokeEllipse` mais um `fillEllipse` por
     * personagem por quadro, dez personagens — o trabalho de `Graphics` mais
     * caro do modo offline, e invisível para quem só quer jogar. A `Arena` já
     * tinha a guarda; aqui ela faltava.
     *
     * `scene.showHitboxes` ausente conta como desligado, então nenhuma cena
     * precisa declarar a flag para o jogo funcionar.
     */
    drawDebugHitbox() {
        if (!this.scene.showHitboxes) {
            // Desligado é o caso normal, e aí não há o que limpar depois do
            // primeiro quadro. A tecla H liga e desliga.
            if (this._debugDesenhado) {
                this.debugGraphics.clear();
                this._debugDesenhado = false;
            }
            return;
        }

        this.debugGraphics.clear();
        this._debugDesenhado = true;

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
        if (!this._isCharging) {
            if (this._cargaDesenhada) {
                this.chargeGlowGraphics.clear();
                this._cargaDesenhada = false;
            }
            return;
        }

        this.chargeGlowGraphics.clear();
        this._cargaDesenhada = true;

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
        if (visible === this._visuaisVisiveis) return;
        this._visuaisVisiveis = visible;

        this.healthBar.setVisible(visible);
        this.debugGraphics.setVisible(visible);
        this.attackGraphics.setVisible(visible);
        this.chargeGlowGraphics.setVisible(visible);
        this.auraEmitter.setVisible(visible);
    }

    /** @param {number} deltaMs Delta do quadro, vindo do `update` da cena. */
    commonUpdate(deltaMs = 0) {
        this.applyKnockback(deltaMs);
        this.healInBase(deltaMs);

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

    /**
     * Direção do golpe que está saindo agora, em RADIANOS e sem quantização.
     *
     * A mira manda, se houver; sem mira (zona morta) o golpe sai para o lado
     * que a peça olha, que é o comportamento de sempre. Espelha
     * `World.attackAngle` do servidor, e é esse fallback que mantém o teclado
     * idêntico ao que era.
     */
    attackAngle() {
        return attackAimAngle(this._aimDx, this._aimDy, this.flipX);
    }

    /**
     * Mira em `target`: o vetor unitário do centro da elipse até a dele.
     *
     * Espelha `World.aimAt`. Escreve no MESMO `_aimDx/_aimDy` da entrada do
     * jogador, então o golpe do bot passa por `attackAngle` como qualquer
     * outro e também sai em qualquer direção dos 360°.
     */
    aimAt(target) {
        const from = this.getEllipseCenter();
        const to = target.getEllipseCenter();
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        this._aimDx = dx / len;
        this._aimDy = dy / len;
    }

    /**
     * Começa um golpe. Devolve `true` se ele saiu mesmo — é essa resposta que
     * diz ao controle de ataque que a mira foi USADA (ver
     * `InputManager.consumeAttackAim`); golpe recusado por recuperação não
     * consome mira nenhuma.
     */
    performAttack(enemyGroup) {
        if (this._isAttacking) return false;
        if (this.scene.time.now < this._attackReadyAt) return false;
        this._isAttacking = true;
        this._attackHitEnemies.clear();
        this._attackEnemyGroup = enemyGroup;
        // Direção CONGELADA aqui, como no servidor: o desenho e o dano do golpe
        // saem os dois dela, e recalculá-la a cada quadro faria a área girar
        // debaixo do golpe já em curso.
        this._atkAngle = this.attackAngle();
        // MIRA CONSUMIDA. Espelha o `beginAttack` do servidor: a direção que
        // acabou de virar golpe deixa de existir, e a próxima só aparece quando
        // alguém definir uma nova — o jogador recentrando e arrastando o
        // controle outra vez, o bot decidindo de novo em `aimAt`. Sem isto o
        // vetor antigo continuaria valendo e bastaria o cooldown vencer para o
        // mesmo golpe sair sozinho.
        this._aimDx = 0;
        this._aimDy = 0;
        // Quando este golpe vai acertar. Serve de chave para a esquiva dos bots
        // (`AIPlayer.tryDodge`), que precisa saber se ainda dá tempo de reagir.
        // O atraso cresce com a carga: o toque rápido sai antes, o golpe cheio
        // se anuncia por mais tempo.
        const windup = attackWindupMs(this._chargePower);
        this._attackHitAt = this.scene.time.now + windup;
        // Recuperação depois do impacto (a desvantagem do golpe carregado) com
        // `ATTACK_INTERVAL` de PISO — é ele que dá ritmo ao ataque contínuo.
        // Vale o maior dos dois, num gate só: não existe segundo temporizador.
        this._attackReadyAt = Math.max(
            this._attackHitAt + attackRecoveryMs(this._chargePower),
            this.scene.time.now + ATTACK_INTERVAL
        );

        this.scene.time.delayedCall(windup, () => {
            // Pode ter morrido/sido desativado durante o delay
            if (this.active) this.executeAttackHit(enemyGroup);
            this.finishAttack();
        });

        return true;
    }

    /**
     * Forma do golpe em curso, no mundo. Uma fonte só para o desenho e para o
     * dano — antes cada um montava a própria geometria.
     */
    attackShape(enemyGroup) {
        const center = this.getEllipseCenter();
        return attackShapes(
            this._currentRank.attack,
            chargeAreaMult(this._chargePower),
            center.x, center.y,
            this.collisionRx, this.collisionRy,
            this._atkAngle,
            this.attackSide(enemyGroup)
        );
    }

    /**
     * Lado da perna do L do cavalo, -1 ou 1.
     *
     * Continua sendo recalculado no momento do uso (e não congelado como no
     * servidor): é uma das diferenças offline/online já anotadas no
     * `CLAUDE.md`, e não é o assunto desta mudança. O que mudou é o EIXO — o
     * lado é medido na perpendicular ao golpe, senão a perna apontaria para o
     * lugar errado fora do eixo X.
     */
    attackSide(enemyGroup) {
        if (!enemyGroup) return 1;

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
        if (!nearest) return 1;

        return attackSideFor(this._atkAngle, this.x, this.y, nearest.x, nearest.y);
    }

    drawAttackVisual(enemyGroup) {
        this.attackGraphics.clear();
        drawAttackShape(this.attackGraphics, this.attackShape(enemyGroup));
    }

    executeAttackHit(enemyGroup) {
        // Área e dano da MESMA potência, os dois já com teto embutido
        // (AREA_MULT_MAX e DAMAGE_MAX).
        const damage = chargeDamage(this._chargePower);
        const forma = this.attackShape(enemyGroup);

        for (const enemy of enemyGroup.getChildren()) {
            if (!enemy.active || this._attackHitEnemies.has(enemy)) continue;

            const c = enemy.getEllipseCenter();
            if (attackShapeHitsEllipse(forma, c.x, c.y, enemy.collisionRx, enemy.collisionRy)) {
                this.applyDamageToEnemy(enemy, damage);
            }
        }
    }

    // Os testes de sobreposição mudaram de casa: vivem em
    // `src/utils/AttackGeometry.js`, o espelho do `sim/geometry.ts` do
    // servidor, porque agora o desenho do modo ONLINE (`ArenaActor`, que não
    // estende esta classe) também precisa deles. Os estáticos ficam como
    // atalhos, para a interface que o `CLAUDE.md` descreve continuar válida.
    static ellipseContainsPoint(px, py, cx, cy, rx, ry) {
        return ellipseContainsPoint(px, py, cx, cy, rx, ry);
    }

    static rectangleOverlapsEllipse(rect, ellipseCx, ellipseCy, rx, ry) {
        return rectangleOverlapsEllipse(rect, ellipseCx, ellipseCy, rx, ry);
    }

    static circleOverlapsEllipse(circleCx, circleCy, radius, ellipseCx, ellipseCy, rx, ry) {
        return circleOverlapsEllipse(circleCx, circleCy, radius, ellipseCx, ellipseCy, rx, ry);
    }

    static diamondOverlapsEllipse(dCx, dCy, radius, eCx, eCy, rx, ry) {
        return diamondOverlapsEllipse(dCx, dCy, radius, eCx, eCy, rx, ry);
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
        if (!this._isCharging) return false;

        const elapsed = this.scene.time.now - this._chargeStartTime;
        const power = chargePower(elapsed, this._currentRank.chargeTime);
        this.cancelCharge();

        if (this._isAttacking) return false;

        this._chargePower = power;
        return this.performAttack(enemyGroup);
    }

    /**
     * Golpe leve imediato, sem passar por estado de carga.
     *
     * É a própria máquina de carga aberta e fechada no mesmo quadro: o tempo
     * decorrido é zero, então `releaseCharge` sai com potência 0 — o mesmo
     * golpe de um toque rápido. Serve ao ataque carregado desligado
     * (`CHARGED_ATTACK_ENABLED`) sem duplicar a checagem de recuperação nem a
     * chamada de `performAttack`.
     *
     * @param {Phaser.GameObjects.Group} enemyGroup Alvos do golpe.
     */
    attackLight(enemyGroup) {
        this.startCharging();
        return this.releaseCharge(enemyGroup);
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
    /**
     * Nasce (ou renasce) no castelo do próprio time, em chão livre.
     *
     * Sem colisor não há o que validar: cai na posição de reserva, que é o
     * comportamento antigo.
     */
    moveToSpawn(mapCollider, reservaX, reservaY) {
        if (!mapCollider) {
            this.setPosition(reservaX, reservaY);
        } else {
            // O offset sai da geometria do rank, não de `getEllipseCenter()`:
            // aquele lê `body.center`, que só é sincronizado no `preUpdate` do
            // quadro seguinte — no spawn ele ainda aponta para a posição
            // anterior e a validação testaria o pixel errado.
            const offsetY = this.displayHeight / 2 - this.collisionRx + (this.collisionRy * 4) / 3;
            const ponto = mapCollider.findSpawn(this.team, this.collisionRx, this.collisionRy, offsetY);
            this.setPosition(ponto.x, ponto.y);
        }

        if (this.body) this.body.updateFromGameObject();
        // O deslize compara com a posição do quadro anterior: sem zerar isto, o
        // personagem seria puxado de volta para onde estava antes de renascer.
        this._prevX = this.x;
        this._prevY = this.y;
    }

    isPositionWalkable(mapCollider) {
        if (!mapCollider) return true;

        const center = this.getEllipseCenter();
        return mapCollider.canStand(center.x, center.y, this.collisionRx, this.collisionRy);
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

        // Cavalo atravessando: o deslize contra o cenário fica suspenso — ele
        // está dentro da estrutura de propósito, e o ponto de chegada já foi
        // aprovado por `dashLandsFree`. O clamp da borda, acima, continua
        // valendo. A bandeira só cai DEPOIS de o deslize ter sido pulado no
        // quadro em que o dash acaba: resolver a partir de uma posição dentro
        // da parede acionaria o resgate do `MapCollider` e jogaria o cavalo
        // para um lado qualquer.
        if (this._dashPhasing) {
            if (!this.isDashing) this._dashPhasing = false;
            this._prevX = this.x;
            this._prevY = this.y;
            this.body.updateFromGameObject();
            return;
        }

        // Deslize contra o cenário. A resolução vive no `MapCollider` e é a
        // MESMA que o servidor usa (`CollisionMask.resolveMove`): tenta a
        // diagonal, o eixo X e o eixo Y, cada um até encostar, e fica com o que
        // render mais. Antes isto era um if aninhado aqui dentro que, na quina,
        // devolvia o personagem para a posição do quadro anterior — ele parava
        // a um passo da parede e, no caso do bot, ficava empurrando o vazio.
        if (mapCollider && this._prevX !== undefined && this._prevY !== undefined) {
            const offsetY = this.displayHeight / 2 - this.collisionRx + (this.collisionRy * 4) / 3;
            const destino = mapCollider.resolveMove(
                this._prevX, this._prevY, newX, newY,
                offsetY, this.collisionRx, this.collisionRy
            );
            this.setPosition(destino.x, destino.y);
        }

        this.body.updateFromGameObject(); // Atualiza a hitbox Arcade

        // Guarda histórico para o deslize do próximo frame
        this._prevX = this.x;
        this._prevY = this.y;
    }
}