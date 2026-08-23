'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchRelayDomain } = require('../src/uglink');
const { testConfig } = require('./helpers');

test('UGLink client parses a valid response', async () => {
  const config = await testConfig();
  const domain = await fetchRelayDomain(config, async (url, options) => {
    assert.equal(url, config.apiUrl);
    assert.deepEqual(JSON.parse(options.body), { alias: 'bmnd' });
    return new Response(JSON.stringify({ code: 200, data: { relayDomain: ' cn59.ug.link ' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  });
  assert.equal(domain, 'cn59.ug.link');
});

test('UGLink client rejects errors, non-JSON, and missing data', async () => {
  const config = await testConfig();
  await assert.rejects(fetchRelayDomain(config, async () => new Response('down', { status: 503 })), /HTTP 503/);
  await assert.rejects(fetchRelayDomain(config, async () => new Response('not-json')), /valid JSON/);
  await assert.rejects(fetchRelayDomain(config, async () => new Response(JSON.stringify({ code: 200 }))), /relayDomain/);
});
