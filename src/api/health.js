'use strict';

/**
 * Health Check API Endpoint (Public)
 * GET /health
 */

const os = require('os');
const { getDatabase } = require('../db/engine');

function handleHealth(req, res) {
  let dbStatus = 'healthy';
  let totalNotes = 0;

  try {
    const db = getDatabase();
    totalNotes = db.getCollection('notes').documents.size;
  } catch (err) {
    dbStatus = `degraded: ${err.message}`;
  }

  const memory = process.memoryUsage();

  const healthData = {
    status: dbStatus === 'healthy' ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    hostname: os.hostname(),
    memory: {
      rssMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024))
    },
    services: {
      database: dbStatus,
      totalNotes
    }
  };

  res.success(healthData, 'System is healthy');
}

module.exports = {
  handleHealth
};
