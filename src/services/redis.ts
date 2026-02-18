/**
 * Redis Cache Utilities
 * Provides caching functions using Redis API backend
 */

import { getRedisValue, setRedisValue } from './redis-api';

/**
 * Cache Key Generators
 */
export const CACHE_KEYS = {
  GEMINI_TREND: (season: string, region: string, demographic: string) =>
    `trends:gemini:${season}:${region}:${demographic}`,

  GEMINI_CELEBRITY_TREND: (demographic: string) =>
    `gemini:trend:celebrity:${demographic}`,
  
  BRIA_STRUCTURED_PROMPT: (hash: string) =>
    `prompt:bria:${hash}`,
  
  RATE_LIMIT: (api: string, userId: string) =>
    `ratelimit:${api}:${userId}`,
};

/**
 * Cache TTL (Time To Live) in seconds
 */
export const CACHE_TTL = {
  GEMINI_TRENDS: 24 * 60 * 60, // 24 hours
  BRIA_PROMPTS: 7 * 24 * 60 * 60, // 7 days
  RATE_LIMIT: 60 * 60, // 1 hour
};

/**
 * Get cached value from Redis
 */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await getRedisValue(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Failed to get cached value for key "${key}":`, error);
    return null;
  }
}

/**
 * Set cached value in Redis
 */
export async function setCached<T>(key: string, value: T, ttl?: number): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    return await setRedisValue(key, serialized, ttl);
  } catch (error) {
    console.warn(`Failed to set cached value for key "${key}":`, error);
    return false;
  }
}

/**
 * Delete cached value from Redis
 */
export async function deleteCached(key: string): Promise<boolean> {
  try {
    // Note: redis-api.ts doesn't have delete yet, but this can be added if needed
    // For now, set with TTL 0 or use a different approach
    return await setRedisValue(key, '', 0);
  } catch (error) {
    console.warn(`Failed to delete cached value for key "${key}":`, error);
    return false;
  }
}

/**
 * Check if key exists in cache
 */
export async function existsInCache(key: string): Promise<boolean> {
  try {
    const value = await getRedisValue(key);
    return value !== null;
  } catch (error) {
    console.warn(`Failed to check existence for key "${key}":`, error);
    return false;
  }
}

/**
 * Hash an object to create a stable cache key
 */
export function hashObject(obj: any): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check rate limit for an API
 */
export async function checkRateLimit(api: string, userId: string = 'default', limit: number = 100): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const key = CACHE_KEYS.RATE_LIMIT(api, userId);
    const cached = await getCached<{ count: number; resetAt: number }>(key);
    
    const now = Date.now();
    
    if (!cached || now > cached.resetAt) {
      // Reset rate limit
      await setCached(key, { count: 1, resetAt: now + CACHE_TTL.RATE_LIMIT * 1000 }, CACHE_TTL.RATE_LIMIT);
      return { allowed: true, remaining: limit - 1 };
    }
    
    if (cached.count >= limit) {
      return { allowed: false, remaining: 0 };
    }
    
    // Increment counter
    await setCached(key, { count: cached.count + 1, resetAt: cached.resetAt }, CACHE_TTL.RATE_LIMIT);
    return { allowed: true, remaining: limit - cached.count - 1 };
  } catch (error) {
    console.warn(`Failed to check rate limit for ${api}:`, error);
    // Fail open - allow request if rate limit check fails
    return { allowed: true, remaining: limit };
  }
}

/**
 * Clear all caches
 */
export async function clearAllCaches(): Promise<boolean> {
  try {
    const { clearRedisCache } = await import('./redis-api');
    return await clearRedisCache();
  } catch (error) {
    console.warn('Failed to clear all caches:', error);
    return false;
  }
}

/**
 * Check if Redis is healthy
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const { checkBackendHealth } = await import('./redis-api');
    return await checkBackendHealth();
  } catch (error) {
    return false;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ totalKeys: number; memoryUsed: string; timestamp: string } | null> {
  try {
    const { getRedisStats } = await import('./redis-api');
    return await getRedisStats();
  } catch (error) {
    console.warn('Failed to get cache stats:', error);
    return null;
  }
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const redisApi = await import('./redis-api');
    const result = await redisApi.testRedisConnection();
    return {
      success: result.success,
      message: result.message
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

