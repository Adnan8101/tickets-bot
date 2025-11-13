import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface DataRow {
  id: string;
  type: 'panel' | 'ticket' | 'autosave' | 'config';
  data: string;
  updatedAt: string;
}

export interface PanelData {
  id: string;
  type: 'panel';
  name?: string;
  channel?: string;
  openCategory?: string;
  closeCategory?: string;
  staffRole?: string;
  logsChannel?: string;
  transcriptChannel?: string;
  label: string;
  emoji: string;
  color: string;
  description: string;
  openMessage: string;
  questions: string[];
  claimable: boolean;
  allowOwnerClose?: boolean;
  enabled: boolean;
  messageId?: string;
  ticketsCreated?: number;
  userPermissions?: string[];
  staffPermissions?: string[];
}

export interface TicketData {
  id: string;
  type: 'ticket';
  owner: string;
  panelId: string;
  channelId: string;
  state: 'open' | 'closed';
  claimedBy?: string;
  createdAt: string;
  closedAt?: string;
  welcomeMessageId?: string;
  closeMessageId?: string;
}

export interface AutosaveData {
  id: string;
  type: 'autosave';
  userId: string;
  panelId?: string;
  data: Partial<PanelData>;
  tempPanel?: PanelData;
  startedAt: string;
}

export type StoredData = PanelData | TicketData | AutosaveData;

class UniversalDB {
  private db: Database.Database;
  private savePrepared!: Database.Statement;
  private getPrepared!: Database.Statement;
  private deletePrepared!: Database.Statement;
  private getByTypePrepared!: Database.Statement;

  constructor(dbPath?: string) {
    const path = dbPath || process.env.DATABASE_PATH || './data/bot.db';
    const dir = join(path, '..');
    
    // Ensure data directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    
    this.initializeDatabase();
    this.prepareSta();
  }

  private initializeDatabase(): void {
    const createTable = `
      CREATE TABLE IF NOT EXISTS data (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `;
    
    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_type ON data(type);
      CREATE INDEX IF NOT EXISTS idx_updated ON data(updatedAt);
    `;
    
    this.db.exec(createTable);
    this.db.exec(createIndexes);
  }

  private prepareSta(): void {
    this.savePrepared = this.db.prepare(`
      INSERT OR REPLACE INTO data (id, type, data, updatedAt)
      VALUES (?, ?, ?, ?)
    `);
    
    this.getPrepared = this.db.prepare(`
      SELECT * FROM data WHERE id = ?
    `);
    
    this.deletePrepared = this.db.prepare(`
      DELETE FROM data WHERE id = ?
    `);
    
    this.getByTypePrepared = this.db.prepare(`
      SELECT * FROM data WHERE type = ?
    `);
  }

  /**
   * Save any data object to the database
   */
  save<T extends StoredData>(data: T): void {
    const now = new Date().toISOString();
    this.savePrepared.run(
      data.id,
      data.type,
      JSON.stringify(data),
      now
    );
  }

  /**
   * Get a specific object by ID
   */
  get<T extends StoredData>(id: string): T | null {
    const row = this.getPrepared.get(id) as DataRow | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as T;
  }

  /**
   * Get all objects of a specific type
   */
  getByType<T extends StoredData>(type: DataRow['type']): T[] {
    const rows = this.getByTypePrepared.all(type) as DataRow[];
    return rows.map(row => JSON.parse(row.data) as T);
  }

  /**
   * Delete an object by ID
   */
  delete(id: string): void {
    this.deletePrepared.run(id);
  }

  /**
   * Get all panels
   */
  getAllPanels(): PanelData[] {
    return this.getByType<PanelData>('panel');
  }

  /**
   * Get all tickets
   */
  getAllTickets(): TicketData[] {
    return this.getByType<TicketData>('ticket');
  }

  /**
   * Get tickets for a specific panel
   */
  getTicketsByPanel(panelId: string): TicketData[] {
    return this.getAllTickets().filter(t => t.panelId === panelId);
  }

  /**
   * Get autosave for a specific user
   */
  getAutosave(userId: string): AutosaveData | null {
    return this.get<AutosaveData>(`autosave:${userId}`);
  }

  /**
   * Delete autosave for a user
   */
  deleteAutosave(userId: string): void {
    this.delete(`autosave:${userId}`);
  }

  /**
   * Generate a unique panel ID
   */
  generatePanelId(): string {
    const panels = this.getAllPanels();
    const ids = panels.map(p => parseInt(p.id.split(':')[1]));
    const maxId = ids.length > 0 ? Math.max(...ids) : 1000;
    return `panel:${maxId + 1}`;
  }

  /**
   * Generate a unique ticket ID
   */
  generateTicketId(): string {
    const tickets = this.getAllTickets();
    const ids = tickets.map(t => parseInt(t.id.split(':')[1]));
    const maxId = ids.length > 0 ? Math.max(...ids) : 1000;
    return `ticket:${maxId + 1}`;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database instance for advanced queries
   */
  getDB(): Database.Database {
    return this.db;
  }
}

export default UniversalDB;
