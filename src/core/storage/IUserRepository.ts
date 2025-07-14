import { User, UserSession, ApiKey, AuditLog } from '@waha/structures/user.dto';

export abstract class IUserRepository {
  abstract create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  abstract findById(id: string): Promise<User | null>;
  abstract findByUsername(username: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract update(id: string, updates: Partial<User>): Promise<User>;
  abstract delete(id: string): Promise<void>;
  abstract list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<{ users: User[]; total: number }>;
  abstract incrementFailedAttempts(id: string): Promise<void>;
  abstract resetFailedAttempts(id: string): Promise<void>;
  abstract lockUser(id: string, until: Date): Promise<void>;
}

export abstract class IUserSessionRepository {
  abstract create(session: Omit<UserSession, 'id' | 'createdAt' | 'lastAccessedAt'> & { id?: string }): Promise<UserSession>;
  abstract findById(id: string): Promise<UserSession | null>;
  abstract findByToken(token: string): Promise<UserSession | null>;
  abstract findByRefreshToken(refreshToken: string): Promise<UserSession | null>;
  abstract updateLastAccessed(id: string): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract deleteByUserId(userId: string): Promise<void>;
  abstract deleteExpired(): Promise<void>;
  abstract findByUserId(userId: string): Promise<UserSession[]>;
}

export abstract class IApiKeyRepository {
  abstract create(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey>;
  abstract findById(id: string): Promise<ApiKey | null>;
  abstract findByHash(keyHash: string): Promise<ApiKey | null>;
  abstract findByUserId(userId: string): Promise<ApiKey[]>;
  abstract update(id: string, updates: Partial<ApiKey>): Promise<ApiKey>;
  abstract delete(id: string): Promise<void>;
  abstract updateLastUsed(id: string): Promise<void>;
  abstract deleteExpired(): Promise<void>;
}

export abstract class IAuditLogRepository {
  abstract create(auditLog: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog>;
  abstract findById(id: string): Promise<AuditLog | null>;
  abstract list(filters: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ logs: AuditLog[]; total: number }>;
  abstract deleteOlderThan(date: Date): Promise<void>;
}
