'use strict';

const { checkEmbyIdentity } = require('./emby');
const { validateRelayDomain } = require('./domain');
const {
  candidateUnhealthyEvent,
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

class Monitor {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.logger = dependencies.logger || console;
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.now = dependencies.now || Date.now;
    this.sleep = dependencies.sleep || sleep;
    this.fetchRelayDomain = dependencies.fetchRelayDomain || fetchRelayDomain;
    this.checkEmbyIdentity = dependencies.checkEmbyIdentity || checkEmbyIdentity;
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
    if (this.config.usedLegacyWebhookVariable) {
      this.logger.warn('WEBHOOK_URL is deprecated; use HERMES_WEBHOOK_URL');
    }
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

  async recordSourceSuccess(domain) {
    const wasUnavailable = this.state.sourceAlertSent;
    const unavailableEventId = this.state.sourceAlertEventId;
    this.state.consecutiveSourceFailures = 0;
    this.state.sourceAlertSent = false;
    this.state.sourceAlertEventId = null;
    this.state.lastSuccessfulCheckAt = isoNow(this.now());
    if (wasUnavailable) {
      const event = sourceRecoveredEvent(
        this.config,
        domain,
        unavailableEventId || 'unknown-outage',
        this.now()
      );
      await this.publish(event);
    }
    await this.save();
  }

  async reportCandidate(domain, reason) {
    const key = `${domain || '(empty)'}:${reason}`;
    if (this.state.candidateAlertKey === key) return;
    const event = candidateUnhealthyEvent(
      this.config,
      this.state.currentDomain,
      domain,
      reason,
      this.now()
    );
    await this.publish(event);
    this.state.candidateAlertKey = key;
    await this.save();
  }

  async establishInitialBaseline(domain) {
    let identity;
    try {
      identity = await this.checkEmbyIdentity(domain, null, this.config, this.fetchImpl);
    } catch (error) {
      await this.reportCandidate(domain, errorReason(error));
      return false;
    }
    this.state.currentDomain = domain;
    this.state.serverId = identity.serverId;
    this.state.candidateAlertKey = null;
    this.state.lastChangeAt = isoNow(this.now());
    await this.save();
    this.logger.info(`Initial baseline established for ${domain}`);
    if (this.config.notifyOnFirstRun) {
      await this.publish(relayChangedEvent(
        this.config,
        '(first-run)',
        domain,
        identity.serverId,
        this.now()
      ));
    }
    return true;
  }

  async ensureServerIdBaseline(candidateDomain) {
    if (this.state.serverId) return true;
    const baselineDomain = this.state.currentDomain;
    if (!validateRelayDomain(baselineDomain, this.config.alias)) {
      await this.reportCandidate(candidateDomain, 'legacy_baseline_domain_invalid');
      return false;
    }
    try {
      const identity = await this.checkEmbyIdentity(
        baselineDomain,
        null,
        this.config,
        this.fetchImpl
      );
      this.state.serverId = identity.serverId;
      await this.save();
      this.logger.info('Emby Server ID baseline established from the committed domain');
      return true;
    } catch (error) {
      await this.reportCandidate(candidateDomain, `baseline_${errorReason(error)}`);
      return false;
    }
  }

  async confirmCandidate(candidateDomain) {
    await this.sleep(this.config.confirmationDelayMs);
    let confirmed;
    try {
      confirmed = await this.fetchRelayDomain(this.config, this.fetchImpl);
    } catch (error) {
      await this.recordSourceFailure(error);
      return false;
    }
    if (!validateRelayDomain(confirmed, this.config.alias)) {
      await this.reportCandidate(confirmed, 'invalid_domain');
      return false;
    }
    if (confirmed !== candidateDomain) {
      await appendEvent(this.config, {
        event_type: 'candidate_discarded',
        occurred_at: isoNow(this.now()),
        first_candidate: candidateDomain,
        second_candidate: confirmed,
        reason: 'confirmation_mismatch'
      });
      this.logger.warn('Candidate changed during confirmation and was discarded');
      return false;
    }
    return true;
  }

  async checkOnce() {
    if (!this.state) await this.initialize();
    await this.processNotifications();

    let candidateDomain;
    try {
      candidateDomain = await this.fetchRelayDomain(this.config, this.fetchImpl);
    } catch (error) {
      await this.recordSourceFailure(error);
      await this.processNotifications();
      return { status: 'source_error' };
    }
    await this.recordSourceSuccess(candidateDomain);

    if (!validateRelayDomain(candidateDomain, this.config.alias)) {
      await this.reportCandidate(candidateDomain, 'invalid_domain');
      await this.processNotifications();
      return { status: 'invalid_domain' };
    }

    if (!this.state.currentDomain) {
      const established = await this.establishInitialBaseline(candidateDomain);
      await this.processNotifications();
      return { status: established ? 'baseline_established' : 'candidate_unhealthy' };
    }

    if (!(await this.ensureServerIdBaseline(candidateDomain))) {
      await this.processNotifications();
      return { status: 'baseline_unhealthy' };
    }

    if (candidateDomain === this.state.currentDomain) {
      if (this.state.candidateAlertKey) {
        this.state.candidateAlertKey = null;
        await this.save();
      }
      this.logger.info('Relay domain unchanged');
      await this.processNotifications();
      return { status: 'unchanged' };
    }

    if (!(await this.confirmCandidate(candidateDomain))) {
      await this.processNotifications();
      return { status: 'candidate_unconfirmed' };
    }

    let identity;
    try {
      identity = await this.checkEmbyIdentity(
        candidateDomain,
        this.state.serverId,
        this.config,
        this.fetchImpl
      );
    } catch (error) {
      await this.reportCandidate(candidateDomain, errorReason(error));
      await this.processNotifications();
      return { status: 'candidate_unhealthy' };
    }

    const oldDomain = this.state.currentDomain;
    const event = relayChangedEvent(
      this.config,
      oldDomain,
      candidateDomain,
      identity.serverId,
      this.now()
    );
    await this.publish(event);
    this.state.currentDomain = candidateDomain;
    this.state.candidateAlertKey = null;
    this.state.lastChangeAt = isoNow(this.now());
    await this.save();
    await this.processNotifications();
    this.logger.info(`Relay domain committed: ${oldDomain} -> ${candidateDomain}`);
    return { status: 'changed', eventId: event.event_id };
  }
}

module.exports = { Monitor, errorReason, sleep };
