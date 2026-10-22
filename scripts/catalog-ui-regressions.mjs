import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { chromium, webkit } from 'playwright';

const categories = ['Instrumentação eletrônica e prototipagem avançada', 'Componentes'];
const products = [
    { id_produto: 1, nome: 'Kit de eletrônica e prototipagem — laboratório', estoque_total: 10002, status_produto: 'Disponível', categorias: categories, cor: 'Azul', descricao_produto: 'Componentes eletrônicos para projetos de pesquisa, ensino e extensão.' },
    { id_produto: 2, nome: 'Placa de desenvolvimento com conectores adicionais', estoque_total: 17, status_produto: 'Disponível', categorias: ['Componentes'], cor: 'Verde', descricao_produto: 'Placa para experimentos e projetos acadêmicos.' },
    { id_produto: 3, nome: 'Multímetro digital do laboratório', estoque_total: 0, status_produto: 'Indisponível', categorias: ['Componentes'], cor: '', descricao_produto: 'Instrumento de medição.' },
    { id_produto: 4, nome: 'Adaptador arquivado com histórico preservado', estoque_total: 0, status_produto: 'Arquivado', categorias: ['Componentes'], cor: '', descricao_produto: 'Adaptador do acervo.' }
];
const profiles = {
    admin: { nome: 'Ernande Facco', email: 'admin@iffar.edu.br', nivel_acesso: 2 },
    student: { nome: 'Estudante com nome extenso para testar o cabeçalho', email: 'estudante@aluno.iffar.edu.br', nivel_acesso: 0, recentOrders: [] },
    visitor: null
};
const mutations = [];
const app = express();
app.use(express.json());
app.get('/api/session', (req, res) => {
    const profile = profiles[req.get('x-catalog-profile')];
    res.json({ user: profile ? { email: profile.email } : null, profile });
});
app.get('/api/categorias', (_req, res) => res.json({ categorias: categories.map(nome_categoria => ({ nome_categoria })) }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 103 }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [] }));
app.get('/api/produtos', (req, res) => {
    let result = products;
    if (req.query.availableOnly === 'true') result = result.filter(product => product.estoque_total > 0 && product.status_produto === 'Disponível');
    if (req.query.search) {
        const search = String(req.query.search).toLocaleLowerCase('pt-BR');
        result = result.filter(product => [product.nome, product.cor, ...product.categorias].join(' ').toLocaleLowerCase('pt-BR').includes(search));
    }
    if (req.query.category) result = result.filter(product => product.categorias.includes(req.query.category));
    res.json({ produtos: result, hasMore: false, isCatalogManager: req.get('x-catalog-profile') === 'admin' });
});
app.get('/api/produtos/:id', (req, res) => res.json({ produto: products.find(product => product.id_produto === Number(req.params.id)) }));
app.use('/api', (req, res) => {
    if (req.method !== 'GET') mutations.push({ method: req.method, path: req.path, body: req.body });
    res.status(500).json({ message: 'Esta regressão não deve gravar dados.' });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const artifacts = await mkdtemp(join(tmpdir(), 'chip-catalog-ui-'));
const widths = [320, 360, 390, 400, 600, 720, 768, 900, 1280];
const errors = [];

async function checkLayout(page, label, width) {
    const geometry = await page.evaluate(() => {
        const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
        const outside = [];
        // Inspect actual content bounds: overflow:hidden must not make a broken layout pass.
        for (const node of document.querySelectorAll('.navbar, .navbar > *, .navbar a, .navbar summary, .inventory-header, .item-card, .item-data, .item-info, .main-footer, .footer-container, .footer-col, .footer-col-icon, .footer-col img')) {
            if (!visible(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.left < -1 || rect.right > innerWidth + 1) outside.push(`${node.tagName}.${node.className}: ${rect.left}..${rect.right}`);
        }
        const footerText = [];
        for (const node of document.querySelectorAll('.footer-col p')) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = node.getBoundingClientRect();
            if (rect.width < 160) footerText.push(`Coluna estreita (${rect.width}px): ${node.textContent.trim()}`);
            for (const line of range.getClientRects()) {
                if (line.left < -1 || line.right > innerWidth + 1) footerText.push(`Texto cortado: ${node.textContent.trim()}`);
            }
        }
        const tinyControls = [...document.querySelectorAll('.navbar a, .navbar summary, .btn-register-new, .btn-edit-item, .add-btn, #managementStatus, #catalogCategory')]
            .filter(visible).filter(node => { const rect = node.getBoundingClientRect(); return rect.width < 43.5 || rect.height < 43.5; })
            .map(node => `${node.tagName}.${node.className}: ${node.getBoundingClientRect().width}x${node.getBoundingClientRect().height}`);
        const smallInputs = [...document.querySelectorAll('.navbar input, #managementStatus, #catalogCategory')]
            .filter(visible).filter(node => parseFloat(getComputedStyle(node).fontSize) < 16).map(node => node.id);
        const header = document.querySelector('.navbar').getBoundingClientRect();
        const search = document.querySelector('.navbar .search-bar').getBoundingClientRect();
        const firstRow = [...document.querySelectorAll('.navbar .logo-container, .navbar .chip-profile-link, .navbar .chip-notification-link, .navbar .chip-menu > summary')]
            .filter(visible).map(node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, center: rect.top + rect.height / 2 }; });
        return { outside, footerText, tinyControls, smallInputs, headerHeight: header.height, searchTop: search.top, firstRow, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.deepEqual(geometry.outside, [], `${label}: elementos fora da tela`);
    assert.deepEqual(geometry.footerText, [], `${label}: rodapé ilegível ou cortado`);
    assert.deepEqual(geometry.tinyControls, [], `${label}: alvo de toque menor que 44px`);
    assert.deepEqual(geometry.smallInputs, [], `${label}: controle de formulário menor que 16px`);
    assert.ok(geometry.scrollWidth <= geometry.viewport, `${label}: rolagem horizontal`);
    if (width <= 400) {
        assert.ok(geometry.headerHeight <= 150, `${label}: cabeçalho usa ${geometry.headerHeight}px`);
        const centers = geometry.firstRow.map(rect => rect.center);
        assert.ok(Math.max(...centers) - Math.min(...centers) <= 4, `${label}: controles do cabeçalho quebraram em várias linhas`);
        assert.ok(geometry.searchTop >= Math.max(...geometry.firstRow.map(rect => rect.bottom)), `${label}: busca deve ocupar a segunda linha`);
    }
}

async function checkMenu(page, role) {
    const summary = page.locator('.chip-menu > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.chip-menu nav');
    await menu.waitFor({ state: 'visible' });
    const controls = menu.locator('a, button');
    assert.equal(await menu.getByRole('link', { name: 'Catálogo', exact: true }).count(), 1);
    assert.equal(await menu.getByRole('link', { name: 'Relatórios', exact: true }).count(), role === 'admin' ? 1 : 0);
    if (role === 'visitor') assert.equal(await menu.getByRole('link', { name: 'Entrar', exact: true }).count(), 1);
    for (let index = 0; index < await controls.count(); index++) {
        await page.keyboard.press('Tab');
        assert.equal(await controls.nth(index).evaluate(node => node === document.activeElement), true, `${role}: ordem de foco do menu`);
        assert.ok(await controls.nth(index).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && rect.height >= 44; }), `${role}: ação do menu cortada`);
    }
    const contrast = page.locator('#contrastToggle');
    await contrast.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('html').getAttribute('data-contrast'), 'high');
    assert.equal(await contrast.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('html').getAttribute('data-contrast'), 'normal');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.chip-menu').evaluate(node => node.open), false);
    assert.equal(await summary.evaluate(node => node === document.activeElement), true);
}

async function checkEditor(page) {
    const trigger = page.locator('.btn-edit-item').first();
    await trigger.click();
    const modal = page.locator('#modalAlterar');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#closeEditModal').evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    assert.ok(await modal.locator('.modal-content').evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && node.scrollHeight > node.clientHeight; }));
    const tinyInputs = await modal.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="file"]), textarea').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && parseFloat(getComputedStyle(node).fontSize) < 16).map(node => node.id));
    assert.deepEqual(tinyInputs, [], 'Inputs do editor não devem provocar zoom automático no celular');
    await page.locator('#editDescription').fill('Texto de teste sem salvar alterações.');
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.move(1, 400);
    await page.mouse.wheel(0, 500);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'O fundo não deve rolar com o editor aberto');
    await page.locator('#closeEditModal').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#deleteItemButton').evaluate(node => node === document.activeElement), true);
    assert.ok(await page.locator('#deleteItemButton').evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), 'Última ação deve ficar acessível pela rolagem do editor');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#closeEditModal').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await trigger.click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#editDescription').inputValue(), products[0].descricao_produto, 'Descartar a edição deve restaurar os dados originais');
    assert.equal(await modal.locator('.modal-content').evaluate(node => node.scrollTop), 0);
    await modal.click({ position: { x: 1, y: 1 } });
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(mutations, [], 'Abrir, preencher e fechar o editor não deve gravar ou arquivar');
}

try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        if (!existsSync(engine.executablePath())) {
            assert.notEqual(name, 'chromium', 'Instale o Chromium do Playwright para executar esta regressão.');
            console.log(`SKIP: ${name} não está instalado (${engine.executablePath()}).`);
            continue;
        }
        const browser = await engine.launch({ headless: true });
        try {
            for (const role of Object.keys(profiles)) {
                const page = await browser.newPage({ viewport: { width: 400, height: 833 }, extraHTTPHeaders: { 'x-catalog-profile': role } });
                page.on('pageerror', error => errors.push(`${name}/${role}: ${error.message}`));
                const path = role === 'admin' ? 'index-tec' : 'pagina-inicial';
                const cardSelector = role === 'admin' ? '#itemsGrid .item-card' : '#catalogGrid .item-card';
                for (const width of widths) {
                    await page.setViewportSize({ width, height: 833 });
                    await page.goto(`${base}/pages/${path}.html`);
                    await page.locator(cardSelector).first().waitFor();
                    await page.locator('.chip-menu > summary').waitFor();
                    await checkLayout(page, `${name}/${role}/${width}px`, width);
                    if (role === 'admin' && [400, 1280].includes(width)) {
                        await page.screenshot({ path: join(artifacts, `${name}-${width}-top.png`) });
                        await page.locator('.main-footer').scrollIntoViewIfNeeded();
                        await page.screenshot({ path: join(artifacts, `${name}-${width}-footer.png`) });
                    }
                }
                await page.setViewportSize({ width: 400, height: 833 });
                await page.goto(`${base}/pages/${path}.html`);
                await page.locator(cardSelector).first().waitFor();
                await checkMenu(page, role);
                const search = page.locator(role === 'admin' ? '#managementSearch' : '#catalogSearch');
                const searched = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/produtos' && url.searchParams.get('search') === 'Multímetro'; });
                await search.fill('Multímetro');
                await searched;
                if (role === 'admin') await page.getByRole('heading', { name: products[2].nome, exact: true }).waitFor();
                else await page.getByText('Nenhum item disponível corresponde à sua pesquisa.', { exact: true }).waitFor();
                const cleared = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/produtos' && !url.searchParams.has('search'); });
                await search.fill('');
                await cleared;
                await page.getByRole('heading', { name: products[0].nome, exact: true }).waitFor();
                if (role === 'admin') {
                    await page.locator('#managementStatus').selectOption('Arquivado');
                    assert.equal(await page.locator(cardSelector).count(), 1);
                    assert.match(await page.locator(cardSelector).innerText(), /Adaptador arquivado/);
                    await page.locator('#managementStatus').selectOption('');
                    await checkEditor(page);
                } else {
                    await page.locator('#catalogCategory').selectOption(categories[0]);
                    await page.getByRole('heading', { name: products[0].nome, exact: true }).waitFor();
                    await page.waitForFunction(() => document.querySelectorAll('#catalogGrid .item-card').length === 1);
                    assert.equal(await page.locator('.orders-section').isVisible(), role === 'student');
                }
                await page.close();
            }
        } finally {
            await browser.close();
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations, []);
    console.log(`OK: catálogo admin/estudante/visitante em ${widths.join('/')}px, cabeçalho compacto, rodapé completo, toque, busca, filtros e editor por teclado. Capturas: ${artifacts}`);
} finally {
    server.close();
    await once(server, 'close');
}
