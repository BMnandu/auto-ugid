'use strict';

// Compatibility entry point for deployments that still invoke monitor.js.
const { main } = require('./src/index');

main().catch((error) => {
  console.error(`Fatal configuration or startup error: ${error.message}`);
  process.exitCode = 1;
});
