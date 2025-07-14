import { Injectable } from '@nestjs/common';
import { Sqlite3SchemaValidation } from '@waha/core/engines/noweb/store/sqlite3/Sqlite3SchemaValidation';
import { IUserRepository, IUserSessionRepository, IApiKeyRepository, IAuditLogRepository } from '@waha/core/storage/IUserRepository';
import { LocalStore } from '@waha/core/storage/LocalStore';
import { 
  SQLUsersSchema, 
  SQLUsersMigrations,
  SQLUserSessionsSchema,
  SQLUserSessionsMigrations,
  SQLApiKeysSchema,
  SQLApiKeysMigrations,
  SQLAuditLogsSchema,
  SQLAuditLogsMigrations
} from '@waha/core/storage/sql/schemas';
import { Sqlite3KVRepository } from '@waha/core/storage/sqlite3/Sqlite3KVRepository';
import { User, UserSession, ApiKey, AuditLog, UserRole } from '@waha/structures/user.dto';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';

// Internal storage entities that match the database schema
class UserEntity {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  salt: string;
  role: string;
  is_active: boolean;
  two_factor_enabled: boolean;
  two_factor_secret?: string;
  last_login_at?: string;
  failed_login_attempts: number;
  locked_until?: string;
  created_at: string;
  updated_at: string;
}

class UserSessionEntity {
  id: string;
  user_id: string;
  session_token: string;
  refresh_token: string;
  ip_address?: string;
  user_agent?: string;
  expires_at: string;
  created_at: string;
  last_accessed_at: string;
}

class ApiKeyEntity {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  permissions: string; // JSON string
  is_active: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

class AuditLogEntity {
  id: string;
  user_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details: string; // JSON string
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

@Injectable()
export class Sqlite3UserRepository implements IUserRepository {
  private knex: any;

  constructor(store: LocalStore) {
    // Initialize store and get database connection
    this.initStore(store).catch(console.error);
  }

  private async initStore(store: LocalStore) {
    await store.init();
    this.knex = store.getWAHADatabase();
    // Initialize tables
    await this.initTables();
  }

  private async initTables() {
    // Apply migrations for users table
    for (const migration of SQLUsersMigrations) {
      try {
        await this.knex.raw(migration);
      } catch (error) {
        // Ignore table already exists errors
        if (!error.message.includes('already exists')) {
          console.error('Migration error:', error);
        }
      }
    }
  }

  async create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const now = new Date().toISOString();
    const entity: UserEntity = {
      id: uuidv4(),
      username: userData.username,
      email: userData.email,
      password_hash: userData.passwordHash,
      salt: userData.salt,
      role: userData.role,
      is_active: userData.isActive,
      two_factor_enabled: userData.twoFactorEnabled,
      two_factor_secret: userData.twoFactorSecret,
      last_login_at: userData.lastLoginAt?.toISOString(),
      failed_login_attempts: userData.failedLoginAttempts,
      locked_until: userData.lockedUntil?.toISOString(),
      created_at: now,
      updated_at: now,
    };

    await this.knex('users').insert(entity);
    return this.entityToUser(entity);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.knex('users').where({ id }).first();
    return rows ? this.entityToUser(rows) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.knex('users').where({ username }).first();
    return rows ? this.entityToUser(rows) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.knex('users').where({ email }).first();
    return rows ? this.entityToUser(rows) : null;
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    const existing = await this.knex('users').where({ id }).first();
    if (!existing) {
      throw new Error('User not found');
    }

    const entityUpdates = {
      ...this.userUpdatesToEntity(updates),
      updated_at: new Date().toISOString(),
    };

    await this.knex('users').where({ id }).update(entityUpdates);

    const updated = await this.knex('users').where({ id }).first();
    return this.entityToUser(updated);
  }

  async delete(id: string): Promise<void> {
    await this.knex('users').where({ id }).del();
  }

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<{ users: User[]; total: number }> {
    let query = this.knex('users');

    // Apply filters
    if (filters.search) {
      query = query.where(function() {
        this.where('username', 'like', `%${filters.search}%`)
            .orWhere('email', 'like', `%${filters.search}%`);
      });
    }
    if (filters.role) {
      query = query.where('role', filters.role);
    }
    if (filters.isActive !== undefined) {
      query = query.where('is_active', filters.isActive);
    }

    const entities = await query.select('*');
    const users = entities.map(entity => this.entityToUser(entity));

    return {
      users,
      total: users.length,
    };
  }

  async incrementFailedAttempts(id: string): Promise<void> {
    await this.knex('users')
      .where({ id })
      .increment('failed_login_attempts', 1)
      .update({ updated_at: new Date().toISOString() });
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.knex('users')
      .where({ id })
      .update({
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      });
  }

  async lockUser(id: string, until: Date): Promise<void> {
    await this.knex('users')
      .where({ id })
      .update({
        locked_until: until.toISOString(),
        updated_at: new Date().toISOString(),
      });
  }

  // Helper methods to convert between entities and domain objects
  private entityToUser(entity: UserEntity): User {
    return {
      id: entity.id,
      username: entity.username,
      email: entity.email,
      passwordHash: entity.password_hash,
      salt: entity.salt,
      role: entity.role as UserRole,
      isActive: entity.is_active,
      twoFactorEnabled: entity.two_factor_enabled,
      twoFactorSecret: entity.two_factor_secret,
      lastLoginAt: entity.last_login_at ? new Date(entity.last_login_at) : undefined,
      failedLoginAttempts: entity.failed_login_attempts,
      lockedUntil: entity.locked_until ? new Date(entity.locked_until) : undefined,
      createdAt: new Date(entity.created_at),
      updatedAt: new Date(entity.updated_at),
    };
  }

  private userUpdatesToEntity(updates: Partial<User>): Partial<UserEntity> {
    const entity: Partial<UserEntity> = {};
    
    if (updates.username !== undefined) entity.username = updates.username;
    if (updates.email !== undefined) entity.email = updates.email;
    if (updates.passwordHash !== undefined) entity.password_hash = updates.passwordHash;
    if (updates.salt !== undefined) entity.salt = updates.salt;
    if (updates.role !== undefined) entity.role = updates.role;
    if (updates.isActive !== undefined) entity.is_active = updates.isActive;
    if (updates.twoFactorEnabled !== undefined) entity.two_factor_enabled = updates.twoFactorEnabled;
    if (updates.twoFactorSecret !== undefined) entity.two_factor_secret = updates.twoFactorSecret;
    if (updates.lastLoginAt !== undefined) entity.last_login_at = updates.lastLoginAt?.toISOString();
    if (updates.failedLoginAttempts !== undefined) entity.failed_login_attempts = updates.failedLoginAttempts;
    if (updates.lockedUntil !== undefined) entity.locked_until = updates.lockedUntil?.toISOString();

    return entity;
  }
}

@Injectable()
export class Sqlite3UserSessionRepository implements IUserSessionRepository {
  private knex: any;

  constructor(store: LocalStore) {
    this.initStore(store).catch(console.error);
  }

  private async initStore(store: LocalStore) {
    await store.init();
    this.knex = store.getWAHADatabase();
  }

  /**
   * Create a new user session
   */
  async create(session: Omit<UserSession, 'id' | 'createdAt' | 'lastAccessedAt'> & { id?: string }): Promise<UserSession> {
    const now = new Date();
    const sessionId = session.id || uuidv4(); // Allow explicit ID to be passed

    const sessionEntity: UserSessionEntity = {
      id: sessionId,
      user_id: session.userId,
      session_token: session.sessionToken,
      refresh_token: session.refreshToken,
      ip_address: session.ipAddress || null,
      user_agent: session.userAgent || null,
      expires_at: session.expiresAt.toISOString(),
      created_at: now.toISOString(),
      last_accessed_at: now.toISOString(),
    };

    try {
      await this.knex('user_sessions').insert(sessionEntity);

      return {
        id: sessionId,
        userId: session.userId,
        sessionToken: session.sessionToken,
        refreshToken: session.refreshToken,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        expiresAt: session.expiresAt,
        createdAt: now,
        lastAccessedAt: now,
      };
    } catch (error) {
      throw new Error(`Failed to create user session: ${error.message}`);
    }
  }

  /**
   * Find session by session token
   */
  async findByToken(token: string): Promise<UserSession | null> {
    try {
      const result = await this.knex('user_sessions')
        .where('session_token', token)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToUserSession(result);
    } catch (error) {
      throw new Error(`Failed to find session by token: ${error.message}`);
    }
  }

  /**
   * Find session by refresh token
   */
  async findByRefreshToken(refreshToken: string): Promise<UserSession | null> {
    try {
      const result = await this.knex('user_sessions')
        .where('refresh_token', refreshToken)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToUserSession(result);
    } catch (error) {
      throw new Error(`Failed to find session by refresh token: ${error.message}`);
    }
  }

  /**
   * Update last accessed timestamp
   */
  async updateLastAccessed(id: string): Promise<void> {
    try {
      await this.knex('user_sessions')
        .where('id', id)
        .update({
          last_accessed_at: new Date().toISOString(),
        });
    } catch (error) {
      throw new Error(`Failed to update last accessed: ${error.message}`);
    }
  }

  /**
   * Delete a session by ID
   */
  async delete(id: string): Promise<void> {
    try {
      await this.knex('user_sessions')
        .where('id', id)
        .del();
    } catch (error) {
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  /**
   * Delete all sessions for a user
   */
  async deleteByUserId(userId: string): Promise<void> {
    try {
      await this.knex('user_sessions')
        .where('user_id', userId)
        .del();
    } catch (error) {
      throw new Error(`Failed to delete sessions for user: ${error.message}`);
    }
  }

  /**
   * Delete expired sessions
   */
  async deleteExpired(): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.knex('user_sessions')
        .where('expires_at', '<', now)
        .del();
    } catch (error) {
      throw new Error(`Failed to delete expired sessions: ${error.message}`);
    }
  }

  /**
   * Find session by ID
   */
  async findById(id: string): Promise<UserSession | null> {
    try {
      const result = await this.knex('user_sessions')
        .where('id', id)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToUserSession(result);
    } catch (error) {
      throw new Error(`Failed to find session by ID: ${error.message}`);
    }
  }

  /**
   * Find all sessions for a user
   */
  async findByUserId(userId: string): Promise<UserSession[]> {
    try {
      const results = await this.knex('user_sessions')
        .where('user_id', userId)
        .orderBy('created_at', 'desc');

      return results.map(result => this.entityToUserSession(result));
    } catch (error) {
      throw new Error(`Failed to find sessions for user: ${error.message}`);
    }
  }

  /**
   * Convert database entity to UserSession object
   */
  private entityToUserSession(entity: UserSessionEntity): UserSession {
    return {
      id: entity.id,
      userId: entity.user_id,
      sessionToken: entity.session_token,
      refreshToken: entity.refresh_token,
      ipAddress: entity.ip_address || undefined,
      userAgent: entity.user_agent || undefined,
      expiresAt: new Date(entity.expires_at),
      createdAt: new Date(entity.created_at),
      lastAccessedAt: new Date(entity.last_accessed_at),
    };
  }
}

@Injectable()
export class Sqlite3ApiKeyRepository implements IApiKeyRepository {
  private knex: any;

  constructor(store: LocalStore) {
    this.initStore(store).catch(console.error);
  }

  private async initStore(store: LocalStore) {
    await store.init();
    this.knex = store.getWAHADatabase();
  }

  /**
   * Create a new API key
   */
  async create(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey> {
    const now = new Date();
    const keyId = uuidv4();

    const apiKeyEntity = {
      id: keyId,
      user_id: apiKey.userId,
      name: apiKey.name,
      key_hash: apiKey.keyHash,
      permissions: JSON.stringify(apiKey.permissions),
      is_active: apiKey.isActive,
      last_used_at: apiKey.lastUsedAt?.toISOString() || null,
      expires_at: apiKey.expiresAt?.toISOString() || null,
      created_at: now.toISOString(),
    };

    try {
      await this.knex('api_keys').insert(apiKeyEntity);

      return {
        id: keyId,
        userId: apiKey.userId,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        permissions: apiKey.permissions,
        isActive: apiKey.isActive,
        lastUsedAt: apiKey.lastUsedAt,
        expiresAt: apiKey.expiresAt,
        createdAt: now,
      };
    } catch (error) {
      throw new Error(`Failed to create API key: ${error.message}`);
    }
  }

  /**
   * Find API key by ID
   */
  async findById(id: string): Promise<ApiKey | null> {
    try {
      const result = await this.knex('api_keys')
        .where('id', id)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToApiKey(result);
    } catch (error) {
      throw new Error(`Failed to find API key by ID: ${error.message}`);
    }
  }

  /**
   * Find API key by hash
   */
  async findByHash(keyHash: string): Promise<ApiKey | null> {
    try {
      const result = await this.knex('api_keys')
        .where('key_hash', keyHash)
        .where('is_active', true)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToApiKey(result);
    } catch (error) {
      throw new Error(`Failed to find API key by hash: ${error.message}`);
    }
  }

  /**
   * Find all API keys for a user
   */
  async findByUserId(userId: string): Promise<ApiKey[]> {
    try {
      const results = await this.knex('api_keys')
        .where('user_id', userId)
        .orderBy('created_at', 'desc');

      return results.map(result => this.entityToApiKey(result));
    } catch (error) {
      throw new Error(`Failed to find API keys for user: ${error.message}`);
    }
  }

  /**
   * Update API key
   */
  async update(id: string, updates: Partial<ApiKey>): Promise<ApiKey> {
    try {
      const updateData: any = {};

      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.permissions !== undefined) updateData.permissions = JSON.stringify(updates.permissions);
      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
      if (updates.expiresAt !== undefined) updateData.expires_at = updates.expiresAt?.toISOString() || null;

      await this.knex('api_keys')
        .where('id', id)
        .update(updateData);

      const updated = await this.knex('api_keys')
        .where('id', id)
        .first();

      if (!updated) {
        throw new Error('API key not found after update');
      }

      return this.entityToApiKey(updated);
    } catch (error) {
      throw new Error(`Failed to update API key: ${error.message}`);
    }
  }

  /**
   * Delete API key
   */
  async delete(id: string): Promise<void> {
    try {
      await this.knex('api_keys')
        .where('id', id)
        .del();
    } catch (error) {
      throw new Error(`Failed to delete API key: ${error.message}`);
    }
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    try {
      await this.knex('api_keys')
        .where('id', id)
        .update({
          last_used_at: new Date().toISOString(),
        });
    } catch (error) {
      throw new Error(`Failed to update API key last used: ${error.message}`);
    }
  }

  /**
   * Delete expired API keys
   */
  async deleteExpired(): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.knex('api_keys')
        .whereNotNull('expires_at')
        .where('expires_at', '<', now)
        .del();
    } catch (error) {
      throw new Error(`Failed to delete expired API keys: ${error.message}`);
    }
  }

  /**
   * Convert database entity to ApiKey object
   */
  private entityToApiKey(entity: any): ApiKey {
    return {
      id: entity.id,
      userId: entity.user_id,
      name: entity.name,
      keyHash: entity.key_hash,
      permissions: JSON.parse(entity.permissions || '{}'),
      isActive: entity.is_active,
      lastUsedAt: entity.last_used_at ? new Date(entity.last_used_at) : undefined,
      expiresAt: entity.expires_at ? new Date(entity.expires_at) : undefined,
      createdAt: new Date(entity.created_at),
    };
  }
}

@Injectable()
export class Sqlite3AuditLogRepository implements IAuditLogRepository {
  private knex: any;

  constructor(store: LocalStore) {
    this.initStore(store).catch(console.error);
  }

  private async initStore(store: LocalStore) {
    await store.init();
    this.knex = store.getWAHADatabase();
  }

  /**
   * Create a new audit log entry
   */
  async create(auditLog: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> {
    const now = new Date();
    const logId = uuidv4();

    const auditLogEntity = {
      id: logId,
      user_id: auditLog.userId || null,
      action: auditLog.action,
      resource_type: auditLog.resourceType || null,
      resource_id: auditLog.resourceId || null,
      details: JSON.stringify(auditLog.details),
      ip_address: auditLog.ipAddress || null,
      user_agent: auditLog.userAgent || null,
      created_at: now.toISOString(),
    };

    try {
      await this.knex('audit_logs').insert(auditLogEntity);

      return {
        id: logId,
        userId: auditLog.userId,
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        createdAt: now,
      };
    } catch (error) {
      throw new Error(`Failed to create audit log: ${error.message}`);
    }
  }

  /**
   * Find audit log by ID
   */
  async findById(id: string): Promise<AuditLog | null> {
    try {
      const result = await this.knex('audit_logs')
        .where('id', id)
        .first();

      if (!result) {
        return null;
      }

      return this.entityToAuditLog(result);
    } catch (error) {
      throw new Error(`Failed to find audit log by ID: ${error.message}`);
    }
  }

  /**
   * List audit logs with pagination and filters
   */
  async list(filters: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 50;
      const offset = (page - 1) * limit;

      let query = this.knex('audit_logs');
      let countQuery = this.knex('audit_logs');

      // Apply filters to both queries
      if (filters.userId) {
        query = query.where('user_id', filters.userId);
        countQuery = countQuery.where('user_id', filters.userId);
      }

      if (filters.action) {
        query = query.where('action', filters.action);
        countQuery = countQuery.where('action', filters.action);
      }

      if (filters.resourceType) {
        query = query.where('resource_type', filters.resourceType);
        countQuery = countQuery.where('resource_type', filters.resourceType);
      }

      if (filters.startDate) {
        query = query.where('created_at', '>=', filters.startDate.toISOString());
        countQuery = countQuery.where('created_at', '>=', filters.startDate.toISOString());
      }

      if (filters.endDate) {
        query = query.where('created_at', '<=', filters.endDate.toISOString());
        countQuery = countQuery.where('created_at', '<=', filters.endDate.toISOString());
      }

      // Get total count
      const totalResult = await countQuery.count('id as count').first();
      const total = totalResult?.count || 0;

      // Get paginated results
      const results = await query
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      const logs = results.map(result => this.entityToAuditLog(result));

      return { logs, total };
    } catch (error) {
      throw new Error(`Failed to list audit logs: ${error.message}`);
    }
  }

  /**
   * Delete audit logs older than specified date
   */
  async deleteOlderThan(date: Date): Promise<void> {
    try {
      await this.knex('audit_logs')
        .where('created_at', '<', date.toISOString())
        .del();
    } catch (error) {
      throw new Error(`Failed to delete old audit logs: ${error.message}`);
    }
  }

  /**
   * Convert database entity to AuditLog object
   */
  private entityToAuditLog(entity: any): AuditLog {
    return {
      id: entity.id,
      userId: entity.user_id || undefined,
      action: entity.action,
      resourceType: entity.resource_type || undefined,
      resourceId: entity.resource_id || undefined,
      details: JSON.parse(entity.details || '{}'),
      ipAddress: entity.ip_address || undefined,
      userAgent: entity.user_agent || undefined,
      createdAt: new Date(entity.created_at),
    };
  }
}
