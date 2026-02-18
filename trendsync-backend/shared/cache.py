"""
Redis Cache Layer for TrendSync Backend
Caches expensive Gemini API calls to reduce cost. Falls back to in-memory dict if Redis unavailable.

Usage:
    from shared.cache import cached

    @cached(prefix="trends", ttl=86400)
    def fetch_trends(season, region, demographic, trend_source):
        ...  # expensive Gemini call
"""

import hashlib
import json
import os
import time
from functools import wraps
from typing import Any, Callable, Optional

import redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Module-level connection (lazy init)
_redis_client: Optional[redis.Redis] = None
_redis_available: Optional[bool] = None

# In-memory fallback: {key: (value_json, expire_timestamp)}
_mem_cache: dict[str, tuple[str, float]] = {}

# Hit/miss counters
_hits: int = 0
_misses: int = 0


def _get_redis() -> Optional[redis.Redis]:
    global _redis_client, _redis_available
    if _redis_available is False:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        _redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
        _redis_client.ping()
        _redis_available = True
        print(f"[Cache] Connected to Redis at {REDIS_URL}")
        return _redis_client
    except Exception as e:
        _redis_available = False
        print(f"[Cache] Redis unavailable ({e}), using in-memory fallback")
        return None


def _make_key(prefix: str, args: tuple, kwargs: dict) -> str:
    """Build a deterministic cache key from function arguments."""
    # Sort kwargs for deterministic ordering
    key_data = json.dumps({"a": [_serialize(a) for a in args], "k": {k: _serialize(v) for k, v in sorted(kwargs.items())}}, sort_keys=True)
    h = hashlib.sha256(key_data.encode()).hexdigest()[:16]
    return f"ts:{prefix}:{h}"


def _serialize(val: Any) -> Any:
    """Serialize a value for cache key generation. Skip large binary blobs."""
    if isinstance(val, str) and len(val) > 10_000:
        # Likely base64 image — hash it instead of including full content
        return f"blob:{hashlib.sha256(val.encode()).hexdigest()[:12]}"
    if isinstance(val, dict):
        return {k: _serialize(v) for k, v in sorted(val.items())}
    if isinstance(val, (list, tuple)):
        return [_serialize(v) for v in val]
    return val


def get(key: str) -> Optional[str]:
    """Get a value from cache (Redis or in-memory fallback)."""
    r = _get_redis()
    if r:
        try:
            return r.get(key)
        except Exception:
            pass
    # In-memory fallback
    entry = _mem_cache.get(key)
    if entry:
        val, expires = entry
        if time.time() < expires:
            return val
        del _mem_cache[key]
    return None


def set(key: str, value: str, ttl: int = 86400) -> None:
    """Set a value in cache with TTL (seconds)."""
    r = _get_redis()
    if r:
        try:
            r.setex(key, ttl, value)
            return
        except Exception:
            pass
    # In-memory fallback
    _mem_cache[key] = (value, time.time() + ttl)


def cached(prefix: str, ttl: int = 86400, skip_args: Optional[list[int]] = None):
    """
    Decorator to cache function results.

    Args:
        prefix: Cache key prefix (e.g. "trends", "image_gen")
        ttl: Time-to-live in seconds (default 24h)
        skip_args: Positional arg indices to exclude from cache key (e.g. for self)
    """
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            global _hits, _misses

            # Build cache key (skip specified args like 'self')
            cache_args = tuple(
                a for i, a in enumerate(args)
                if skip_args is None or i not in skip_args
            )
            key = _make_key(prefix, cache_args, kwargs)

            # Check cache
            t0 = time.time()
            hit = get(key)
            if hit is not None:
                _hits += 1
                elapsed = (time.time() - t0) * 1000
                print(f"[Cache] ⚡ HIT  {prefix} ({key[-8:]}) — served from Redis in {elapsed:.0f}ms (saved a Gemini API call)")
                return json.loads(hit)

            # Cache miss — call the real function
            _misses += 1
            print(f"[Cache] 🔄 MISS {prefix} ({key[-8:]}) — calling Gemini API...")
            result = fn(*args, **kwargs)
            elapsed = (time.time() - t0) * 1000

            # Store result (skip if it's too large — e.g. >5MB images)
            try:
                serialized = json.dumps(result)
                if len(serialized) < 5_000_000:
                    set(key, serialized, ttl)
                    print(f"[Cache] 💾 STORED {prefix} ({key[-8:]}) — {len(serialized)} bytes, TTL {ttl}s (Gemini call took {elapsed:.0f}ms)")
                else:
                    print(f"[Cache] ⚠️  Skipping store for {prefix} — result too large ({len(serialized)} bytes)")
            except (TypeError, ValueError):
                pass  # Not JSON-serializable, skip caching

            return result
        return wrapper
    return decorator


def clear_prefix(prefix: str) -> int:
    """Clear all cached entries with a given prefix. Returns count deleted."""
    r = _get_redis()
    if r:
        try:
            keys = list(r.scan_iter(f"ts:{prefix}:*"))
            if keys:
                return r.delete(*keys)
        except Exception:
            pass
    # In-memory fallback
    to_delete = [k for k in _mem_cache if k.startswith(f"ts:{prefix}:")]
    for k in to_delete:
        del _mem_cache[k]
    return len(to_delete)


def cache_stats() -> dict:
    """Return detailed cache statistics."""
    r = _get_redis()
    if r:
        try:
            keys = list(r.scan_iter("ts:*"))

            # Get real memory usage from Redis INFO
            info = r.info("memory")
            memory_bytes = info.get("used_memory", 0)
            if memory_bytes >= 1_048_576:
                memory_str = f"{memory_bytes / 1_048_576:.1f} MB"
            elif memory_bytes >= 1024:
                memory_str = f"{memory_bytes / 1024:.1f} KB"
            else:
                memory_str = f"{memory_bytes} B"

            # Count keys per prefix
            prefix_counts: dict[str, int] = {}
            for k in keys:
                parts = k.split(":")
                if len(parts) >= 2:
                    p = parts[1]
                    prefix_counts[p] = prefix_counts.get(p, 0) + 1

            return {
                "backend": "redis",
                "keys": len(keys),
                "memory_used": memory_str,
                "memory_bytes": memory_bytes,
                "hits": _hits,
                "misses": _misses,
                "hit_rate": f"{(_hits / (_hits + _misses) * 100):.0f}%" if (_hits + _misses) > 0 else "N/A",
                "prefixes": prefix_counts,
            }
        except Exception:
            pass

    valid = sum(1 for _, (_, exp) in _mem_cache.items() if time.time() < exp)
    return {
        "backend": "memory",
        "keys": valid,
        "memory_used": "N/A",
        "memory_bytes": 0,
        "hits": _hits,
        "misses": _misses,
        "hit_rate": f"{(_hits / (_hits + _misses) * 100):.0f}%" if (_hits + _misses) > 0 else "N/A",
        "prefixes": {},
    }
