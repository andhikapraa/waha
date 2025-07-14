import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomBytes } from 'crypto';

import { parseBool } from '../../helpers';

export interface AuthConfig {
  enabled: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;

  // API Key configuration
  apiKey: string | null;
  apiKeyGenerated: boolean;
  
  // Password policy
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  
  // Rate limiting
  loginRateLimit: {
    attempts: number;
    windowMs: number;
    blockDurationMs: number;
  };
  apiRateLimit: {
    requests: number;
    windowMs: number;
  };
  
  // Security features
  twoFactorEnabled: boolean;
  sessionTimeoutMs: number;
  forceHttps: boolean;
  auditLoggingEnabled: boolean;
  auditRetentionDays: number;
  
  // Default admin user
  defaultAdmin: {
    username: string;
    password: string;
    email: string;
  };
  
  // Backward compatibility
  legacyApiKeySupport: boolean;
  legacyBasicAuthSupport: boolean;
}

@Injectable()
export class AuthConfigService {
  private readonly config: AuthConfig;

  constructor(
    private configService: ConfigService,
    @InjectPinoLogger('AuthConfigService')
    private logger: PinoLogger,
  ) {
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  private loadConfiguration(): AuthConfig {
    return {
      enabled: parseBool(this.configService.get('WAHA_AUTH_ENABLED', 'false')),
      jwtSecret: this.getOrGenerateJwtSecret(),
      jwtExpiresIn: this.configService.get('WAHA_JWT_EXPIRES_IN', '24h'),
      refreshTokenExpiresIn: this.configService.get('WAHA_REFRESH_TOKEN_EXPIRES_IN', '7d'),

      // API Key configuration
      ...this.getApiKeyConfig(),
      
      // Password policy
      passwordMinLength: parseInt(this.configService.get('WAHA_PASSWORD_MIN_LENGTH', '8')),
      passwordRequireUppercase: parseBool(this.configService.get('WAHA_PASSWORD_REQUIRE_UPPERCASE', 'true')),
      passwordRequireLowercase: parseBool(this.configService.get('WAHA_PASSWORD_REQUIRE_LOWERCASE', 'true')),
      passwordRequireNumbers: parseBool(this.configService.get('WAHA_PASSWORD_REQUIRE_NUMBERS', 'true')),
      passwordRequireSymbols: parseBool(this.configService.get('WAHA_PASSWORD_REQUIRE_SYMBOLS', 'true')),
      
      // Rate limiting
      loginRateLimit: {
        attempts: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_ATTEMPTS', '5')),
        windowMs: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_WINDOW_MS', '900000')), // 15 minutes
        blockDurationMs: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_BLOCK_MS', '900000')), // 15 minutes
      },
      apiRateLimit: {
        requests: parseInt(this.configService.get('WAHA_API_RATE_LIMIT_REQUESTS', '100')),
        windowMs: parseInt(this.configService.get('WAHA_API_RATE_LIMIT_WINDOW_MS', '60000')), // 1 minute
      },
      
      // Security features
      twoFactorEnabled: parseBool(this.configService.get('WAHA_2FA_ENABLED', 'true')),
      sessionTimeoutMs: parseInt(this.configService.get('WAHA_SESSION_TIMEOUT_MS', '86400000')), // 24 hours
      forceHttps: parseBool(this.configService.get('WAHA_FORCE_HTTPS', 'false')),
      auditLoggingEnabled: parseBool(this.configService.get('WAHA_AUDIT_LOGGING_ENABLED', 'true')),
      auditRetentionDays: parseInt(this.configService.get('WAHA_AUDIT_RETENTION_DAYS', '90')),
      
      // Default admin user
      defaultAdmin: {
        username: this.configService.get('WAHA_DEFAULT_ADMIN_USERNAME', 'admin'),
        password: this.configService.get('WAHA_DEFAULT_ADMIN_PASSWORD', 'change-me-please'),
        email: this.configService.get('WAHA_DEFAULT_ADMIN_EMAIL', 'admin@example.com'),
      },
      
      // Backward compatibility
      legacyApiKeySupport: parseBool(this.configService.get('WAHA_LEGACY_API_KEY_SUPPORT', 'true')),
      legacyBasicAuthSupport: parseBool(this.configService.get('WAHA_LEGACY_BASIC_AUTH_SUPPORT', 'false')),
    };
  }

  private getOrGenerateJwtSecret(): string {
    const envSecret = this.configService.get('WAHA_JWT_SECRET');

    // If JWT secret is provided in environment, use it
    if (envSecret && envSecret !== 'default-secret-change-in-production') {
      return envSecret;
    }

    // Generate a secure random secret for development/testing
    // In production, this should be set via environment variable
    const generatedSecret = randomBytes(32).toString('base64');

    // Log warning about generated secret
    if (!envSecret) {
      this.logger.warn('No WAHA_JWT_SECRET provided. Generated secure random secret for this session.');
      this.logger.warn('For production, set WAHA_JWT_SECRET environment variable.');
    } else {
      this.logger.warn('Using default JWT secret. Generated secure random secret for this session.');
      this.logger.warn('For production, set a secure WAHA_JWT_SECRET environment variable.');
    }

    return generatedSecret;
  }

  private getApiKeyConfig(): { apiKey: string | null; apiKeyGenerated: boolean } {
    // Check for existing API key from WhatsappConfigService compatible sources
    const envApiKey = this.configService.get('WAHA_API_KEY') || this.configService.get('WHATSAPP_API_KEY');

    if (envApiKey) {
      return {
        apiKey: envApiKey,
        apiKeyGenerated: false,
      };
    }

    // If authentication is enabled but no API key is set, generate a secure one for development
    if (this.configService.get('WAHA_AUTH_ENABLED') === 'true') {
      const generatedKey = randomBytes(32).toString('hex');
      this.logger.warn('No WAHA_API_KEY provided. Generated secure random API key for this session.');
      this.logger.warn('For production, set WAHA_API_KEY environment variable.');
      this.logger.warn(`Generated API Key: ${generatedKey}`);
      this.logger.warn('Save this key securely - it will not be shown again.');

      return {
        apiKey: generatedKey,
        apiKeyGenerated: true,
      };
    }

    // No authentication enabled and no API key - return null (NoAuth will be used)
    return {
      apiKey: null,
      apiKeyGenerated: false,
    };
  }

  private validateConfiguration(): void {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate JWT secret
    const envSecret = this.configService.get('WAHA_JWT_SECRET');
    if (!envSecret || envSecret === 'default-secret-change-in-production') {
      warnings.push('No secure JWT secret configured. Please set WAHA_JWT_SECRET in production!');
    } else if (this.config.jwtSecret.length < 32) {
      warnings.push('JWT secret should be at least 32 characters long for security.');
    }

    // Validate API key configuration
    if (this.config.enabled && !this.config.apiKey) {
      warnings.push('Authentication enabled but no API key configured. Please set WAHA_API_KEY for production!');
    } else if (this.config.apiKeyGenerated) {
      warnings.push('Using generated API key. Please set WAHA_API_KEY environment variable for production!');
    }

    // Validate default admin password
    if (this.config.defaultAdmin.password === 'change-me-please') {
      warnings.push('Using default admin password. Please set WAHA_DEFAULT_ADMIN_PASSWORD!');
    }

    // Validate password policy
    if (this.config.passwordMinLength < 8) {
      warnings.push('Password minimum length should be at least 8 characters.');
    }

    // Validate rate limiting
    if (this.config.loginRateLimit.attempts < 3) {
      warnings.push('Login rate limit attempts should be at least 3 to prevent lockouts.');
    }
    if (this.config.apiRateLimit.requests < 10) {
      warnings.push('API rate limit should allow at least 10 requests per window.');
    }

    // Validate audit retention
    if (this.config.auditRetentionDays < 30) {
      warnings.push('Audit log retention should be at least 30 days for compliance.');
    }

    // Log warnings and errors
    if (warnings.length > 0) {
      this.logger.warn({ warnings }, 'Authentication configuration warnings');
    }
    if (errors.length > 0) {
      this.logger.error({ errors }, 'Authentication configuration errors');
      throw new Error(`Authentication configuration errors: ${errors.join(', ')}`);
    }
  }

  // Getters for configuration values
  get authEnabled(): boolean {
    return this.config.enabled;
  }

  get jwtConfig() {
    return {
      secret: this.config.jwtSecret,
      expiresIn: this.config.jwtExpiresIn,
      refreshExpiresIn: this.config.refreshTokenExpiresIn,
    };
  }

  get passwordPolicy() {
    return {
      minLength: this.config.passwordMinLength,
      requireUppercase: this.config.passwordRequireUppercase,
      requireLowercase: this.config.passwordRequireLowercase,
      requireNumbers: this.config.passwordRequireNumbers,
      requireSymbols: this.config.passwordRequireSymbols,
    };
  }

  get rateLimitConfig() {
    return {
      login: this.config.loginRateLimit,
      api: this.config.apiRateLimit,
    };
  }

  get securityConfig() {
    return {
      twoFactorEnabled: this.config.twoFactorEnabled,
      sessionTimeoutMs: this.config.sessionTimeoutMs,
      forceHttps: this.config.forceHttps,
      auditLoggingEnabled: this.config.auditLoggingEnabled,
      auditRetentionDays: this.config.auditRetentionDays,
    };
  }

  get defaultAdminConfig() {
    return this.config.defaultAdmin;
  }

  get compatibilityConfig() {
    return {
      legacyApiKeySupport: this.config.legacyApiKeySupport,
      legacyBasicAuthSupport: this.config.legacyBasicAuthSupport,
    };
  }

  get apiKeyConfig() {
    return {
      apiKey: this.config.apiKey,
      apiKeyGenerated: this.config.apiKeyGenerated,
    };
  }

  get fullConfig(): AuthConfig {
    return { ...this.config };
  }

  // Password validation based on policy
  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < this.config.passwordMinLength) {
      errors.push(`Password must be at least ${this.config.passwordMinLength} characters long`);
    }

    if (this.config.passwordRequireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.config.passwordRequireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.config.passwordRequireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (this.config.passwordRequireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // Generate password regex based on policy
  getPasswordRegex(): RegExp {
    let pattern = '^';
    
    if (this.config.passwordRequireUppercase) {
      pattern += '(?=.*[A-Z])';
    }
    if (this.config.passwordRequireLowercase) {
      pattern += '(?=.*[a-z])';
    }
    if (this.config.passwordRequireNumbers) {
      pattern += '(?=.*\\d)';
    }
    if (this.config.passwordRequireSymbols) {
      pattern += '(?=.*[!@#$%^&*()_+\\-=\\[\\]{};\':"\\\\|,.<>\\/?])';
    }
    
    pattern += `[A-Za-z\\d!@#$%^&*()_+\\-=\\[\\]{};':"\\\\|,.<>\\/?]{${this.config.passwordMinLength},}$`;
    
    return new RegExp(pattern);
  }

  // Configuration summary for logging
  getConfigSummary(): Record<string, any> {
    return {
      authEnabled: this.config.enabled,
      jwtExpiresIn: this.config.jwtExpiresIn,
      twoFactorEnabled: this.config.twoFactorEnabled,
      auditLoggingEnabled: this.config.auditLoggingEnabled,
      forceHttps: this.config.forceHttps,
      legacyApiKeySupport: this.config.legacyApiKeySupport,
      passwordPolicy: this.passwordPolicy,
      rateLimits: {
        loginAttempts: this.config.loginRateLimit.attempts,
        apiRequests: this.config.apiRateLimit.requests,
      },
    };
  }
}
