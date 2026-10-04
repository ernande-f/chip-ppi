import { getServerConfig, getDatabaseConfig, getGoogleConfig } from '../backend/config.js';
import { getSessionSecret } from '../backend/services/sessionAuth.js';

for (const [label, check] of [['Servidor', getServerConfig], ['PostgreSQL', getDatabaseConfig], ['Google OAuth', getGoogleConfig], ['Sessões', getSessionSecret]]) {
    try {
        check();
        console.log(`${label}: configuração válida.`);
    } catch (error) {
        console.error(`${label}: ${error.message}`);
        process.exitCode = 1;
    }
}
if (!process.exitCode) {
    const { redirectUri } = getGoogleConfig();
    console.log(`URI a cadastrar no Google: ${redirectUri}`);
    await import('./check-database.mjs');
}
