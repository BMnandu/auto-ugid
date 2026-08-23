'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { enqueue, processPending } = require('../src/notifier');
const { atomicWriteJson, loadPending, loadState, saveState } = require('../src/storage');
const { silentLogger, testConfig } = require('./helpers');

test('pending notifications are deduplicated and retried with a cap', async () => {
  const config = await testConfig({ notificationMaxAttempts: 2 });
  const payload = { event_id: 'evt-1', event_type: 'test', message: 'test' };
  assert.equal(await enqueue(config, payload, silentLogger(), 1700000000000), true);
  assert.equal(await enqueue(config, payload, silentLogger(), 1700000000000), false);
  let now = 1700000000000;
  const driver = { name: 'failing', async deliver() { throw new Error('down'); } };
  await processPending(config, { logger: silentLogger(), driver, now: () => now });
  assert.equal((await loadPending(config)).length, 1);
  now += 1000;
  await processPending(config, { logger: silentLogger(), driver, now: () => now });
  assert.equal((await loadPending(config)).length, 0);
  assert.match(await fs.readFile(config.eventsFile, 'utf8'), /notification_failed/);
});

test('version 1 state migrates to version 2 and removes Emby fields', async () => {
  const config = await testConfig();
  await fs.writeFile(config.stateFile, JSON.stringify({
    version: 1,
    currentDomain: 'cn59.ug.link',
    serverId: 'old-emby-id',
    candidateAlertKey: 'old-key',
    consecutiveSourceFailures: 2,
    sourceAlertSent: true,
    sourceAlertEventId: 'source-event',
    lastSuccessfulCheckAt: '2026-08-23T00:00:00.000Z',
    lastChangeAt: '2026-08-22T00:00:00.000Z'
  }));
  const loaded = await loadState(config, silentLogger());
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.state.version, 2);
  assert.equal(loaded.state.currentDomain, 'test-alias.cn59.ug.link');
  assert.equal('serverId' in loaded.state, false);
  assert.equal('candidateAlertKey' in loaded.state, false);
  assert.deepEqual(JSON.parse(await fs.readFile(config.stateFile, 'utf8')), loaded.state);
});

test('version 2 state round-trips and corrupt state is preserved', async () => {
  const config = await testConfig();
  const first = await loadState(config, silentLogger());
  first.state.currentDomain = 'test-alias.cn59.ug.link';
  await saveState(config, first.state);
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'test-alias.cn59.ug.link');

  await fs.writeFile(config.stateFile, '{broken', 'utf8');
  const recovered = await loadState(config, silentLogger(), 1700000000000);
  assert.equal(recovered.state.currentDomain, null);
  assert.match(recovered.corruptBackup, /\.corrupt-/);
  assert.equal(await fs.readFile(recovered.corruptBackup, 'utf8'), '{broken');
});

test('legacy text domain imports as a full hostname', async () => {
  const config = await testConfig();
  await fs.writeFile(config.legacyDomainFile, 'cn61.ug.link\n');
  const loaded = await loadState(config, silentLogger());
  assert.equal(loaded.state.currentDomain, 'test-alias.cn61.ug.link');
});

test('atomic JSON helper leaves complete JSON', async () => {
  const config = await testConfig();
  await atomicWriteJson(config.pendingFile, [{ eventId: 'one' }]);
  assert.deepEqual(JSON.parse(await fs.readFile(config.pendingFile, 'utf8')), [{ eventId: 'one' }]);
});
