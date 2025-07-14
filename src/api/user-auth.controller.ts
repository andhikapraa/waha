import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import {
  LoginDto,
  AuthResponseDto,
  RefreshTokenDto,
  ChangePasswordDto,
  Enable2FADto,
  Verify2FADto,
  TwoFactorSetupDto,
  UserDto,
  User,
} from '@waha/structures/user.dto';
import { AuthService } from '../core/services/AuthService';
import { UserService } from '../core/services/UserService';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard';
import { Public } from '../core/auth/auth.decorators';

@ApiTags('🔐 User Authentication')
@Controller('api/auth')
export class UserAuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    @InjectPinoLogger('UserAuthController')
    private logger: PinoLogger,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate user with username/password and optional 2FA code',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or 2FA code required',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    this.logger.info(
      { username: loginDto.username, ipAddress },
      'User login attempt'
    );

    const result = await this.authService.login(loginDto, ipAddress, userAgent);

    // Convert User to UserDto for response
    const userDto: UserDto = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      role: result.user.role,
      isActive: result.user.isActive,
      twoFactorEnabled: result.user.twoFactorEnabled,
      lastLoginAt: result.user.lastLoginAt,
      failedLoginAttempts: result.user.failedLoginAttempts,
      lockedUntil: result.user.lockedUntil,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
    };

    return {
      token: result.token,
      refreshToken: result.refreshToken,
      user: userDto,
      requiresTwoFactor: result.requiresTwoFactor,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'User logout',
    description: 'Invalidate current session token',
  })
  @ApiResponse({
    status: 204,
    description: 'Logout successful',
  })
  async logout(@Req() req: Request): Promise<void> {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await this.authService.logout(token);
    }

    const user = req.user as User;
    this.logger.info({ userId: user?.id }, 'User logged out');
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Get new access token using refresh token',
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid refresh token',
  })
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    const result = await this.authService.refreshToken(
      refreshTokenDto.refreshToken,
      ipAddress,
      userAgent,
    );

    // Convert User to UserDto for response
    const userDto: UserDto = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      role: result.user.role,
      isActive: result.user.isActive,
      twoFactorEnabled: result.user.twoFactorEnabled,
      lastLoginAt: result.user.lastLoginAt,
      failedLoginAttempts: result.user.failedLoginAttempts,
      lockedUntil: result.user.lockedUntil,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
    };

    return {
      token: result.token,
      refreshToken: result.refreshToken,
      user: userDto,
      requiresTwoFactor: result.requiresTwoFactor,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Get authenticated user information',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserDto,
  })
  async getCurrentUser(@Req() req: Request): Promise<UserDto> {
    const user = req.user as User;
    
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change password',
    description: 'Change current user password',
  })
  @ApiResponse({
    status: 204,
    description: 'Password changed successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Current password is incorrect',
  })
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    const user = req.user as User;
    await this.userService.changePassword(user.id, changePasswordDto);
    this.logger.info({ userId: user.id }, 'Password changed successfully');
  }

  @Post('enable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enable two-factor authentication',
    description: 'Generate QR code and backup codes for 2FA setup',
  })
  @ApiResponse({
    status: 200,
    description: '2FA setup initiated',
    type: TwoFactorSetupDto,
  })
  async enable2FA(@Req() req: Request): Promise<TwoFactorSetupDto> {
    const user = req.user as User;
    const result = await this.authService.enable2FA(user.id);
    this.logger.info({ userId: user.id }, '2FA setup initiated');
    return result;
  }

  @Post('verify-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Verify and enable 2FA',
    description: 'Verify 2FA code and complete 2FA setup',
  })
  @ApiResponse({
    status: 204,
    description: '2FA enabled successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid verification code',
  })
  async verify2FA(
    @Body() verify2FADto: Verify2FADto,
    @Req() req: Request,
  ): Promise<void> {
    const user = req.user as User;
    await this.authService.verify2FA(user.id, verify2FADto);
    this.logger.info({ userId: user.id }, '2FA enabled successfully');
  }

  @Post('disable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disable two-factor authentication',
    description: 'Disable 2FA for current user',
  })
  @ApiResponse({
    status: 204,
    description: '2FA disabled successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid verification code',
  })
  async disable2FA(
    @Body() verify2FADto: Verify2FADto,
    @Req() req: Request,
  ): Promise<void> {
    const user = req.user as User;
    await this.authService.disable2FA(user.id, verify2FADto.twoFactorCode);
    this.logger.info({ userId: user.id }, '2FA disabled successfully');
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user sessions',
    description: 'Get all active sessions for current user',
  })
  async getUserSessions(@Req() req: Request) {
    const user = req.user as User;
    return this.authService.getUserSessions(user.id);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke session',
    description: 'Revoke a specific session',
  })
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<void> {
    const user = req.user as User;
    await this.authService.revokeSession(sessionId, user.id);
    this.logger.info({ userId: user.id, sessionId }, 'Session revoked');
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke all sessions',
    description: 'Revoke all sessions for current user',
  })
  async revokeAllSessions(@Req() req: Request): Promise<void> {
    const user = req.user as User;
    await this.authService.revokeAllSessions(user.id);
    this.logger.info({ userId: user.id }, 'All sessions revoked');
  }
}
