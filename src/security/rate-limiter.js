'use strict';

/**
 * Custom Zero-Dependency Rate Limiter & Brute-Force Lockout
 * Implements sliding window request counters per key & IP with automatic abuse lockout.
 */

const config = require('../config');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || config.rateLimitWindowMs || 60000;
    this.maxRequests = options.maxRequests || config.rateLimitMax || 100;
    this.lockoutThreshold = options.lockoutThreshold || 5; // 5 failed attempts
    this.lockoutDurationMs = options.lockoutDurationMs || 15 * 60000; // 15 mins

    this.requests = new Map(); // identifier -> array of timestamps
    this.failedAttempts = new Map(); // ip -> { count: number, lockedUntil: number }

    // Periodic cleanup of stale tracking data (every 5 minutes)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60000);
    this.cleanupTimer.unref();
  }

  isLockedOut(ip) {
    const record = this.failedAttempts.get(ip);
    if (!record) return false;
    if (record.lockedUntil > 0) {
      if (Date.now() < record.lockedUntil) {
        return true;
      }
      // Lockout period expired
      this.failedAttempts.delete(ip);
      return false;
    }
    return false;
  }

  recordFailure(ip) {
    const now = Date.now();
    const record = this.failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    record.count += 1;

    if (record.count >= this.lockoutThreshold) {
      record.lockedUntil = now + this.lockoutDurationMs;
    }

    this.failedAttempts.set(ip, record);
    return record;
  }

  recordSuccess(ip) {
    this.failedAttempts.delete(ip);
  }

  check(identifier) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(identifier) || [];
    // Filter timestamps within current window
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const resetTime = Math.ceil((timestamps[0] + this.windowMs - now) / 1000);
      return {
        allowed: false,
        total: timestamps.length,
        limit: this.maxRequests,
        remaining: 0,
        retryAfterSec: Math.max(1, resetTime)
      };
    }

    timestamps.push(now);
    this.requests.set(identifier, timestamps);

    return {
      allowed: true,
      total: timestamps.length,
      limit: this.maxRequests,
      remaining: this.maxRequests - timestamps.length
    };
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [id, timestamps] of this.requests.entries()) {
      const active = timestamps.filter(t => t > windowStart);
      if (active.length === 0) {
        this.requests.delete(id);
      } else {
        this.requests.set(id, active);
      }
    }

    for (const [ip, record] of this.failedAttempts.entries()) {
      if (record.lockedUntil < now && record.count < this.lockoutThreshold) {
        this.failedAttempts.delete(ip);
      }
    }
  }
}

const rateLimiter = new RateLimiter();

module.exports = {
  RateLimiter,
  rateLimiter
};
