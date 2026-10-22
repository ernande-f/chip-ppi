import assert from 'node:assert/strict';
import test from 'node:test';
import { isUserTechnical } from '../frontend/js/api.js';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { getAccessLevelLabel, normalizeDisplayName, updateProfileByAuthUserId } = await import('../backend/services/userProfile.js');

test('perfil identifica professor pelo domínio sem conceder acesso técnico', () => {
    const email = 'professor@IFFARROUPILHA.EDU.BR';
    const label = getAccessLevelLabel(0, email);
    assert.equal(label, 'Professor');
    assert.equal(isUserTechnical({ nivel_acesso: 0, nivel_acesso_label: label }), false);
    for (const otherEmail of [undefined, null, 'aluno@aluno.iffar.edu.br', 'usuario@example.test', 'usuario@sub.iffarroupilha.edu.br', 'usuario@iffarroupilha.edu.br.example.test']) {
        assert.equal(getAccessLevelLabel(0, otherEmail), 'Estudante');
    }
});

test('níveis técnico e administrador prevalecem sobre o domínio do perfil', () => {
    const email = 'professor@iffarroupilha.edu.br';
    for (const level of [1, 'tecnico', 'técnico']) assert.equal(getAccessLevelLabel(level, email), 'Técnico');
    for (const level of [2, 'adm', 'administrador']) assert.equal(getAccessLevelLabel(level, email), 'Administrador');
});

test('nome do perfil aceita de 3 a 60 caracteres e remove espaços externos', () => {
    assert.equal(normalizeDisplayName(' Ana '), 'Ana');
    assert.equal(normalizeDisplayName('a'.repeat(60)), 'a'.repeat(60));
});

test('nome inválido é recusado antes de consultar o banco', async () => {
    for (const name of [undefined, null, {}, [], 123, '', '  ', 'ab', 'a'.repeat(61)]) {
        await assert.rejects(updateProfileByAuthUserId('profile-id', { name }), /nome válido entre 3 e 60 caracteres/);
    }
});
