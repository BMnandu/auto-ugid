'use strict';

const { embyPublicInfoUrl } = require('./domain');
const { HttpError, fetchWithTimeout, readJson } = require('./http');

function validatePublicInfo(info) {
  return Boolean(
    info &&
    typeof info === 'object' &&
    typeof info.Id === 'string' && info.Id.length > 0 &&
    typeof info.ServerName === 'string' && info.ServerName.length > 0 &&
    typeof info.Version === 'string' && info.Version.length > 0
  );
}

async function checkEmbyIdentity(domain, expectedServerId, config, fetchImpl = fetch) {
  const response = await fetchWithTimeout(embyPublicInfoUrl(domain), {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'auto-ugid/2' }
  }, config.requestTimeoutMs, fetchImpl);

  if (!response.ok) {
    throw new HttpError(`Emby returned HTTP ${response.status}`, 'emby_http_error', {
      status: response.status
    });
  }
  const info = await readJson(response);
  if (!validatePublicInfo(info)) {
    throw new HttpError('Emby public info was missing required fields', 'invalid_emby_response');
  }
  if (expectedServerId && info.Id !== expectedServerId) {
    throw new HttpError('Emby Server ID did not match the baseline', 'server_id_mismatch');
  }
  return { serverId: info.Id, serverName: info.ServerName, version: info.Version };
}

module.exports = { checkEmbyIdentity, validatePublicInfo };
