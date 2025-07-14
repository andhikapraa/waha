import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { IS_PUBLIC_KEY } from './auth.decorators';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    @InjectPinoLogger('JwtAuthGuard')
    private logger: PinoLogger,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if the endpoint is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Call the parent canActivate method to perform JWT validation
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // You can throw an exception based on either "info" or "err" arguments
    if (err || !user) {
      const request = context.switchToHttp().getRequest();
      this.logger.warn(
        { 
          url: request.url, 
          method: request.method,
          error: err?.message || info?.message 
        }, 
        'JWT authentication failed'
      );
      throw err || new UnauthorizedException('Invalid or missing authentication token');
    }

    this.logger.debug(
      { 
        userId: user.id, 
        username: user.username 
      }, 
      'JWT authentication successful'
    );

    return user;
  }
}
