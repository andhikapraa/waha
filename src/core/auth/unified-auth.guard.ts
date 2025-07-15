import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException,
  Logger
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { JwtAuthGuard } from './jwt-auth.guard';
import { IApiKeyAuth } from './auth';
import { AuthConfigService } from '../config/AuthConfigService';
import { IS_PUBLIC_KEY } from './auth.decorators';

/**
 * Unified Authentication Guard
 * 
 * This guard provides a unified authentication system that supports:
 * 1. JWT Bearer tokens (preferred, modern authentication)
 * 2. API Key authentication (legacy support for backward compatibility)
 * 3. Public endpoints (bypassed with @Public decorator)
 * 
 * Authentication Priority:
 * 1. Check for @Public decorator - if present, allow access
 * 2. Check for JWT Bearer token - if present, validate with JwtAuthGuard
 * 3. Check for API Key - if present and legacy support enabled, validate
 * 4. If no valid authentication found, deny access
 */
@Injectable()
export class UnifiedAuthGuard implements CanActivate {
  private readonly logger = new Logger(UnifiedAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtAuthGuard: JwtAuthGuard,
    private apiKeyAuth: IApiKeyAuth,
    private authConfig: AuthConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Explicit bypass for dashboard auth routes
    if (request.url.startsWith('/dashboard/auth')) {
      this.logger.debug('Dashboard auth route detected, skipping authentication');
      return true;
    }

    // Check if endpoint is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.debug('Public endpoint accessed, skipping authentication');
      return true;
    }

    // If authentication is disabled globally, allow access (backward compatibility)
    if (!this.authConfig.fullConfig.enabled) {
      this.logger.warn('🚨 Authentication is DISABLED - allowing unauthenticated access');
      return true;
    }
    
    // Try JWT authentication first (preferred method)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const result = await this.jwtAuthGuard.canActivate(context);
        if (result) {
          this.logger.debug('JWT authentication successful');
          return true;
        }
      } catch (error) {
        this.logger.debug('JWT authentication failed:', error.message);
        // Continue to try API key authentication
      }
    }

    // Try API key authentication (legacy support)
    if (this.authConfig.compatibilityConfig?.legacyApiKeySupport) {
      const apiKey = this.extractApiKey(request);
      if (apiKey) {
        try {
          const isValidApiKey = await this.apiKeyAuth.isValid(apiKey);
          if (isValidApiKey) {
            this.logger.debug('API key authentication successful');
            // Set a basic user context for API key authentication
            request.user = {
              id: 'api-key-user',
              username: 'api-key',
              role: 'ADMIN', // API key users get admin access for backward compatibility
              permissions: [],
            };
            return true;
          }
        } catch (error) {
          this.logger.debug('API key authentication failed:', error.message);
        }
      }
    }

    // No valid authentication found
    this.logger.warn('Authentication failed - no valid JWT token or API key provided');
    throw new UnauthorizedException(
      'Authentication required. Provide a valid JWT Bearer token or API key.'
    );
  }

  private extractApiKey(request: Request): string | null {
    // Check multiple possible locations for API key
    const apiKey = 
      request.headers['x-api-key'] ||
      request.headers['api-key'] ||
      request.query.api_key ||
      request.query.apikey;

    return typeof apiKey === 'string' ? apiKey : null;
  }
}
