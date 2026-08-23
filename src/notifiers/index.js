'use strict';

const { createGenericDriver } = require('./generic');
const { createHermesDriver } = require('./hermes');
const { createWecomDriver } = require('./wecom');

function createNotificationDriver(config, fetchImpl = fetch) {
  switch (config.notification.driver) {
    case 'hermes': return createHermesDriver(config, fetchImpl);
    case 'wecom': return createWecomDriver(config, fetchImpl);
    case 'generic': return createGenericDriver(config, fetchImpl);
    default: throw new Error(`Unsupported notification driver: ${config.notification.driver}`);
  }
}

module.exports = { createNotificationDriver };
