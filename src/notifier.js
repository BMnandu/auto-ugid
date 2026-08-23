'use strict';

const crypto = require('node:crypto');
const { appendEvent, loadPending, savePending } = require('./storage');
const { fetchWithTimeout } = require('./http');
const { isoNow } = require('./time');

function signHermesV2(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

async function deliver(config, payload, fetchImpl = fetch, now = Date.now()) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(now / 1000));
  const response = await fetchWithTimeout(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature-V2': signHermesV2(config.webhookSecret, timestamp, body),
      'X-Request-ID': payload.event_id
    },
    body
  }, config.requestTimeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`Hermes returned HTTP ${response.status}`);
}

async function enqueue(config, payload, logger = console, now = Date.now()) {
  const pending = await loadPending(config, logger, now);
  if (pending.some((entry) => entry.eventId === payload.event_id)) return false;
  pending.push({
    eventId: payload.event_id,
    payload,
    attempts: 0,
    createdAt: isoNow(now),
    nextAttemptAt: isoNow(now)
  });
  await savePending(config, pending);
  return true;
}

function retryDelay(config, attempts) {
  return Math.min(config.notificationBackoffMs * (2 ** Math.max(0, attempts - 1)), 3600000);
}

async function processPending(config, dependencies = {}) {
  const logger = dependencies.logger || console;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now ? dependencies.now() : Date.now();
  const pending = await loadPending(config, logger, now);
  const remaining = [];

  for (const entry of pending) {
    if (Date.parse(entry.nextAttemptAt) > now) {
      remaining.push(entry);
      continue;
    }
    try {
      await deliver(config, entry.payload, fetchImpl, now);
      logger.info(`Notification delivered: ${entry.eventId}`);
    } catch (error) {
      const attempts = entry.attempts + 1;
      if (attempts >= config.notificationMaxAttempts) {
        logger.error(`Notification exhausted retries: ${entry.eventId}`);
        await appendEvent(config, {
          event_type: 'notification_failed',
          event_id: entry.eventId,
          occurred_at: isoNow(now),
          attempts,
          reason: error.message
        });
      } else {
        remaining.push({
          ...entry,
          attempts,
          nextAttemptAt: isoNow(now + retryDelay(config, attempts)),
          lastError: error.message
        });
      }
    }
  }
  await savePending(config, remaining);
  return { delivered: pending.length - remaining.length, remaining: remaining.length };
}

module.exports = { deliver, enqueue, processPending, retryDelay, signHermesV2 };
