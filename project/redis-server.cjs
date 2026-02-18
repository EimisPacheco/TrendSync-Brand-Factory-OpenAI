/**
 * Redis Backend Server
 * This server provides HTTP endpoints for Redis operations
 * Required for hackathon to demonstrate real Redis usage
 */

const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
const port = 3001;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());

// Create Redis client with real connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    console.log(`Redis connection attempt ${times}`);
    return Math.min(times * 100, 3000);
  }
});

// Redis event handlers
redis.on('connect', () => {
  console.log('✅ Connected to Redis server successfully!');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

// Test connection endpoint
app.get('/api/redis/ping', async (req, res) => {
  try {
    const result = await redis.ping();
    res.json({
      success: true,
      message: 'Redis connection successful',
      response: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get cache stats
app.get('/api/redis/stats', async (req, res) => {
  try {
    const dbSize = await redis.dbsize();
    const info = await redis.info('memory');

    // Parse memory info
    const memoryUsed = info.match(/used_memory_human:(.+)/)?.[1]?.trim() || 'Unknown';

    res.json({
      success: true,
      stats: {
        totalKeys: dbSize,
        memoryUsed,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get value by key
app.get('/api/redis/get/:key', async (req, res) => {
  try {
    const value = await redis.get(req.params.key);
    res.json({
      success: true,
      key: req.params.key,
      value,
      exists: value !== null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Set value with expiry
app.post('/api/redis/set', async (req, res) => {
  try {
    const { key, value, ttl } = req.body;

    if (!key || !value) {
      return res.status(400).json({
        success: false,
        message: 'Key and value are required'
      });
    }

    let result;
    if (ttl) {
      result = await redis.setex(key, ttl, value);
    } else {
      result = await redis.set(key, value);
    }

    res.json({
      success: true,
      message: 'Value set successfully',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Clear all cache
app.delete('/api/redis/clear', async (req, res) => {
  try {
    await redis.flushdb();
    res.json({
      success: true,
      message: 'All cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// List all keys (with pattern matching)
app.get('/api/redis/keys', async (req, res) => {
  try {
    const pattern = req.query.pattern || '*';
    const keys = await redis.keys(pattern);
    res.json({
      success: true,
      keys,
      count: keys.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Redis Backend Server',
    timestamp: new Date().toISOString()
  });
});
// Start server
app.listen(port, () => {
  console.log(`🚀 Redis backend server running at http://localhost:${port}`);
  console.log('📝 Available endpoints:');
  console.log('  GET  /api/redis/ping     - Test Redis connection');
  console.log('  GET  /api/redis/stats    - Get cache statistics');
  console.log('  GET  /api/redis/keys     - List all keys');
  console.log('  GET  /api/redis/get/:key - Get value by key');
  console.log('  POST /api/redis/set      - Set key-value pair');
  console.log('  DELETE /api/redis/clear  - Clear all cache');
  console.log('  GET  /api/health         - Server health check');
});
