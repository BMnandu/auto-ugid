'use strict';

const crypto = require('node:crypto');
const { beijingTime, isoNow } = require('./time');
const { embyBaseUrl } = require('./domain');

function stableEventId(type, alias, parts) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([type, alias, ...parts]))
    .digest('hex')
    .slice(0, 24);
  return `${type}-${digest}`;
}

function createEvent(config, type, fields = {}, options = {}) {
  const now = options.now ?? Date.now();
  const idParts = options.idParts || [isoNow(now)];
  const event = {
    event_id: stableEventId(type, config.alias, idParts),
    event_type: type,
    source: 'auto-ugid',
    alias: config.alias,
    occurred_at: isoNow(now),
    occurred_at_beijing: beijingTime(now),
    ...fields
  };
  event.message = messageFor(event);
  return event;
}

function messageFor(event) {
  switch (event.event_type) {
    case 'relay_changed':
      return `UGLink 域名已更新：${event.old_domain} → ${event.new_domain}\nEmby：${event.emby_url}\n时间：${event.occurred_at_beijing}`;
    case 'candidate_unhealthy':
      return `UGLink 候选域名未通过验证：${event.candidate_domain || '(无)'}\n原因：${event.reason}\n当前地址：${event.current_domain || '(尚未建立)'}\n时间：${event.occurred_at_beijing}`;
    case 'source_unavailable':
      return `UGLink 域名来源连续查询失败 ${event.failure_count} 次\n原因：${event.reason}\n时间：${event.occurred_at_beijing}`;
    case 'source_recovered':
      return `UGLink 域名来源已经恢复\n当前域名：${event.current_domain}\n时间：${event.occurred_at_beijing}`;
    default:
      return `${event.event_type} at ${event.occurred_at_beijing}`;
  }
}

function relayChangedEvent(config, oldDomain, newDomain, serverId, now = Date.now()) {
  return createEvent(config, 'relay_changed', {
    severity: 'info',
    old_domain: oldDomain,
    new_domain: newDomain,
    emby_url: embyBaseUrl(newDomain),
    server_id: serverId
  }, { now, idParts: [oldDomain, newDomain, serverId] });
}

function candidateUnhealthyEvent(config, currentDomain, candidateDomain, reason, now = Date.now()) {
  return createEvent(config, 'candidate_unhealthy', {
    severity: 'warning',
    current_domain: currentDomain,
    candidate_domain: candidateDomain,
    reason
  }, { now, idParts: [currentDomain, candidateDomain, reason] });
}

function sourceUnavailableEvent(config, failureCount, reason, episodeKey, now = Date.now()) {
  return createEvent(config, 'source_unavailable', {
    severity: 'warning', failure_count: failureCount, reason
  }, { now, idParts: [episodeKey] });
}

function sourceRecoveredEvent(config, currentDomain, unavailableEventId, now = Date.now()) {
  return createEvent(config, 'source_recovered', {
    severity: 'info', current_domain: currentDomain
  }, { now, idParts: [unavailableEventId] });
}

module.exports = {
  candidateUnhealthyEvent,
  createEvent,
  relayChangedEvent,
  sourceRecoveredEvent,
  sourceUnavailableEvent,
  stableEventId
};
