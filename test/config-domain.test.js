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
  assert.equal(validateRelayDomain('cn59.ug.link', 'bmnd'), true);
  assert.equal(validateRelayDomain('bmnd.cn59.ug.link', 'bmnd'), true);
  assert.equal(normalizeRelayDomain('cn59.ug.link', 'bmnd'), 'bmnd.cn59.ug.link');
  assert.equal(normalizeRelayDomain('bmnd.cn59.ug.link', 'bmnd'), 'bmnd.cn59.ug.link');
  assert.equal(ugLinkUrl('bmnd.cn59.ug.link'), 'https://bmnd.cn59.ug.link');
  for (const value of [
    'evil.cn59.ug.link',
    'fakecn59.ug.link',
    'bmnd.cn.ug.link',
    'bmnd.cn59.ug.link.evil.test',
    'BMND.cn59.ug.link',
    'https://bmnd.cn59.ug.link',
    'cn59.evil.com'
  ]) assert.equal(validateRelayDomain(value, 'bmnd'), false, value);
  assert.equal(expectedDomainPattern('a-b').test('a-b.cn12.ug.link'), true);
});

test('configuration selects and validates the Hermes driver', () => {
  const config = loadConfig({
    HERMES_WEBHOOK_URL: 'http://127.0.0.1:8644/webhooks/test',
    HERMES_WEBHOOK_SECRET: 'secret'
  });
  assert.equal(config.notification.driver, 'hermes');
  assert.throws(() => loadConfig({ HERMES_WEBHOOK_URL: 'http://localhost/test' }), /SECRET/);
});

test('configuration auto-detects WeCom and supports an explicit generic driver', () => {
  const wecom = loadConfig({ WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test' });
  assert.equal(wecom.notification.driver, 'wecom');
  assert.equal(wecom.notification.usedCompatibilityUrl, true);

  const generic = loadConfig({
    NOTIFICATION_DRIVER: 'generic',
    GENERIC_WEBHOOK_URL: 'https://hooks.example.test/uglink',
    GENERIC_WEBHOOK_TOKEN: 'token'
  });
  assert.equal(generic.notification.driver, 'generic');
  assert.equal(generic.notification.token, 'token');
  assert.throws(() => loadConfig({ NOTIFICATION_DRIVER: 'email' }), /hermes, wecom, or generic/);
});
