import { HEAL_ZONE, WORLD_WIDTH } from '../constants/Scenario.js';

/**
 * Névoa verde que marca a área de cura dos castelos.
 *
 * É a MESMA `HEAL_ZONE` que o servidor usa para decidir quem regenera — o
 * retângulo não é copiado nem aproximado aqui, é lido da constante. Mover a
 * área de cura move a névoa junto, sem tocar neste arquivo.
 *
 * Custo: UMA textura gerada uma vez por sessão (155 × 110 px, ~68 KB) e DOIS
 * `Image` no mundo, um por castelo. Não há partícula, shader, `Graphics`
 * redesenhado por quadro nem nada por jogador — o único movimento é um tween
 * de opacidade por castelo, que o Phaser interpola sozinho.
 *
 * Usado pelos dois modos (`Start` e `Arena`), como `DashFx` e `ChargeGlow`.
 */

const TEXTURE_KEY = 'heal-zone-fog';

/** Resolução da textura. Baixa de propósito: o Phaser a estica com filtro
 *  linear, e é essa interpolação que dá o borrado da névoa de graça. */
const TEX_W = 155;
const TEX_H = 110;

/** Verde da névoa. */
const COR = { r: 96, g: 232, b: 138 };

/**
 * Largura do halo, em fração da meia-largura da área (0,5 seria "até o
 * centro"). Calibrado na tela: 0,34 pintava quase o retângulo inteiro e virava
 * o bloco verde sólido que NÃO se quer; 0,10 virava um fio de contorno. Em
 * 0,13 sobra um miolo limpo com uma faixa esfumaçada em volta.
 */
const BANDA = 0.13;

/** Queda do halo dentro da banda. Quanto maior, mais colado na borda. */
const EXPOENTE = 2.0;

/** Feather da borda externa: some nos últimos 3,5 % para o retângulo não ter
 *  aresta desenhada — o verde nasce e morre no borrado. */
const FEATHER = 0.035;

/**
 * Opacidade mínima e máxima da pulsação, e o período dela.
 *
 * Parecem altas para algo "sutil", mas o alfa da textura vale 0,54 no pico do
 * halo e 0 no miolo: o que chega à tela é 0,26 a 0,37 de verde ADITIVO, e só
 * na faixa da borda. Valores mais baixos (0,14–0,26, a primeira tentativa)
 * sumiam contra a pedra do pátio.
 */
const ALPHA_MIN = 0.48;
const ALPHA_MAX = 0.68;
const PULSO_MS = 2600;

/** Profundidade: acima da arte do mapa (0) e abaixo de qualquer personagem,
 *  que usa `setDepth(y)` e nunca fica abaixo de 1 na prática. */
const DEPTH = 1;

/** Suavização cúbica, para o feather não ter quina. */
function suave(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/**
 * Ruído de valor com semente fixa: a névoa é sempre a mesma, então os dois
 * castelos (e as duas telas de dois jogadores) mostram o mesmo desenho.
 */
function fazRuido(colunas, linhas) {
    // LCG minúsculo — não vale a pena depender de `Math.random`, que mudaria
    // o visual a cada carga de página.
    let semente = 20240817;
    const rnd = () => {
        semente = (semente * 1664525 + 1013904223) >>> 0;
        return semente / 4294967296;
    };

    const lattice = new Float32Array(colunas * linhas);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();

    return (u, v) => {
        const fx = u * (colunas - 1);
        const fy = v * (linhas - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, colunas - 1);
        const y1 = Math.min(y0 + 1, linhas - 1);
        const tx = suave(fx - x0);
        const ty = suave(fy - y0);

        const a = lattice[y0 * colunas + x0];
        const b = lattice[y0 * colunas + x1];
        const c = lattice[y1 * colunas + x0];
        const d = lattice[y1 * colunas + x1];

        return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    };
}

/**
 * Desenha a textura da névoa: transparente no miolo, verde nas bordas.
 *
 * O alfa sai de `1 - distância até a borda mais próxima`, medida em fração de
 * `BANDA` — daí o halo. Passada a banda, alfa zero: o centro da área fica
 * limpo, que é o pedido (nada de bloco verde sólido). O ruído por cima quebra
 * o contorno perfeito e é o que faz parecer névoa, não moldura.
 */
function criaTextura(scene) {
    if (scene.textures.exists(TEXTURE_KEY)) return;

    const canvas = scene.textures.createCanvas(TEXTURE_KEY, TEX_W, TEX_H);
    const ctx = canvas.getContext();
    const img = ctx.createImageData(TEX_W, TEX_H);
    const ruido = fazRuido(7, 6);

    for (let py = 0; py < TEX_H; py++) {
        const v = py / (TEX_H - 1);
        const dv = Math.min(v, 1 - v);

        for (let px = 0; px < TEX_W; px++) {
            const u = px / (TEX_W - 1);
            const du = Math.min(u, 1 - u);

            // Quão fundo está, em fração da banda. 0 = na borda, 1 = miolo.
            const t = Math.min(1, Math.min(du, dv) / BANDA);
            let alfa = Math.pow(1 - t, EXPOENTE);

            // Feather da borda externa, para o halo não terminar em aresta.
            alfa *= suave(du / FEATHER) * suave(dv / FEATHER);

            // Ruído: nunca zera o halo, só o deixa irregular.
            alfa *= 0.55 + 0.45 * ruido(u, v);

            const i = (py * TEX_W + px) * 4;
            img.data[i] = COR.r;
            img.data[i + 1] = COR.g;
            img.data[i + 2] = COR.b;
            img.data[i + 3] = Math.round(alfa * 255);
        }
    }

    ctx.putImageData(img, 0, 0);
    canvas.refresh();
}

/**
 * Cria a névoa dos DOIS castelos e devolve as imagens.
 *
 * O castelo do `enemy` é o espelho em X do mapa, exatamente como
 * `insideHealZone` calcula — por isso a segunda imagem é a primeira refletida,
 * e não um retângulo escrito à mão.
 */
export function createHealZoneFx(scene) {
    criaTextura(scene);

    const largura = HEAL_ZONE.maxX - HEAL_ZONE.minX;
    const altura = HEAL_ZONE.maxY - HEAL_ZONE.minY;
    const centroX = (HEAL_ZONE.minX + HEAL_ZONE.maxX) / 2;
    const centroY = (HEAL_ZONE.minY + HEAL_ZONE.maxY) / 2;

    const imagens = [
        { x: centroX, flip: false },
        { x: WORLD_WIDTH - centroX, flip: true },
    ].map(({ x, flip }) => {
        const img = scene.add.image(x, centroY, TEXTURE_KEY)
            .setOrigin(0.5, 0.5)
            .setDisplaySize(largura, altura)
            .setDepth(DEPTH)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(ALPHA_MIN);

        if (flip) img.setFlipX(true);

        // Respiração lenta. Um tween por castelo, interpolado pelo Phaser:
        // não há cálculo por quadro do nosso lado.
        scene.tweens.add({
            targets: img,
            alpha: ALPHA_MAX,
            duration: PULSO_MS,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
        });

        return img;
    });

    return imagens;
}
