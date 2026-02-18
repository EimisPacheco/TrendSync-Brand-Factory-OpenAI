/**
 * Redis API Client
 * Communicates with the Python backend's /cache/* endpoints
 * Replaces the old localhost:3001 Node.js Redis bridge.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface RedisStats {
  totalKeys: number;
  memoryUsed: string;
  hits: number;
  misses: number;
  hitRate: string;
  prefixes: Record<string, number>;
  timestamp: string;
}

export interface RedisConnectionStatus {
  success: boolean;
  message: string;
  response?: string;
  timestamp?: string;
}

/**
 * Test Redis connection via backend /cache/stats
 */
export async function testRedisConnection(): Promise<RedisConnectionStatus> {
  try {
    const response = await fetch(`${API_BASE}/cache/stats`);
    const data = await response.json();

    if (data.backend === 'redis') {
      console.log(`%c[Redis] ✅ Connected to Redis Cloud — ${data.keys} keys, ${data.memory_used}, hit rate: ${data.hit_rate}`, 'color: #22c55e; font-weight: bold');
      return {
        success: true,
        message: `Connected to Redis Cloud (${data.keys} keys, ${data.memory_used})`,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`%c[Redis] ⚠️ Using in-memory fallback — ${data.keys} keys`, 'color: #f59e0b; font-weight: bold');
    return {
      success: true,
      message: `Using in-memory fallback (${data.keys} keys)`,
      timestamp: new Date().toISOString(),
    };
  } catch {
    console.log('%c[Redis] ❌ Backend not reachable', 'color: #ef4444; font-weight: bold');
    return {
      success: false,
      message: 'Backend API not available. Ensure the backend is running.',
    };
  }
}

/**
 * Get Redis statistics via backend
 */
export async function getRedisStats(): Promise<RedisStats | null> {
  try {
    const response = await fetch(`${API_BASE}/cache/stats`);
    if (!response.ok) return null;

    const data = await response.json();

    // Log detailed stats
    if (data.hits > 0 || data.misses > 0) {
      console.log(
        `%c[Redis] 📊 Stats — ${data.hits} hits, ${data.misses} misses, hit rate: ${data.hit_rate}`,
        'color: #6366f1; font-weight: bold'
      );
      if (data.prefixes && Object.keys(data.prefixes).length > 0) {
        console.log('%c[Redis] 📦 Cached prefixes:', 'color: #6366f1', data.prefixes);
      }
    }

    return {
      totalKeys: data.keys ?? 0,
      memoryUsed: data.memory_used ?? '0 KB',
      hits: data.hits ?? 0,
      misses: data.misses ?? 0,
      hitRate: data.hit_rate ?? 'N/A',
      prefixes: data.prefixes ?? {},
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Get value from Redis — not used directly (caching is server-side now)
 */
export async function getRedisValue(_key: string): Promise<string | null> {
  return null;
}

/**
 * Set value in Redis — not used directly (caching is server-side now)
 */
export async function setRedisValue(_key: string, _value: string, _ttl?: number): Promise<boolean> {
  return true;
}

/**
 * Clear all Redis cache via backend
 */
export async function clearRedisCache(): Promise<boolean> {
  try {
    const prefixes = ['trends', 'celebrities', 'img_gen'];
    const results = await Promise.all(
      prefixes.map((prefix) =>
        fetch(`${API_BASE}/cache/${prefix}`, { method: 'DELETE' }).then((r) => r.ok)
      )
    );
    console.log('%c[Redis] 🗑️ All caches cleared', 'color: #ef4444; font-weight: bold');
    return results.every(Boolean);
  } catch {
    return false;
  }
}

/**
 * Check if backend server is healthy
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
}
