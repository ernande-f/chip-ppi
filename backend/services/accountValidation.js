export class AccountAccessError extends Error {}

export function assertAccountIsActive(profile) {
    if (!profile) {
        throw new AccountAccessError('Perfil de usuário não encontrado.');
    }

    if (!profile.status_conta) {
        throw new AccountAccessError('Esta conta está bloqueada. Procure a administração do laboratório.');
    }
}
