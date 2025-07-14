import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RateLimitingService } from '../services/RateLimitingService';
import { AuditService } from '../services/AuditService';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(
    private rateLimitingService: RateLimitingService,
    private auditService: AuditService,
    @InjectPinoLogger('RateLimitMiddleware')
    private logger: PinoLogger,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const identifier = this.getIdentifier(req);
    const isLoginEndpoint = this.isLoginEndpoint(req);
    
    if (isLoginEndpoint) {
      this.handleLoginRateLimit(req, res, next, identifier);
    } else {
      this.handleApiRateLimit(req, res, next, identifier);
    }
  }

  private handleLoginRateLimit(req: Request, res: Response, next: NextFunction, identifier: string) {
    const result = this.rateLimitingService.checkLoginRateLimit(identifier);
    
    if (!result.allowed) {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');
      
      // Log rate limit exceeded
      this.auditService.logRateLimitExceeded(identifier, ipAddress, userAgent);
      
      this.logger.warn(
        {
          identifier,
          endpoint: req.path,
          ipAddress,
          resetTime: result.resetTime ? new Date(result.resetTime) : undefined,
          blockedUntil: result.blockedUntil ? new Date(result.blockedUntil) : undefined,
        },
        'Login rate limit exceeded'
      );

      // Set rate limit headers
      this.setRateLimitHeaders(res, result.resetTime, result.blockedUntil);
      
      const message = result.blockedUntil 
        ? `Too many failed login attempts. Account temporarily blocked until ${new Date(result.blockedUntil).toISOString()}`
        : `Too many login attempts. Please try again after ${new Date(result.resetTime || Date.now()).toISOString()}`;
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message,
          error: 'Too Many Requests',
          retryAfter: result.blockedUntil || result.resetTime,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    next();
  }

  private handleApiRateLimit(req: Request, res: Response, next: NextFunction, identifier: string) {
    const result = this.rateLimitingService.checkApiRateLimit(identifier);
    
    if (!result.allowed) {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');
      
      // Log rate limit exceeded
      this.auditService.logRateLimitExceeded(identifier, ipAddress, userAgent);
      
      this.logger.warn(
        {
          identifier,
          endpoint: req.path,
          ipAddress,
          resetTime: result.resetTime ? new Date(result.resetTime) : undefined,
        },
        'API rate limit exceeded'
      );

      // Set rate limit headers
      this.setRateLimitHeaders(res, result.resetTime);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `API rate limit exceeded. Please try again after ${new Date(result.resetTime || Date.now()).toISOString()}`,
          error: 'Too Many Requests',
          retryAfter: result.resetTime,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Record the API request
    this.rateLimitingService.recordApiRequest(identifier);
    
    // Set rate limit headers for successful requests
    const status = this.rateLimitingService.getApiRateLimitStatus(identifier);
    res.setHeader('X-RateLimit-Limit', status.maxAttempts.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, status.maxAttempts - status.attempts).toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(status.resetTime / 1000).toString());

    next();
  }

  private getIdentifier(req: Request): string {
    // Use IP address as primary identifier
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    
    // For login endpoints, also consider username if provided
    if (this.isLoginEndpoint(req) && req.body?.username) {
      return `${ipAddress}:${req.body.username}`;
    }
    
    // For authenticated requests, use user ID if available
    const user = req.user as any;
    if (user?.id) {
      return `user:${user.id}`;
    }
    
    return `ip:${ipAddress}`;
  }

  private isLoginEndpoint(req: Request): boolean {
    return req.path === '/api/auth/login' && req.method === 'POST';
  }

  private setRateLimitHeaders(res: Response, resetTime?: number, blockedUntil?: number) {
    if (resetTime) {
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());
      res.setHeader('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString());
    }
    
    if (blockedUntil) {
      res.setHeader('X-RateLimit-Blocked-Until', Math.ceil(blockedUntil / 1000).toString());
      res.setHeader('Retry-After', Math.ceil((blockedUntil - Date.now()) / 1000).toString());
    }
  }
}

// Decorator to apply rate limiting to specific endpoints
export function RateLimit(config?: { maxAttempts?: number; windowMs?: number }) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      // This would be implemented if we need endpoint-specific rate limiting
      // For now, we use the middleware approach
      return method.apply(this, args);
    };
  };
}
