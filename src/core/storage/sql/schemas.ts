import { Field, Index, Schema } from '@waha/core/storage/Schema';
import { Migration } from '@waha/core/storage/sql/SqlKVRepository';

/**
 * Session Config
 */
export const SQLSessionConfigSchema = new Schema(
  'session_config',
  [new Field('id', 'TEXT'), new Field('data', 'TEXT')],
  [new Index('session_config_id_index', ['id'])],
);

export const SQLSessionConfigMigrations: Migration[] = [
  'CREATE TABLE IF NOT EXISTS session_config (id TEXT PRIMARY KEY, data TEXT)',
  'CREATE UNIQUE INDEX IF NOT EXISTS session_config_id_index ON session_config (id)',
];

/**
 * Me
 */
export const SQLMeSchema = new Schema(
  'me',
  [new Field('id', 'TEXT'), new Field('data', 'TEXT')],
  [new Index('me_id_index', ['id'])],
);

export const SQLMeMigrations: Migration[] = [
  'CREATE TABLE IF NOT EXISTS me (id TEXT PRIMARY KEY, data TEXT)',
  'CREATE UNIQUE INDEX IF NOT EXISTS me_id_index ON me (id)',
];

/**
 * Worker
 */
export const SQLSessionWorkerSchema = new Schema(
  'session_worker',
  [
    new Field('id', 'TEXT'),
    new Field('worker', 'TEXT'),
    new Field('data', 'TEXT'),
  ],
  [
    new Index('session_worker_id_idx', ['id']),
    new Index('session_worker_worker_idx', ['worker']),
  ],
);

export const SQLSessionWorkerMigrations: Migration[] = [
  'CREATE TABLE IF NOT EXISTS session_worker (id TEXT, worker TEXT, data TEXT)',
  // Session can have only one record
  'CREATE UNIQUE INDEX IF NOT EXISTS session_worker_id_idx ON session_worker (id)',
  // Worker can have multiple records
  'CREATE INDEX IF NOT EXISTS session_worker_worker_idx ON session_worker (worker)',
];

/**
 * Users - Authentication System
 */
export const SQLUsersSchema = new Schema(
  'users',
  [
    new Field('id', 'TEXT'),
    new Field('username', 'TEXT'),
    new Field('email', 'TEXT'),
    new Field('password_hash', 'TEXT'),
    new Field('salt', 'TEXT'),
    new Field('role', 'TEXT'),
    new Field('is_active', 'BOOLEAN'),
    new Field('two_factor_enabled', 'BOOLEAN'),
    new Field('two_factor_secret', 'TEXT'),
    new Field('last_login_at', 'TIMESTAMP'),
    new Field('failed_login_attempts', 'INTEGER'),
    new Field('locked_until', 'TIMESTAMP'),
    new Field('created_at', 'TIMESTAMP'),
    new Field('updated_at', 'TIMESTAMP'),
  ],
  [
    new Index('users_id_idx', ['id']),
    new Index('users_username_idx', ['username']),
    new Index('users_email_idx', ['email']),
  ],
);

export const SQLUsersMigrations: Migration[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT true,
    two_factor_enabled BOOLEAN DEFAULT false,
    two_factor_secret TEXT,
    last_login_at TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS users_id_idx ON users (id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username)',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email)',
];

/**
 * User Sessions - JWT Token Management
 */
export const SQLUserSessionsSchema = new Schema(
  'user_sessions',
  [
    new Field('id', 'TEXT'),
    new Field('user_id', 'TEXT'),
    new Field('session_token', 'TEXT'),
    new Field('refresh_token', 'TEXT'),
    new Field('ip_address', 'TEXT'),
    new Field('user_agent', 'TEXT'),
    new Field('expires_at', 'TIMESTAMP'),
    new Field('created_at', 'TIMESTAMP'),
    new Field('last_accessed_at', 'TIMESTAMP'),
  ],
  [
    new Index('user_sessions_id_idx', ['id']),
    new Index('user_sessions_user_id_idx', ['user_id']),
    new Index('user_sessions_token_idx', ['session_token']),
    new Index('user_sessions_refresh_token_idx', ['refresh_token']),
  ],
);

export const SQLUserSessionsMigrations: Migration[] = [
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    refresh_token TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_id_idx ON user_sessions (id)',
  'CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_idx ON user_sessions (session_token)',
  'CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_refresh_token_idx ON user_sessions (refresh_token)',
];

/**
 * Enhanced API Keys - User-Associated API Keys
 */
export const SQLApiKeysSchema = new Schema(
  'api_keys',
  [
    new Field('id', 'TEXT'),
    new Field('user_id', 'TEXT'),
    new Field('name', 'TEXT'),
    new Field('key_hash', 'TEXT'),
    new Field('permissions', 'TEXT'), // JSON string
    new Field('is_active', 'BOOLEAN'),
    new Field('last_used_at', 'TIMESTAMP'),
    new Field('expires_at', 'TIMESTAMP'),
    new Field('created_at', 'TIMESTAMP'),
  ],
  [
    new Index('api_keys_id_idx', ['id']),
    new Index('api_keys_user_id_idx', ['user_id']),
    new Index('api_keys_hash_idx', ['key_hash']),
  ],
);

export const SQLApiKeysMigrations: Migration[] = [
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    permissions TEXT DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS api_keys_id_idx ON api_keys (id)',
  'CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id)',
  'CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash)',
];

/**
 * Audit Logs - Security Event Tracking
 */
export const SQLAuditLogsSchema = new Schema(
  'audit_logs',
  [
    new Field('id', 'TEXT'),
    new Field('user_id', 'TEXT'),
    new Field('action', 'TEXT'),
    new Field('resource_type', 'TEXT'),
    new Field('resource_id', 'TEXT'),
    new Field('details', 'TEXT'), // JSON string
    new Field('ip_address', 'TEXT'),
    new Field('user_agent', 'TEXT'),
    new Field('created_at', 'TIMESTAMP'),
  ],
  [
    new Index('audit_logs_id_idx', ['id']),
    new Index('audit_logs_user_id_idx', ['user_id']),
    new Index('audit_logs_action_idx', ['action']),
    new Index('audit_logs_created_at_idx', ['created_at']),
  ],
);

export const SQLAuditLogsMigrations: Migration[] = [
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_id_idx ON audit_logs (id)',
  'CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs (user_id)',
  'CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action)',
  'CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at)',
];
