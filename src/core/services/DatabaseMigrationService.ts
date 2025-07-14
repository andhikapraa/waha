import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { LocalStore } from '../storage/LocalStore';
import { 
  SQLUsersSchema, 
  SQLUsersMigrations,
  SQLUserSessionsSchema,
  SQLUserSessionsMigrations,
  SQLApiKeysSchema,
  SQLApiKeysMigrations,
  SQLAuditLogsSchema,
  SQLAuditLogsMigrations
} from '../storage/sql/schemas';

export interface MigrationResult {
  success: boolean;
  tablesCreated: string[];
  errors: string[];
  version: string;
}

export interface MigrationInfo {
  name: string;
  version: string;
  sql: string;
  dependencies?: string[];
}

@Injectable()
export class DatabaseMigrationService implements OnModuleInit {
  private knex: any;
  private readonly MIGRATION_VERSION = '1.0.0';
  private readonly MIGRATION_TABLE = 'waha_migrations';

  constructor(
    private store: LocalStore,
    @InjectPinoLogger('DatabaseMigrationService')
    private logger: PinoLogger,
  ) {}

  async onModuleInit() {
    try {
      await this.store.init();
      this.knex = this.store.getWAHADatabase();
      this.logger.info('Database migration service initialized');
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to initialize database migration service');
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      tablesCreated: [],
      errors: [],
      version: this.MIGRATION_VERSION,
    };

    try {
      this.logger.info('Starting database migrations...');

      // Ensure migration tracking table exists
      await this.ensureMigrationTable();

      // Get all migrations
      const migrations = this.getAllMigrations();

      // Run each migration
      for (const migration of migrations) {
        try {
          const isApplied = await this.isMigrationApplied(migration.name);
          if (!isApplied) {
            await this.applyMigration(migration);
            result.tablesCreated.push(migration.name);
            this.logger.info({ migration: migration.name }, 'Migration applied successfully');
          } else {
            this.logger.debug({ migration: migration.name }, 'Migration already applied, skipping');
          }
        } catch (error) {
          const errorMsg = `Failed to apply migration ${migration.name}: ${error.message}`;
          result.errors.push(errorMsg);
          result.success = false;
          this.logger.error({ migration: migration.name, error: error.message }, 'Migration failed');
        }
      }

      if (result.success) {
        this.logger.info({ 
          tablesCreated: result.tablesCreated.length,
          version: result.version 
        }, 'All migrations completed successfully');
      } else {
        this.logger.error({ 
          errors: result.errors.length,
          tablesCreated: result.tablesCreated.length 
        }, 'Some migrations failed');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Migration process failed: ${error.message}`);
      this.logger.error({ error: error.message }, 'Migration process failed');
    }

    return result;
  }

  /**
   * Get all available migrations
   */
  private getAllMigrations(): MigrationInfo[] {
    return [
      {
        name: 'create_users_table',
        version: '1.0.0',
        sql: SQLUsersMigrations[0], // First migration creates the table
      },
      {
        name: 'create_user_sessions_table',
        version: '1.0.0',
        sql: SQLUserSessionsMigrations[0],
        dependencies: ['create_users_table'],
      },
      {
        name: 'create_api_keys_table',
        version: '1.0.0',
        sql: SQLApiKeysMigrations[0],
        dependencies: ['create_users_table'],
      },
      {
        name: 'create_audit_logs_table',
        version: '1.0.0',
        sql: SQLAuditLogsMigrations[0],
        dependencies: ['create_users_table'],
      },
    ];
  }

  /**
   * Ensure the migration tracking table exists
   */
  private async ensureMigrationTable(): Promise<void> {
    const exists = await this.knex.schema.hasTable(this.MIGRATION_TABLE);
    if (!exists) {
      await this.knex.schema.createTable(this.MIGRATION_TABLE, (table) => {
        table.string('name').primary();
        table.string('version').notNullable();
        table.timestamp('applied_at').defaultTo(this.knex.fn.now());
        table.text('sql');
      });
      this.logger.info('Migration tracking table created');
    }
  }

  /**
   * Check if a migration has been applied
   */
  private async isMigrationApplied(migrationName: string): Promise<boolean> {
    try {
      const result = await this.knex(this.MIGRATION_TABLE)
        .where('name', migrationName)
        .first();
      return !!result;
    } catch (error) {
      this.logger.error({ migration: migrationName, error: error.message }, 'Error checking migration status');
      return false;
    }
  }

  /**
   * Apply a single migration
   */
  private async applyMigration(migration: MigrationInfo): Promise<void> {
    // Start transaction
    const trx = await this.knex.transaction();

    try {
      // Execute the migration SQL
      await trx.raw(migration.sql);

      // Record the migration as applied
      await trx(this.MIGRATION_TABLE).insert({
        name: migration.name,
        version: migration.version,
        sql: migration.sql,
      });

      // Commit transaction
      await trx.commit();

      this.logger.info({ migration: migration.name }, 'Migration applied and recorded');
    } catch (error) {
      // Rollback transaction
      await trx.rollback();
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<{
    currentVersion: string;
    appliedMigrations: string[];
    pendingMigrations: string[];
  }> {
    try {
      await this.ensureMigrationTable();
      
      const appliedMigrations = await this.knex(this.MIGRATION_TABLE)
        .select('name')
        .orderBy('applied_at');

      const allMigrations = this.getAllMigrations();
      const appliedNames = appliedMigrations.map(m => m.name);
      const pendingMigrations = allMigrations
        .filter(m => !appliedNames.includes(m.name))
        .map(m => m.name);

      return {
        currentVersion: this.MIGRATION_VERSION,
        appliedMigrations: appliedNames,
        pendingMigrations,
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to get migration status');
      return {
        currentVersion: this.MIGRATION_VERSION,
        appliedMigrations: [],
        pendingMigrations: this.getAllMigrations().map(m => m.name),
      };
    }
  }

  /**
   * Validate database schema
   */
  async validateSchema(): Promise<{
    valid: boolean;
    missingTables: string[];
    issues: string[];
  }> {
    const result = {
      valid: true,
      missingTables: [] as string[],
      issues: [] as string[],
    };

    try {
      const requiredTables = ['users', 'user_sessions', 'api_keys', 'audit_logs'];
      
      for (const table of requiredTables) {
        const exists = await this.knex.schema.hasTable(table);
        if (!exists) {
          result.valid = false;
          result.missingTables.push(table);
          result.issues.push(`Table '${table}' does not exist`);
        }
      }

      if (result.valid) {
        this.logger.info('Database schema validation passed');
      } else {
        this.logger.warn({ 
          missingTables: result.missingTables,
          issues: result.issues 
        }, 'Database schema validation failed');
      }

    } catch (error) {
      result.valid = false;
      result.issues.push(`Schema validation error: ${error.message}`);
      this.logger.error({ error: error.message }, 'Schema validation error');
    }

    return result;
  }

  /**
   * Rollback last migration (for emergency use)
   */
  async rollbackLastMigration(): Promise<{ success: boolean; migration?: string; error?: string }> {
    try {
      const lastMigration = await this.knex(this.MIGRATION_TABLE)
        .orderBy('applied_at', 'desc')
        .first();

      if (!lastMigration) {
        return { success: false, error: 'No migrations to rollback' };
      }

      // For now, we'll just remove the migration record
      // In a more sophisticated system, we'd have rollback scripts
      await this.knex(this.MIGRATION_TABLE)
        .where('name', lastMigration.name)
        .del();

      this.logger.warn({ migration: lastMigration.name }, 'Migration rolled back (record removed)');
      
      return { success: true, migration: lastMigration.name };
    } catch (error) {
      this.logger.error({ error: error.message }, 'Rollback failed');
      return { success: false, error: error.message };
    }
  }
}
