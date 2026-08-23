'use strict';

const { fetchWithTimeout } = require('../http');

function createWecomDriver(config, fetchImpl = fetch) {
  return {
    name: 'wecom',
    async deliver(event) {
      const response = await fetchWithTimeout(config.notification.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: { content: event.message }
        })
      }, config.requestTimeoutMs, fetchImpl);
      if (!response.ok) throw new Error(`WeCom returned HTTP ${response.status}`);

      const text = await response.text();
      if (!text) return;
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof result.errcode === 'number' && result.errcode !== 0) {
        throw new Error(`WeCom returned errcode ${result.errcode}`);
      }
    }
  };
}

module.exports = { createWecomDriver };
