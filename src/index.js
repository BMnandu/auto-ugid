#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./config');
const { Monitor } = require('./monitor');

const HELP = `auto-ugid - 通用 UGLink 中继域名监控器

用法：
  node src/index.js [--once]
  node src/index.js --help

选项：
  --once   执行一次检查后退出
  --help   显示帮助，不读取配置

通知驱动：
  NOTIFICATION_DRIVER     hermes、wecom 或 generic

常用环境变量：
  UG_ID                   UGLink alias（必填，兼容 UGID）
  CHECK_INTERVAL          检查周期秒数（默认：600）
  CONFIRMATION_DELAY      二次确认等待秒数（默认：20）
  STATE_DIR               持久化目录（默认：/data）

驱动配置详见 README.md。
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
