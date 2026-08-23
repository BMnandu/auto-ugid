'use strict';

const { HttpError, fetchWithTimeout, readJson } = require('./http');

async function fetchRelayDomain(config, fetchImpl = fetch) {
  const response = await fetchWithTimeout(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'auto-ugid/2',
      lang: 'zh-CN'
    },
    body: JSON.stringify({ alias: config.alias })
  }, config.requestTimeoutMs, fetchImpl);

  if (!response.ok) {
    throw new HttpError(`UGLink API returned HTTP ${response.status}`, 'http_error', {
      status: response.status
    });
  }

  const body = await readJson(response);
  if (body?.code !== 200 || typeof body?.data?.relayDomain !== 'string') {
    throw new HttpError('UGLink API response did not contain relayDomain', 'invalid_api_response', {
      apiCode: body?.code
    });
  }
  return body.data.relayDomain.trim();
}

module.exports = { fetchRelayDomain };
