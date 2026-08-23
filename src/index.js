#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./config');
const { Monitor } = require('./monitor');

const HELP = `auto-ugid - monitor a UGLink relay domain

Usage:
  node src/index.js [--once]
  node src/index.js --help

Options:
  --once   Run one check and exit
  --help   Show this help without reading configuration

Required environment:
  HERMES_WEBHOOK_URL       Hermes /webhooks/<route> URL
  HERMES_WEBHOOK_SECRET    Per-route HMAC secret

Common environment:
  UG_ID                    UGLink alias (default: bmnd)
  CHECK_INTERVAL           Seconds between checks (default: 600)
  CONFIRMATION_DELAY       Seconds before confirming a change (default: 20)
  STATE_DIR                Persistent state directory (default: /data)
`;

function waitUntilNextCheck(ms, registerWake) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      registerWake(null);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    registerWake(finish);
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  const unknown = argv.filter((arg) => arg !== '--once');
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);

  const config = loadConfig();
  const monitor = new Monitor(config);
  await monitor.initialize();

  if (argv.includes('--once')) {
    await monitor.checkOnce();
    return;
  }

  let stopping = false;
  let wake = null;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    const started = Date.now();
    try {
      await monitor.checkOnce();
    } catch (error) {
      console.error(`Unexpected monitor error: ${error.message}`);
    }
    const remaining = Math.max(0, config.intervalMs - (Date.now() - started));
    if (!stopping) {
      await waitUntilNextCheck(remaining, (nextWake) => { wake = nextWake; });
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Fatal configuration or startup error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { HELP, main, waitUntilNextCheck };
