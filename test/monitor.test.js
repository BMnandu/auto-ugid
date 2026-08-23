'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { HttpError } = require('../src/http');
const { Monitor } = require('../src/monitor');
const { loadPending, loadState } = require('../src/storage');
const { silentLogger, testConfig } = require('./helpers');

function identity(serverId = 'server-1') {
  return { serverId, serverName: 'Home', version: '4.9.0' };
}

test('first run establishes a healthy baseline without notifying', async () => {
  const config = await testConfig();
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => 'bmnd.cn59.ug.link',
    checkEmbyIdentity: async () => identity(),
    fetchImpl: async () => { throw new Error('notification should not be sent'); },
    now: () => 1700000000000
  });
  assert.equal((await monitor.checkOnce()).status, 'baseline_established');
  const state = (await loadState(config, silentLogger())).state;
  assert.equal(state.currentDomain, 'bmnd.cn59.ug.link');
  assert.equal(state.serverId, 'server-1');
  assert.equal((await loadPending(config)).length, 0);
});

test('a confirmed healthy domain change commits and sends one event', async () => {
  const config = await testConfig();
  const domains = ['bmnd.cn59.ug.link', 'bmnd.cn60.ug.link', 'bmnd.cn60.ug.link'];
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    checkEmbyIdentity: async () => identity(),
    fetchImpl: async (url, options) => {
      delivered.push(JSON.parse(options.body));
      return new Response('{}', { status: 200 });
    },
    sleep: async () => {},
    now: () => 1700000000000
  });
  await monitor.checkOnce();
  const result = await monitor.checkOnce();
  assert.equal(result.status, 'changed');
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn60.ug.link');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].event_type, 'relay_changed');
  assert.equal(delivered[0].emby_url, 'https://bmnd.cn60.ug.link/emby/');
});

test('an inconsistent candidate is discarded without changing state', async () => {
  const config = await testConfig();
  const domains = ['bmnd.cn59.ug.link', 'bmnd.cn60.ug.link', 'bmnd.cn61.ug.link'];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    checkEmbyIdentity: async () => identity(),
    fetchImpl: async () => new Response('{}', { status: 200 }),
    sleep: async () => {}
  });
  await monitor.checkOnce();
  assert.equal((await monitor.checkOnce()).status, 'candidate_unconfirmed');
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn59.ug.link');
  assert.match(await fs.readFile(config.eventsFile, 'utf8'), /candidate_discarded/);
});

test('a mismatched Emby identity alerts once and never commits', async () => {
  const config = await testConfig();
  const domains = ['bmnd.cn59.ug.link', 'bmnd.cn60.ug.link', 'bmnd.cn60.ug.link', 'bmnd.cn60.ug.link', 'bmnd.cn60.ug.link'];
  let checks = 0;
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    checkEmbyIdentity: async (domain, expected) => {
      checks += 1;
      if (expected) throw new HttpError('mismatch', 'server_id_mismatch');
      return identity();
    },
    fetchImpl: async (url, options) => {
      delivered.push(JSON.parse(options.body));
      return new Response('{}', { status: 200 });
    },
    sleep: async () => {}
  });
  await monitor.checkOnce();
  await monitor.checkOnce();
  await monitor.checkOnce();
  assert.ok(checks >= 3);
  assert.equal(delivered.filter((event) => event.event_type === 'candidate_unhealthy').length, 1);
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn59.ug.link');
});

test('source failure alerts once and emits one recovery event', async () => {
  const config = await testConfig({ sourceFailureThreshold: 2 });
  const responses = [
    new HttpError('down', 'timeout'),
    new HttpError('down', 'timeout'),
    new HttpError('down', 'timeout'),
    'bmnd.cn59.ug.link'
  ];
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value;
    },
    checkEmbyIdentity: async () => identity(),
    fetchImpl: async (url, options) => {
      delivered.push(JSON.parse(options.body));
      return new Response('{}', { status: 200 });
    }
  });
  await monitor.checkOnce();
  await monitor.checkOnce();
  await monitor.checkOnce();
  await monitor.checkOnce();
  assert.equal(delivered.filter((event) => event.event_type === 'source_unavailable').length, 1);
  assert.equal(delivered.filter((event) => event.event_type === 'source_recovered').length, 1);
});
