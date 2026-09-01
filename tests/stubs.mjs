// Stubs mínimos: só o bastante para os módulos do cliente CARREGAREM em Node.
// Nada aqui simula o jogo — o que está sob teste é a lógica de ciclo de vida
// da cena `Arena`, e ela não toca em nenhuma destas peças.
class Base { constructor() {} }
const noop = () => {};
const chain = new Proxy(function () {}, {
    get: () => chain,
    apply: () => chain,
    construct: () => chain,
});

globalThis.Phaser = {
    Scene: class { constructor() {} },
    Core: {
        Events: {
            BLUR: 'blur', HIDDEN: 'hidden',
            PRE_STEP: 'prestep', STEP: 'step', POST_STEP: 'poststep',
            PRE_RENDER: 'prerender', POST_RENDER: 'postrender',
        },
    },
    Physics: { Arcade: { Sprite: Base } },
    GameObjects: { Sprite: Base, Container: Base, Graphics: Base, Image: Base },
    Math: {
        Between: (a) => a, FloatBetween: (a) => a,
        // Implementacoes reais: os testes de desenho dependem do RESULTADO,
        // nao so de a funcao existir.
        Clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
        Linear: (p0, p1, t) => (p1 - p0) * t + p0,
        Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) },
        Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1) },
    },
    BlendModes: { ADD: 1, NORMAL: 0 },
    Display: { Color: chain },
    Geom: chain,
    Input: { Keyboard: { KeyCodes: new Proxy({}, { get: () => 0 }) } },
    Renderer: {
        WebGL: {
            Pipelines: {
                Events: { BEFORE_FLUSH: 'pipelinebeforeflush', AFTER_FLUSH: 'pipelineafterflush' },
            },
        },
    },
    Scale: {
        RESIZE: 'RESIZE', FIT: 'FIT', EXPAND: 'EXPAND', CENTER_BOTH: 'CENTER_BOTH',
        Events: { RESIZE: 'resize' },
    },
    AUTO: 0,
};

const CloseCode = {
    NORMAL_CLOSURE: 1000, GOING_AWAY: 1001, NO_STATUS_RECEIVED: 1005,
    ABNORMAL_CLOSURE: 1006, CONSENTED: 4000, SERVER_SHUTDOWN: 4001,
    WITH_ERROR: 4002, FAILED_TO_RECONNECT: 4003, MAY_TRY_RECONNECT: 4010,
};

globalThis.Colyseus = {
    CloseCode,
    Client: class {},
    // `$(state).actors.onAdd(cb)` — devolve encadeamento que registra os
    // callbacks na própria FakeRoom, para o teste poder disparar.
    getStateCallbacks: (room) => (state) => ({
        actors: {
            onAdd: (cb) => { room._cbs.onAdd.push(cb); },
            onRemove: (cb) => { room._cbs.onRemove.push(cb); },
        },
    }),
};

// `Viewport` le os `env(safe-area-inset-*)` por variavel de CSS. O teste
// controla os valores por `globalThis.__insets`.
globalThis.__insets = {};

globalThis.window = {
    getComputedStyle: () => ({
        getPropertyValue: (nome) => (globalThis.__insets && globalThis.__insets[nome]) || '0px',
    }),
    innerWidth: 1280,
    innerHeight: 720,
    location: { search: '', href: 'http://localhost:8000/', protocol: 'http:', reload: noop, assign: noop },
    sessionStorage: { getItem: () => null, setItem: noop },
    addEventListener: noop, removeEventListener: noop,
};
const elemento = () => ({
    getContext: () => ({}), addEventListener: noop, removeEventListener: noop,
    appendChild: noop, focus: noop, select: noop, setAttribute: noop,
    classList: { add: noop, remove: noop }, style: {}, value: '', hidden: true,
    querySelector: () => elemento(), querySelectorAll: () => [],
});
globalThis.document = {
    createElement: elemento, getElementById: elemento,
    querySelector: elemento, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    body: elemento(), documentElement: elemento(),
};
globalThis.performance = globalThis.performance || { now: () => 0 };
globalThis.navigator = { userAgent: 'node' };

export { CloseCode };
