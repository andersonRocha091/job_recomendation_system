import { Pool } from 'pg';

export class DatabaseConnection {
    private static instance: DatabaseConnection;
    private readonly pool: Pool;

    private constructor() {
        this.pool = new Pool({
            host:     process.env.DB_HOST     || 'localhost',
            port:     Number(process.env.DB_PORT) || 5432,
            database: process.env.DB_NAME     || 'job_recommendation',
            user:     process.env.DB_USER     || 'user',
            password: process.env.DB_PASSWORD || 'user',
        });
    }

    public static getInstance(): DatabaseConnection {
        if (!DatabaseConnection.instance) {
            DatabaseConnection.instance = new DatabaseConnection();
        }
        return DatabaseConnection.instance;
    }

    public getPool(): Pool {
        return this.pool;
    }
}
