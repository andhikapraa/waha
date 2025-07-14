import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

import { 
  User, 
  UserSession, 
  LoginDto, 
  AuthResponseDto,
  TwoFactorSetupDto,
  Enable2FADto,
  Verify2FADto 
} from '@waha/structures/user.dto';
import { IUserRepository, IUserSessionRepository } from '../storage/IUserRepository';
import { UserService } from './UserService';

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  user: User;
  requiresTwoFactor: boolean;
}

@Injectable()
export class AuthService {
  private readonly jwtExpiresIn: string;
  private readonly refreshTokenExpiresIn: string;
  private readonly jwtSecret: string;

  constructor(
    private userService: UserService,
    private userRepository: IUserRepository,
    private sessionRepository: IUserSessionRepository,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectPinoLogger('AuthService')
    private logger: PinoLogger,
  ) {
    this.jwtExpiresIn = this.configService.get('WAHA_JWT_EXPIRES_IN', '24h');
    this.refreshTokenExpiresIn = this.configService.get('WAHA_REFRESH_TOKEN_EXPIRES_IN', '7d');
    this.jwtSecret = this.configService.get('WAHA_JWT_SECRET', 'default-secret-change-in-production');
    
    if (this.jwtSecret === 'default-secret-change-in-production') {
      this.logger.warn('Using default JWT secret. Please set WAHA_JWT_SECRET in production!');
    }
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    this.logger.info({ username: loginDto.username }, 'User login attempt');

    // Validate user credentials
    const user = await this.userService.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if 2FA is enabled and required
    if (user.twoFactorEnabled) {
      if (!loginDto.twoFactorCode) {
        this.logger.info({ userId: user.id }, 'Two-factor authentication required');
        return {
          token: '',
          refreshToken: '',
          user,
          requiresTwoFactor: true,
        };
      }

      // Verify 2FA code
      const is2FAValid = this.verify2FACode(user.twoFactorSecret!, loginDto.twoFactorCode);
      if (!is2FAValid) {
        this.logger.warn({ userId: user.id }, 'Invalid 2FA code provided');
        throw new UnauthorizedException('Invalid two-factor authentication code');
      }
    }

    // Generate tokens and create session
    const authResult = await this.createSession(user, ipAddress, userAgent);
    
    this.logger.info({ userId: user.id, username: user.username }, 'User logged in successfully');
    return authResult;
  }

  async logout(sessionToken: string): Promise<void> {
    this.logger.info('User logout attempt');

    const session = await this.sessionRepository.findByToken(sessionToken);
    if (session) {
      await this.sessionRepository.delete(session.id);
      this.logger.info({ userId: session.userId, sessionId: session.id }, 'User logged out successfully');
    }
  }

  async refreshToken(refreshToken: string, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    this.logger.info('Token refresh attempt');

    const session = await this.sessionRepository.findByRefreshToken(refreshToken);
    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Delete old session
    await this.sessionRepository.delete(session.id);

    // Create new session
    const authResult = await this.createSession(user, ipAddress, userAgent);
    
    this.logger.info({ userId: user.id }, 'Token refreshed successfully');
    return authResult;
  }

  async validateSession(sessionToken: string): Promise<User | null> {
    const session = await this.sessionRepository.findByToken(sessionToken);
    if (!session) {
      return null;
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user || !user.isActive) {
      return null;
    }

    // Update last accessed time
    await this.sessionRepository.updateLastAccessed(session.id);

    return user;
  }

  async validateJwtPayload(payload: JwtPayload): Promise<User | null> {
    const user = await this.userRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      return null;
    }

    // Verify session still exists using session ID
    const session = await this.sessionRepository.findById(payload.sessionId);
    if (!session) {
      return null;
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      return null;
    }

    return user;
  }

  async enable2FA(userId: string): Promise<TwoFactorSetupDto> {
    this.logger.info({ userId }, 'Enabling 2FA for user');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is already enabled');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `WAHA (${user.username})`,
      issuer: 'WAHA WhatsApp API',
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = speakeasy.otpauthURL({
      secret: secret.ascii,
      label: user.username,
      issuer: 'WAHA WhatsApp API',
    });

    const qrCode = await QRCode.toDataURL(qrCodeUrl);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();

    // Store secret temporarily (will be confirmed when user verifies)
    await this.userRepository.update(userId, { twoFactorSecret: secret.base32 });

    this.logger.info({ userId }, '2FA setup initiated');

    return {
      qrCode,
      secret: secret.base32,
      backupCodes,
    };
  }

  async verify2FA(userId: string, verify2FADto: Verify2FADto): Promise<void> {
    this.logger.info({ userId }, 'Verifying 2FA setup');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication setup not initiated');
    }

    const isValid = this.verify2FACode(user.twoFactorSecret, verify2FADto.twoFactorCode);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Enable 2FA
    await this.userRepository.update(userId, { twoFactorEnabled: true });

    this.logger.info({ userId }, '2FA enabled successfully');
  }

  async disable2FA(userId: string, twoFactorCode: string): Promise<void> {
    this.logger.info({ userId }, 'Disabling 2FA for user');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const isValid = this.verify2FACode(user.twoFactorSecret, twoFactorCode);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Disable 2FA
    await this.userRepository.update(userId, { 
      twoFactorEnabled: false,
      twoFactorSecret: undefined 
    });

    this.logger.info({ userId }, '2FA disabled successfully');
  }

  async getUserSessions(userId: string): Promise<UserSession[]> {
    return this.sessionRepository.findByUserId(userId);
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessionRepository.findByToken(sessionId);
    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session not found');
    }

    await this.sessionRepository.delete(session.id);
    this.logger.info({ userId, sessionId }, 'Session revoked');
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessionRepository.deleteByUserId(userId);
    this.logger.info({ userId }, 'All sessions revoked');
  }

  async cleanupExpiredSessions(): Promise<void> {
    await this.sessionRepository.deleteExpired();
    this.logger.debug('Expired sessions cleaned up');
  }

  private async createSession(user: User, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    const sessionId = uuidv4();
    const sessionToken = uuidv4(); // Separate session token for database
    const refreshToken = uuidv4();

    // Calculate expiration times
    const tokenExpiresAt = this.calculateExpirationTime(this.jwtExpiresIn);
    const refreshExpiresAt = this.calculateExpirationTime(this.refreshTokenExpiresIn);

    // Create JWT payload with session ID
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      sessionId, // This is the session UUID for lookup
    };

    // Generate JWT token
    const token = this.jwtService.sign(payload, {
      expiresIn: this.jwtExpiresIn,
      secret: this.jwtSecret,
    });

    // Create session record with explicit ID
    const session = await this.sessionRepository.create({
      id: sessionId, // Pass the session ID explicitly
      userId: user.id,
      sessionToken, // Store separate session token
      refreshToken,
      ipAddress,
      userAgent,
      expiresAt: refreshExpiresAt, // Use refresh token expiration for session
    });

    return {
      token,
      refreshToken,
      user,
      requiresTwoFactor: false,
    };
  }

  private verify2FACode(secret: string, code: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2, // Allow 2 time steps before/after current time
    });
  }

  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(Math.random().toString(36).substring(2, 8).toUpperCase());
    }
    return codes;
  }

  private calculateExpirationTime(duration: string): Date {
    const now = new Date();
    const match = duration.match(/^(\d+)([smhd])$/);
    
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return new Date(now.getTime() + value * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      default:
        throw new Error(`Invalid duration unit: ${unit}`);
    }
  }
}
