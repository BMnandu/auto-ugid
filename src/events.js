'use strict';

const crypto = require('node:crypto');
const { ugLinkUrl } = require('./domain');
const { beijingTime, isoNow } = require('./time');

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
      return `UGLink 域名已更新：\n旧地址：${event.old_url || '（首次运行）'}\n新地址：${event.new_url}\n时间：${event.occurred_at_beijing}`;
    case 'source_unavailable':
      return `UGLink 域名来源连续查询失败 ${event.failure_count} 次\n原因：${event.reason}\n时间：${event.occurred_at_beijing}`;
    case 'source_recovered':
      return `UGLink 域名来源已经恢复\n当前地址：${event.current_url || '（尚未建立）'}\n时间：${event.occurred_at_beijing}`;
    default:
      return `${event.event_type} at ${event.occurred_at_beijing}`;
  }
}

function relayChangedEvent(config, oldDomain, newDomain, now = Date.now()) {
  return createEvent(config, 'relay_changed', {
    severity: 'info',
    old_domain: oldDomain,
    new_domain: newDomain,
    old_url: oldDomain ? ugLinkUrl(oldDomain) : null,
    new_url: ugLinkUrl(newDomain)
  }, { now, idParts: [oldDomain, newDomain] });
}

function sourceUnavailableEvent(config, failureCount, reason, episodeKey, now = Date.now()) {
  return createEvent(config, 'source_unavailable', {
    severity: 'warning', failure_count: failureCount, reason
  }, { now, idParts: [episodeKey] });
}

function sourceRecoveredEvent(config, currentDomain, unavailableEventId, now = Date.now()) {
  return createEvent(config, 'source_recovered', {
    severity: 'info',
    current_domain: currentDomain,
    current_url: currentDomain ? ugLinkUrl(currentDomain) : null
  }, { now, idParts: [unavailableEventId] });
}

module.exports = {
  createEvent,
  relayChangedEvent,
  sourceRecoveredEvent,
  sourceUnavailableEvent,
  stableEventId
};
