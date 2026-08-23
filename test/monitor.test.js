'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { HttpError } = require('../src/http');
const { Monitor } = require('../src/monitor');
const { loadPending, loadState } = require('../src/storage');
const { silentLogger, testConfig } = require('./helpers');

function captureDriver(delivered) {
  return { name: 'capture', async deliver(event) { delivered.push(event); } };
}

test('first run confirms and stores a full hostname without notifying', async () => {
  const config = await testConfig();
  const domains = ['cn59.ug.link', 'cn59.ug.link'];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    notificationDriver: captureDriver([]),
    sleep: async () => {},
    now: () => 1700000000000
  });
  assert.equal((await monitor.checkOnce()).status, 'baseline_established');
  const state = (await loadState(config, silentLogger())).state;
  assert.equal(state.version, 2);
  assert.equal(state.currentDomain, 'bmnd.cn59.ug.link');
  assert.equal('serverId' in state, false);
  assert.equal((await loadPending(config)).length, 0);
});

test('a confirmed change commits a full hostname and sends a generic event', async () => {
  const config = await testConfig();
  const domains = [
    'cn59.ug.link', 'bmnd.cn59.ug.link',
    'cn60.ug.link', 'bmnd.cn60.ug.link'
  ];
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    notificationDriver: captureDriver(delivered),
    sleep: async () => {},
    now: () => 1700000000000
  });
  await monitor.checkOnce();
  const result = await monitor.checkOnce();
  assert.equal(result.status, 'changed');
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn60.ug.link');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].event_type, 'relay_changed');
  assert.equal(delivered[0].old_url, 'https://bmnd.cn59.ug.link');
  assert.equal(delivered[0].new_url, 'https://bmnd.cn60.ug.link');
  assert.doesNotMatch(delivered[0].message, /Emby/);
});

test('different raw forms normalize to the same candidate during confirmation', async () => {
  const config = await testConfig();
  const domains = ['cn59.ug.link', 'bmnd.cn59.ug.link'];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    notificationDriver: captureDriver([]),
    sleep: async () => {}
  });
  assert.equal((await monitor.checkOnce()).status, 'baseline_established');
});

test('an inconsistent candidate is discarded without changing state', async () => {
  const config = await testConfig();
  const domains = [
    'cn59.ug.link', 'cn59.ug.link',
    'cn60.ug.link', 'cn61.ug.link'
  ];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => domains.shift(),
    notificationDriver: captureDriver([]),
    sleep: async () => {}
  });
  await monitor.checkOnce();
  assert.equal((await monitor.checkOnce()).status, 'candidate_unconfirmed');
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn59.ug.link');
  assert.match(await fs.readFile(config.eventsFile, 'utf8'), /confirmation_mismatch/);
});

test('an invalid domain is audited but not committed or notified', async () => {
  const config = await testConfig();
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => 'fakecn59.ug.link',
    notificationDriver: captureDriver(delivered)
  });
  assert.equal((await monitor.checkOnce()).status, 'invalid_domain');
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, null);
  assert.equal(delivered.length, 0);
  assert.match(await fs.readFile(config.eventsFile, 'utf8'), /invalid_domain/);
});

test('source failure alerts once and emits one recovery event', async () => {
  const config = await testConfig({ sourceFailureThreshold: 2 });
  const responses = [
    new HttpError('down', 'timeout'),
    new HttpError('down', 'timeout'),
    new HttpError('down', 'timeout'),
    'cn59.ug.link',
    'cn59.ug.link'
  ];
  const delivered = [];
  const monitor = new Monitor(config, {
    logger: silentLogger(),
    fetchRelayDomain: async () => {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value;
    },
    notificationDriver: captureDriver(delivered),
    sleep: async () => {}
  });
  await monitor.checkOnce();
  await monitor.checkOnce();
  await monitor.checkOnce();
  await monitor.checkOnce();
  assert.equal(delivered.filter((event) => event.event_type === 'source_unavailable').length, 1);
  assert.equal(delivered.filter((event) => event.event_type === 'source_recovered').length, 1);
});
