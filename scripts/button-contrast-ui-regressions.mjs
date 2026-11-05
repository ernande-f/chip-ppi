import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

function luminance(color) {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

const app = express();
app.get('/api/session', (_req, res) => res.json({ user: { email: 'test@example.invalid' }, profile: { nome: 'Pessoa Teste', nivel_acesso: 0 } }));
app.get('/api/categorias', (_req, res) => res.json({ categorias: [] }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [] }));
app.get('/api/produtos', (_req, res) => res.json({ produtos: [{ id_produto: 1, nome: 'Arduino', descricao_produto: 'Placa para teste de contraste.', estoque_total: 5, categorias: ['Componentes'] }], hasMore: false }));
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [];
    const measured = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const [file, selector] of [['login', '.btn-entrar'], ['pagina-inicial', '.add-btn']]) {
            await page.goto(`http://127.0.0.1:${server.address().port}/pages/${file}.html`);
            const button = page.locator(selector);
            await button.waitFor();
            await page.locator('#contrastToggle').waitFor({ state: 'attached' });
            const toggleContrast = async () => {
                const menu = page.locator('.chip-menu');
                if (await menu.count()) await menu.locator('summary').click();
                await page.locator('#contrastToggle').click();
                if (await menu.count()) await page.keyboard.press('Escape');
            };
            await button.evaluate(node => node.addEventListener('click', event => {
                event.preventDefault();
                event.stopImmediatePropagation();
            }, { capture: true }));
            for (const state of ['normal', 'hover', 'active', 'high']) {
                if (state === 'normal') await page.mouse.move(1, 1);
                if (state === 'hover') await button.hover();
                if (state === 'active') await page.mouse.down();
                if (state === 'high') {
                    await page.mouse.up();
                    await toggleContrast();
                    assert.equal(await page.locator('html').getAttribute('data-contrast'), 'high');
                }
                const colors = await button.evaluate(node => {
                    const style = getComputedStyle(node);
                    return { foreground: style.color, background: style.backgroundColor };
                });
                const values = [luminance(colors.foreground), luminance(colors.background)].sort((a, b) => a - b);
                const ratio = (values[1] + .05) / (values[0] + .05);
                assert.ok(ratio >= 4.5, `${file}/${width}px/${state}: contraste ${ratio}:1`);
                measured.push({ file, width, state, ratio: Number(ratio.toFixed(2)) });
            }
            await toggleContrast();
        }
    }
    assert.deepEqual(errors, []);
    console.log(`OK: contraste ≥4,5:1 nos CTAs Google/catálogo, normal/hover/active/alto contraste em 320/390/1280px. Menor razão: ${Math.min(...measured.map(row => row.ratio))}:1.`);
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
