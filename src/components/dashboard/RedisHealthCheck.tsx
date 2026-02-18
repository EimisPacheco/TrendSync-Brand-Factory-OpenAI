import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  testRedisConnection,
  getRedisStats,
  clearRedisCache,
  checkBackendHealth,
} from '../../services/redis-api';
import type { RedisStats } from '../../services/redis-api';

/**
 * Redis Health Check Component
 * Displays Redis connection status, cache statistics, and provides admin controls.
 * Talks to the Python backend's /cache/* endpoints.
 */
export function RedisHealthCheck() {
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isHealthy, setIsHealthy] = useState<boolean>(false);
  const [stats, setStats] = useState<RedisStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    handleRefreshAll();
  }, []);

  const handleRefreshAll = async () => {
    const [healthy, result, redisStats] = await Promise.all([
      checkBackendHealth(),
      testRedisConnection(),
      getRedisStats(),
    ]);
    setIsHealthy(healthy);
    setConnectionStatus(result);
    if (redisStats) setStats(redisStats);
  };

  const handleTestConnection = async () => {
    setIsLoading(true);
    try {
      const result = await testRedisConnection();
      setConnectionStatus(result);
      if (result.success) {
        toast.success('Connected to Redis!');
      } else {
        toast.error(result.message);
      }
      await handleRefreshAll();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm('Clear ALL cached data? Next API calls will hit Gemini again.')) return;

    setIsLoading(true);
    try {
      const ok = await clearRedisCache();
      if (ok) {
        toast.success('All caches cleared!');
      } else {
        toast.error('Failed to clear cache');
      }
      await handleRefreshAll();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await handleRefreshAll();
      toast.success('Status refreshed!');
    } finally {
      setIsRefreshing(false);
    }
  };

  const prefixLabels: Record<string, string> = {
    trends: 'Trend insights',
    celebrities: 'Celebrity data',
    img_gen: 'Generated images',
  };

  return (
    <div className="neumorphic-card p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-pastel-navy flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            Redis Cache Status
          </h3>
          <p className="text-sm text-pastel-muted mt-1">
            Real-time cache monitoring and performance metrics
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="btn-soft px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
        >
          {isRefreshing ? (
            <>
              <div className="w-4 h-4 border-2 border-pastel-accent border-t-transparent rounded-full animate-spin" />
              Refreshing...
            </>
          ) : (
            <>🔄 Refresh</>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {/* Connection Status */}
        <div className="neumorphic-inset p-4 rounded-xl">
          <h4 className="text-sm font-medium text-pastel-navy mb-2">Connection Test</h4>
          {connectionStatus ? (
            <div className={`flex items-start gap-3 ${connectionStatus.success ? 'text-green-700' : 'text-red-700'}`}>
              <span className="text-xl">{connectionStatus.success ? '✅' : '❌'}</span>
              <div>
                <p className="font-medium">{connectionStatus.success ? 'Connected' : 'Connection Failed'}</p>
                <p className="text-sm opacity-80">{connectionStatus.message}</p>
              </div>
            </div>
          ) : (
            <p className="text-pastel-muted text-sm">Testing connection...</p>
          )}
        </div>

        {/* Cache Statistics */}
        <div className="neumorphic-inset p-4 rounded-xl">
          <h4 className="text-sm font-medium text-pastel-navy mb-3">Cache Statistics</h4>
          {stats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-pastel-muted uppercase tracking-wide">Total Keys</p>
                  <p className="text-2xl font-bold text-pastel-navy mt-1">{stats.totalKeys}</p>
                  <p className="text-xs text-pastel-muted mt-1">Cached items</p>
                </div>
                <div>
                  <p className="text-xs text-pastel-muted uppercase tracking-wide">Memory Used</p>
                  <p className="text-2xl font-bold text-pastel-navy mt-1">{stats.memoryUsed}</p>
                  <p className="text-xs text-pastel-muted mt-1">Redis Cloud</p>
                </div>
                <div>
                  <p className="text-xs text-pastel-muted uppercase tracking-wide">Hit Rate</p>
                  <p className="text-2xl font-bold text-pastel-navy mt-1">{stats.hitRate}</p>
                  <p className="text-xs text-pastel-muted mt-1">
                    {stats.hits} hits / {stats.misses} misses
                  </p>
                </div>
              </div>

              {/* Per-prefix breakdown */}
              {stats.prefixes && Object.keys(stats.prefixes).length > 0 && (
                <div className="pt-3 border-t border-pastel-navy/10">
                  <p className="text-xs text-pastel-muted uppercase tracking-wide mb-2">Cached Data Breakdown</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.prefixes).map(([prefix, count]) => (
                      <span
                        key={prefix}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium neumorphic-sm"
                      >
                        <span className="w-2 h-2 rounded-full bg-pastel-accent" />
                        {prefixLabels[prefix] || prefix}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-pastel-muted text-sm">Loading statistics...</p>
          )}
        </div>

        {/* Cache Benefits */}
        <div className="neumorphic-inset p-4 rounded-xl bg-pastel-accent/5">
          <h4 className="text-sm font-medium text-pastel-navy mb-2 flex items-center gap-2">
            <span>💡</span>
            Cache Benefits
          </h4>
          <ul className="text-sm text-pastel-text space-y-1">
            <li>✓ Gemini trends cached for 24 hours</li>
            <li>✓ Image generation cached for 24 hours</li>
            <li>✓ Celebrity data cached for 24 hours</li>
            <li>✓ Backed by Redis Cloud (persistent across restarts)</li>
            <li>✓ Automatic fallback to in-memory if Redis is unavailable</li>
          </ul>
        </div>

        {/* Admin Controls */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleClearCache}
            disabled={isLoading || !stats || stats.totalKeys === 0}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-red-600 neumorphic-sm hover:neumorphic disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            🗑️ Clear All Caches
          </button>
          <button
            onClick={handleTestConnection}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-pastel-accent neumorphic-sm hover:neumorphic disabled:opacity-50 disabled:cursor-wait transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-pastel-accent border-t-transparent rounded-full animate-spin" />
                Testing...
              </>
            ) : (
              <>🧪 Test Connection</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
