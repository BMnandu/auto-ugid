'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkEmbyIdentity } = require('../src/emby');
const { fetchRelayDomain } = require('../src/uglink');
const { testConfig } = require('./helpers');

test('UGLink client parses a valid response', async () => {
  const config = await testConfig();
  const domain = await fetchRelayDomain(config, async (url, options) => {
    assert.equal(url, config.apiUrl);
    assert.deepEqual(JSON.parse(options.body), { alias: 'bmnd' });
    return new Response(JSON.stringify({ code: 200, data: { relayDomain: ' bmnd.cn59.ug.link ' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  });
  assert.equal(domain, 'bmnd.cn59.ug.link');
});

test('UGLink client rejects errors, non-JSON, and missing data', async () => {
  const config = await testConfig();
  await assert.rejects(fetchRelayDomain(config, async () => new Response('down', { status: 503 })), /HTTP 503/);
  await assert.rejects(fetchRelayDomain(config, async () => new Response('not-json')), /valid JSON/);
  await assert.rejects(fetchRelayDomain(config, async () => new Response(JSON.stringify({ code: 200 }))), /relayDomain/);
});

test('Emby health check validates public fields and Server ID', async () => {
  const config = await testConfig();
  const fetchImpl = async (url) => {
    assert.match(url, /\/emby\/System\/Info\/Public$/);
    return new Response(JSON.stringify({ Id: 'server-1', ServerName: 'Home', Version: '4.9.0' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  assert.equal((await checkEmbyIdentity('bmnd.cn59.ug.link', 'server-1', config, fetchImpl)).serverId, 'server-1');
  await assert.rejects(checkEmbyIdentity('bmnd.cn59.ug.link', 'server-2', config, fetchImpl), (error) => {
    assert.equal(error.code, 'server_id_mismatch');
    return true;
  });
  await assert.rejects(checkEmbyIdentity('bmnd.cn59.ug.link', null, config, async () => (
    new Response(JSON.stringify({ Id: 'server-1' }))
  )), /required fields/);
});
