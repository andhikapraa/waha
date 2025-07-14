import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs?: number;
}

export interface RateLimitRecord {
  count: number;
  resetTime: number;
  blockedUntil?: number;
}

@Injectable()
export class RateLimitingService {
  private attempts = new Map<string, RateLimitRecord>();
  private readonly loginConfig: RateLimitConfig;
  private readonly apiConfig: RateLimitConfig;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    @InjectPinoLogger('RateLimitingService')
    private logger: PinoLogger,
  ) {
    // Login rate limiting configuration
    this.loginConfig = {
      maxAttempts: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_ATTEMPTS', '5')),
      windowMs: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_WINDOW_MS', '900000')), // 15 minutes
      blockDurationMs: parseInt(this.configService.get('WAHA_LOGIN_RATE_LIMIT_BLOCK_MS', '900000')), // 15 minutes
    };

    // API rate limiting configuration
    this.apiConfig = {
      maxAttempts: parseInt(this.configService.get('WAHA_API_RATE_LIMIT_REQUESTS', '100')),
      windowMs: parseInt(this.configService.get('WAHA_API_RATE_LIMIT_WINDOW_MS', '60000')), // 1 minute
    };

    // Cleanup expired records every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRecords();
    }, 5 * 60 * 1000);

    this.logger.info(
      {
        loginConfig: this.loginConfig,
        apiConfig: this.apiConfig,
      },
      'Rate limiting service initialized'
    );
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Check if login attempt is allowed for the given identifier
   */
  checkLoginRateLimit(identifier: string): { allowed: boolean; resetTime?: number; blockedUntil?: number } {
    return this.checkRateLimit(identifier, this.loginConfig, 'login');
  }

  /**
   * Check if API request is allowed for the given identifier
   */
  checkApiRateLimit(identifier: string): { allowed: boolean; resetTime?: number } {
    const result = this.checkRateLimit(identifier, this.apiConfig, 'api');
    return {
      allowed: result.allowed,
      resetTime: result.resetTime,
    };
  }

  /**
   * Record a failed login attempt
   */
  recordFailedLogin(identifier: string): void {
    this.recordAttempt(identifier, this.loginConfig, 'login');
  }

  /**
   * Record an API request
   */
  recordApiRequest(identifier: string): void {
    this.recordAttempt(identifier, this.apiConfig, 'api');
  }

  /**
   * Reset rate limit for an identifier (e.g., after successful login)
   */
  resetRateLimit(identifier: string): void {
    this.attempts.delete(identifier);
    this.logger.debug({ identifier }, 'Rate limit reset');
  }

  /**
   * Get current rate limit status for an identifier
   */
  getRateLimitStatus(identifier: string, config: RateLimitConfig): {
    attempts: number;
    maxAttempts: number;
    resetTime: number;
    blocked: boolean;
    blockedUntil?: number;
  } {
    const record = this.attempts.get(identifier);
    const now = Date.now();

    if (!record) {
      return {
        attempts: 0,
        maxAttempts: config.maxAttempts,
        resetTime: now + config.windowMs,
        blocked: false,
      };
    }

    const blocked = record.blockedUntil ? record.blockedUntil > now : false;

    return {
      attempts: record.count,
      maxAttempts: config.maxAttempts,
      resetTime: record.resetTime,
      blocked,
      blockedUntil: record.blockedUntil,
    };
  }

  /**
   * Get login rate limit status
   */
  getLoginRateLimitStatus(identifier: string) {
    return this.getRateLimitStatus(identifier, this.loginConfig);
  }

  /**
   * Get API rate limit status
   */
  getApiRateLimitStatus(identifier: string) {
    return this.getRateLimitStatus(identifier, this.apiConfig);
  }

  /**
   * Block an identifier for a specific duration
   */
  blockIdentifier(identifier: string, durationMs: number): void {
    const now = Date.now();
    const record = this.attempts.get(identifier) || {
      count: 0,
      resetTime: now + this.loginConfig.windowMs,
    };

    record.blockedUntil = now + durationMs;
    this.attempts.set(identifier, record);

    this.logger.warn(
      {
        identifier,
        blockedUntil: new Date(record.blockedUntil),
        durationMs,
      },
      'Identifier blocked'
    );
  }

  /**
   * Unblock an identifier
   */
  unblockIdentifier(identifier: string): void {
    const record = this.attempts.get(identifier);
    if (record) {
      delete record.blockedUntil;
      this.attempts.set(identifier, record);
    }

    this.logger.info({ identifier }, 'Identifier unblocked');
  }

  private checkRateLimit(
    identifier: string,
    config: RateLimitConfig,
    type: string
  ): { allowed: boolean; resetTime?: number; blockedUntil?: number } {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    // Check if identifier is blocked
    if (record?.blockedUntil && record.blockedUntil > now) {
      this.logger.warn(
        {
          identifier,
          type,
          blockedUntil: new Date(record.blockedUntil),
        },
        'Rate limit check - identifier blocked'
      );
      return {
        allowed: false,
        blockedUntil: record.blockedUntil,
      };
    }

    // If no record or window expired, allow
    if (!record || now > record.resetTime) {
      return { allowed: true };
    }

    // Check if within rate limit
    if (record.count < config.maxAttempts) {
      return {
        allowed: true,
        resetTime: record.resetTime,
      };
    }

    // Rate limit exceeded
    this.logger.warn(
      {
        identifier,
        type,
        attempts: record.count,
        maxAttempts: config.maxAttempts,
        resetTime: new Date(record.resetTime),
      },
      'Rate limit exceeded'
    );

    return {
      allowed: false,
      resetTime: record.resetTime,
    };
  }

  private recordAttempt(identifier: string, config: RateLimitConfig, type: string): void {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    if (!record || now > record.resetTime) {
      // Create new record or reset expired record
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + config.windowMs,
      });
    } else {
      // Increment existing record
      record.count++;
      
      // If this is a login attempt and we've exceeded the limit, block the identifier
      if (type === 'login' && record.count >= config.maxAttempts && config.blockDurationMs) {
        record.blockedUntil = now + config.blockDurationMs;
        this.logger.warn(
          {
            identifier,
            attempts: record.count,
            blockedUntil: new Date(record.blockedUntil),
          },
          'Identifier blocked due to rate limit exceeded'
        );
      }
      
      this.attempts.set(identifier, record);
    }

    this.logger.debug(
      {
        identifier,
        type,
        attempts: this.attempts.get(identifier)?.count,
        maxAttempts: config.maxAttempts,
      },
      'Rate limit attempt recorded'
    );
  }

  private cleanupExpiredRecords(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [identifier, record] of this.attempts.entries()) {
      // Remove if both window and block have expired
      if (now > record.resetTime && (!record.blockedUntil || now > record.blockedUntil)) {
        this.attempts.delete(identifier);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(
        {
          cleanedCount,
          remainingRecords: this.attempts.size,
        },
        'Cleaned up expired rate limit records'
      );
    }
  }

  /**
   * Get rate limiting statistics
   */
  getStatistics(): {
    totalRecords: number;
    blockedIdentifiers: number;
    loginConfig: RateLimitConfig;
    apiConfig: RateLimitConfig;
  } {
    const now = Date.now();
    let blockedCount = 0;

    for (const record of this.attempts.values()) {
      if (record.blockedUntil && record.blockedUntil > now) {
        blockedCount++;
      }
    }

    return {
      totalRecords: this.attempts.size,
      blockedIdentifiers: blockedCount,
      loginConfig: this.loginConfig,
      apiConfig: this.apiConfig,
    };
  }
}
