import { getServerConfig, getDatabaseConfig, getGoogleConfig } from '../backend/config.js';
import { getSessionSecret } from '../backend/services/sessionAuth.js';
import { getEmailConfig } from '../backend/services/notificationService.js';

for (const [label, check] of [['Servidor', getServerConfig], ['PostgreSQL', getDatabaseConfig], ['Google OAuth', getGoogleConfig], ['Sessões', getSessionSecret], ['E-mail', getEmailConfig]]) {
    try {
        check();
        console.log(`${label}: configuração válida.`);
    } catch (error) {
        console.error(`${label}: ${error.message}`);
        process.exitCode = 1;
    }
}
if (!process.exitCode) {
    console.log(`Envio de e-mails: ${getEmailConfig().enabled ? 'habilitado' : 'desativado; notificações internas disponíveis'}.`);
    const { redirectUri } = getGoogleConfig();
    console.log(`URI a cadastrar no Google: ${redirectUri}`);
    await import('./check-database.mjs');
}
