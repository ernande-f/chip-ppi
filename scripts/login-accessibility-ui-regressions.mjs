import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/pages/login.html`;
let browser;

try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('chip-contrast', 'high'));

    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(url);
        const contrast = page.getByRole('button', { name: 'Alto contraste', exact: true });
        await contrast.waitFor();
        assert.equal(await page.locator('html').getAttribute('data-contrast'), 'high');
        assert.equal(await contrast.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.right-side').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
        assert.ok(await contrast.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth;
        }), `Controle de contraste deve ficar visível e acessível em ${width}px`);
        await contrast.focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('html').getAttribute('data-contrast'), 'normal');
        assert.equal(await contrast.getAttribute('aria-pressed'), 'false');
        assert.equal(await page.evaluate(() => localStorage.getItem('chip-contrast')), 'normal');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }

    const systemPage = await browser.newPage({ viewport: { width: 1280, height: 844 }, contrast: 'more', reducedMotion: 'reduce' });
    systemPage.on('pageerror', error => errors.push(error.message));
    await systemPage.goto(url);
    const contrast = systemPage.getByRole('button', { name: 'Alto contraste', exact: true });
    await contrast.waitFor();
    assert.equal(await systemPage.locator('html').getAttribute('data-contrast'), 'high', 'Sem preferência salva, deve seguir o contraste do sistema');
    await systemPage.locator('#infoButton').click();
    await systemPage.locator('#infoModalOverlay').waitFor({ state: 'visible' });
    assert.deepEqual(await systemPage.locator('.info-modal-overlay, .info-modal-card, .info-slide.active').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName)), ['none', 'none', 'none'], 'Redução de movimento deve desativar animações do modal');
    await systemPage.keyboard.press('Escape');
    await contrast.focus();
    await systemPage.keyboard.press('Space');
    await systemPage.reload();
    await systemPage.getByRole('button', { name: 'Alto contraste', exact: true }).waitFor();
    assert.equal(await systemPage.locator('html').getAttribute('data-contrast'), 'normal', 'Escolha explícita deve persistir e prevalecer sobre o sistema');
    assert.deepEqual(errors, []);
    console.log('OK: login respeita contraste persistido/sistema, toggle por teclado e persistência, redução de movimento e layout em 320/390/1280px.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
