'use strict';

const path = require('node:path');

const DEFAULT_API_URL = 'https://api.ugnas.com/api/p2p/v2/ta/nodeInfo/byAlias';

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

function loadConfig(env = process.env) {
  const alias = (env.UG_ID || env.UGID || 'bmnd').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(alias)) {
    throw new Error('UG_ID must be a lowercase DNS label');
  }

  const webhookValue = env.HERMES_WEBHOOK_URL || env.WEBHOOK_URL;
  if (!webhookValue) throw new Error('HERMES_WEBHOOK_URL is required');
  if (!env.HERMES_WEBHOOK_SECRET) throw new Error('HERMES_WEBHOOK_SECRET is required');

  const stateDir = path.resolve(env.STATE_DIR || '/data');
  return {
    alias,
    apiUrl: parseHttpUrl(env.UGLINK_API_URL || DEFAULT_API_URL, 'UGLINK_API_URL'),
    webhookUrl: parseHttpUrl(webhookValue, 'HERMES_WEBHOOK_URL'),
    webhookSecret: env.HERMES_WEBHOOK_SECRET,
    usedLegacyWebhookVariable: !env.HERMES_WEBHOOK_URL && Boolean(env.WEBHOOK_URL),
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

module.exports = { DEFAULT_API_URL, loadConfig, parseBoolean, parseInteger };
