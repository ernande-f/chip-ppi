const STUDENT_DOMAIN = 'aluno.iffar.edu.br';
const STAFF_DOMAIN = 'iffarroupilha.edu.br';
const ALLOWED_PASSWORD_CHARACTERS = /^[A-Za-z0-9!@#$%^&*()_+=]+$/;
const SPECIAL_CHARACTER = /[!@#$%^&*()_+=]/;

export class AccountAccessError extends Error {}

function getEmailDomain(email) {
    if (typeof email !== 'string') {
        return null;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(normalizedEmail)) {
        return null;
    }

    const separator = normalizedEmail.lastIndexOf('@');

    if (separator < 1 || separator === normalizedEmail.length - 1) {
        return null;
    }

    return normalizedEmail.slice(separator + 1);
}

export function isValidCpf(cpf) {
    const digits = String(cpf || '').replace(/\D/g, '');

    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
        return false;
    }

    const calculateDigit = (length) => {
        let sum = 0;

        for (let index = 0; index < length; index += 1) {
            sum += Number(digits[index]) * (length + 1 - index);
        }

        const remainder = (sum * 10) % 11;
        return remainder === 10 ? 0 : remainder;
    };

    return calculateDigit(9) === Number(digits[9]) && calculateDigit(10) === Number(digits[10]);
}

export function getInstitutionalUserType(email) {
    const domain = getEmailDomain(email);

    if (domain === STUDENT_DOMAIN) {
        return 'estudante';
    }

    if (domain === STAFF_DOMAIN) {
        return 'professor';
    }

    return null;
}

export function isInstitutionalEmail(email) {
    return getInstitutionalUserType(email) !== null;
}

export function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 6) {
        throw new Error('A senha deve ter no mínimo 6 caracteres.');
    }

    if (password.length > 64) {
        throw new Error('A senha deve ter no máximo 64 caracteres.');
    }

    if (!ALLOWED_PASSWORD_CHARACTERS.test(password)) {
        throw new Error('A senha deve usar apenas caracteres ASCII permitidos, sem espaços, acentos ou hífen.');
    }

    if (!/\d/.test(password)) {
        throw new Error('A senha deve conter pelo menos um número.');
    }

    if (!SPECIAL_CHARACTER.test(password)) {
        throw new Error('A senha deve conter pelo menos um caractere especial permitido.');
    }
}

export function assertAccountIsActive(profile) {
    if (!profile) {
        throw new AccountAccessError('Perfil de usuário não encontrado.');
    }

    if (!profile.status_conta) {
        throw new AccountAccessError('Esta conta está bloqueada. Procure a administração do laboratório.');
    }
}
