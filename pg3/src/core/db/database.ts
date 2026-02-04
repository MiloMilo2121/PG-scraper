
import * as fs from 'fs';
import * as path from 'path';
// import Database from 'better-sqlite3';

export class DatabaseService {
    private static instance: DatabaseService;
    private db: any;

    private constructor() {
        const dbPath = path.join(process.cwd(), 'data.db');
        // this.db = new Database(dbPath);
        console.log(`[Database] Initialized at ${dbPath} (Mock)`);
        // this.init();
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    private init() {
        // this.db.exec(`
        //     CREATE TABLE IF NOT EXISTS companies (
        //         id INTEGER PRIMARY KEY AUTOINCREMENT,
        //         name TEXT NOT NULL,
        //         vat TEXT UNIQUE,
        //         status TEXT DEFAULT 'NEW'
        //     )
        // `);
    }

    public getCompany(id: number) {
        // return this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
        return null; // Mock
    }

    public saveCompany(company: any) {
        console.log(`[Database] Saved company ${company.name}`);
    }

    // Task 9: State Management
    public updateState(id: number, state: string) {
        console.log(`[Database] Updated ${id} to ${state}`);
    }
}
