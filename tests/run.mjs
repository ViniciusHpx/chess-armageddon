/**
 * Testes do cliente: `node tests/run.mjs` (na raiz do projeto).
 *
 * O cliente não tem build system nem `package.json` — e não é para ter, porque
 * `index.html` carrega `src/main.js` direto no navegador. O efeito colateral é
 * que, para o Node, todo `.js` daqui é CommonJS e `import` não compila.
 *
 * Em vez de plantar um `package.json` só para o teste (que mudaria como o
 * projeto inteiro é interpretado), este runner copia `src/` para uma pasta
 * temporária trocando a extensão para `.mjs`, reescreve os `from './x.js'` na
 * mesma medida, e roda os testes contra a CÓPIA. O código fonte não é tocado e
 * a cópia é descartada no fim, então não existe versão paralela para
 * dessincronizar.
 *
 * O navegador continua sendo a última palavra: o que roda aqui é a lógica que
 * não depende de canvas nem de socket. O que não dá para automatizar está
 * escrito no cabeçalho de cada arquivo de teste.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const raiz = path.resolve(import.meta.dirname, '..');
const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-armageddon-testes-'));

/** Copia `src/**\/*.js` como `.mjs`, corrigindo os especificadores de import. */
function copiarComoEsm(de, para) {
    for (const nome of fs.readdirSync(de)) {
        const origem = path.join(de, nome);

        if (fs.statSync(origem).isDirectory()) {
            const sub = path.join(para, nome);
            fs.mkdirSync(sub, { recursive: true });
            copiarComoEsm(origem, sub);
            continue;
        }

        if (!nome.endsWith('.js')) continue;

        const texto = fs.readFileSync(origem, 'utf8').replace(/(from\s+'[^']+)\.js'/g, "$1.mjs'");
        fs.writeFileSync(path.join(para, nome.slice(0, -3) + '.mjs'), texto, 'utf8');
    }
}

/** Módulos de teste, na ordem em que rodam. */
const SUITES = ['lifecycle.mjs', 'viewport.mjs', 'layout.mjs', 'render.mjs', 'gpu.mjs', 'cpu.mjs'];

try {
    fs.mkdirSync(path.join(destino, 'src'), { recursive: true });
    copiarComoEsm(path.join(raiz, 'src'), path.join(destino, 'src'));
    for (const arquivo of ['stubs.mjs', ...SUITES]) {
        fs.copyFileSync(path.join(import.meta.dirname, arquivo), path.join(destino, arquivo));
    }

    let total = 0;
    let falhas = 0;

    for (const suite of SUITES) {
        const modulo = await import(pathToFileURL(path.join(destino, suite)).href);
        const resultado = await modulo.run();
        total += resultado.pass + resultado.fail;
        falhas += resultado.fail;
    }

    console.log(`\n${total - falhas} PASS, ${falhas} FAIL`);
    process.exitCode = falhas ? 1 : 0;
} finally {
    fs.rmSync(destino, { recursive: true, force: true });
}
