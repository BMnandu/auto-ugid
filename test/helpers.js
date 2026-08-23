'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function testConfig(overrides = {}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-ugid-test-'));
  return {
    alias: 'bmnd',
    apiUrl: 'https://api.example.test/relay',
    notification: {
      driver: 'hermes',
      url: 'https://hermes.example.test/webhooks/uglink-status',
      secret: 'test-secret',
      usedCompatibilityUrl: false
    },
    stateDir,
    stateFile: path.join(stateDir, 'state.json'),
    eventsFile: path.join(stateDir, 'events.jsonl'),
    pendingFile: path.join(stateDir, 'pending-notifications.json'),
    legacyDomainFile: path.join(stateDir, 'legacy-missing.txt'),
    intervalMs: 600000,
    confirmationDelayMs: 0,
    requestTimeoutMs: 1000,
    sourceFailureThreshold: 2,
    notificationMaxAttempts: 3,
    notificationBackoffMs: 1000,
    notifyOnFirstRun: false,
    ...overrides
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

module.exports = { silentLogger, testConfig };
