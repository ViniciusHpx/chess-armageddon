import PlayerBase from './PlayerBase.js';
import {
    RANKS, attackHalfBand, attackReach, ATTACK_MOVE_FACTOR, DAMAGE_NORMAL, DAMAGE_CHARGED,
    attackWindupMs, chargeAreaMult, BOT_DASH_COOLDOWN_MS, BOT_DODGE_CHANCE, BOT_DODGE_RANGE_SLACK, BOT_DODGE_REACTION_MS
} from '../constants/Hierarchy.js';

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

/**
 * Quanto tempo o bot segura um golpe já carregado esperando o alvo entrar no
 * alcance, antes de soltar assim mesmo. Espelha `BOT_CHARGE_HOLD_MS`.
 *
 * Sem este teto, um alvo que foge deixaria o bot paralisado segurando a carga
 * para sempre. Soltar no vazio é melhor: gasta o cooldown e ele volta a agir.
 */
const CHARGE_HOLD_MS = 1200;

export default class AIPlayer extends PlayerBase {
    constructor(scene, x, y, team) {
        const debugColor = team === 'ally' ? 0x00ff00 : 0xff0000;
        super(scene, x, y, RANKS.PAWN.key, team, debugColor);

        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 0;
        this.setRandomTimer();

        this._attackCooldown = 0;

        /**
         * Golpe inimigo para o qual este bot já sorteou reação, identificado
         * pelo instante do impacto. Ver `tryDodge`.
         */
        this._dodgeRolledFor = 0;
    }

    setRandomTimer() {
        this.wanderTimer = Phaser.Math.Between(1000, 3000);
    }

    die() {
        this.cancelDash();
        this.setActive(false);
        this.setVisible(false);
        this.body.enable = false;

        this.resetAura(); // reseta aura ao morrer

        this.scene.time.delayedCall(1000, () => this.respawn());
    }

    respawn() {
        this.moveToSpawn(this.scene.mapCollider, 500, 700);
        this.resetProgressOnDeath();
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

        // Dash em curso: mantém o impulso e não decide mais nada neste quadro.
        const dash = this.dashVelocity(delta);
        if (dash) {
            this.setVelocity(dash.vx, dash.vy);
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
  
        // --- NOVO: STEERING BEHAVIOR (DESVIO DE PAREDES) ---
        if (this.scene.mapCollider) {
            const center = this.getEllipseCenter();
            const lookAhead = 150; // Quão longe o bot "enxerga"
            const clearance = this.scene.mapCollider.getClearance(center.x, center.y, moveAngle, lookAhead);

            // Parede detectada na rota principal!
            if (clearance < lookAhead) {
                // Testa as vistas em leque: 45º, -45º, 90º, -90º, 135º, -135º
                const offsets = [Math.PI/4, -Math.PI/4, Math.PI/2, -Math.PI/2, Math.PI*0.75, -Math.PI*0.75];
                let bestAngle = moveAngle;
                let bestClearance = clearance;

                for (const offset of offsets) {
                    const testAngle = moveAngle + offset;
                    const testClearance = this.scene.mapCollider.getClearance(center.x, center.y, testAngle, lookAhead);

                    // +20 evita tremedeiras (ele só desvia se for muito vantajoso)
                    if (testClearance > bestClearance + 20) {
                        bestClearance = testClearance;
                        bestAngle = testAngle;
                        if (testClearance >= lookAhead) break; // Achou caminho 100% livre
                    }
                }

                moveAngle = bestAngle; // Assume a rota desviada

                // Se estivesse vagando, ajusta a variável interna para não ficar insistindo em bater
                if (!nearestEnemy) {
                    this.wanderAngle = moveAngle;
                }
            }
        }

        // --- FIM DO NOVO BLOCO ---


        // Velocidade cheia do rank, igual ao jogador (espelha BOT_SPEED_FACTOR = 1).
        // Durante o golpe, reduzida: antes o bot mantinha a velocidade do
        // quadro anterior e deslizava solto pelos 200 ms do windup.
        const speed = this._currentRank.speed *
            (this._isAttacking ? ATTACK_MOVE_FACTOR : 1);
          
        const vx = Math.cos(moveAngle) * speed;
        const vy = Math.sin(moveAngle) * speed;
        this.setVelocity(vx, vy);

        // Orientação do sprite durante o movimento
        if (vx < 0) this.setFlipX(true);
        else if (vx > 0) this.setFlipX(false);

        // --- ATAQUE ---
        // Golpe em curso: não encadeia carga nem novo ataque.
        if (this._isAttacking) {
            this.commonUpdate(delta);
            return;
        }

        if (this.tryDodge(nearestEnemy)) {
            this.commonUpdate(delta);
            return;
        }

        if (this._isCharging) {
            this.stepCharge(nearestEnemy, enemies);
        } else {
            this.decideAttack(nearestEnemy, enemies, delta);
        }

        this.commonUpdate(delta);
    }

    /**
     * O bot esquiva do golpe que está vindo?
     *
     * Mesma regra do servidor (`World.tryBotDodge`): filtros baratos primeiro
     * — cooldown, existe golpe inimigo em curso, o atacante está perto o
     * bastante, o tempo de reação já passou — e só então UM sorteio por golpe,
     * com a chave guardada em `_dodgeRolledFor`. Sorteando por quadro, a 60
     * FPS os 200 ms de windup dariam 12 chances e o bot esquivaria de tudo.
     *
     * @param {?PlayerBase} threat Inimigo mais próximo.
     */
    tryDodge(threat) {
        if (this.dashCooldownRatio(BOT_DASH_COOLDOWN_MS) > 0) return false;
        if (!threat || !threat.active || !threat._isAttacking) return false;

        const impactoEm = threat._attackHitAt || 0;
        if (this._dodgeRolledFor === impactoEm) return false;

        const now = this.scene.time.now;
        // O windup do atacante depende da carga dele: golpe cheio dá mais
        // tempo de reação, e é justamente o que compensa esquivar.
        const janela = attackWindupMs(threat._chargePower);
        const elapsed = janela - (impactoEm - now);
        if (elapsed < BOT_DODGE_REACTION_MS) return false;

        const from = threat.getEllipseCenter();
        const to = this.getEllipseCenter();
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        const mult = chargeAreaMult(threat._chargePower);
        const perigo = (threat.collisionRx + attackReach(threat._currentRank) * mult
            + this.collisionRx) * BOT_DODGE_RANGE_SLACK;
        if (dx * dx + dy * dy > perigo * perigo) return false;

        // Percebeu o golpe: gasta o sorteio deste ataque, acertando ou não.
        this._dodgeRolledFor = impactoEm;
        if (Math.random() >= BOT_DODGE_CHANCE) return false;

        // Foge na direção oposta ao atacante — o mesmo vetor do empurrão.
        return this.startDash(dx, dy, BOT_DASH_COOLDOWN_MS);
    }

    /** Escolhe entre não atacar, bater normal ou começar a carregar. */
    decideAttack(target, enemies, delta) {
        this._attackCooldown -= delta;
        if (this._attackCooldown > 0 || !target) return;

        // Extremos da escala: o golpe que sai agora e o da carga cheia.
        const alcancaNormal = this.canHit(target, chargeAreaMult(0));
        const alcancaCarregado = this.canHit(target, chargeAreaMult(1));
        if (!alcancaNormal && !alcancaCarregado) return;

        // Taxa por segundo convertida na chance deste quadro.
        const chance = 1 - Math.exp(-ATTACK_RATE_PER_SECOND * (delta / 1000));
        if (Math.random() >= chance) return;

        this.setFlipX(target.x < this.x);

        if (AIPlayer.shouldCharge(target, alcancaNormal, alcancaCarregado)) {
            this.startCharging();
            return;
        }

        this.attack(target, enemies);
        this._attackCooldown = ATTACK_COOLDOWN_MS;
    }

    /**
     * Vale a pena carregar em vez de bater logo?
     *
     * Carregar NÃO rende mais dano por segundo — o ciclo normal (cooldown 700
     * + windup 200) tira ~28/s, e o carregado, com a espera do `chargeTime`,
     * fica em torno de ~26/s. Carregar é ferramenta de situação, não a jogada
     * padrão. As duas situações em que compensa:
     *
     *   1. FINALIZAÇÃO — a vida do alvo está na janela em que o carregado mata
     *      e o normal não. Abater promove e dá aura, o que vale bem mais que a
     *      diferença de dano.
     *   2. APROXIMAÇÃO — o alvo está fora do alcance normal mas dentro do
     *      carregado (que dobra o alcance). Carregar aí é de graça: não existia
     *      golpe possível de qualquer forma.
     */
    static shouldCharge(target, alcancaNormal, alcancaCarregado) {
        if (!alcancaCarregado) return false;

        const finaliza = target.currentHealth > DAMAGE_NORMAL
            && target.currentHealth <= DAMAGE_CHARGED;

        return finaliza || !alcancaNormal;
    }

    /** Carga em curso: continua perseguindo e escolhe a hora de soltar. */
    stepCharge(target, enemies) {
        this.updateCharge();

        // Alvo morreu ou sumiu: não há o que finalizar, desiste sem gastar golpe.
        if (!target) {
            this.cancelCharge();
            return;
        }

        if (!this._chargeComplete) return;

        const segurando = this.scene.time.now - this._chargeStartTime;
        const esperouDemais = segurando >= this._currentRank.chargeTime + CHARGE_HOLD_MS;
        if (!this.canHit(target, chargeAreaMult(1)) && !esperouDemais) return;

        this.setFlipX(target.x < this.x);
        this.releaseCharge(enemies);
        this._attackCooldown = ATTACK_COOLDOWN_MS;
    }

    /**
     * O golpe tem chance real de acertar este alvo?
     *
     * Reproduz de forma barata o que `executeAttackHit` testaria: distância
     * dentro do alcance do rank e — para os golpes retos — alvo na faixa à
     * frente. Antes eram 100 px fixos para todo rank, medidos de `x`/`y` em vez
     * do centro da elipse de onde o dano realmente sai.
     *
     * @param {number} mult Multiplicador de área a testar. É o mesmo
     *        fator que `executeAttackHit` aplica às dimensões da forma.
     */
    canHit(enemy, mult) {
        if (enemy._isInvulnerable) return false; // só gastaria o cooldown

        const from = this.getEllipseCenter();
        const to = enemy.getEllipseCenter();
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        const reach = this.collisionRx + attackReach(this._currentRank) * mult
            + enemy.collisionRx + ATTACK_RANGE_SLACK;
        // Compara os quadrados: dispensa a raiz quadrada a cada quadro.
        if (dx * dx + dy * dy > reach * reach) return false;

        // `Infinity` nos golpes radiais passa direto, sem ramificação extra.
        return Math.abs(dy) <= attackHalfBand(this._currentRank) * mult + enemy.collisionRy;
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