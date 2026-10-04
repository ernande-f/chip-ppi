import postgres from 'postgres';
import { getDatabaseConfig } from './config.js';

const { url, options } = getDatabaseConfig();
const sql = postgres(url, options);

export default sql;
