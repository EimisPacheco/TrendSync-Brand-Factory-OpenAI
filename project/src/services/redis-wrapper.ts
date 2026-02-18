/**
 * Redis Wrapper that conditionally loads ioredis
 * Prevents browser errors while maintaining Redis functionality for server/build
 */

// Type definitions to maintain TypeScript compatibility
export interface RedisClientType {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<string>;
  setex: (key: string, seconds: number, value: string) => Promise<string>;
  del: (...keys: string[]) => Promise<number>;
  exists: (key: string) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  ping: () => Promise<string>;
  quit: () => Promise<string>;
  info: (section?: string) => Promise<string>;
  dbsize: () => Promise<number>;
  zremrangebyscore: (key: string, min: number | string, max: number | string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  zadd: (key: string, ...args: Array<string | number>) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  on: (event: string, callback: (...args: any[]) => void) => void;
}

let redisClient: RedisClientType | null = null;

/**
 * Create a mock Redis client for browser environments
 */
function createMockRedisClient(): RedisClientType {
  const storage = new Map<string, { value: string; expiresAt?: number }>();

  return {
    async get(key: string): Promise<string | null> {
      const item = storage.get(key);
      if (!item) return null;
      if (item.expiresAt && Date.now() > item.expiresAt) {
        storage.delete(key);
        return null;
      }
      return item.value;
    },

    async set(key: string, value: string): Promise<string> {
      storage.set(key, { value });
      return 'OK';
    },

    async setex(key: string, seconds: number, value: string): Promise<string> {
      storage.set(key, {
        value,
        expiresAt: Date.now() + seconds * 1000
      });
      return 'OK';
    },

    async del(...keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        if (storage.delete(key)) deleted++;
      }
      return deleted;
    },

    async exists(key: string): Promise<number> {
      return storage.has(key) ? 1 : 0;
    },

    async keys(pattern: string): Promise<string[]> {
      // Simple pattern matching for mock
      if (pattern === '*') {
        return Array.from(storage.keys());
      }
      // Basic wildcard support
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return Array.from(storage.keys()).filter(k => regex.test(k));
    },

    async ping(): Promise<string> {
      return 'PONG';
    },

    async quit(): Promise<string> {
      storage.clear();
      return 'OK';
    },

    async info(section?: string): Promise<string> {
      return `# Mock Redis Info
used_memory_human:${storage.size * 100}B
connected_clients:1`;
    },

    async dbsize(): Promise<number> {
      return storage.size;
    },

    async zremrangebyscore(): Promise<number> {
      // Mock implementation
      return 0;
    },

    async zcard(): Promise<number> {
      // Mock implementation
      return 0;
    },

    async zadd(): Promise<number> {
      // Mock implementation
      return 1;
    },

    async expire(): Promise<number> {
      // Mock implementation
      return 1;
    },

    on(event: string, callback: (...args: any[]) => void): void {
      // Mock event handling
      if (event === 'connect' || event === 'ready') {
        setTimeout(() => callback(), 0);
      }
    }
  };
}

/**
 * Get or create Redis client singleton
 */
export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    // Try to create real Redis client first
    try {
      // Attempt dynamic import to avoid build errors
      const Redis = require('ioredis');
      const host = import.meta.env.VITE_REDIS_HOST || 'localhost';
      const port = parseInt(import.meta.env.VITE_REDIS_PORT || '6379');
      const password = import.meta.env.VITE_REDIS_PASSWORD;

      console.log('🔴 Attempting to connect to real Redis server at', `${host}:${port}`);

      redisClient = new Redis({
        host,
        port,
        password,
        retryStrategy: (times: number) => {
          if (times > 3) {
            console.log('⚠️ Redis connection failed after 3 retries, falling back to mock');
            redisClient = createMockRedisClient();
            return null;
          }
          return Math.min(times * 100, 3000);
        },
        lazyConnect: true,
      });

      // Test the connection
      redisClient.ping().then(() => {
        console.log('✅ Connected to real Redis server!');
      }).catch((err: any) => {
        console.log('⚠️ Redis ping failed, using mock instead:', err.message);
        redisClient = createMockRedisClient();
      });
    } catch (error) {
      // In browser environment, ioredis won't be available
      console.log('⚠️ Cannot connect to Redis directly from browser (security limitation)');
      console.log('📝 Note for hackathon: Redis requires a backend server. Using Redis-compatible in-memory cache for demo.');
      console.log('💡 To use real Redis: Set up a Node.js backend or use Upstash Redis (HTTP-based)');
      redisClient = createMockRedisClient();
    }
  }

  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('👋 Redis connection closed');
  }
}