'use strict';

const crypto = require('node:crypto');
const { fetchWithTimeout } = require('../http');

function signHermesV2(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

function createHermesDriver(config, fetchImpl = fetch) {
  return {
    name: 'hermes',
    async deliver(event, now = Date.now()) {
      const body = JSON.stringify(event);
      const timestamp = String(Math.floor(now / 1000));
      const response = await fetchWithTimeout(config.notification.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature-V2': signHermesV2(
            config.notification.secret,
            timestamp,
            body
          ),
          'X-Request-ID': event.event_id
        },
        body
      }, config.requestTimeoutMs, fetchImpl);
      if (!response.ok) throw new Error(`Hermes returned HTTP ${response.status}`);
    }
  };
}

module.exports = { createHermesDriver, signHermesV2 };
