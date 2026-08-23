'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createGenericDriver, genericPayload } = require('../src/notifiers/generic');
const { createHermesDriver, signHermesV2 } = require('../src/notifiers/hermes');
const { createWecomDriver } = require('../src/notifiers/wecom');
const { testConfig } = require('./helpers');

const event = {
  event_id: 'relay_changed-1',
  event_type: 'relay_changed',
  message: 'UGLink 域名已更新',
  old_domain: 'test-alias.cn58.ug.link',
  new_domain: 'test-alias.cn59.ug.link'
};

test('Hermes driver signs the exact structured event with HMAC V2', async () => {
  const config = await testConfig();
  await createHermesDriver(config, async (url, options) => {
    const timestamp = '1700000000';
    assert.equal(url, config.notification.url);
    assert.equal(options.headers['X-Request-ID'], event.event_id);
    assert.equal(options.headers['X-Webhook-Timestamp'], timestamp);
    const expected = crypto.createHmac('sha256', 'test-secret')
      .update(`${timestamp}.${options.body}`).digest('hex');
    assert.equal(options.headers['X-Webhook-Signature-V2'], expected);
    assert.deepEqual(JSON.parse(options.body), event);
    return new Response('{}', { status: 200 });
  }).deliver(event, 1700000000000);
  assert.equal(signHermesV2('secret', '1', '{}'), (
    crypto.createHmac('sha256', 'secret').update('1.{}').digest('hex')
  ));
});

test('WeCom driver sends the native text robot payload', async () => {
  const config = await testConfig({
    notification: { driver: 'wecom', url: 'https://qyapi.weixin.qq.com/test' }
  });
  await createWecomDriver(config, async (url, options) => {
    assert.equal(url, config.notification.url);
    assert.deepEqual(JSON.parse(options.body), {
      msgtype: 'text', text: { content: event.message }
    });
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
  }).deliver(event);
});

test('WeCom driver rejects a non-zero robot errcode', async () => {
  const config = await testConfig({
    notification: { driver: 'wecom', url: 'https://qyapi.weixin.qq.com/test' }
  });
  await assert.rejects(createWecomDriver(config, async () => (
    new Response(JSON.stringify({ errcode: 40013 }), { status: 200 })
  )).deliver(event), /errcode 40013/);
});

test('generic driver sends a standard JSON payload and optional Bearer token', async () => {
  const config = await testConfig({
    notification: {
      driver: 'generic',
      url: 'https://hooks.example.test/uglink',
      token: 'generic-token'
    }
  });
  assert.deepEqual(genericPayload(event), {
    event: 'relay_changed',
    message: event.message,
    data: {
      event_id: event.event_id,
      old_domain: event.old_domain,
      new_domain: event.new_domain
    }
  });
  await createGenericDriver(config, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer generic-token');
    assert.deepEqual(JSON.parse(options.body), genericPayload(event));
    return new Response(null, { status: 204 });
  }).deliver(event);
});
