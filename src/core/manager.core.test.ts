import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SessionManagerCore } from './manager.core';
import { WhatsappConfigService } from '../config.service';
import { EngineConfigService } from './config/EngineConfigService';
import { WebJSEngineConfigService } from './config/WebJSEngineConfigService';
import { GowsEngineConfigService } from './config/GowsEngineConfigService';
import { MediaStorageFactory } from './media/MediaStorageFactory';
import { WAHAEngine, WAHAEvents, WAHASessionStatus } from '../structures/enums.dto';
import { SessionConfig } from '../structures/sessions.dto';

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      level: 'info',
    }),
  },
};

const mockConfig = {
  startSessions: [],
  shouldRestartAllSessions: false,
  mimetypes: [],
  getWebhookConfig: jest.fn().mockReturnValue(null),
};

const mockEngineConfigService = {
  getDefaultEngineName: jest.fn().mockReturnValue(WAHAEngine.WEBJS),
  shouldPrintQR: false,
};

const mockWebJSEngineConfigService = {
  getConfig: jest.fn().mockReturnValue({}),
};

const mockGowsConfigService = {
  getConfig: jest.fn().mockReturnValue({}),
};

const mockMediaStorageFactory = {
  build: jest.fn().mockResolvedValue({
    init: jest.fn(),
    close: jest.fn(),
  }),
};

// Mock WhatsApp session
const mockWhatsappSession = {
  name: 'test-session',
  status: WAHASessionStatus.WORKING,
  engine: WAHAEngine.WEBJS,
  sessionConfig: {},
  start: jest.fn(),
  stop: jest.fn(),
  unpair: jest.fn(),
  getSessionMeInfo: jest.fn().mockReturnValue({ id: 'test@c.us', pushName: 'Test' }),
  getEngineInfo: jest.fn().mockResolvedValue({ version: '1.0.0' }),
  getEventObservable: jest.fn().mockReturnValue({
    pipe: jest.fn().mockReturnValue({
      subscribe: jest.fn(),
    }),
  }),
};

// Mock session class constructor
const MockWhatsappSessionClass = jest.fn().mockImplementation(() => mockWhatsappSession);

describe('SessionManagerCore - Multiple Sessions', () => {
  let sessionManager: SessionManagerCore;
  let module: TestingModule;

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Set environment variables for testing
    process.env.WAHA_MAX_SESSIONS = '5';
    process.env.WAHA_SESSION_MEMORY_LIMIT_MB = '100';

    module = await Test.createTestingModule({
      providers: [
        SessionManagerCore,
        { provide: PinoLogger, useValue: mockLogger },
        { provide: WhatsappConfigService, useValue: mockConfig },
        { provide: EngineConfigService, useValue: mockEngineConfigService },
        { provide: WebJSEngineConfigService, useValue: mockWebJSEngineConfigService },
        { provide: GowsEngineConfigService, useValue: mockGowsConfigService },
        { provide: MediaStorageFactory, useValue: mockMediaStorageFactory },
      ],
    }).compile();

    sessionManager = module.get<SessionManagerCore>(SessionManagerCore);
    
    // Mock the EngineClass property
    Object.defineProperty(sessionManager, 'EngineClass', {
      get: () => MockWhatsappSessionClass,
    });

    // Initialize the manager
    await sessionManager.init();
  });

  afterEach(async () => {
    await module.close();
    // Clean up environment variables
    delete process.env.WAHA_MAX_SESSIONS;
    delete process.env.WAHA_SESSION_MEMORY_LIMIT_MB;
  });

  describe('Session Creation and Management', () => {
    it('should create multiple sessions successfully', async () => {
      const sessionNames = ['session1', 'session2', 'session3'];
      
      for (const sessionName of sessionNames) {
        await sessionManager.upsert(sessionName, { debug: false });
        const sessionDto = await sessionManager.start(sessionName);

        expect(sessionDto.name).toBe(sessionName);
        expect(sessionDto.status).toBe(WAHASessionStatus.WORKING);
        expect(sessionManager.isRunning(sessionName)).toBe(true);
      }
      
      // Verify all sessions are running
      const sessions = await sessionManager.getSessions(false);
      expect(sessions).toHaveLength(3);
      expect(sessions.map(s => s.name)).toEqual(expect.arrayContaining(sessionNames));
    });

    it('should enforce session limits', async () => {
      // Create sessions up to the limit
      for (let i = 1; i <= 5; i++) {
        await sessionManager.upsert(`session${i}`, { debug: false });
        await sessionManager.start(`session${i}`);
      }

      // Try to create one more session beyond the limit
      await sessionManager.upsert('session6', { debug: false });
      await expect(sessionManager.start('session6')).rejects.toThrow(UnprocessableEntityException);
      await expect(sessionManager.start('session6')).rejects.toThrow('Maximum number of concurrent sessions');
    });

    it('should prevent starting the same session twice', async () => {
      await sessionManager.upsert('duplicate-session', { debug: false });
      await sessionManager.start('duplicate-session');

      await expect(sessionManager.start('duplicate-session')).rejects.toThrow(UnprocessableEntityException);
      await expect(sessionManager.start('duplicate-session')).rejects.toThrow('already started');
    });
  });

  describe('Session State Management', () => {
    it('should track session states correctly', async () => {
      const sessionName = 'state-test-session';
      
      // Initially should not exist
      expect(await sessionManager.exists(sessionName)).toBe(false);
      expect(sessionManager.isRunning(sessionName)).toBe(false);
      
      // After upsert, should exist but not running
      await sessionManager.upsert(sessionName, { debug: false });
      expect(await sessionManager.exists(sessionName)).toBe(true);
      expect(sessionManager.isRunning(sessionName)).toBe(false);

      // After start, should be running
      await sessionManager.start(sessionName);
      expect(await sessionManager.exists(sessionName)).toBe(true);
      expect(sessionManager.isRunning(sessionName)).toBe(true);

      // After stop, should exist but not running
      await sessionManager.stop(sessionName, false);
      expect(await sessionManager.exists(sessionName)).toBe(true);
      expect(sessionManager.isRunning(sessionName)).toBe(false);
    });

    it('should handle session deletion properly', async () => {
      const sessionName = 'delete-test-session';
      
      await sessionManager.upsert(sessionName, { debug: false });
      await sessionManager.start(sessionName);
      expect(sessionManager.isRunning(sessionName)).toBe(true);

      await sessionManager.delete(sessionName);
      expect(sessionManager.isRunning(sessionName)).toBe(false);
      // Session should still exist in stopped state after deletion
      expect(await sessionManager.exists(sessionName)).toBe(false);
    });
  });

  describe('Session Configuration', () => {
    it('should persist and load session configurations', async () => {
      const sessionName = 'config-test-session';
      const config: SessionConfig = {
        debug: true,
        metadata: new Map([['key1', 'value1']]),
        webhooks: [],
      };
      
      await sessionManager.upsert(sessionName, config);
      
      // Verify configuration is stored
      const sessionInfo = await sessionManager.getSessionInfo(sessionName);
      expect(sessionInfo?.config?.debug).toBe(true);
    });

    it('should handle sessions with different configurations', async () => {
      const sessions = [
        { name: 'session-debug', config: { debug: true } },
        { name: 'session-normal', config: { debug: false } },
        { name: 'session-metadata', config: { debug: false, metadata: new Map([['env', 'test']]) } },
      ];
      
      for (const { name, config } of sessions) {
        await sessionManager.upsert(name, config);
        await sessionManager.start(name);
      }
      
      const allSessions = await sessionManager.getSessions(false);
      expect(allSessions).toHaveLength(3);
      
      // Verify each session has its own configuration
      for (const { name, config } of sessions) {
        const sessionInfo = await sessionManager.getSessionInfo(name);
        expect(sessionInfo?.config?.debug).toBe(config.debug);
      }
    });
  });

  describe('Resource Management', () => {
    it('should provide session health information', async () => {
      await sessionManager.upsert('health-session', { debug: false });
      await sessionManager.start('health-session');
      
      const healthInfo = sessionManager.getSessionHealthInfo();
      
      expect(healthInfo.totalSessions).toBe(1);
      expect(healthInfo.runningSessions).toBe(1);
      expect(healthInfo.maxConcurrentSessions).toBe(5);
      expect(healthInfo.sessions).toHaveLength(1);
      expect(healthInfo.sessions[0].name).toBe('health-session');
      expect(healthInfo.sessions[0].status).toBe(WAHASessionStatus.WORKING);
    });

    it('should track session activity', async () => {
      const sessionName = 'activity-session';
      await sessionManager.upsert(sessionName, { debug: false });
      await sessionManager.start(sessionName);
      
      // Update activity
      sessionManager.updateSessionActivity(sessionName);
      
      const healthInfo = sessionManager.getSessionHealthInfo();
      const sessionHealth = healthInfo.sessions.find(s => s.name === sessionName);
      
      expect(sessionHealth).toBeDefined();
      expect(sessionHealth.lastActivity).toBeLessThan(5); // Should be very recent
    });
  });

  describe('Event System', () => {
    it('should handle session-specific events', async () => {
      const sessionName = 'event-session';
      await sessionManager.upsert(sessionName, { debug: false });
      await sessionManager.start(sessionName);
      
      const eventObservable = sessionManager.getSessionEvent(sessionName, WAHAEvents.MESSAGE);
      expect(eventObservable).toBeDefined();
    });

    it('should handle wildcard session events', async () => {
      await sessionManager.upsert('session1', { debug: false });
      await sessionManager.start('session1');
      await sessionManager.upsert('session2', { debug: false });
      await sessionManager.start('session2');
      
      const wildcardObservable = sessionManager.getSessionEvent('*', WAHAEvents.MESSAGE);
      expect(wildcardObservable).toBeDefined();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent session operations safely', async () => {
      const sessionPromises = [];
      
      // Start multiple sessions concurrently
      for (let i = 1; i <= 3; i++) {
        const sessionName = `concurrent-session-${i}`;
        sessionPromises.push(
          sessionManager.upsert(sessionName, { debug: false }).then(() =>
            sessionManager.start(sessionName)
          )
        );
      }
      
      const results = await Promise.all(sessionPromises);
      expect(results).toHaveLength(3);
      
      // Verify all sessions are running
      const sessions = await sessionManager.getSessions(false);
      expect(sessions).toHaveLength(3);
    });
  });
});
