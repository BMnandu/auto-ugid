'use strict';

const { createNotificationDriver } = require('./notifiers');
const { appendEvent, loadPending, savePending } = require('./storage');
const { isoNow } = require('./time');

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
  const now = dependencies.now ? dependencies.now() : Date.now();
  const driver = dependencies.driver || createNotificationDriver(
    config,
    dependencies.fetchImpl || fetch
  );
  const pending = await loadPending(config, logger, now);
  const remaining = [];
  let delivered = 0;
  let exhausted = 0;

  for (const entry of pending) {
    if (Date.parse(entry.nextAttemptAt) > now) {
      remaining.push(entry);
      continue;
    }
    try {
      await driver.deliver(entry.payload, now);
      delivered += 1;
      logger.info(`Notification delivered by ${driver.name}: ${entry.eventId}`);
    } catch (error) {
      const attempts = entry.attempts + 1;
      if (attempts >= config.notificationMaxAttempts) {
        exhausted += 1;
        logger.error(`Notification exhausted retries: ${entry.eventId}`);
        await appendEvent(config, {
          event_type: 'notification_failed',
          event_id: entry.eventId,
          occurred_at: isoNow(now),
          driver: driver.name,
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
  return { delivered, exhausted, remaining: remaining.length };
}

module.exports = { enqueue, processPending, retryDelay };
