'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { waitUntilNextCheck } = require('../src/index');

test('the interval wait can be interrupted for graceful shutdown', async () => {
  let wake;
  const waiting = waitUntilNextCheck(60000, (value) => { wake = value; });
  assert.equal(typeof wake, 'function');
  wake();
  await waiting;
  assert.equal(wake, null);
});
