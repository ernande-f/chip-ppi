import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const products = ['Resistor', 'Capacitor'].flatMap((name, group) =>
    ['Disponível', 'Arquivado', 'Indisponível'].flatMap((status, state) =>
        Array.from({ length: 25 }, (_, index) => ({
            id_produto: group * 75 + state * 25 + index + 1,
            nome: `${name} ${status} ${index + 1}`,
            status_produto: status,
            estoque_total: status === 'Disponível' ? 5 : 0,
            categorias: [index % 2 ? 'Categoria B' : 'Categoria A'],
            descricao_produto: 'Componente para verificar busca e paginação.'
        }))));
const holds = [];
const releases = [];
const queries = [];
let active = 0;
let maxActive = 0;
function pauseNext(match, fail = false) {
    let start, release;
    const started = new Promise(resolve => { start = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    releases.push(release);
    holds.push({ match, start, released, fail });
    return { started, release };
}
const app = express();
app.get('/api/session', (req, res) => res.json({ user: { email: 'test@example.invalid' },
    profile: { nome: 'Pessoa Teste', nivel_acesso: req.get('x-test-role') === 'admin' ? 2 : 0, recentOrders: [] } }));
app.get('/api/categorias', (_req, res) => res.json({ categorias: ['Categoria A', 'Categoria B'].map(nome_categoria => ({ nome_categoria })) }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [] }));
app.get('/api/produtos', async (req, res) => {
    const query = { ...req.query };
    queries.push(query);
    active++;
    maxActive = Math.max(maxActive, active);
    const index = holds.findIndex(hold => hold.match(query));
    const hold = index >= 0 ? holds.splice(index, 1)[0] : null;
    if (hold) { hold.start(query); await hold.released; }
    active--;
    if (hold?.fail) return res.status(500).json({ message: 'Falha de uma pesquisa antiga.' });
    const result = products.filter(product =>
        (!query.search || product.nome.toLowerCase().includes(query.search.toLowerCase()))
        && (!query.category || product.categorias.includes(query.category))
        && (!query.status || product.status_produto === query.status)
        && (query.availableOnly !== 'true' || product.status_produto === 'Disponível'));
    const page = Number(query.page);
    const limit = Number(query.limit);
    res.json({ produtos: result.slice((page - 1) * limit, page * limit), hasMore: page * limit < result.length });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const role of ['student', 'admin']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-test-role': role } });
        page.setDefaultTimeout(10_000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const grid = role === 'admin' ? '#itemsGrid' : '#catalogGrid';
        const search = page.locator(role === 'admin' ? '#managementSearch' : '#catalogSearch');
        const filter = page.locator(role === 'admin' ? '#managementStatus' : '#catalogCategory');
        const sentinel = role === 'admin' ? '#itemsSentinel' : '#catalogSentinel';
        const expectNames = async (word, count = 20) => {
            await page.waitForFunction(({ grid, word, count }) => {
                const names = [...document.querySelectorAll(`${grid} .item-card h3`)].map(node => node.textContent);
                return names.length === count && names.every(name => name.startsWith(word));
            }, { grid, word, count });
        };

        const initial = pauseNext(query => !query.search && query.page === '1');
        await page.goto(`http://127.0.0.1:${server.address().port}/pages/${role === 'admin' ? 'index-tec' : 'pagina-inicial'}.html`);
        await initial.started;
        await search.fill('resistor');
        initial.release();
        await expectNames('Resistor');

        const previous = pauseNext(query => query.search === 'res');
        await search.fill('res');
        await previous.started;
        await search.fill('capacitor');
        await page.waitForTimeout(300);
        previous.release();
        await expectNames('Capacitor');

        const filtering = pauseNext(query => query.search === 'resistor');
        await search.fill('resistor');
        await filtering.started;
        await filter.selectOption(role === 'admin' ? 'Arquivado' : 'Categoria B');
        filtering.release();
        await expectNames('Resistor', role === 'admin' ? 20 : 12);
        if (role === 'admin') assert.ok((await page.locator(`${grid} .status-badge`).allTextContents()).every(status => status === 'Arquivado'));
        else assert.ok((await page.locator(`${grid} .item-card`).allTextContents()).every(text => text.includes('Categoria B')));

        // One page in flight must not append old results after a new search.
        await filter.selectOption(role === 'admin' ? 'Disponível' : '');
        await expectNames('Resistor');
        const nextPage = pauseNext(query => query.search === 'resistor' && query.page === '2');
        await page.locator(sentinel).scrollIntoViewIfNeeded();
        await nextPage.started;
        await search.fill('capacitor');
        nextPage.release();
        await expectNames('Capacitor');
        await page.locator(sentinel).scrollIntoViewIfNeeded();
        await expectNames('Capacitor', 25);
        assert.equal(new Set(await page.locator(`${grid} .item-card h3`).allTextContents()).size, 25);
        assert.equal(await page.locator(sentinel).count(), 0);

        const failure = pauseNext(query => query.search === 'erro antigo', true);
        await search.fill('erro antigo');
        await failure.started;
        await search.fill('resistor');
        failure.release();
        await expectNames('Resistor');
        assert.equal(await page.getByText('Falha de uma pesquisa antiga.', { exact: true }).count(), 0);
        assert.ok(queries.some(query => query.search === 'capacitor' && query.page === '1'));
        assert.deepEqual(errors, []);
        await page.close();
    }
    assert.equal(maxActive, 1, 'As consultas do catálogo devem ser serializadas.');
    console.log('OK: busca mais recente durante carga inicial, requisição atrasada, troca de filtro, paginação e erro antigo; sem sobreposição ou resultados misturados.');
} finally {
    for (const release of releases) release();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
