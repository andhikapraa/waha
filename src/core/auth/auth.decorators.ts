import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@waha/structures/user.dto';
import { ROLES_KEY, PERMISSIONS_KEY, Permission } from './roles.guard';

/**
 * Decorator to specify required roles for accessing an endpoint
 * @param roles - Array of roles that can access the endpoint
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator to specify required permissions for accessing an endpoint
 * @param permissions - Array of permissions required to access the endpoint
 */
export const RequirePermissions = (...permissions: Permission[]) => 
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Convenience decorators for common role combinations
 */
export const AdminOnly = () => Roles(UserRole.ADMIN);
export const AdminOrManager = () => Roles(UserRole.ADMIN, UserRole.MANAGER);
export const AllRoles = () => Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER);

/**
 * Convenience decorators for common permissions
 */
export const CanManageUsers = () => RequirePermissions({ resource: 'users', action: 'all' });
export const CanReadUsers = () => RequirePermissions({ resource: 'users', action: 'read' });
export const CanManageSessions = () => RequirePermissions({ resource: 'sessions', action: 'all' });
export const CanReadSessions = () => RequirePermissions({ resource: 'sessions', action: 'read' });
export const CanViewAuditLogs = () => RequirePermissions({ resource: 'audit_logs', action: 'read' });
export const CanManageApiKeys = () => RequirePermissions({ resource: 'api_keys', action: 'all' });

/**
 * Public endpoint decorator - bypasses authentication
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
