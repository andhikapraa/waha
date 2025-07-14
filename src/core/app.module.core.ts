import * as process from 'node:process';

import { INestApplication, MiddlewareConsumer, Module } from '@nestjs/common';
import { Provider } from '@nestjs/common/interfaces/modules/provider.interface';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TerminusModule } from '@nestjs/terminus';
import { ChannelsController } from '@waha/api/channels.controller';
import { DashboardAuthController } from '@waha/api/dashboard-auth.controller';
import { LidsController } from '@waha/api/lids.controller';
import { ProfileController } from '@waha/api/profile.controller';
import { ServerController } from '@waha/api/server.controller';
import { ServerDebugController } from '@waha/api/server.debug.controller';
import { WebsocketGatewayCore } from '@waha/api/websocket.gateway.core';
import { AppsModuleExports } from '@waha/apps/apps.module';
import { ApiKeyStrategy } from '@waha/core/auth/apiKey.strategy';
import { IApiKeyAuth } from '@waha/core/auth/auth';
import { AuthMiddleware } from '@waha/core/auth/auth.middleware';
import { BasicAuthFunction } from '@waha/core/auth/basicAuth';
import { WebSocketAuth } from '@waha/core/auth/WebSocketAuth';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
import { MediaLocalStorageModule } from '@waha/core/media/local/media.local.storage.module';
import { MediaLocalStorageConfig } from '@waha/core/media/local/MediaLocalStorageConfig';
import { ChannelsInfoServiceCore } from '@waha/core/services/ChannelsInfoServiceCore';
import { parseBool } from '@waha/helpers';
import { BufferJsonReplacerInterceptor } from '@waha/nestjs/BufferJsonReplacerInterceptor';
import { HttpsExpress } from '@waha/nestjs/HttpsExpress';
import {
  getPinoHttpUseLevel,
  getPinoLogLevel,
  getPinoTransport,
} from '@waha/utils/logging';
import * as Joi from 'joi';
import { LoggerModule } from 'nestjs-pino';
import { Logger as NestJSPinoLogger } from 'nestjs-pino';
import { join } from 'path';
import { Logger } from 'pino';

import { AuthController } from '../api/auth.controller';
import { ChatsController } from '../api/chats.controller';
import { ChattingController } from '../api/chatting.controller';
import { ContactsController } from '../api/contacts.controller';
import { EventsController } from '../api/events.controller';
import { GroupsController } from '../api/groups.controller';
import { HealthController } from '../api/health.controller';
import { LabelsController } from '../api/labels.controller';
import { MediaController } from '../api/media.controller';
import { PingController } from '../api/ping.controller';
import { PresenceController } from '../api/presence.controller';
import { ScreenshotController } from '../api/screenshot.controller';
import { SessionsController } from '../api/sessions.controller';
import { StatusController } from '../api/status.controller';
import { UserAuthController } from '../api/user-auth.controller';
import { UsersController } from '../api/users.controller';
import { VersionController } from '../api/version.controller';
import { WhatsappConfigService } from '../config.service';
import { SessionManager } from './abc/manager.abc';
import { WAHAHealthCheckService } from './abc/WAHAHealthCheckService';
import { ApiKeyAuthFactory } from './auth/ApiKeyAuthFactory';
import { JwtStrategy } from './auth/jwt.strategy';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard, PermissionsGuard, OwnerGuard } from './auth/roles.guard';
import { AuthConfigService } from './config/AuthConfigService';
import { DashboardConfigServiceCore } from './config/DashboardConfigServiceCore';
import { EngineConfigService } from './config/EngineConfigService';
import { SwaggerConfigServiceCore } from './config/SwaggerConfigServiceCore';
import { UserService } from './services/UserService';
import { AuthService } from './services/AuthService';
import { AuditService } from './services/AuditService';
import { RateLimitingService } from './services/RateLimitingService';
import { AuthMigrationService } from './services/AuthMigrationService';
import { DatabaseMigrationService } from './services/DatabaseMigrationService';
import { AdminBootstrapService } from './services/AdminBootstrapService';
import { IUserRepository, IUserSessionRepository, IApiKeyRepository, IAuditLogRepository } from './storage/IUserRepository';
import { Sqlite3UserRepository, Sqlite3UserSessionRepository, Sqlite3ApiKeyRepository, Sqlite3AuditLogRepository } from './storage/sqlite3/Sqlite3UserRepository';
import { Sqlite3KVRepository } from './storage/sqlite3/Sqlite3KVRepository';
import { LocalStore } from './storage/LocalStore';
import { LocalStoreCore } from './storage/LocalStoreCore';
import { WAHAHealthCheckServiceCore } from './health/WAHAHealthCheckServiceCore';
import { SessionManagerCore } from './manager.core';

export const IMPORTS_CORE = [
  ...AppsModuleExports.imports,
  LoggerModule.forRoot({
    renameContext: 'name',
    pinoHttp: {
      quietReqLogger: true,
      level: getPinoLogLevel(),
      useLevel: getPinoHttpUseLevel(),
      transport: getPinoTransport(),
      autoLogging: {
        ignore: (req) => {
          return (
            req.url.startsWith('/ping') ||
            req.url.startsWith('/dashboard/') ||
            req.url.startsWith('/api/files/') ||
            req.url.startsWith('/api/s3/') ||
            req.url.startsWith('/jobs/')
          );
        },
      },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          query: req.query,
          params: req.params,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    },
  }),
  ConfigModule.forRoot({
    isGlobal: true,
    validationSchema: Joi.object({
      WHATSAPP_API_SCHEMA: Joi.string().valid('http', 'https').default('http'),
    }),
  }),
  ServeStaticModule.forRootAsync({
    imports: [],
    extraProviders: [DashboardConfigServiceCore],
    inject: [DashboardConfigServiceCore],
    useFactory: (dashboardConfig: DashboardConfigServiceCore) => {
      if (!dashboardConfig.enabled) {
        return [];
      }
      return [
        {
          rootPath: join(__dirname, '..', 'dashboard'),
          serveRoot: dashboardConfig.dashboardUri,
        },
        // Serve auth dashboard assets with higher priority
        {
          rootPath: join(__dirname, '..', 'dashboard', 'auth', 'assets'),
          serveRoot: '/dashboard/auth/assets',
          serveStaticOptions: {
            index: false,
            fallthrough: false, // Don't fallthrough for assets - serve or 404
            setHeaders: (res, path) => {
              // Cache static assets aggressively
              res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
              res.setHeader('Access-Control-Allow-Origin', '*');
            },
          },
        },
        // Serve other auth dashboard files (like favicon)
        {
          rootPath: join(__dirname, '..', 'dashboard', 'auth'),
          serveRoot: '/dashboard/auth',
          serveStaticOptions: {
            index: false,
            fallthrough: true, // Let controller handle HTML routes
            setHeaders: (res, path) => {
              // Only cache non-HTML files
              if (!path.endsWith('.html')) {
                res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
              }
            },
          },
        },
      ];
    },
  }),
  PassportModule.register({ defaultStrategy: 'jwt' }),
  JwtModule.registerAsync({
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService) => ({
      secret: configService.get<string>('WAHA_JWT_SECRET', 'default-secret-change-in-production'),
      signOptions: {
        expiresIn: configService.get<string>('WAHA_JWT_EXPIRES_IN', '24h'),
      },
    }),
    inject: [ConfigService],
  }),
  TerminusModule,
];

const IMPORTS_MEDIA = [
  ConfigModule.forRoot({
    validationSchema: Joi.object({
      WAHA_MEDIA_STORAGE: Joi.string()
        .valid('LOCAL', 'S3', 'POSTGRESQL')
        .default('LOCAL'),
    }),
  }),
  MediaLocalStorageModule,
];

const IMPORTS = [...IMPORTS_CORE, ...IMPORTS_MEDIA];

export const CONTROLLERS = [
  AuthController,
  SessionsController,
  ProfileController,
  ChattingController,
  ChatsController,
  ChannelsController,
  StatusController,
  LabelsController,
  ContactsController,
  LidsController,
  GroupsController,
  PresenceController,
  ScreenshotController,
  EventsController,
  PingController,
  HealthController,
  ServerController,
  ServerDebugController,
  UserAuthController,
  UsersController,
  VersionController,
  MediaController,
  ...AppsModuleExports.controllers,
  DashboardAuthController,
];
export const PROVIDERS_BASE: Provider[] = [
  {
    provide: APP_INTERCEPTOR,
    useClass: BufferJsonReplacerInterceptor,
  },
  DashboardConfigServiceCore,
  SwaggerConfigServiceCore,
  WebJSEngineConfigService,
  GowsEngineConfigService,
  WhatsappConfigService,
  EngineConfigService,
  WebsocketGatewayCore,
  MediaLocalStorageConfig,
  WebSocketAuth,
  ApiKeyStrategy,
  {
    provide: IApiKeyAuth,
    useFactory: ApiKeyAuthFactory,
    inject: [WhatsappConfigService, NestJSPinoLogger],
  },
  ...AppsModuleExports.providers,
  // Authentication services
  AuthConfigService,
  UserService,
  AuthService,
  AuditService,
  RateLimitingService,
  AuthMigrationService,
  DatabaseMigrationService,
  AdminBootstrapService,
  // Authentication strategies and guards
  JwtStrategy,
  JwtAuthGuard,
  RolesGuard,
  PermissionsGuard,
  OwnerGuard,
  // Repository implementations
  {
    provide: IUserRepository,
    useClass: Sqlite3UserRepository,
  },
  {
    provide: IUserSessionRepository,
    useClass: Sqlite3UserSessionRepository,
  },
  {
    provide: IApiKeyRepository,
    useClass: Sqlite3ApiKeyRepository,
  },
  {
    provide: IAuditLogRepository,
    useClass: Sqlite3AuditLogRepository,
  },
  Sqlite3KVRepository,
  {
    provide: LocalStore,
    useFactory: () => {
      const store = new LocalStoreCore('core');
      return store;
    },
  },
];

const PROVIDERS = [
  {
    provide: SessionManager,
    useClass: SessionManagerCore,
  },
  {
    provide: WAHAHealthCheckService,
    useClass: WAHAHealthCheckServiceCore,
  },
  ChannelsInfoServiceCore,
  ...PROVIDERS_BASE,
];

@Module({
  imports: IMPORTS,
  controllers: CONTROLLERS,
  providers: PROVIDERS,
})
export class AppModuleCore {
  public startTimestamp: number;

  constructor(
    protected config: WhatsappConfigService,
    private dashboardConfig: DashboardConfigServiceCore,
  ) {
    this.startTimestamp = Date.now();
  }

  static getHttpsOptions(logger: Logger) {
    const httpsEnabled = parseBool(process.env.WAHA_HTTPS_ENABLED);
    if (!httpsEnabled) {
      return undefined;
    }
    const httpsExpress = new HttpsExpress(logger);
    return httpsExpress.readSync();
  }

  static async appReady(app: INestApplication, logger: Logger) {
    // Initialize authentication system
    await AppModuleCore.initializeAuthentication(app, logger);

    const httpsEnabled = parseBool(process.env.WAHA_HTTPS_ENABLED);
    if (!httpsEnabled) {
      return;
    }
    const httpd = app.getHttpServer();
    const httpsExpress = new HttpsExpress(logger);
    httpsExpress.watchCertChanges(httpd);
  }

  static async initializeAuthentication(app: INestApplication, logger: Logger) {
    try {
      const authEnabled = parseBool(process.env.WAHA_AUTH_ENABLED);
      if (!authEnabled) {
        logger.info('Enhanced authentication system is disabled (WAHA_AUTH_ENABLED=false)');
        return;
      }

      logger.info('Enhanced authentication system is enabled but not yet fully integrated');
      logger.info('Enhanced authentication system partially initialized');

      // Schedule the full initialization to run after the application has started
      setTimeout(async () => {
        try {
          logger.info('Starting delayed authentication system initialization...');

          // Step 1: Run database migrations
          const migrationService = app.get(DatabaseMigrationService);
          const migrationResult = await migrationService.runMigrations();

          if (migrationResult.success) {
            logger.info({
              tablesCreated: migrationResult.tablesCreated,
              version: migrationResult.version
            }, 'Database migrations completed successfully');
          } else {
            logger.error({
              errors: migrationResult.errors,
              tablesCreated: migrationResult.tablesCreated
            }, 'Some database migrations failed');
          }

          // Step 2: Validate database schema
          const schemaValidation = await migrationService.validateSchema();
          if (!schemaValidation.valid) {
            logger.warn({
              missingTables: schemaValidation.missingTables,
              issues: schemaValidation.issues
            }, 'Database schema validation failed');
          }

          // Step 3: Bootstrap admin user
          const adminBootstrap = app.get(AdminBootstrapService);
          const adminResult = await adminBootstrap.bootstrapAdmin();

          if (adminResult.success) {
            if (adminResult.adminCreated) {
              logger.info({ username: adminResult.username }, 'Default admin user created');
            } else if (adminResult.adminExists) {
              logger.info('Admin user already exists, skipping creation');
            }
          } else {
            logger.error({ error: adminResult.error }, 'Admin bootstrap failed');
          }

          // Step 4: Validate admin setup
          const adminValidation = await adminBootstrap.validateAdminSetup();
          if (!adminValidation.valid) {
            logger.warn({ issues: adminValidation.issues }, 'Admin setup validation failed');
          }

          // Step 5: Check if legacy migration is needed
          const autoMigrate = parseBool(process.env.WAHA_AUTO_MIGRATE);
          if (autoMigrate) {
            try {
              const authMigration = app.get(AuthMigrationService);
              const migrationCheck = await authMigration.validateMigrationPrerequisites();

              if (migrationCheck.valid) {
                logger.info('Starting automatic migration from legacy authentication');
                const legacyMigrationResult = await authMigration.migrateFromLegacyAuth();
                if (legacyMigrationResult.success) {
                  logger.info(legacyMigrationResult, 'Legacy migration completed successfully');
                } else {
                  logger.error(legacyMigrationResult, 'Legacy migration completed with errors');
                }
              } else {
                logger.warn({ issues: migrationCheck.issues }, 'Legacy migration prerequisites not met');
              }
            } catch (error) {
              logger.error({ error: error.message }, 'Legacy migration failed');
            }
          }

          logger.info('Enhanced authentication system fully initialized');
        } catch (error) {
          logger.error({ error: error.message }, 'Failed to complete authentication system initialization');
        }
      }, 2000); // Wait 2 seconds for the application to fully start

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to initialize authentication system');
    }
  }

  configure(consumer: MiddlewareConsumer) {
    const exclude = this.config.getExcludedPaths();
    consumer
      .apply(AuthMiddleware)
      .exclude(...exclude)
      .forRoutes('api', 'health', 'ws');
    const dashboardCredentials = this.dashboardConfig.credentials;
    if (dashboardCredentials) {
      const username = dashboardCredentials[0];
      const password = dashboardCredentials[1];
      const route = noSlashAtTheEnd(this.dashboardConfig.dashboardUri);
      // Apply basic auth to main dashboard but exclude auth UI
      consumer
        .apply(BasicAuthFunction(username, password))
        .exclude('/dashboard/auth(.*)')
        .forRoutes(route);
    }
  }
}
