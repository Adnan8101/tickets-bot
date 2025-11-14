import { Pool, PoolClient } from 'pg';

export interface DataRow {
  id: string;
  type: 'panel' | 'ticket' | 'autosave' | 'config' | 'template';
  data: string;
  updatedAt: string;
}

export interface CustomQuestion {
  text: string;
  type: 'primary' | 'optional';
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
  color: 'Primary' | 'Secondary' | 'Success' | 'Danger';
  description: string;
  openMessage: string;
  questions: string[]; // Legacy support
  customQuestions?: CustomQuestion[];
  claimable: boolean;
  allowOwnerClose?: boolean;
  enabled: boolean;
  messageId?: string;
  ticketsCreated?: number;
  userPermissions?: string[];
  staffPermissions?: string[];
  editChanges?: string[]; // Track changes during editing
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
  editChanges?: string[]; // Track changes during editing
}

export interface GuildConfig {
  id: string;
  type: 'config';
  guildId: string;
  prefix: string;
  updatedAt: string;
}

export type StoredData = PanelData | TicketData | AutosaveData | GuildConfig;

class PostgresDB {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor(connectionString?: string) {
    const dbUrl = connectionString || process.env.DATABASE_URL;
    
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL connection');
    }

    console.log('🔌 Initializing PostgreSQL connection to Google Cloud Database...');
    
    // Remove sslmode from connection string and handle SSL explicitly
    const cleanUrl = dbUrl.replace(/[?&]sslmode=[^&]*/g, '');
    
    this.pool = new Pool({
      connectionString: cleanUrl,
      ssl: {
        rejectUnauthorized: false // Allow self-signed certificates for cloud databases
      },
      max: 20, // Maximum pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000, // Increased to 30 seconds for cloud databases
      // Add keepalive settings for better connection stability
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    // Add error handler for pool
    this.pool.on('error', (err) => {
      console.error('❌ Unexpected error on idle PostgreSQL client:', err);
    });

    // Test connection and initialize (non-blocking)
    this.initializeDatabase().catch(err => {
      console.error('❌ Failed to initialize PostgreSQL database:');
      console.error(err);
    });
  }

  private async initializeDatabase(retries = 3): Promise<void> {
    let client: PoolClient | null = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📊 Connecting to PostgreSQL database... (Attempt ${attempt}/${retries})`);
        client = await this.pool.connect();
        
        console.log('✅ Connected to Google Cloud PostgreSQL Database successfully!');
        console.log('🗄️  Creating tables if they don\'t exist...');
        
        const createTable = `
          CREATE TABLE IF NOT EXISTS data (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            data JSONB NOT NULL,
            "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        const createIndexes = `
          CREATE INDEX IF NOT EXISTS idx_type ON data(type);
          CREATE INDEX IF NOT EXISTS idx_updated ON data("updatedAt");
          CREATE INDEX IF NOT EXISTS idx_data_gin ON data USING gin(data);
        `;
        
        await client.query(createTable);
        await client.query(createIndexes);
        
        console.log('✅ Database tables and indexes created successfully');
        
        this.isConnected = true;
        
        // Log connection info (without sensitive data)
        const result = await client.query('SELECT version()');
        console.log('📌 PostgreSQL Version:', result.rows[0].version.split(',')[0]);
        
        const countResult = await client.query('SELECT COUNT(*) as count FROM data');
        console.log('📦 Total records in database:', countResult.rows[0].count);
        
        return; // Success, exit retry loop
        
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Connection attempt ${attempt}/${retries} failed:`, error.message);
        
        if (attempt < retries) {
          const waitTime = attempt * 2000; // Exponential backoff
          console.log(`⏳ Retrying in ${waitTime/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } finally {
        if (client) {
          client.release();
          client = null;
        }
      }
    }

    // All retries failed
    console.error('❌ Failed to initialize PostgreSQL database after', retries, 'attempts');
    console.error('💡 Troubleshooting tips:');
    console.error('  1. Check if your IP address is whitelisted in Google Cloud SQL');
    console.error('  2. Verify the DATABASE_URL in your .env file');
    console.error('  3. Ensure the database instance is running');
    console.error('  4. Check your network connection');
    throw lastError;
  }

  /**
   * Check if the database is connected
   */
  isConnectionReady(): boolean {
    return this.isConnected;
  }

  /**
   * Wait for database to be ready (with timeout)
   */
  async waitForConnection(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    while (!this.isConnected && Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return this.isConnected;
  }

  /**
   * Save any data object to the database
   */
  async save<T extends StoredData>(data: T): Promise<void> {
    if (!this.isConnected) {
      console.warn('⚠️  Database not connected, attempting to reconnect...');
      const connected = await this.waitForConnection(5000);
      if (!connected) {
        throw new Error('Database connection not available');
      }
    }

    const client = await this.pool.connect();
    try {
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO data (id, type, data, "updatedAt")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE 
         SET data = $3, "updatedAt" = $4`,
        [data.id, data.type, JSON.stringify(data), now]
      );
    } catch (error: any) {
      console.error('❌ Error saving data:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a specific object by ID
   */
  async get<T extends StoredData>(id: string): Promise<T | null> {
    if (!this.isConnected) {
      console.warn('⚠️  Database not connected, attempting to reconnect...');
      const connected = await this.waitForConnection(5000);
      if (!connected) {
        throw new Error('Database connection not available');
      }
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM data WHERE id = $1',
        [id]
      );
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      // data is already parsed as JSONB from PostgreSQL
      return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    } catch (error: any) {
      console.error('❌ Error getting data:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all objects of a specific type
   */
  async getByType<T extends StoredData>(type: DataRow['type']): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM data WHERE type = $1 ORDER BY "updatedAt" DESC',
        [type]
      );
      
      return result.rows.map(row => {
        // data is already parsed as JSONB from PostgreSQL
        return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      });
    } catch (error: any) {
      console.error('❌ Error getting data by type:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete an object by ID
   */
  async delete(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM data WHERE id = $1', [id]);
    } catch (error: any) {
      console.error('❌ Error deleting data:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all panels
   */
  async getAllPanels(): Promise<PanelData[]> {
    return this.getByType<PanelData>('panel');
  }

  /**
   * Get all tickets
   */
  async getAllTickets(): Promise<TicketData[]> {
    return this.getByType<TicketData>('ticket');
  }

  /**
   * Get tickets for a specific panel
   */
  async getTicketsByPanel(panelId: string): Promise<TicketData[]> {
    const allTickets = await this.getAllTickets();
    return allTickets.filter(t => t.panelId === panelId);
  }

  /**
   * Get autosave for a specific user
   */
  async getAutosave(userId: string): Promise<AutosaveData | null> {
    return this.get<AutosaveData>(`autosave:${userId}`);
  }

  /**
   * Delete autosave for a user
   */
  async deleteAutosave(userId: string): Promise<void> {
    await this.delete(`autosave:${userId}`);
  }

  /**
   * Generate a unique panel ID
   */
  async generatePanelId(): Promise<string> {
    const panels = await this.getAllPanels();
    const ids = panels.map(p => parseInt(p.id.split(':')[1]));
    const maxId = ids.length > 0 ? Math.max(...ids) : 1000;
    return `panel:${maxId + 1}`;
  }

  /**
   * Generate a unique ticket ID
   */
  async generateTicketId(): Promise<string> {
    const tickets = await this.getAllTickets();
    const ids = tickets.map(t => parseInt(t.id.split(':')[1]));
    const maxId = ids.length > 0 ? Math.max(...ids) : 1000;
    return `ticket:${maxId + 1}`;
  }

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    console.log('🔌 Closing PostgreSQL connection pool...');
    await this.pool.end();
    console.log('✅ PostgreSQL connection pool closed');
  }

  /**
   * Get pool instance for advanced queries
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Check if database is connected
   */
  isConnectionActive(): boolean {
    return this.isConnected;
  }

  /**
   * Get guild configuration
   */
  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    return this.get<GuildConfig>(`config:${guildId}`);
  }

  /**
   * Save guild configuration
   */
  async saveGuildConfig(guildId: string, prefix: string): Promise<void> {
    const config: GuildConfig = {
      id: `config:${guildId}`,
      type: 'config',
      guildId,
      prefix,
      updatedAt: new Date().toISOString()
    };
    await this.save(config);
  }

  /**
   * Get guild prefix or default
   */
  async getPrefix(guildId: string): Promise<string> {
    const config = await this.getGuildConfig(guildId);
    return config?.prefix || '$';
  }

  /**
   * Save panel template
   */
  async savePanelTemplate(templateId: string, template: any): Promise<void> {
    // Create a copy without the 'id' field to avoid conflicts
    const { id: _originalId, ...templateWithoutId } = template;
    
    const templateData = {
      id: `template:${templateId}`,
      type: 'template' as const,
      ...templateWithoutId
    };
    await this.save(templateData as any);
  }

  /**
   * Get panel template
   */
  async getPanelTemplate(templateId: string): Promise<any | null> {
    return await this.get(`template:${templateId}`);
  }

  /**
   * Get all templates
   */
  async getAllTemplates(): Promise<any[]> {
    return this.getByType('template');
  }
}

export default PostgresDB;
