import postgres from 'postgres'
import 'dotenv/config'

const connectionString = process.env.DATABASE_URL_POOLER
// O pooler transacional do Supabase (porta 6543) não mantém prepared statements
// entre conexões.
const sql = postgres(connectionString, { prepare: false })

export default sql
