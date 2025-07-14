import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AuditLog } from '@waha/structures/user.dto';
import { IAuditLogRepository } from '../storage/IUserRepository';

export interface AuditAction {
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export enum AuditActionType {
  // Authentication actions
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  TOKEN_REFRESH = 'token_refresh',
  PASSWORD_CHANGE = 'password_change',
  PASSWORD_RESET = 'password_reset',
  
  // 2FA actions
  TWO_FA_ENABLED = '2fa_enabled',
  TWO_FA_DISABLED = '2fa_disabled',
  TWO_FA_FAILED = '2fa_failed',
  
  // User management actions
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  USER_LOCKED = 'user_locked',
  USER_UNLOCKED = 'user_unlocked',
  
  // Session management actions
  SESSION_CREATED = 'session_created',
  SESSION_REVOKED = 'session_revoked',
  ALL_SESSIONS_REVOKED = 'all_sessions_revoked',
  
  // API key actions
  API_KEY_CREATED = 'api_key_created',
  API_KEY_USED = 'api_key_used',
  API_KEY_REVOKED = 'api_key_revoked',
  
  // System actions
  UNAUTHORIZED_ACCESS = 'unauthorized_access',
  PERMISSION_DENIED = 'permission_denied',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  
  // WhatsApp session actions
  WHATSAPP_SESSION_CREATED = 'whatsapp_session_created',
  WHATSAPP_SESSION_DELETED = 'whatsapp_session_deleted',
  WHATSAPP_SESSION_STARTED = 'whatsapp_session_started',
  WHATSAPP_SESSION_STOPPED = 'whatsapp_session_stopped',
}

@Injectable()
export class AuditService {
  private readonly auditEnabled: boolean;
  private readonly retentionDays: number;

  constructor(
    private auditRepository: IAuditLogRepository,
    private configService: ConfigService,
    @InjectPinoLogger('AuditService')
    private logger: PinoLogger,
  ) {
    this.auditEnabled = this.configService.get('WAHA_AUDIT_LOGGING_ENABLED', 'true') === 'true';
    this.retentionDays = parseInt(this.configService.get('WAHA_AUDIT_RETENTION_DAYS', '90'));
  }

  async logAction(action: AuditAction): Promise<void> {
    if (!this.auditEnabled) {
      return;
    }

    try {
      const auditLog = await this.auditRepository.create({
        userId: action.userId,
        action: action.action,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        details: action.details || {},
        ipAddress: action.ipAddress,
        userAgent: action.userAgent,
      });

      this.logger.debug(
        {
          auditId: auditLog.id,
          userId: action.userId,
          action: action.action,
          resourceType: action.resourceType,
          resourceId: action.resourceId,
        },
        'Audit log created'
      );
    } catch (error) {
      this.logger.error(
        { error: error.message, action },
        'Failed to create audit log'
      );
    }
  }

  // Convenience methods for common audit actions
  async logLogin(userId: string, success: boolean, ipAddress?: string, userAgent?: string, details?: Record<string, any>): Promise<void> {
    await this.logAction({
      userId,
      action: success ? AuditActionType.LOGIN_SUCCESS : AuditActionType.LOGIN_FAILED,
      resourceType: 'user',
      resourceId: userId,
      details,
      ipAddress,
      userAgent,
    });
  }

  async logLogout(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.LOGOUT,
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  async logPasswordChange(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.PASSWORD_CHANGE,
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  async logUserCreated(createdUserId: string, createdByUserId?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId: createdByUserId,
      action: AuditActionType.USER_CREATED,
      resourceType: 'user',
      resourceId: createdUserId,
      ipAddress,
      userAgent,
    });
  }

  async logUserUpdated(updatedUserId: string, updatedByUserId?: string, changes?: Record<string, any>, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId: updatedByUserId,
      action: AuditActionType.USER_UPDATED,
      resourceType: 'user',
      resourceId: updatedUserId,
      details: { changes },
      ipAddress,
      userAgent,
    });
  }

  async logUserDeleted(deletedUserId: string, deletedByUserId?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId: deletedByUserId,
      action: AuditActionType.USER_DELETED,
      resourceType: 'user',
      resourceId: deletedUserId,
      ipAddress,
      userAgent,
    });
  }

  async log2FAEnabled(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.TWO_FA_ENABLED,
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  async log2FADisabled(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.TWO_FA_DISABLED,
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  async logUnauthorizedAccess(userId?: string, resource?: string, ipAddress?: string, userAgent?: string, details?: Record<string, any>): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.UNAUTHORIZED_ACCESS,
      resourceType: 'security',
      resourceId: resource,
      details,
      ipAddress,
      userAgent,
    });
  }

  async logPermissionDenied(userId: string, resource: string, requiredPermission: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      userId,
      action: AuditActionType.PERMISSION_DENIED,
      resourceType: 'security',
      resourceId: resource,
      details: { requiredPermission },
      ipAddress,
      userAgent,
    });
  }

  async logRateLimitExceeded(identifier: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.logAction({
      action: AuditActionType.RATE_LIMIT_EXCEEDED,
      resourceType: 'security',
      resourceId: identifier,
      details: { identifier },
      ipAddress,
      userAgent,
    });
  }

  async logWhatsAppSessionAction(action: string, sessionName: string, userId?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    let auditAction: string;
    switch (action) {
      case 'created':
        auditAction = AuditActionType.WHATSAPP_SESSION_CREATED;
        break;
      case 'deleted':
        auditAction = AuditActionType.WHATSAPP_SESSION_DELETED;
        break;
      case 'started':
        auditAction = AuditActionType.WHATSAPP_SESSION_STARTED;
        break;
      case 'stopped':
        auditAction = AuditActionType.WHATSAPP_SESSION_STOPPED;
        break;
      default:
        auditAction = action;
    }

    await this.logAction({
      userId,
      action: auditAction,
      resourceType: 'whatsapp_session',
      resourceId: sessionName,
      ipAddress,
      userAgent,
    });
  }

  async getAuditLogs(filters: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    return this.auditRepository.list(filters);
  }

  async cleanupOldLogs(): Promise<void> {
    if (this.retentionDays <= 0) {
      return; // Retention disabled
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    try {
      await this.auditRepository.deleteOlderThan(cutoffDate);
      this.logger.info(
        { cutoffDate, retentionDays: this.retentionDays },
        'Cleaned up old audit logs'
      );
    } catch (error) {
      this.logger.error(
        { error: error.message, cutoffDate },
        'Failed to cleanup old audit logs'
      );
    }
  }
}
