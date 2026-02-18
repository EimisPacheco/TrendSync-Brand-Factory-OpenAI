/**
 * Redis API Client
 * Communicates with the backend Redis server via HTTP
 * This allows real Redis operations while maintaining browser compatibility
 */

const REDIS_API_URL = 'http://localhost:3001/api';

export interface RedisStats {
  totalKeys: number;
  memoryUsed: string;
  timestamp: string;
}

export interface RedisConnectionStatus {
  success: boolean;
  message: string;
  response?: string;
  timestamp?: string;
}

/**
 * Test Redis connection via backend API
 */
export async function testRedisConnection(): Promise<RedisConnectionStatus> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/ping`);
    const data = await response.json();

    if (data.success) {
      console.log('✅ Connected to real Redis server via backend!');
    }

    return data;
  } catch (error) {
    // If backend is not running, fallback to mock
    console.warn('⚠️ Backend Redis API not available. Using in-memory cache for demo.');
    return {
      success: false,
      message: 'Backend API not available. Using in-memory cache for demo purposes.'
    };
  }
}

/**
 * Get Redis statistics via backend API
 */
export async function getRedisStats(): Promise<RedisStats | null> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/stats`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      console.log('📊 Retrieved real Redis stats:', data.stats);
      return data.stats;
    }

    return null;
  } catch (error) {
    console.warn('⚠️ Could not get Redis stats from backend:', error);
    // Return mock stats for demo
    return {
      totalKeys: 0,
      memoryUsed: '0 KB',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get value from Redis via backend API
 */
export async function getRedisValue(key: string): Promise<string | null> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/get/${encodeURIComponent(key)}`);
    const data = await response.json();

    if (data.success && data.exists) {
      return data.value;
    }

    return null;
  } catch (error) {
    console.warn('⚠️ Could not get value from Redis backend:', error);
    return null;
  }
}

/**
 * Set value in Redis via backend API
 */
export async function setRedisValue(key: string, value: string, ttl?: number): Promise<boolean> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value, ttl })
    });

    const data = await response.json();

    if (data.success) {
      console.log(`✅ Set Redis key "${key}" via backend`);
    }

    return data.success;
  } catch (error) {
    console.warn('⚠️ Could not set value in Redis backend:', error);
    return false;
  }
}

/**
 * Clear all Redis cache via backend API
 */
export async function clearRedisCache(): Promise<boolean> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/clear`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      console.log('🗑️ Cleared all Redis cache via backend');
    }

    return data.success;
  } catch (error) {
    console.warn('⚠️ Could not clear Redis cache via backend:', error);
    return false;
  }
}

/**
 * List all Redis keys via backend API
 */
export async function listRedisKeys(pattern: string = '*'): Promise<string[]> {
  try {
    const response = await fetch(`${REDIS_API_URL}/redis/keys?pattern=${encodeURIComponent(pattern)}`);
    const data = await response.json();

    if (data.success) {
      console.log(`🔑 Found ${data.count} Redis keys matching pattern "${pattern}"`);
      return data.keys;
    }

    return [];
  } catch (error) {
    console.warn('⚠️ Could not list Redis keys from backend:', error);
    return [];
  }
}

/**
 * Check if backend server is healthy
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${REDIS_API_URL}/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      console.log('✅ Backend Redis API server is healthy');
      return true;
    }

    return false;
  } catch (error) {
    console.warn('⚠️ Backend Redis API server is not running');
    console.log('💡 To start the backend server, run: node redis-server.cjs');
    return false;
  }
}