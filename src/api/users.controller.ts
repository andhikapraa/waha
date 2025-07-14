import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import {
  CreateUserDto,
  UpdateUserDto,
  UserDto,
  GetUsersQueryDto,
  ResetPasswordDto,
  User,
} from '@waha/structures/user.dto';
import { UserService } from '../core/services/UserService';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard';
import { RolesGuard, PermissionsGuard, OwnerGuard } from '../core/auth/roles.guard';
import { 
  Roles, 
  AdminOnly, 
  AdminOrManager, 
  CanManageUsers, 
  CanReadUsers 
} from '../core/auth/auth.decorators';

@ApiTags('👥 User Management')
@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private userService: UserService,
    @InjectPinoLogger('UsersController')
    private logger: PinoLogger,
  ) {}

  @Get()
  @AdminOrManager()
  @ApiOperation({
    summary: 'List users',
    description: 'Get paginated list of users with optional filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: [UserDto],
  })
  async getUsers(@Query() query: GetUsersQueryDto) {
    this.logger.info({ query }, 'Listing users');
    
    const result = await this.userService.listUsers(query);
    
    // Convert Users to UserDtos
    const users: UserDto[] = result.users.map(user => ({
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
    }));

    return {
      users,
      total: result.total,
      page: query.page || 1,
      limit: query.limit || 10,
    };
  }

  @Get(':id')
  @UseGuards(PermissionsGuard, OwnerGuard)
  @CanReadUsers()
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Get user details by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getUserById(@Param('id') id: string): Promise<UserDto> {
    this.logger.info({ userId: id }, 'Getting user by ID');
    
    const user = await this.userService.getUserById(id);
    
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

  @Post()
  @AdminOnly()
  @ApiOperation({
    summary: 'Create user',
    description: 'Create a new user account',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Username or email already exists',
  })
  async createUser(@Body() createUserDto: CreateUserDto): Promise<UserDto> {
    this.logger.info({ username: createUserDto.username }, 'Creating new user');
    
    const user = await this.userService.createUser(createUserDto);
    
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

  @Put(':id')
  @UseGuards(PermissionsGuard, OwnerGuard)
  @CanManageUsers()
  @ApiOperation({
    summary: 'Update user',
    description: 'Update user information',
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Username or email already exists',
  })
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserDto> {
    this.logger.info({ userId: id }, 'Updating user');
    
    const user = await this.userService.updateUser(id, updateUserDto);
    
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

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete user',
    description: 'Delete user account',
  })
  @ApiResponse({
    status: 204,
    description: 'User deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async deleteUser(@Param('id') id: string): Promise<void> {
    this.logger.info({ userId: id }, 'Deleting user');
    await this.userService.deleteUser(id);
  }

  @Post(':id/reset-password')
  @AdminOnly()
  @ApiOperation({
    summary: 'Reset user password',
    description: 'Generate temporary password for user',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
    type: ResetPasswordDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async resetPassword(@Param('id') id: string): Promise<ResetPasswordDto> {
    this.logger.info({ userId: id }, 'Resetting user password');
    
    const temporaryPassword = await this.userService.resetPassword(id);
    
    return { temporaryPassword };
  }

  @Post(':id/lock')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Lock user account',
    description: 'Lock user account temporarily',
  })
  @ApiResponse({
    status: 204,
    description: 'User account locked successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async lockUser(@Param('id') id: string): Promise<void> {
    this.logger.info({ userId: id }, 'Locking user account');
    await this.userService.lockUser(id);
  }

  @Post(':id/unlock')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlock user account',
    description: 'Unlock user account',
  })
  @ApiResponse({
    status: 204,
    description: 'User account unlocked successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async unlockUser(@Param('id') id: string): Promise<void> {
    this.logger.info({ userId: id }, 'Unlocking user account');
    await this.userService.unlockUser(id);
  }
}
