import assert from 'node:assert/strict';
import test from 'node:test';

const { ProductValidationError, validateProductPayload } = await import('../backend/services/productService.js');

test('valida os campos obrigatórios do cadastro de item', () => {
    assert.throws(
        () => validateProductPayload({
            nome: 'Arduino Uno',
            descricao_produto: '',
            estoque_total: 2,
            cor: 'Azul',
            foto_produto: 'data:image/png;base64,abc',
            categorias: ['Placas']
        }),
        ProductValidationError
    );
});

test('aceita estoque zero e categoriza entradas duplicadas apenas uma vez', () => {
    const product = validateProductPayload({
        nome: 'Arduino Uno',
        descricao_produto: 'Placa para prototipação.',
        estoque_total: 0,
        cor: 'Azul',
        foto_produto: 'data:image/png;base64,abc',
        categorias: ['Placas', 'placas', 'Componentes']
    });

    assert.equal(product.estoque_total, 0);
    assert.deepEqual(product.categorias, ['Placas', 'Componentes']);
});

test('rejeita estoque negativo e foto ausente', () => {
    assert.throws(
        () => validateProductPayload({
            nome: 'Protoboard',
            descricao_produto: 'Base para montagem de circuitos.',
            estoque_total: -1,
            cor: 'Branca',
            foto_produto: '',
            categorias: ['Componentes']
        }),
        ProductValidationError
    );
});
