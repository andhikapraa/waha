import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthConfigService } from '../config/AuthConfigService';
import { UserService } from './UserService';
import { IUserRepository } from '../storage/IUserRepository';
import { User, UserRole } from '@waha/structures/user.dto';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export interface AdminBootstrapResult {
  success: boolean;
  adminCreated: boolean;
  adminExists: boolean;
  username?: string;
  error?: string;
}

export interface AdminValidationResult {
  valid: boolean;
  adminExists: boolean;
  adminActive: boolean;
  issues: string[];
}

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly DEFAULT_ADMIN_USERNAME = 'admin';
  private readonly DEFAULT_ADMIN_EMAIL = 'admin@waha.local';

  constructor(
    private authConfig: AuthConfigService,
    private userService: UserService,
    private userRepository: IUserRepository,
    @InjectPinoLogger('AdminBootstrapService')
    private logger: PinoLogger,
  ) {}

  async onModuleInit() {
    this.logger.info('Admin bootstrap service initialized');
  }

  /**
   * Bootstrap admin user if needed
   */
  async bootstrapAdmin(): Promise<AdminBootstrapResult> {
    const result: AdminBootstrapResult = {
      success: true,
      adminCreated: false,
      adminExists: false,
    };

    try {
      this.logger.info('Starting admin bootstrap process...');

      // Check if authentication is enabled
      if (!this.authConfig.authEnabled) {
        this.logger.info('Authentication is disabled, skipping admin bootstrap');
        return result;
      }

      // Check if any admin users exist
      const adminExists = await this.checkAdminExists();
      result.adminExists = adminExists;

      if (adminExists) {
        this.logger.info('Admin user already exists, skipping creation');
        return result;
      }

      // Create default admin user
      const adminUser = await this.createDefaultAdmin();
      if (adminUser) {
        result.adminCreated = true;
        result.username = adminUser.username;
        this.logger.info({ 
          username: adminUser.username,
          email: adminUser.email 
        }, 'Default admin user created successfully');
      }

    } catch (error) {
      result.success = false;
      result.error = error.message;
      this.logger.error({ error: error.message }, 'Admin bootstrap failed');
    }

    return result;
  }

  /**
   * Check if any admin users exist
   */
  private async checkAdminExists(): Promise<boolean> {
    try {
      const users = await this.userRepository.list({
        role: UserRole.ADMIN,
        limit: 1,
      });
      return users.users.length > 0;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error checking for admin users');
      return false;
    }
  }

  /**
   * Create default admin user
   */
  private async createDefaultAdmin(): Promise<User | null> {
    try {
      // Get admin credentials from environment
      const adminPassword = this.getAdminPassword();
      const adminUsername = this.getAdminUsername();
      const adminEmail = this.getAdminEmail();

      if (!adminPassword) {
        throw new Error('Admin password not configured. Set WAHA_DEFAULT_ADMIN_PASSWORD environment variable.');
      }

      // Check if username already exists
      const existingUser = await this.userRepository.findByUsername(adminUsername);
      if (existingUser) {
        this.logger.warn({ username: adminUsername }, 'Admin username already exists');
        return existingUser;
      }

      // Check if email already exists
      const existingEmail = await this.userRepository.findByEmail(adminEmail);
      if (existingEmail) {
        this.logger.warn({ email: adminEmail }, 'Admin email already exists');
        return existingEmail;
      }

      // Generate salt and hash password
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(adminPassword, salt);

      // Create admin user
      const adminUser = await this.userRepository.create({
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        salt,
        role: UserRole.ADMIN,
        isActive: true,
        twoFactorEnabled: false,
        failedLoginAttempts: 0,
      });

      this.logger.info({ 
        id: adminUser.id,
        username: adminUser.username,
        email: adminUser.email 
      }, 'Default admin user created');

      return adminUser;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to create default admin user');
      return null;
    }
  }

  /**
   * Validate admin user configuration
   */
  async validateAdminSetup(): Promise<AdminValidationResult> {
    const result: AdminValidationResult = {
      valid: true,
      adminExists: false,
      adminActive: false,
      issues: [],
    };

    try {
      // Check if authentication is enabled
      if (!this.authConfig.authEnabled) {
        result.issues.push('Authentication is disabled');
        return result;
      }

      // Check for admin users
      const users = await this.userRepository.list({
        role: UserRole.ADMIN,
        limit: 10,
      });

      result.adminExists = users.users.length > 0;

      if (!result.adminExists) {
        result.valid = false;
        result.issues.push('No admin users found');
        return result;
      }

      // Check for active admin users
      const activeAdmins = users.users.filter(user => user.isActive);
      result.adminActive = activeAdmins.length > 0;

      if (!result.adminActive) {
        result.valid = false;
        result.issues.push('No active admin users found');
      }

      // Check admin password configuration
      const adminPassword = this.getAdminPassword();
      if (!adminPassword && !result.adminExists) {
        result.valid = false;
        result.issues.push('WAHA_DEFAULT_ADMIN_PASSWORD not configured');
      }

      // Validate password strength
      if (adminPassword && !this.isPasswordStrong(adminPassword)) {
        result.issues.push('Admin password does not meet strength requirements');
      }

      this.logger.info({ 
        adminExists: result.adminExists,
        adminActive: result.adminActive,
        issues: result.issues.length 
      }, 'Admin setup validation completed');

    } catch (error) {
      result.valid = false;
      result.issues.push(`Validation error: ${error.message}`);
      this.logger.error({ error: error.message }, 'Admin validation failed');
    }

    return result;
  }

  /**
   * Reset admin password
   */
  async resetAdminPassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.userRepository.findByUsername(username);
      if (!user) {
        return { success: false, error: 'Admin user not found' };
      }

      if (user.role !== UserRole.ADMIN) {
        return { success: false, error: 'User is not an admin' };
      }

      if (!this.isPasswordStrong(newPassword)) {
        return { success: false, error: 'Password does not meet strength requirements' };
      }

      // Generate new salt and hash
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      // Update user
      await this.userRepository.update(user.id, {
        passwordHash,
        salt,
        failedLoginAttempts: 0,
        lockedUntil: undefined,
      });

      this.logger.info({ username }, 'Admin password reset successfully');
      return { success: true };

    } catch (error) {
      this.logger.error({ username, error: error.message }, 'Failed to reset admin password');
      return { success: false, error: error.message };
    }
  }

  /**
   * Get admin password from environment
   */
  private getAdminPassword(): string | undefined {
    return process.env.WAHA_DEFAULT_ADMIN_PASSWORD || 
           process.env.WAHA_ADMIN_PASSWORD ||
           process.env.ADMIN_PASSWORD;
  }

  /**
   * Get admin username from environment
   */
  private getAdminUsername(): string {
    return process.env.WAHA_DEFAULT_ADMIN_USERNAME || 
           process.env.WAHA_ADMIN_USERNAME ||
           process.env.ADMIN_USERNAME ||
           this.DEFAULT_ADMIN_USERNAME;
  }

  /**
   * Get admin email from environment
   */
  private getAdminEmail(): string {
    return process.env.WAHA_DEFAULT_ADMIN_EMAIL || 
           process.env.WAHA_ADMIN_EMAIL ||
           process.env.ADMIN_EMAIL ||
           this.DEFAULT_ADMIN_EMAIL;
  }

  /**
   * Check password strength
   */
  private isPasswordStrong(password: string): boolean {
    const passwordPolicy = this.authConfig.passwordPolicy;

    if (password.length < passwordPolicy.minLength) {
      return false;
    }

    // Check requirements based on configuration
    if (passwordPolicy.requireUppercase && !/[A-Z]/.test(password)) {
      return false;
    }

    if (passwordPolicy.requireLowercase && !/[a-z]/.test(password)) {
      return false;
    }

    if (passwordPolicy.requireNumbers && !/\d/.test(password)) {
      return false;
    }

    if (passwordPolicy.requireSymbols && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return false;
    }

    return true;
  }

  /**
   * Get admin setup status
   */
  async getAdminStatus(): Promise<{
    authEnabled: boolean;
    adminExists: boolean;
    adminCount: number;
    activeAdminCount: number;
    defaultCredentialsConfigured: boolean;
  }> {
    try {
      const authEnabled = this.authConfig.authEnabled;
      
      if (!authEnabled) {
        return {
          authEnabled: false,
          adminExists: false,
          adminCount: 0,
          activeAdminCount: 0,
          defaultCredentialsConfigured: false,
        };
      }

      const users = await this.userRepository.list({
        role: UserRole.ADMIN,
        limit: 100,
      });

      const activeAdmins = users.users.filter(user => user.isActive);
      const defaultCredentialsConfigured = !!this.getAdminPassword();

      return {
        authEnabled,
        adminExists: users.users.length > 0,
        adminCount: users.users.length,
        activeAdminCount: activeAdmins.length,
        defaultCredentialsConfigured,
      };

    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to get admin status');
      return {
        authEnabled: false,
        adminExists: false,
        adminCount: 0,
        activeAdminCount: 0,
        defaultCredentialsConfigured: false,
      };
    }
  }
}
