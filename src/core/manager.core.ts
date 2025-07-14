import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AppsService,
  IAppsService,
} from '@waha/apps/app_sdk/services/IAppsService';
import { EngineBootstrap } from '@waha/core/abc/EngineBootstrap';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
import { WhatsappSessionGoWSCore } from '@waha/core/engines/gows/session.gows.core';
import { WebhookConductor } from '@waha/core/integrations/webhooks/WebhookConductor';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { getPinoLogLevel, LoggerBuilder } from '@waha/utils/logging';
import { promiseTimeout, sleep } from '@waha/utils/promiseTimeout';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import { PinoLogger } from 'nestjs-pino';
import { merge, Observable, retry, share } from 'rxjs';
import { map } from 'rxjs/operators';

import { WhatsappConfigService } from '../config.service';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
} from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDetailedInfo,
  SessionDTO,
  SessionInfo,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.config.dto';
import { populateSessionInfo, SessionManager } from './abc/manager.abc';
import { SessionParams, WhatsappSession } from './abc/session.abc';
import { EngineConfigService } from './config/EngineConfigService';
import { WhatsappSessionNoWebCore } from './engines/noweb/session.noweb.core';
import { WhatsappSessionWebJSCore } from './engines/webjs/session.webjs.core';
import { DOCS_URL } from './exceptions';
import { getProxyConfig } from './helpers.proxy';
import { MediaManager } from './media/MediaManager';
import { LocalSessionAuthRepository } from './storage/LocalSessionAuthRepository';
import { LocalSessionConfigRepository } from './storage/LocalSessionConfigRepository';
import { LocalStoreCore } from './storage/LocalStoreCore';

enum SessionStatus {
  REMOVED = 'REMOVED',
  STOPPED = 'STOPPED',
}

interface SessionResources {
  mediaManager?: any;
  webhook?: any;
  storage?: any;
  startTime: number;
  lastActivity: number;
}

@Injectable()
export class SessionManagerCore extends SessionManager implements OnModuleInit {
  SESSION_STOP_TIMEOUT = 3000;

  // sessions - collection of all sessions (running, stopped, or failed)
  private sessions: Map<string, WhatsappSession> = new Map();
  // sessionStates - track states of stopped/removed sessions
  private sessionStates: Map<string, SessionStatus> = new Map();
  // sessionConfigs - per-session configurations
  private sessionConfigs: Map<string, SessionConfig> = new Map();
  // sessionResources - track resources per session for cleanup
  private sessionResources: Map<string, SessionResources> = new Map();
  DEFAULT = 'default';

  // Resource limits
  private readonly MAX_CONCURRENT_SESSIONS = parseInt(process.env.WAHA_MAX_SESSIONS || '10');
  private readonly SESSION_MEMORY_LIMIT_MB = parseInt(process.env.WAHA_SESSION_MEMORY_LIMIT_MB || '500');
  private readonly SESSION_CLEANUP_INTERVAL_MS = parseInt(process.env.WAHA_SESSION_CLEANUP_INTERVAL_MS || '300000'); // 5 minutes
  private readonly SESSION_INACTIVE_TIMEOUT_MS = parseInt(process.env.WAHA_SESSION_INACTIVE_TIMEOUT_MS || '3600000'); // 1 hour

  private cleanupTimer?: NodeJS.Timeout;

  protected readonly EngineClass: typeof WhatsappSession;
  protected events2: DefaultMap<WAHAEvents, SwitchObservable<any>>;
  protected sessionEvents: Map<string, SwitchObservable<any>> = new Map();
  protected readonly engineBootstrap: EngineBootstrap;
  public sessionConfigRepository: LocalSessionConfigRepository;

  constructor(
    config: WhatsappConfigService,
    private engineConfigService: EngineConfigService,
    private webjsEngineConfigService: WebJSEngineConfigService,
    gowsConfigService: GowsEngineConfigService,
    log: PinoLogger,
    private mediaStorageFactory: MediaStorageFactory,
    @Inject(AppsService)
    appsService: IAppsService,
  ) {
    super(log, config, gowsConfigService, appsService);
    const engineName = this.engineConfigService.getDefaultEngineName();
    this.EngineClass = this.getEngine(engineName);
    this.engineBootstrap = this.getEngineBootstrap(engineName);

    this.events2 = new DefaultMap<WAHAEvents, SwitchObservable<any>>(
      (key) =>
        new SwitchObservable((obs$) => {
          return obs$.pipe(retry(), share());
        }),
    );

    this.store = new LocalStoreCore(engineName.toLowerCase());
    this.sessionAuthRepository = new LocalSessionAuthRepository(this.store);
    this.sessionConfigRepository = new LocalSessionConfigRepository(this.store);
    this.clearStorage().catch((error) => {
      this.log.error({ error }, 'Error while clearing storage');
    });
  }

  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (engine === WAHAEngine.WEBJS) {
      return WhatsappSessionWebJSCore;
    } else if (engine === WAHAEngine.NOWEB) {
      return WhatsappSessionNoWebCore;
    } else if (engine === WAHAEngine.GOWS) {
      return WhatsappSessionGoWSCore;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }
  }

  // Remove the session name restriction - now supports any session name

  async beforeApplicationShutdown(signal?: string) {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Stop all running sessions
    const runningSessionNames = Array.from(this.sessions.keys());
    this.log.info(`Shutting down ${runningSessionNames.length} running sessions...`);

    for (const sessionName of runningSessionNames) {
      try {
        await this.stop(sessionName, true);
      } catch (error) {
        this.log.warn({ session: sessionName, error }, 'Error stopping session during shutdown');
      }
    }

    this.stopEvents();
    await this.engineBootstrap.shutdown();
    this.log.info('All sessions stopped and resources cleaned up');
  }

  async onApplicationBootstrap() {
    await this.engineBootstrap.bootstrap();
    this.startPredefinedSessions();

    // Auto-restart sessions if configured
    if (this.config.shouldRestartAllSessions) {
      this.restartAllSessions();
    }
  }

  private async clearStorage() {
    const storage = await this.mediaStorageFactory.build(
      'all',
      this.log.logger.child({ name: 'Storage' }),
    );
    await storage.purge();
  }

  //
  // API Methods
  //
  async exists(name: string): Promise<boolean> {
    return this.sessions.has(name) || this.sessionStates.get(name) === SessionStatus.STOPPED;
  }

  isRunning(name: string): boolean {
    return this.sessions.has(name);
  }

  async upsert(name: string, config?: SessionConfig): Promise<void> {
    const sessionConfig: SessionConfig = {
      debug: false,
      ...config,
    };
    this.sessionConfigs.set(name, sessionConfig);

    // Persist the configuration
    await this.sessionConfigRepository.saveConfig(name, sessionConfig);

    // If session was marked as removed, change it to stopped
    if (this.sessionStates.get(name) === SessionStatus.REMOVED) {
      this.sessionStates.set(name, SessionStatus.STOPPED);
    }
  }

  async start(name: string): Promise<SessionDTO> {
    if (this.sessions.has(name)) {
      throw new UnprocessableEntityException(
        `Session '${name}' is already started.`,
      );
    }

    // Check session limits
    if (this.sessions.size >= this.MAX_CONCURRENT_SESSIONS) {
      throw new UnprocessableEntityException(
        `Maximum number of concurrent sessions (${this.MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Stop some sessions or increase WAHA_MAX_SESSIONS limit.`,
      );
    }

    // Ensure session config exists (create default if not)
    if (!this.sessionConfigs.has(name)) {
      await this.upsert(name, { debug: false });
    }

    this.log.info({ session: name }, `Starting session...`);
    const logger = this.log.logger.child({ session: name });
    const sessionConfig = this.sessionConfigs.get(name);
    logger.level = getPinoLogLevel(sessionConfig?.debug);
    const loggerBuilder: LoggerBuilder = logger;

    const storage = await this.mediaStorageFactory.build(
      name,
      loggerBuilder.child({ name: 'Storage' }),
    );
    await storage.init();
    const mediaManager = new MediaManager(
      storage,
      this.config.mimetypes,
      loggerBuilder.child({ name: 'MediaManager' }),
    );

    const webhook = new WebhookConductor(loggerBuilder);
    const proxyConfig = this.getProxyConfig(name);
    const sessionParams: SessionParams = {
      name,
      mediaManager,
      loggerBuilder,
      printQR: this.engineConfigService.shouldPrintQR,
      sessionStore: this.store,
      proxyConfig: proxyConfig,
      sessionConfig: sessionConfig,
    };
    if (this.EngineClass === WhatsappSessionWebJSCore) {
      sessionParams.engineConfig = this.webjsEngineConfigService.getConfig();
    } else if (this.EngineClass === WhatsappSessionGoWSCore) {
      sessionParams.engineConfig = this.gowsConfigService.getConfig();
    }
    await this.sessionAuthRepository.init(name);
    // @ts-ignore
    const session = new this.EngineClass(sessionParams);
    this.sessions.set(name, session);

    // Track session resources
    this.sessionResources.set(name, {
      mediaManager,
      webhook,
      storage,
      startTime: Date.now(),
      lastActivity: Date.now(),
    });

    // Remove from stopped/removed states if it was there
    this.sessionStates.delete(name);
    this.updateSession(name);

    // configure webhooks
    const webhooks = this.getWebhooks(name);
    webhook.configure(session, webhooks);

    // Apps
    await this.configureApps(session);

    // start session
    await session.start();
    logger.info('Session has been started.');
    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  private updateSession(sessionName: string) {
    const session = this.sessions.get(sessionName);
    if (!session) {
      return;
    }
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const stream$ = session
        .getEventObservable(event)
        .pipe(map(populateSessionInfo(event, session)));
      // Create session-specific event key to avoid conflicts
      const sessionEventKey = `${sessionName}:${event}`;
      if (!this.sessionEvents.has(sessionEventKey)) {
        this.sessionEvents.set(sessionEventKey, new SwitchObservable((obs$) => {
          return obs$.pipe(retry(), share());
        }));
      }
      this.sessionEvents.get(sessionEventKey).switch(stream$);
    }
  }

  getSessionEvent(sessionName: string, event: WAHAEvents): Observable<any> {
    // Handle wildcard session - return events from all sessions
    if (sessionName === '*') {
      const allSessionObservables = [];
      for (const [name] of this.sessions) {
        const sessionEventKey = `${name}:${event}`;
        if (this.sessionEvents.has(sessionEventKey)) {
          allSessionObservables.push(this.sessionEvents.get(sessionEventKey));
        }
      }
      if (allSessionObservables.length === 0) {
        return new Observable(subscriber => {
          // Return empty observable that never emits
        });
      }
      return merge(...allSessionObservables);
    }

    // Handle specific session
    const sessionEventKey = `${sessionName}:${event}`;
    if (!this.sessionEvents.has(sessionEventKey)) {
      return new Observable(subscriber => {
        // Return empty observable that never emits
      });
    }
    return this.sessionEvents.get(sessionEventKey);
  }

  private cleanupSessionEvents(sessionName: string) {
    // Remove all event observables for this session
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const sessionEventKey = `${sessionName}:${event}`;
      if (this.sessionEvents.has(sessionEventKey)) {
        const observable = this.sessionEvents.get(sessionEventKey);
        observable.complete();
        this.sessionEvents.delete(sessionEventKey);
      }
    }
  }

  private async cleanupSessionResources(sessionName: string) {
    const resources = this.sessionResources.get(sessionName);
    if (!resources) {
      return;
    }

    try {
      // Close media manager
      if (resources.mediaManager && typeof resources.mediaManager.close === 'function') {
        await resources.mediaManager.close();
      }

      // Close storage
      if (resources.storage && typeof resources.storage.close === 'function') {
        await resources.storage.close();
      }

      // Clean up webhook resources
      if (resources.webhook && typeof resources.webhook.cleanup === 'function') {
        await resources.webhook.cleanup();
      }

      this.log.debug({ session: sessionName }, 'Session resources cleaned up');
    } catch (error) {
      this.log.warn({ session: sessionName, error }, 'Error cleaning up session resources');
    } finally {
      this.sessionResources.delete(sessionName);
    }
  }

  async stop(name: string, silent: boolean): Promise<void> {
    if (!this.isRunning(name)) {
      this.log.debug({ session: name }, `Session is not running.`);
      return;
    }

    this.log.info({ session: name }, `Stopping session...`);
    try {
      const session = this.getSession(name);
      await session.stop();
    } catch (err) {
      this.log.warn(`Error while stopping session '${name}'`);
      if (!silent) {
        throw err;
      }
    }
    this.log.info({ session: name }, `Session has been stopped.`);

    // Clean up session resources
    await this.cleanupSessionResources(name);

    // Remove from active sessions and mark as stopped
    this.sessions.delete(name);
    this.sessionStates.set(name, SessionStatus.STOPPED);

    // Clean up session-specific events
    this.cleanupSessionEvents(name);

    await sleep(this.SESSION_STOP_TIMEOUT);
  }

  async unpair(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      return;
    }

    this.log.info({ session: name }, 'Unpairing the device from account...');
    await session.unpair().catch((err) => {
      this.log.warn(`Error while unpairing from device: ${err}`);
    });
    await sleep(1000);
  }

  async logout(name: string): Promise<void> {
    await this.sessionAuthRepository.clean(name);
  }

  async delete(name: string): Promise<void> {
    // Stop the session if it's running
    if (this.isRunning(name)) {
      await this.stop(name, true);
    }

    // Clean up persisted configuration
    await this.sessionConfigRepository.deleteConfig(name);

    // Clean up any remaining resources
    await this.cleanupSessionResources(name);

    // Mark as removed and clean up
    this.sessionStates.set(name, SessionStatus.REMOVED);
    this.sessionConfigs.delete(name);
    this.cleanupSessionEvents(name);
  }

  /**
   * Combine per session and global webhooks
   */
  private getWebhooks(sessionName: string) {
    let webhooks: WebhookConfig[] = [];
    const sessionConfig = this.sessionConfigs.get(sessionName);
    if (sessionConfig?.webhooks) {
      webhooks = webhooks.concat(sessionConfig.webhooks);
    }
    const globalWebhookConfig = this.config.getWebhookConfig();
    if (globalWebhookConfig) {
      webhooks.push(globalWebhookConfig);
    }
    return webhooks;
  }

  /**
   * Get either session's or global proxy if defined
   */
  protected getProxyConfig(sessionName: string): ProxyConfig | undefined {
    const sessionConfig = this.sessionConfigs.get(sessionName);
    if (sessionConfig?.proxy) {
      return sessionConfig.proxy;
    }
    const session = this.sessions.get(sessionName);
    if (!session) {
      return undefined;
    }
    const sessions = { [sessionName]: session };
    return getProxyConfig(this.config, sessions, sessionName);
  }

  getSession(name: string): WhatsappSession {
    const session = this.sessions.get(name);
    if (!session) {
      throw new NotFoundException(
        `We didn't find a session with name '${name}'.\n` +
          `Please start it first by using POST /api/sessions/${name}/start request`,
      );
    }
    return session;
  }

  async getSessions(all: boolean): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    // Add running sessions
    for (const [sessionName, session] of this.sessions.entries()) {
      const me = session.getSessionMeInfo();
      sessions.push({
        name: session.name,
        status: session.status,
        config: session.sessionConfig,
        me: me,
      });
    }

    // Add stopped/removed sessions if 'all' is requested
    if (all) {
      for (const [sessionName, state] of this.sessionStates.entries()) {
        // Skip if we already added this session as running
        if (this.sessions.has(sessionName)) {
          continue;
        }

        // Skip removed sessions unless explicitly requested
        if (state === SessionStatus.REMOVED) {
          continue;
        }

        const sessionConfig = this.sessionConfigs.get(sessionName);
        sessions.push({
          name: sessionName,
          status: WAHASessionStatus.STOPPED,
          config: sessionConfig,
          me: null,
        });
      }
    }

    return sessions;
  }

  private async fetchEngineInfo(sessionName: string) {
    const session = this.sessions.get(sessionName);
    // Get engine info
    let engineInfo = {};
    if (session) {
      try {
        engineInfo = await promiseTimeout(1000, session.getEngineInfo());
      } catch (error) {
        this.log.debug(
          { session: session.name, error: `${error}` },
          'Can not get engine info',
        );
      }
    }
    const engine = {
      engine: session?.engine,
      ...engineInfo,
    };
    return engine;
  }

  async getSessionInfo(name: string): Promise<SessionDetailedInfo | null> {
    const sessions = await this.getSessions(true);
    const session = sessions.find(s => s.name === name);
    if (!session) {
      return null;
    }
    const engine = await this.fetchEngineInfo(name);
    return { ...session, engine: engine };
  }

  protected stopEvents() {
    complete(this.events2);
  }

  async onModuleInit() {
    await this.init();
  }

  async init() {
    await this.store.init();
    const knex = this.store.getWAHADatabase();
    await this.appsService.migrate(knex);
    await this.loadExistingSessionConfigs();
    this.logSessionStatistics();
    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.performPeriodicCleanup();
    }, this.SESSION_CLEANUP_INTERVAL_MS);

    this.log.debug(`Started session cleanup timer (interval: ${this.SESSION_CLEANUP_INTERVAL_MS}ms)`);
  }

  private async performPeriodicCleanup() {
    const now = Date.now();
    const inactiveSessions = [];

    // Find inactive sessions
    for (const [sessionName, resources] of this.sessionResources) {
      const inactiveTime = now - resources.lastActivity;
      if (inactiveTime > this.SESSION_INACTIVE_TIMEOUT_MS) {
        inactiveSessions.push(sessionName);
      }
    }

    // Clean up inactive sessions if configured
    if (inactiveSessions.length > 0 && process.env.WAHA_AUTO_CLEANUP_INACTIVE_SESSIONS === 'true') {
      this.log.info(`Cleaning up ${inactiveSessions.length} inactive sessions`);
      for (const sessionName of inactiveSessions) {
        try {
          await this.stop(sessionName, true);
          this.log.info({ session: sessionName }, 'Stopped inactive session');
        } catch (error) {
          this.log.warn({ session: sessionName, error }, 'Failed to stop inactive session');
        }
      }
    }

    // Log session statistics periodically
    this.logSessionStatistics();
  }

  private logSessionStatistics() {
    const totalSessions = this.sessionConfigs.size;
    const runningSessions = this.sessions.size;
    const stoppedSessions = Array.from(this.sessionStates.values()).filter(
      state => state === SessionStatus.STOPPED
    ).length;
    const removedSessions = Array.from(this.sessionStates.values()).filter(
      state => state === SessionStatus.REMOVED
    ).length;

    this.log.info({
      total: totalSessions,
      running: runningSessions,
      stopped: stoppedSessions,
      removed: removedSessions,
      maxConcurrent: this.MAX_CONCURRENT_SESSIONS
    }, 'Session statistics');
  }

  public getSessionHealthInfo(): any {
    const sessions = [];
    const now = Date.now();

    for (const [sessionName, session] of this.sessions) {
      const resources = this.sessionResources.get(sessionName);
      const uptime = resources ? now - resources.startTime : 0;
      const lastActivity = resources ? now - resources.lastActivity : 0;

      sessions.push({
        name: sessionName,
        status: session.status,
        uptime: Math.floor(uptime / 1000), // seconds
        lastActivity: Math.floor(lastActivity / 1000), // seconds
        engine: session.engine,
      });
    }

    return {
      totalSessions: this.sessionConfigs.size,
      runningSessions: this.sessions.size,
      maxConcurrentSessions: this.MAX_CONCURRENT_SESSIONS,
      memoryLimitMB: this.SESSION_MEMORY_LIMIT_MB,
      sessions,
    };
  }

  public updateSessionActivity(sessionName: string) {
    const resources = this.sessionResources.get(sessionName);
    if (resources) {
      resources.lastActivity = Date.now();
    }
  }

  private async loadExistingSessionConfigs() {
    try {
      const sessionNames = await this.sessionConfigRepository.getAllConfigs();
      for (const sessionName of sessionNames) {
        const config = await this.sessionConfigRepository.getConfig(sessionName);
        if (config) {
          this.sessionConfigs.set(sessionName, config);
          // Mark as stopped (not removed) so they can be started
          this.sessionStates.set(sessionName, SessionStatus.STOPPED);
        }
      }
      this.log.info(`Loaded ${sessionNames.length} existing session configurations`);
    } catch (error) {
      this.log.warn({ error }, 'Failed to load existing session configurations');
    }
  }

  private restartAllSessions() {
    const sessionNames = Array.from(this.sessionConfigs.keys());
    this.log.info(`Attempting to restart ${sessionNames.length} sessions...`);

    sessionNames.forEach((sessionName) => {
      // Use withLock to prevent concurrent operations
      this.withLock(sessionName, async () => {
        const log = this.log.logger.child({ session: sessionName });
        try {
          log.info('Restarting session...');
          await this.start(sessionName);
          log.info('Session restarted successfully');
        } catch (error) {
          log.error(`Failed to restart session: ${error}`);
          log.error(error.stack);
        }
      });
    });
  }
}
