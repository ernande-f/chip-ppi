import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const profile = { nome: 'Pessoa Estudante', email: 'pessoa@aluno.iffar.edu.br', nivel_acesso: 0, recentOrders: [] };
let logouts = 0;
const app = express();
app.get('/api/session', (_req, res) => res.json({ user: { email: profile.email }, profile }));
app.get('/api/profile', (_req, res) => res.json({ profile }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.post('/api/logout', (_req, res) => { logouts++; res.json({ message: 'Sessão encerrada.' }); });
app.get('/login', (_req, res) => res.redirect('/pages/login.html'));
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;

try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const focused = selector => page.locator(selector).evaluate(node => node === document.activeElement);

    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 600 });
        await page.goto(`${base}/pages/login.html`);
        await page.locator('#infoModalClose').waitFor({ state: 'attached' });
        await page.evaluate(() => { document.body.style.overflow = 'clip'; });
        const trigger = width > 768 ? '#infoButton' : '.btn-entrar';
        await page.locator(trigger).focus();
        if (width > 768) {
            assert.notEqual(await page.locator(trigger).evaluate(node => getComputedStyle(node).outlineStyle), 'none');
            await page.keyboard.press('Enter');
        } else {
            await page.evaluate(async () => (await import('/js/info-modal.js')).openInfoModal());
        }
        assert.equal(await focused('#infoModalClose'), true);
        assert.equal(await page.locator('#infoModalOverlay').getAttribute('aria-modal'), 'true');
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused('.info-dot:last-child'), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.info-dot:last-child').getAttribute('aria-pressed'), 'true');
        assert.match(await page.locator('.info-slide.active h2').innerText(), /Prática Profissional/);
        await page.keyboard.press('Tab');
        assert.equal(await focused('#infoModalClose'), true);
        assert.ok(await page.locator('.info-modal-card').evaluate(node => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        }), `Informações devem caber em ${width}px`);
        await page.keyboard.press('Escape');
        assert.equal(await focused(trigger), true);
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'clip');

        await page.goto(`${base}/pages/perfil.html`);
        await page.locator('#profileName').getByText(profile.nome, { exact: true }).waitFor();
        await page.locator('#logoutTrigger').focus();
        await page.keyboard.press('Enter');
        assert.equal(await focused('#cancelLogout'), true);
        assert.equal(await page.getByRole('dialog', { name: 'Sair', exact: true }).count(), 1);
        await page.keyboard.press('Tab');
        assert.equal(await focused('#confirmLogout'), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused('#cancelLogout'), true);
        await page.keyboard.press('Escape');
        assert.equal(await focused('#logoutTrigger'), true);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        await page.locator('#logoutTrigger').click();
        await page.locator('#cancelLogout').click();
        assert.equal(await focused('#logoutTrigger'), true);
        await page.locator('#logoutTrigger').click();
        await page.locator('#logoutModal').click({ position: { x: 1, y: 1 } });
        assert.equal(await focused('#logoutTrigger'), true);
    }
    assert.equal(logouts, 0, 'Cancelar, Escape e fundo não devem encerrar a sessão');
    await page.locator('#logoutTrigger').click();
    await page.locator('#confirmLogout').click();
    await page.waitForURL('**/pages/login.html');
    assert.equal(logouts, 1);
    assert.deepEqual(errors, []);
    console.log('OK: modais de informações e saída com foco, Tab, Escape, retorno, rolagem, carrossel e logout em 320/390/1280px.');
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
