'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../src/config');
const { expectedDomainPattern, validateRelayDomain } = require('../src/domain');

test('strict domain validation only accepts alias.cn<digits>.ug.link', () => {
  assert.equal(validateRelayDomain('bmnd.cn59.ug.link', 'bmnd'), true);
  assert.equal(validateRelayDomain('bmnd.cn0.ug.link', 'bmnd'), true);
  for (const value of [
    'evil.cn59.ug.link',
    'bmnd.cn.ug.link',
    'bmnd.cn59.ug.link.evil.test',
    'BMND.cn59.ug.link',
    'bmnd.cn59xug.link',
    'https://bmnd.cn59.ug.link'
  ]) assert.equal(validateRelayDomain(value, 'bmnd'), false, value);
  assert.equal(expectedDomainPattern('a-b').test('a-b.cn12.ug.link'), true);
});

test('configuration validates required secrets and ranges', () => {
  const config = loadConfig({
    HERMES_WEBHOOK_URL: 'http://127.0.0.1:8644/webhooks/test',
    HERMES_WEBHOOK_SECRET: 'secret',
    CHECK_INTERVAL: '300'
  });
  assert.equal(config.alias, 'bmnd');
  assert.equal(config.intervalMs, 300000);
  assert.throws(() => loadConfig({}), /HERMES_WEBHOOK_URL/);
  assert.throws(() => loadConfig({
    HERMES_WEBHOOK_URL: 'http://localhost/test', HERMES_WEBHOOK_SECRET: 'x', UG_ID: '../bad'
  }), /DNS label/);
  assert.throws(() => loadConfig({
    HERMES_WEBHOOK_URL: 'http://localhost/test', HERMES_WEBHOOK_SECRET: 'x', CHECK_INTERVAL: '5'
  }), /between/);
});
