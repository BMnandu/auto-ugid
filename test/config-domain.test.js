'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../src/config');
const {
  expectedDomainPattern,
  normalizeRelayDomain,
  ugLinkUrl,
  validateRelayDomain
} = require('../src/domain');

test('domain validation accepts optional alias and normalizes to a full hostname', () => {
  assert.equal(validateRelayDomain('cn59.ug.link', 'test-alias'), true);
  assert.equal(validateRelayDomain('test-alias.cn59.ug.link', 'test-alias'), true);
  assert.equal(normalizeRelayDomain('cn59.ug.link', 'test-alias'), 'test-alias.cn59.ug.link');
  assert.equal(normalizeRelayDomain('test-alias.cn59.ug.link', 'test-alias'), 'test-alias.cn59.ug.link');
  assert.equal(ugLinkUrl('test-alias.cn59.ug.link'), 'https://test-alias.cn59.ug.link');
  for (const value of [
    'evil.cn59.ug.link',
    'fakecn59.ug.link',
    'test-alias.cn.ug.link',
    'test-alias.cn59.ug.link.evil.test',
    'TEST-ALIAS.cn59.ug.link',
    'https://test-alias.cn59.ug.link',
    'cn59.evil.com'
  ]) assert.equal(validateRelayDomain(value, 'test-alias'), false, value);
  assert.equal(expectedDomainPattern('a-b').test('a-b.cn12.ug.link'), true);
});

test('configuration requires an explicit UGLink alias', () => {
  assert.throws(() => loadConfig({}), /UG_ID is required/);
  assert.throws(() => loadConfig({ UG_ID: '   ' }), /UG_ID is required/);
  assert.throws(() => loadConfig({
    UG_ID: 'Invalid-Alias',
    NOTIFICATION_DRIVER: 'generic',
    GENERIC_WEBHOOK_URL: 'https://hooks.example.test/uglink'
  }), /lowercase DNS label/);
  const config = loadConfig({
    UGID: 'demo',
    NOTIFICATION_DRIVER: 'generic',
    GENERIC_WEBHOOK_URL: 'https://hooks.example.test/uglink'
  });
  assert.equal(config.alias, 'demo');
});

test('configuration selects and validates the Hermes driver', () => {
  const config = loadConfig({
    UG_ID: 'test-alias',
    HERMES_WEBHOOK_URL: 'http://127.0.0.1:8644/webhooks/test',
    HERMES_WEBHOOK_SECRET: 'secret'
  });
  assert.equal(config.notification.driver, 'hermes');
  assert.throws(() => loadConfig({ UG_ID: 'test-alias', HERMES_WEBHOOK_URL: 'http://localhost/test' }), /SECRET/);
});

test('configuration auto-detects WeCom and supports an explicit generic driver', () => {
  const wecom = loadConfig({ UG_ID: 'test-alias', WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test' });
  assert.equal(wecom.notification.driver, 'wecom');
  assert.equal(wecom.notification.usedCompatibilityUrl, true);

  const generic = loadConfig({
    UG_ID: 'test-alias',
    NOTIFICATION_DRIVER: 'generic',
    GENERIC_WEBHOOK_URL: 'https://hooks.example.test/uglink',
    GENERIC_WEBHOOK_TOKEN: 'token'
  });
  assert.equal(generic.notification.driver, 'generic');
  assert.equal(generic.notification.token, 'token');
  assert.throws(() => loadConfig({ UG_ID: 'test-alias', NOTIFICATION_DRIVER: 'email' }), /hermes, wecom, or generic/);
});
