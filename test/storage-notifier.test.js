'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const test = require('node:test');
const { deliver, enqueue, processPending, signHermesV2 } = require('../src/notifier');
const { atomicWriteJson, loadPending, loadState, saveState } = require('../src/storage');
const { silentLogger, testConfig } = require('./helpers');

test('Hermes V2 signature matches the official timestamp.body format', () => {
  const body = '{"event_id":"evt-1"}';
  const expected = crypto.createHmac('sha256', 'secret').update(`1700000000.${body}`).digest('hex');
  assert.equal(signHermesV2('secret', '1700000000', body), expected);
});

test('delivery sends V2 headers and a stable request ID', async () => {
  const config = await testConfig();
  const payload = { event_id: 'evt-1', event_type: 'relay_changed' };
  await deliver(config, payload, async (url, options) => {
    assert.equal(url, config.webhookUrl);
    assert.equal(options.headers['X-Request-ID'], 'evt-1');
    assert.equal(options.headers['X-Webhook-Timestamp'], '1700000000');
    assert.equal(
      options.headers['X-Webhook-Signature-V2'],
      signHermesV2(config.webhookSecret, '1700000000', options.body)
    );
    return new Response('{}', { status: 200 });
  }, 1700000000000);
});

test('pending notifications are deduplicated and retried with a cap', async () => {
  const config = await testConfig({ notificationMaxAttempts: 2 });
  const payload = { event_id: 'evt-1', event_type: 'test' };
  assert.equal(await enqueue(config, payload, silentLogger(), 1700000000000), true);
  assert.equal(await enqueue(config, payload, silentLogger(), 1700000000000), false);
  let now = 1700000000000;
  const failingFetch = async () => new Response('bad', { status: 503 });
  await processPending(config, { logger: silentLogger(), fetchImpl: failingFetch, now: () => now });
  assert.equal((await loadPending(config)).length, 1);
  now += 1000;
  await processPending(config, { logger: silentLogger(), fetchImpl: failingFetch, now: () => now });
  assert.equal((await loadPending(config)).length, 0);
  assert.match(await fs.readFile(config.eventsFile, 'utf8'), /notification_failed/);
});

test('state writes round-trip and corrupt state is preserved', async () => {
  const config = await testConfig();
  const first = await loadState(config, silentLogger());
  first.state.currentDomain = 'bmnd.cn59.ug.link';
  await saveState(config, first.state);
  assert.equal((await loadState(config, silentLogger())).state.currentDomain, 'bmnd.cn59.ug.link');

  await fs.writeFile(config.stateFile, '{broken', 'utf8');
  const recovered = await loadState(config, silentLogger(), 1700000000000);
  assert.equal(recovered.state.currentDomain, null);
  assert.match(recovered.corruptBackup, /\.corrupt-/);
  assert.equal(await fs.readFile(recovered.corruptBackup, 'utf8'), '{broken');
});

test('atomic JSON helper leaves complete JSON', async () => {
  const config = await testConfig();
  await atomicWriteJson(config.pendingFile, [{ eventId: 'one' }]);
  assert.deepEqual(JSON.parse(await fs.readFile(config.pendingFile, 'utf8')), [{ eventId: 'one' }]);
});
