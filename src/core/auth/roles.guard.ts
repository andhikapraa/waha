import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { User, UserRole } from '@waha/structures/user.dto';
import { IS_PUBLIC_KEY } from './auth.decorators';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectPinoLogger('RolesGuard')
    private logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    this.logger.warn(`RolesGuard called for route: ${request.method} ${request.url}`);

    // Explicit bypass for dashboard auth routes
    if (request.url.startsWith('/dashboard/auth')) {
      this.logger.warn('Dashboard auth route detected, skipping role-based authorization');
      return true;
    }

    // Check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    this.logger.warn(`Route is public: ${isPublic}`);

    if (isPublic) {
      // Route is public, skip role-based authorization
      this.logger.warn('Route is public, skipping role-based authorization');
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      // No roles required, allow access
      return true;
    }
    const user: User = request.user;

    if (!user) {
      this.logger.warn('No user found in request for role-based authorization');
      throw new ForbiddenException('Authentication required');
    }

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      this.logger.warn(
        { 
          userId: user.id, 
          userRole: user.role, 
          requiredRoles 
        }, 
        'User does not have required role'
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    this.logger.debug(
      { 
        userId: user.id, 
        userRole: user.role, 
        requiredRoles 
      }, 
      'Role-based authorization successful'
    );

    return true;
  }
}

// Permission-based guard for more granular control
export interface Permission {
  resource: string;
  action: string;
}

export const PERMISSIONS_KEY = 'permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectPinoLogger('PermissionsGuard')
    private logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) {
      this.logger.warn('No user found in request for permission-based authorization');
      throw new ForbiddenException('Authentication required');
    }

    const hasPermission = this.checkUserPermissions(user, requiredPermissions);

    if (!hasPermission) {
      this.logger.warn(
        { 
          userId: user.id, 
          userRole: user.role, 
          requiredPermissions 
        }, 
        'User does not have required permissions'
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    this.logger.debug(
      { 
        userId: user.id, 
        userRole: user.role, 
        requiredPermissions 
      }, 
      'Permission-based authorization successful'
    );

    return true;
  }

  private checkUserPermissions(user: User, requiredPermissions: Permission[]): boolean {
    // Define role-based permissions
    const rolePermissions = this.getRolePermissions(user.role);

    return requiredPermissions.every(permission => {
      const resourcePermissions = rolePermissions[permission.resource];
      if (!resourcePermissions) {
        return false;
      }

      // Check if user has 'all' permission for the resource or specific action
      return resourcePermissions.includes('all') || resourcePermissions.includes(permission.action);
    });
  }

  private getRolePermissions(role: UserRole): Record<string, string[]> {
    switch (role) {
      case UserRole.ADMIN:
        return {
          sessions: ['all'],
          users: ['all'],
          system: ['all'],
          api_keys: ['all'],
          audit_logs: ['all'],
        };

      case UserRole.MANAGER:
        return {
          sessions: ['all'],
          users: ['read'],
          system: ['read', 'health'],
          api_keys: ['create', 'read', 'update'],
          audit_logs: ['read'],
        };

      case UserRole.VIEWER:
        return {
          sessions: ['read'],
          users: [],
          system: ['health'],
          api_keys: [],
          audit_logs: [],
        };

      case UserRole.API_ONLY:
        return {
          // API-only users have no dashboard permissions
          // Their permissions are handled via API key permissions
        };

      default:
        return {};
    }
  }
}

// Owner-based guard for resource ownership
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(
    @InjectPinoLogger('OwnerGuard')
    private logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: User = request.user;
    const params = request.params;

    if (!user) {
      this.logger.warn('No user found in request for owner-based authorization');
      throw new ForbiddenException('Authentication required');
    }

    // Admin can access everything
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // Check if user is trying to access their own resources
    const userId = params.userId || params.id;
    if (userId && userId !== user.id) {
      this.logger.warn(
        { 
          userId: user.id, 
          requestedUserId: userId 
        }, 
        'User trying to access another user\'s resources'
      );
      throw new ForbiddenException('Can only access your own resources');
    }

    return true;
  }
}
