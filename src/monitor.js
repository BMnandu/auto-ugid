'use strict';

const { normalizeRelayDomain, validateRelayDomain } = require('./domain');
const {
  relayChangedEvent,
  sourceRecoveredEvent,
  sourceUnavailableEvent
} = require('./events');
const { enqueue, processPending } = require('./notifier');
const { appendEvent, loadState, saveState, stateEvent } = require('./storage');
const { isoNow } = require('./time');
const { fetchRelayDomain } = require('./uglink');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorReason(error) {
  return error?.code || error?.message || 'unknown_error';
}

function safeAuditValue(value) {
  return typeof value === 'string' ? value.slice(0, 253) : null;
}

class Monitor {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.logger = dependencies.logger || console;
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.now = dependencies.now || Date.now;
    this.sleep = dependencies.sleep || sleep;
    this.fetchRelayDomain = dependencies.fetchRelayDomain || fetchRelayDomain;
    this.notificationDriver = dependencies.notificationDriver;
    this.state = null;
  }

  async initialize() {
    const loaded = await loadState(this.config, this.logger, this.now());
    this.state = loaded.state;
    if (loaded.corruptBackup) {
      await appendEvent(this.config, stateEvent('corrupt_state_preserved', {
        backup_file: loaded.corruptBackup.split('/').pop()
      }, this.now()));
    }
    if (this.config.notification.usedCompatibilityUrl) {
      this.logger.warn('WEBHOOK_URL is a compatibility alias; prefer the driver-specific URL variable');
    }
    this.logger.info(`Notification driver: ${this.config.notification.driver}`);
    return loaded;
  }

  async save() {
    await saveState(this.config, this.state);
  }

  async publish(event) {
    await appendEvent(this.config, event);
    await enqueue(this.config, event, this.logger, this.now());
  }

  async processNotifications() {
    return processPending(this.config, {
      logger: this.logger,
      fetchImpl: this.fetchImpl,
      driver: this.notificationDriver,
      now: this.now
    });
  }

  async recordSourceFailure(error) {
    this.state.consecutiveSourceFailures += 1;
    if (
      this.state.consecutiveSourceFailures >= this.config.sourceFailureThreshold &&
      !this.state.sourceAlertSent
    ) {
      const episodeKey = this.state.lastSuccessfulCheckAt || 'startup';
      const event = sourceUnavailableEvent(
        this.config,
        this.state.consecutiveSourceFailures,
        errorReason(error),
        episodeKey,
        this.now()
      );
      await this.publish(event);
      this.state.sourceAlertSent = true;
      this.state.sourceAlertEventId = event.event_id;
    }
    await this.save();
    this.logger.error(`UGLink source query failed (${this.state.consecutiveSourceFailures}): ${errorReason(error)}`);
  }

  async recordSourceSuccess() {
    const wasUnavailable = this.state.sourceAlertSent;
    const unavailableEventId = this.state.sourceAlertEventId;
    this.state.consecutiveSourceFailures = 0;
    this.state.sourceAlertSent = false;
    this.state.sourceAlertEventId = null;
    this.state.lastSuccessfulCheckAt = isoNow(this.now());
    if (wasUnavailable) {
      await this.publish(sourceRecoveredEvent(
        this.config,
        this.state.currentDomain,
        unavailableEventId || 'unknown-outage',
        this.now()
      ));
    }
    await this.save();
  }

  async discardCandidate(domain, reason, secondDomain = null) {
    await appendEvent(this.config, {
      event_type: 'candidate_discarded',
      occurred_at: isoNow(this.now()),
      candidate_domain: safeAuditValue(domain),
      second_candidate: safeAuditValue(secondDomain),
      reason
    });
    this.logger.warn(`Candidate discarded: ${reason}`);
  }

  async confirmCandidate(candidateDomain) {
    await this.sleep(this.config.confirmationDelayMs);
    let rawConfirmed;
    try {
      rawConfirmed = await this.fetchRelayDomain(this.config, this.fetchImpl);
    } catch (error) {
      await this.recordSourceFailure(error);
      return false;
    }
    if (!validateRelayDomain(rawConfirmed, this.config.alias)) {
      await this.discardCandidate(rawConfirmed, 'invalid_domain');
      return false;
    }
    const confirmed = normalizeRelayDomain(rawConfirmed, this.config.alias);
    if (confirmed !== candidateDomain) {
      await this.discardCandidate(candidateDomain, 'confirmation_mismatch', confirmed);
      return false;
    }
    return true;
  }

  async checkOnce() {
    if (!this.state) await this.initialize();
    await this.processNotifications();

    let rawCandidate;
    try {
      rawCandidate = await this.fetchRelayDomain(this.config, this.fetchImpl);
    } catch (error) {
      await this.recordSourceFailure(error);
      await this.processNotifications();
      return { status: 'source_error' };
    }
    await this.recordSourceSuccess();

    if (!validateRelayDomain(rawCandidate, this.config.alias)) {
      await this.discardCandidate(rawCandidate, 'invalid_domain');
      await this.processNotifications();
      return { status: 'invalid_domain' };
    }
    const candidateDomain = normalizeRelayDomain(rawCandidate, this.config.alias);

    if (candidateDomain === this.state.currentDomain) {
      this.logger.info('Relay domain unchanged');
      await this.processNotifications();
      return { status: 'unchanged' };
    }

    if (!(await this.confirmCandidate(candidateDomain))) {
      await this.processNotifications();
      return { status: 'candidate_unconfirmed' };
    }

    const oldDomain = this.state.currentDomain;
    if (oldDomain === null) {
      this.state.currentDomain = candidateDomain;
      this.state.lastChangeAt = isoNow(this.now());
      await this.save();
      this.logger.info(`Initial baseline established for ${candidateDomain}`);
      if (this.config.notifyOnFirstRun) {
        await this.publish(relayChangedEvent(this.config, null, candidateDomain, this.now()));
      }
      await this.processNotifications();
      return { status: 'baseline_established' };
    }

    const event = relayChangedEvent(
      this.config,
      oldDomain,
      candidateDomain,
      this.now()
    );
    await this.publish(event);
    this.state.currentDomain = candidateDomain;
    this.state.lastChangeAt = isoNow(this.now());
    await this.save();
    await this.processNotifications();
    this.logger.info(`Relay domain committed: ${oldDomain} -> ${candidateDomain}`);
    return { status: 'changed', eventId: event.event_id };
  }
}

module.exports = { Monitor, errorReason, safeAuditValue, sleep };
