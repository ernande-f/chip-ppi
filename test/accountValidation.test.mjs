import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertAccountIsActive,
    getInstitutionalUserType,
    isInstitutionalEmail,
    isValidCpf,
    validatePassword
} from '../backend/services/accountValidation.js';

test('valida CPF pelos dígitos verificadores', () => {
    assert.equal(isValidCpf('529.982.247-25'), true);
    assert.equal(isValidCpf('123.456.789-09'), true);
    assert.equal(isValidCpf('111.111.111-11'), false);
    assert.equal(isValidCpf('123.456.789-00'), false);
});

test('aceita somente os domínios institucionais documentados', () => {
    assert.equal(isInstitutionalEmail('aluno@aluno.iffar.edu.br'), true);
    assert.equal(isInstitutionalEmail('professor@iffarroupilha.edu.br'), true);
    assert.equal(isInstitutionalEmail('pessoa@gmail.com'), false);
    assert.equal(isInstitutionalEmail('pessoa@aluno.iffar.edu.br.evil.test'), false);
    assert.equal(isInstitutionalEmail('pessoa@evil.test@aluno.iffar.edu.br'), false);
});

test('classifica estudante e professor pelo domínio institucional', () => {
    assert.equal(getInstitutionalUserType('aluno@aluno.iffar.edu.br'), 'estudante');
    assert.equal(getInstitutionalUserType('professor@iffarroupilha.edu.br'), 'professor');
    assert.equal(getInstitutionalUserType('pessoa@example.com'), null);
});

test('aplica a política de senha em um único ponto', () => {
    assert.doesNotThrow(() => validatePassword('Senha@123'));
    assert.throws(() => validatePassword('Senha123'), /caractere especial/);
    assert.throws(() => validatePassword('Senha@abc'), /número/);
    assert.throws(() => validatePassword('Sé nha@123'), /ASCII/);
    assert.throws(() => validatePassword('Cur1@'), /6 caracteres/);
    assert.throws(() => validatePassword(`${'A'.repeat(63)}1@`), /64 caracteres/);
});

test('recusa contas inexistentes ou bloqueadas', () => {
    assert.doesNotThrow(() => assertAccountIsActive({ status_conta: true }));
    assert.throws(() => assertAccountIsActive({ status_conta: false }), /bloqueada/);
    assert.throws(() => assertAccountIsActive(null), /não encontrado/);
});
