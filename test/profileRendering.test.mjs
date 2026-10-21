import assert from 'node:assert/strict';
import test from 'node:test';

test('perfil mantém HTML vindo da API em textContent', async (t) => {
    const payload = '<img src=x onerror="window.injected=true"><b>recusa</b>';
    const elements = new Map();
    const element = () => ({ addEventListener() {}, style: {} });
    let onReady;
    let card;
    const originalDocument = globalThis.document;
    globalThis.document = {
        addEventListener(event, listener) { assert.equal(event, 'DOMContentLoaded'); onReady = listener; },
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        querySelector() { return null; },
        createElement(tag) {
            assert.equal(tag, 'article');
            const fields = new Map(['h3', '.order-id span', '.order-text'].map(selector => [selector, element()]));
            card = {
                querySelector(selector) { return fields.get(selector); },
                querySelectorAll(selector) { assert.equal(selector, '.order-meta span'); return [element(), element()]; }
            };
            return card;
        }
    };
    t.after(() => {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    });
    const container = globalThis.document.getElementById('ordersPreview');
    container.replaceChildren = (...children) => { container.children = children; };
    t.mock.method(globalThis, 'fetch', async (url) => {
        assert.equal(url, '/api/profile');
        return Response.json({ profile: {
            nome: 'Estudante', email: 'student@aluno.iffar.edu.br', nivel_acesso: 0,
            recentOrders: [{ id_pedido: payload, status: payload, motivo_recusa: payload, data_pedido: '2026-10-20', data_devolucao: '2026-10-27' }]
        } });
    });

    await import('../frontend/js/profile.js');
    await onReady();

    assert.deepEqual(container.children, [card]);
    assert.equal(card.querySelector('.order-text').textContent, payload);
    assert.equal(card.querySelector('h3').textContent, `Pedido #${payload}`);
    assert.equal(card.querySelector('.order-id span').textContent, payload);
    assert.doesNotMatch(card.innerHTML, /<img|<b>|onerror/);
});

test('impressão do termo usa listener externo', async (t) => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    let click;
    let prints = 0;
    globalThis.document = { getElementById(id) {
        assert.equal(id, 'printTerms');
        return { addEventListener(event, listener) { assert.equal(event, 'click'); click = listener; } };
    } };
    globalThis.window = { print() { prints++; } };
    t.after(() => {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });
    await import('../frontend/js/terms.js');
    click();
    assert.equal(prints, 1);
});
