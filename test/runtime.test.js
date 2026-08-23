'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { HELP, waitUntilNextCheck } = require('../src/index');

test('help documents the required alias', () => {
  const aliasLine = HELP.split(String.fromCharCode(10)).find((line) => line.trimStart().startsWith('UG_ID'));
  assert.equal(aliasLine.trim(), 'UG_ID                   UGLink alias（必填，兼容 UGID）');
});

test('the interval wait can be interrupted for graceful shutdown', async () => {
  let wake;
  const waiting = waitUntilNextCheck(60000, (value) => { wake = value; });
  assert.equal(typeof wake, 'function');
  wake();
  await waiting;
  assert.equal(wake, null);
});
