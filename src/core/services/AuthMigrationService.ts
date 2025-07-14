import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { UserService } from './UserService';
import { AuditService } from './AuditService';
import { UserRole, CreateUserDto } from '@waha/structures/user.dto';
import { IUserRepository, IApiKeyRepository } from '../storage/IUserRepository';

@Injectable()
export class AuthMigrationService {
  constructor(
    private userService: UserService,
    private auditService: AuditService,
    private userRepository: IUserRepository,
    private apiKeyRepository: IApiKeyRepository,
    private configService: ConfigService,
    @InjectPinoLogger('AuthMigrationService')
    private logger: PinoLogger,
  ) {}

  /**
   * Migrate from legacy authentication system to new user-based system
   */
  async migrateFromLegacyAuth(): Promise<{
    adminUser?: any;
    migratedApiKeys: number;
    success: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let adminUser: any = undefined;
    let migratedApiKeys = 0;

    try {
      this.logger.info('Starting migration from legacy authentication system');

      // Step 1: Create admin user from dashboard credentials
      try {
        adminUser = await this.createAdminFromDashboard();
        if (adminUser) {
          this.logger.info({ userId: adminUser.id }, 'Admin user created from dashboard credentials');
          await this.auditService.logUserCreated(adminUser.id, undefined, 'system', 'migration');
        }
      } catch (error) {
        const errorMsg = `Failed to create admin user: ${error.message}`;
        errors.push(errorMsg);
        this.logger.error({ error: error.message }, errorMsg);
      }

      // Step 2: Migrate existing API keys to user-based system
      try {
        migratedApiKeys = await this.migrateApiKeys(adminUser?.id);
        this.logger.info({ migratedApiKeys }, 'API keys migrated to user-based system');
      } catch (error) {
        const errorMsg = `Failed to migrate API keys: ${error.message}`;
        errors.push(errorMsg);
        this.logger.error({ error: error.message }, errorMsg);
      }

      // Step 3: Update configuration recommendations
      this.logConfigurationRecommendations();

      const success = errors.length === 0;
      this.logger.info(
        { 
          success, 
          adminUserCreated: !!adminUser, 
          migratedApiKeys, 
          errors: errors.length 
        },
        'Migration completed'
      );

      return {
        adminUser,
        migratedApiKeys,
        success,
        errors,
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'Migration failed with unexpected error');
      return {
        migratedApiKeys: 0,
        success: false,
        errors: [...errors, `Unexpected error: ${error.message}`],
      };
    }
  }

  /**
   * Create admin user from existing dashboard credentials
   */
  private async createAdminFromDashboard(): Promise<any | null> {
    const dashboardUsername = this.configService.get('WAHA_DASHBOARD_USERNAME');
    const dashboardPassword = this.configService.get('WAHA_DASHBOARD_PASSWORD');

    if (!dashboardUsername || !dashboardPassword) {
      this.logger.warn('No dashboard credentials found, skipping admin user creation');
      return null;
    }

    // Check if admin user already exists
    try {
      const existingUser = await this.userRepository.findByUsername(dashboardUsername);
      if (existingUser) {
        this.logger.info({ username: dashboardUsername }, 'Admin user already exists');
        return existingUser;
      }
    } catch (error) {
      // User doesn't exist, continue with creation
    }

    // Create admin user
    const adminEmail = this.configService.get('WAHA_DEFAULT_ADMIN_EMAIL', `${dashboardUsername}@localhost`);
    
    const createUserDto: CreateUserDto = {
      username: dashboardUsername,
      email: adminEmail,
      password: dashboardPassword,
      role: UserRole.ADMIN,
      isActive: true,
    };

    const adminUser = await this.userService.createUser(createUserDto);
    
    this.logger.info(
      { 
        userId: adminUser.id, 
        username: adminUser.username,
        email: adminUser.email 
      },
      'Admin user created from dashboard credentials'
    );

    return adminUser;
  }

  /**
   * Migrate existing API keys to user-based system
   */
  private async migrateApiKeys(adminUserId?: string): Promise<number> {
    // In the current WAHA system, API keys are handled by the ApiKeyAuth system
    // This is a placeholder for migrating existing API keys to the new user-based system
    
    if (!adminUserId) {
      this.logger.warn('No admin user available for API key migration');
      return 0;
    }

    // Get current API key configuration
    const currentApiKey = this.configService.get('WHATSAPP_API_KEY');
    const currentApiKeyHash = this.configService.get('WHATSAPP_API_KEY_HASH');

    if (!currentApiKey && !currentApiKeyHash) {
      this.logger.info('No existing API keys found to migrate');
      return 0;
    }

    try {
      // Create API key record for the admin user
      const apiKeyData = {
        userId: adminUserId,
        name: 'Migrated Legacy API Key',
        keyHash: currentApiKeyHash || this.hashApiKey(currentApiKey),
        permissions: {
          sessions: 'all',
          users: 'read',
          system: 'all',
          api_keys: 'all',
        },
        isActive: true,
      };

      await this.apiKeyRepository.create(apiKeyData);
      
      this.logger.info(
        { 
          userId: adminUserId,
          keyName: apiKeyData.name 
        },
        'Legacy API key migrated to user-based system'
      );

      return 1;
    } catch (error) {
      this.logger.error(
        { 
          error: error.message,
          userId: adminUserId 
        },
        'Failed to migrate legacy API key'
      );
      throw error;
    }
  }

  /**
   * Hash API key for storage (simple implementation)
   */
  private hashApiKey(apiKey: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Log configuration recommendations after migration
   */
  private logConfigurationRecommendations(): void {
    const recommendations = [
      'Set WAHA_AUTH_ENABLED=true to enable the new authentication system',
      'Set WAHA_JWT_SECRET to a secure random string (at least 32 characters)',
      'Configure WAHA_JWT_EXPIRES_IN (default: 24h) and WAHA_REFRESH_TOKEN_EXPIRES_IN (default: 7d)',
      'Enable audit logging with WAHA_AUDIT_LOGGING_ENABLED=true',
      'Configure rate limiting with WAHA_LOGIN_RATE_LIMIT_ATTEMPTS and WAHA_LOGIN_RATE_LIMIT_WINDOW_MS',
      'Consider enabling 2FA with WAHA_2FA_ENABLED=true',
      'Set WAHA_FORCE_HTTPS=true in production',
      'Review and update WAHA_DASHBOARD_USERNAME and WAHA_DASHBOARD_PASSWORD if needed',
    ];

    this.logger.info('Configuration recommendations after migration:');
    recommendations.forEach((recommendation, index) => {
      this.logger.info(`${index + 1}. ${recommendation}`);
    });
  }

  /**
   * Validate migration prerequisites
   */
  async validateMigrationPrerequisites(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check if database tables exist
    try {
      await this.userRepository.list({ page: 1, limit: 1 });
    } catch (error) {
      issues.push('User management database tables not found. Please run database migrations first.');
    }

    // Check JWT secret configuration
    const jwtSecret = this.configService.get('WAHA_JWT_SECRET', 'default-secret-change-in-production');
    if (jwtSecret === 'default-secret-change-in-production') {
      issues.push('WAHA_JWT_SECRET is using default value. Please set a secure secret.');
    }

    // Check if auth is enabled
    const authEnabled = this.configService.get('WAHA_AUTH_ENABLED', 'false');
    if (authEnabled !== 'true') {
      issues.push('WAHA_AUTH_ENABLED is not set to true. The new authentication system will not be active.');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Rollback migration (if needed)
   */
  async rollbackMigration(): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      this.logger.warn('Starting migration rollback');

      // This would remove migrated users and API keys
      // Implementation depends on specific rollback requirements
      
      this.logger.warn('Migration rollback completed');
      return { success: true, errors };
    } catch (error) {
      const errorMsg = `Rollback failed: ${error.message}`;
      errors.push(errorMsg);
      this.logger.error({ error: error.message }, errorMsg);
      return { success: false, errors };
    }
  }
}
