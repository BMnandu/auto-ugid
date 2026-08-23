'use strict';

const path = require('node:path');

const DEFAULT_API_URL = 'https://api.ugnas.com/api/p2p/v2/ta/nodeInfo/byAlias';
const NOTIFICATION_DRIVERS = new Set(['hermes', 'wecom', 'generic']);

function parseInteger(env, name, defaultValue, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseBoolean(env, name, defaultValue = false) {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function parseHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString();
}

function isWecomWebhook(value) {
  if (!value) return false;
  try {
    return new URL(value).hostname === 'qyapi.weixin.qq.com';
  } catch {
    return false;
  }
}

function inferNotificationDriver(env) {
  const explicit = env.NOTIFICATION_DRIVER?.trim().toLowerCase();
  if (explicit) {
    if (!NOTIFICATION_DRIVERS.has(explicit)) {
      throw new Error('NOTIFICATION_DRIVER must be hermes, wecom, or generic');
    }
    return explicit;
  }
  if (env.HERMES_WEBHOOK_SECRET || env.HERMES_WEBHOOK_URL) return 'hermes';
  if (env.WECOM_WEBHOOK_URL || isWecomWebhook(env.WEBHOOK_URL)) return 'wecom';
  if (env.GENERIC_WEBHOOK_URL || env.WEBHOOK_URL) return 'generic';
  throw new Error('notification configuration is required');
}

function loadNotificationConfig(env) {
  const driver = inferNotificationDriver(env);
  if (driver === 'hermes') {
    const rawUrl = env.HERMES_WEBHOOK_URL || env.WEBHOOK_URL;
    if (!rawUrl) throw new Error('HERMES_WEBHOOK_URL is required for the hermes driver');
    if (!env.HERMES_WEBHOOK_SECRET) {
      throw new Error('HERMES_WEBHOOK_SECRET is required for the hermes driver');
    }
    return {
      driver,
      url: parseHttpUrl(rawUrl, 'HERMES_WEBHOOK_URL'),
      secret: env.HERMES_WEBHOOK_SECRET,
      usedCompatibilityUrl: !env.HERMES_WEBHOOK_URL && Boolean(env.WEBHOOK_URL)
    };
  }
  if (driver === 'wecom') {
    const rawUrl = env.WECOM_WEBHOOK_URL || env.WEBHOOK_URL;
    if (!rawUrl) throw new Error('WECOM_WEBHOOK_URL is required for the wecom driver');
    return {
      driver,
      url: parseHttpUrl(rawUrl, 'WECOM_WEBHOOK_URL'),
      usedCompatibilityUrl: !env.WECOM_WEBHOOK_URL && Boolean(env.WEBHOOK_URL)
    };
  }
  const rawUrl = env.GENERIC_WEBHOOK_URL || env.WEBHOOK_URL;
  if (!rawUrl) throw new Error('GENERIC_WEBHOOK_URL is required for the generic driver');
  return {
    driver,
    url: parseHttpUrl(rawUrl, 'GENERIC_WEBHOOK_URL'),
    token: env.GENERIC_WEBHOOK_TOKEN || null,
    usedCompatibilityUrl: !env.GENERIC_WEBHOOK_URL && Boolean(env.WEBHOOK_URL)
  };
}

function loadConfig(env = process.env) {
  const alias = (env.UG_ID || env.UGID || 'bmnd').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(alias)) {
    throw new Error('UG_ID must be a lowercase DNS label');
  }

  const stateDir = path.resolve(env.STATE_DIR || '/data');
  return {
    alias,
    apiUrl: parseHttpUrl(env.UGLINK_API_URL || DEFAULT_API_URL, 'UGLINK_API_URL'),
    notification: loadNotificationConfig(env),
    stateDir,
    stateFile: path.join(stateDir, 'state.json'),
    eventsFile: path.join(stateDir, 'events.jsonl'),
    pendingFile: path.join(stateDir, 'pending-notifications.json'),
    legacyDomainFile: env.LEGACY_DOMAIN_FILE || '/app/last_domain.txt',
    intervalMs: parseInteger(env, 'CHECK_INTERVAL', 600, { min: 30, max: 86400 }) * 1000,
    confirmationDelayMs: parseInteger(env, 'CONFIRMATION_DELAY', 20, { min: 0, max: 300 }) * 1000,
    requestTimeoutMs: parseInteger(env, 'REQUEST_TIMEOUT', 10, { min: 1, max: 120 }) * 1000,
    sourceFailureThreshold: parseInteger(env, 'SOURCE_FAILURE_THRESHOLD', 3, { min: 1, max: 100 }),
    notificationMaxAttempts: parseInteger(env, 'NOTIFICATION_MAX_ATTEMPTS', 5, { min: 1, max: 20 }),
    notificationBackoffMs: parseInteger(env, 'NOTIFICATION_BACKOFF', 30, { min: 1, max: 3600 }) * 1000,
    notifyOnFirstRun: parseBoolean(env, 'NOTIFY_ON_FIRST_RUN', false)
  };
}

module.exports = {
  DEFAULT_API_URL,
  inferNotificationDriver,
  isWecomWebhook,
  loadConfig,
  loadNotificationConfig,
  parseBoolean,
  parseInteger
};
