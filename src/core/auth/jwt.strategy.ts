import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { User } from '@waha/structures/user.dto';
import { AuthService, JwtPayload } from '../services/AuthService';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
    @InjectPinoLogger('JwtStrategy')
    private logger: PinoLogger,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Custom cookie extractor
        (request) => {
          if (request.cookies && request.cookies.session_token) {
            return request.cookies.session_token;
          }
          return null;
        },
        // Custom extractor for Authorization header with 'Bearer ' prefix
        (request) => {
          const authHeader = request.headers?.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('WAHA_JWT_SECRET', 'default-secret-change-in-production'),
    });

    const jwtSecret = configService.get('WAHA_JWT_SECRET', 'default-secret-change-in-production');
    if (jwtSecret === 'default-secret-change-in-production') {
      this.logger.warn('Using default JWT secret. Please set WAHA_JWT_SECRET in production!');
    }
  }

  async validate(payload: JwtPayload): Promise<User> {
    this.logger.debug({ userId: payload.sub }, 'Validating JWT payload');

    try {
      const user = await this.authService.validateJwtPayload(payload);
      if (!user) {
        this.logger.warn({ userId: payload.sub }, 'JWT validation failed - user not found or inactive');
        throw new UnauthorizedException('Invalid token');
      }

      this.logger.debug({ userId: user.id, username: user.username }, 'JWT validation successful');
      return user;
    } catch (error) {
      this.logger.error({ error: error.message, userId: payload.sub }, 'JWT validation error');
      throw new UnauthorizedException('Invalid token');
    }
  }
}
