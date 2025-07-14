import { Injectable, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { 
  User, 
  UserRole, 
  CreateUserDto, 
  UpdateUserDto, 
  ChangePasswordDto,
  GetUsersQueryDto 
} from '@waha/structures/user.dto';
import { IUserRepository } from '../storage/IUserRepository';

@Injectable()
export class UserService {
  private readonly saltRounds = 12;
  private readonly maxFailedAttempts = 5;
  private readonly lockoutDurationMs = 15 * 60 * 1000; // 15 minutes

  constructor(
    private userRepository: IUserRepository,
    private configService: ConfigService,
    @InjectPinoLogger('UserService')
    private logger: PinoLogger,
  ) {}

  async createUser(userData: CreateUserDto): Promise<User> {
    this.logger.info({ username: userData.username }, 'Creating new user');

    // Check if username already exists
    const existingUsername = await this.userRepository.findByUsername(userData.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    // Check if email already exists
    const existingEmail = await this.userRepository.findByEmail(userData.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // Generate salt and hash password
    const salt = await bcrypt.genSalt(this.saltRounds);
    const passwordHash = await bcrypt.hash(userData.password, salt);

    const user = await this.userRepository.create({
      username: userData.username,
      email: userData.email,
      passwordHash,
      salt,
      role: userData.role || UserRole.VIEWER,
      isActive: userData.isActive !== undefined ? userData.isActive : true,
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
    });

    this.logger.info({ userId: user.id, username: user.username }, 'User created successfully');
    return user;
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      this.logger.warn({ username }, 'User not found during validation');
      return null;
    }

    // Check if user is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.logger.warn({ userId: user.id, username }, 'User account is locked');
      throw new UnauthorizedException('Account is temporarily locked due to too many failed attempts');
    }

    // Check if user is active
    if (!user.isActive) {
      this.logger.warn({ userId: user.id, username }, 'Inactive user attempted login');
      throw new UnauthorizedException('Account is disabled');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      this.logger.warn({ userId: user.id, username }, 'Invalid password attempt');
      
      // Increment failed attempts
      await this.userRepository.incrementFailedAttempts(user.id);
      
      // Check if we should lock the account
      const updatedUser = await this.userRepository.findById(user.id);
      if (updatedUser && updatedUser.failedLoginAttempts >= this.maxFailedAttempts) {
        const lockUntil = new Date(Date.now() + this.lockoutDurationMs);
        await this.userRepository.lockUser(user.id, lockUntil);
        this.logger.warn({ userId: user.id, username }, 'User account locked due to failed attempts');
        throw new UnauthorizedException('Account locked due to too many failed attempts');
      }
      
      return null;
    }

    // Reset failed attempts on successful login
    if (user.failedLoginAttempts > 0) {
      await this.userRepository.resetFailedAttempts(user.id);
    }

    // Update last login time
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

    this.logger.info({ userId: user.id, username }, 'User validated successfully');
    return user;
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getUserByUsername(username: string): Promise<User> {
    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getUserByEmail(email: string): Promise<User> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateUser(id: string, updates: UpdateUserDto): Promise<User> {
    this.logger.info({ userId: id }, 'Updating user');

    const existingUser = await this.userRepository.findById(id);
    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // Check for username conflicts
    if (updates.username && updates.username !== existingUser.username) {
      const usernameExists = await this.userRepository.findByUsername(updates.username);
      if (usernameExists) {
        throw new ConflictException('Username already exists');
      }
    }

    // Check for email conflicts
    if (updates.email && updates.email !== existingUser.email) {
      const emailExists = await this.userRepository.findByEmail(updates.email);
      if (emailExists) {
        throw new ConflictException('Email already exists');
      }
    }

    const updatedUser = await this.userRepository.update(id, updates);
    this.logger.info({ userId: id }, 'User updated successfully');
    return updatedUser;
  }

  async deleteUser(id: string): Promise<void> {
    this.logger.info({ userId: id }, 'Deleting user');

    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.delete(id);
    this.logger.info({ userId: id }, 'User deleted successfully');
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<void> {
    this.logger.info({ userId }, 'Changing user password');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(changePasswordDto.currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Generate new salt and hash new password
    const salt = await bcrypt.genSalt(this.saltRounds);
    const passwordHash = await bcrypt.hash(changePasswordDto.newPassword, salt);

    await this.userRepository.update(userId, { passwordHash, salt });
    this.logger.info({ userId }, 'Password changed successfully');
  }

  async resetPassword(userId: string): Promise<string> {
    this.logger.info({ userId }, 'Resetting user password');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate temporary password
    const temporaryPassword = this.generateTemporaryPassword();
    
    // Generate salt and hash temporary password
    const salt = await bcrypt.genSalt(this.saltRounds);
    const passwordHash = await bcrypt.hash(temporaryPassword, salt);

    await this.userRepository.update(userId, { 
      passwordHash, 
      salt,
      failedLoginAttempts: 0,
      lockedUntil: undefined 
    });

    this.logger.info({ userId }, 'Password reset successfully');
    return temporaryPassword;
  }

  async listUsers(query: GetUsersQueryDto): Promise<{ users: User[]; total: number }> {
    this.logger.debug({ query }, 'Listing users');

    const result = await this.userRepository.list({
      page: query.page,
      limit: query.limit,
      search: query.search,
      role: query.role,
      isActive: query.isActive,
    });

    this.logger.debug({ count: result.users.length, total: result.total }, 'Users listed');
    return result;
  }

  async lockUser(userId: string, durationMs?: number): Promise<void> {
    this.logger.info({ userId }, 'Locking user account');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const lockUntil = new Date(Date.now() + (durationMs || this.lockoutDurationMs));
    await this.userRepository.lockUser(userId, lockUntil);

    this.logger.info({ userId, lockUntil }, 'User account locked');
  }

  async unlockUser(userId: string): Promise<void> {
    this.logger.info({ userId }, 'Unlocking user account');

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, { 
      lockedUntil: undefined,
      failedLoginAttempts: 0 
    });

    this.logger.info({ userId }, 'User account unlocked');
  }

  private generateTemporaryPassword(): string {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    return password;
  }

  async hashPassword(password: string): Promise<{ hash: string; salt: string }> {
    const salt = await bcrypt.genSalt(this.saltRounds);
    const hash = await bcrypt.hash(password, salt);
    return { hash, salt };
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
