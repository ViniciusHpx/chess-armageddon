/**
 * Geometria do golpe: testes de sobreposição e o LAYOUT da forma.
 *
 * Espelho de `chess-armageddon-server/src/sim/geometry.ts` — aquele é a fonte
 * de verdade, este é a cópia que o cliente usa para desenhar e para rodar o
 * modo offline. Se um dos dois mudar, o golpe passa a acertar fora do que
 * aparece na tela.
 *
 * Os três testes primitivos (`ellipseContainsPoint`, `circleOverlapsEllipse`,
 * `diamondOverlapsEllipse`) moravam como estáticos no `PlayerBase`; vieram para
 * cá porque agora o desenho do modo ONLINE (`ArenaActor`, que não estende
 * `PlayerBase`) também precisa da mesma geometria. O `PlayerBase` mantém os
 * estáticos como atalhos para não mudar a interface que o `CLAUDE.md` descreve.
 */
function clamp(valor, min, max) {
    return Math.max(min, Math.min(max, valor));
}

export function ellipseContainsPoint(px, py, cx, cy, rx, ry) {
    const dx = px - cx;
    const dy = py - cy;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.001;
}

export function rectangleOverlapsEllipse(rect, ellipseCx, ellipseCy, rx, ry) {
    if (rx <= 0 || ry <= 0) return false;
    const closestX = clamp(ellipseCx, rect.x, rect.x + rect.w);
    const closestY = clamp(ellipseCy, rect.y, rect.y + rect.h);
    return ellipseContainsPoint(closestX, closestY, ellipseCx, ellipseCy, rx, ry);
}

/**
 * Raio da elipse na direção `angle`, medido do centro dela.
 *
 * Era uma expressão solta dentro de `circleOverlapsEllipse`; virou função
 * porque a origem do golpe passou a precisar dela — com o ataque preso ao eixo
 * X bastava `± rx`, e é exatamente o que ela devolve em 0 e em π.
 */
export function ellipseRadiusAt(rx, ry, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return (rx * ry) / Math.sqrt((ry * cosA) ** 2 + (rx * sinA) ** 2);
}

export function circleOverlapsEllipse(circleCx, circleCy, radius, ellipseCx, ellipseCy, rx, ry) {
    if (rx <= 0 || ry <= 0) return false;
    const dx = ellipseCx - circleCx;
    const dy = ellipseCy - circleCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return true;

    return dist <= radius + ellipseRadiusAt(rx, ry, Math.atan2(dy, dx));
}

export function diamondOverlapsEllipse(dCx, dCy, radius, eCx, eCy, rx, ry) {
    if (rx <= 0 || ry <= 0) return false;
    const dx = eCx - dCx;
    const dy = eCy - dCy;
    const u = dx + dy;
    const v = dx - dy;

    if (Math.abs(u) <= radius && Math.abs(v) <= radius) return true;

    const closestU = clamp(u, -radius, radius);
    const closestV = clamp(v, -radius, radius);

    const closestX = (closestU + closestV) / 2 + dCx;
    const closestY = (closestU - closestV) / 2 + dCy;

    return ellipseContainsPoint(closestX, closestY, eCx, eCy, rx, ry);
}

/**
 * Retângulo ORIENTADO contra elipse.
 *
 * Generaliza `rectangleOverlapsEllipse` para um retângulo girado, e é a única
 * peça de geometria nova que o golpe direcional pediu. A conta é a mesma de
 * sempre, num referencial diferente: leva o centro da elipse para o referencial
 * do retângulo, corta nas meias-extensões (o ponto mais próximo), volta ao
 * mundo e testa com o mesmo `ellipseContainsPoint`.
 *
 * Em ângulo 0 (ou π) `cos` é ±1 e `sin` é 0, então isto é LITERALMENTE o clamp
 * do `rectangleOverlapsEllipse`: o golpe que sai no eixo X — todo golpe de
 * teclado e todo golpe de bot — continua sendo avaliado exatamente como antes.
 *
 * @param {number} cx Centro do retângulo em X.
 * @param {number} cy Centro do retângulo em Y.
 * @param {number} halfLength Meia extensão NA direção `angle`.
 * @param {number} halfWidth Meia extensão na perpendicular.
 */
export function orientedRectOverlapsEllipse(
    cx, cy, halfLength, halfWidth, angle, eCx, eCy, rx, ry
) {
    if (rx <= 0 || ry <= 0) return false;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = eCx - cx;
    const dy = eCy - cy;

    // Centro da elipse no referencial do retângulo, e o ponto do retângulo
    // mais próximo dele.
    const px = clamp(dx * cos + dy * sin, -halfLength, halfLength);
    const py = clamp(-dx * sin + dy * cos, -halfWidth, halfWidth);

    return ellipseContainsPoint(
        cx + px * cos - py * sin, cy + px * sin + py * cos, eCx, eCy, rx, ry
    );
}

/**
 * Os quatro cantos de um retângulo orientado, no sentido do desenho.
 *
 * Só o desenho usa isto (o `Graphics` do Phaser não tem retângulo girado, então
 * vai de polígono). Sai da MESMA descrição que o teste de dano consome, então
 * não há como o desenho e a área divergirem.
 */
export function orientedRectPoints(cx, cy, halfLength, halfWidth, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return [
        [-halfLength, -halfWidth],
        [halfLength, -halfWidth],
        [halfLength, halfWidth],
        [-halfLength, halfWidth]
    ].map(([lx, ly]) => ({
        x: cx + lx * cos - ly * sin,
        y: cy + lx * sin + ly * cos
    }));
}

// ---------------------------------------------------------------------------
// FORMA DO GOLPE
//
// O layout da forma vive AQUI, num lugar só, e é consumido pelo dano offline
// (`PlayerBase.executeAttackHit`) e pelos DOIS desenhos (`PlayerBase` e
// `ArenaActor`). Antes cada um montava a própria geometria num `switch`
// paralelo, e o `CLAUDE.md` já anotava que era o ponto de divergência número
// um: dano e desenho saindo de lugares diferentes. Somar um ÂNGULO a cinco
// cópias à mão seria pedir esse bug.
// ---------------------------------------------------------------------------

/**
 * Monta a forma do golpe, já posicionada no mundo.
 *
 * Devolve `{kind: 'rects', rects}` para os golpes DIRECIONAIS (peão e cavalo) e
 * `{kind: 'radial', ...}` para os que pegam em volta do personagem (torre,
 * bispo, rainha) — estes não têm direção nenhuma e não mudaram com o ataque
 * direcional.
 *
 * @param {object} attack Configuração do rank (`RANKS[x].attack`).
 * @param {number} mult Multiplicador de área da carga (`chargeAreaMult(power)`).
 * @param {number} centerX Centro da elipse do atacante.
 * @param {number} centerY Centro da elipse do atacante.
 * @param {number} rx Raio da elipse do atacante.
 * @param {number} ry Raio da elipse do atacante.
 * @param {number} angle Direção do golpe, em radianos.
 * @param {number} side Lado da perna do L, -1 ou 1, na PERPENDICULAR ao golpe.
 */
export function attackShapes(attack, mult, centerX, centerY, rx, ry, angle, side) {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    // Origem do golpe: a borda da elipse NA DIREÇÃO do ataque. Com o golpe
    // preso ao eixo X isto era sempre `center.x ± collisionRx`, que é o que
    // `ellipseRadiusAt` devolve em 0 e em π.
    const borda = ellipseRadiusAt(rx, ry, angle);
    const startX = centerX + ux * borda;
    const startY = centerY + uy * borda;

    switch (attack.type) {
        case 'rectangle': {
            const length = attack.length * mult;
            const width = attack.width * mult;
            return {
                kind: 'rects',
                rects: [{
                    cx: startX + (ux * length) / 2,
                    cy: startY + (uy * length) / 2,
                    halfLength: length / 2,
                    halfWidth: width / 2,
                    angle
                }]
            };
        }

        case 'lshape': {
            const forward = attack.forwardLength * mult;
            const lado = attack.sideLength * mult;
            const width = attack.width * mult;

            // Perpendicular ao golpe. Com o golpe em X ela é o eixo Y, então a
            // perna do L cai onde caía antes.
            const px = -uy;
            const py = ux;
            const endX = startX + ux * forward;
            const endY = startY + uy * forward;

            return {
                kind: 'rects',
                rects: [
                    {
                        cx: startX + (ux * forward) / 2,
                        cy: startY + (uy * forward) / 2,
                        halfLength: forward / 2,
                        halfWidth: width / 2,
                        angle
                    },
                    {
                        cx: endX + (px * side * lado) / 2,
                        cy: endY + (py * side * lado) / 2,
                        halfLength: lado / 2,
                        halfWidth: width / 2,
                        angle: angle + Math.PI / 2
                    }
                ]
            };
        }

        case 'circle':
        case 'diamond':
        default:
            // Golpes RADIAIS: pegam em volta, então a direção não os altera.
            return {
                kind: 'radial',
                type: attack.type,
                cx: centerX,
                cy: centerY,
                radius: attack.radius * mult
            };
    }
}

/** A forma do golpe encosta nesta elipse? */
export function attackShapeHitsEllipse(shape, eCx, eCy, rx, ry) {
    if (shape.kind === 'radial') {
        return shape.type === 'circle'
            ? circleOverlapsEllipse(shape.cx, shape.cy, shape.radius, eCx, eCy, rx, ry)
            : diamondOverlapsEllipse(shape.cx, shape.cy, shape.radius, eCx, eCy, rx, ry);
    }

    for (const r of shape.rects) {
        if (orientedRectOverlapsEllipse(
            r.cx, r.cy, r.halfLength, r.halfWidth, r.angle, eCx, eCy, rx, ry
        )) return true;
    }
    return false;
}

/**
 * Desenha a forma do golpe. Usado pelos DOIS modos, para o vermelho na tela ser
 * literalmente a área que `attackShapeHitsEllipse` testa.
 *
 * @param {Phaser.GameObjects.Graphics} g Já limpo pelo chamador.
 */
export function drawAttackShape(g, shape) {
    const COR = 0xff0000;

    if (shape.kind === 'radial') {
        if (shape.type === 'circle') {
            g.lineStyle(3, COR, 0.6);
            g.strokeCircle(shape.cx, shape.cy, shape.radius);
            return;
        }

        // Losango: o mesmo quadrado girado 45° que `diamondOverlapsEllipse` usa.
        const r = shape.radius;
        g.fillStyle(COR, 0.4);
        g.beginPath();
        g.moveTo(shape.cx, shape.cy - r);
        g.lineTo(shape.cx + r, shape.cy);
        g.lineTo(shape.cx, shape.cy + r);
        g.lineTo(shape.cx - r, shape.cy);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, COR);
        g.strokePath();
        return;
    }

    for (const r of shape.rects) {
        const pontos = orientedRectPoints(r.cx, r.cy, r.halfLength, r.halfWidth, r.angle);
        g.fillStyle(COR, 0.4);
        g.fillPoints(pontos, true);
        g.lineStyle(2, COR);
        g.strokePoints(pontos, true);
    }
}

/**
 * Lado da perna do L, medido na PERPENDICULAR ao golpe.
 *
 * Com o golpe preso ao eixo X isto era só comparar o Y do alvo com o do
 * atacante — a conta antiga —, e em ângulo 0 é exatamente o que esta devolve.
 * Fora do eixo X, comparar Y do mundo mandaria a perna para o lado errado.
 */
export function attackSideFor(angle, fromX, fromY, toX, toY) {
    const px = -Math.sin(angle);
    const py = Math.cos(angle);
    return (toX - fromX) * px + (toY - fromY) * py > 0 ? 1 : -1;
}
