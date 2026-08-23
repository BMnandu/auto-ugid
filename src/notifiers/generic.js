'use strict';

const { fetchWithTimeout } = require('../http');

function genericPayload(event) {
  const { event_type: eventType, message, ...data } = event;
  return { event: eventType, message, data };
}

function createGenericDriver(config, fetchImpl = fetch) {
  return {
    name: 'generic',
    async deliver(event) {
      const headers = { 'Content-Type': 'application/json' };
      if (config.notification.token) {
        headers.Authorization = `Bearer ${config.notification.token}`;
      }
      const response = await fetchWithTimeout(config.notification.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(genericPayload(event))
      }, config.requestTimeoutMs, fetchImpl);
      if (!response.ok) throw new Error(`Generic webhook returned HTTP ${response.status}`);
    }
  };
}

module.exports = { createGenericDriver, genericPayload };
