'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeRelayDomain } = require('./domain');
const { isoNow } = require('./time');

const STATE_VERSION = 2;

function defaultState() {
  return {
    version: STATE_VERSION,
    currentDomain: null,
    consecutiveSourceFailures: 0,
    sourceAlertSent: false,
    sourceAlertEventId: null,
    lastSuccessfulCheckAt: null,
    lastChangeAt: null
  };
}

function normalizeCurrentDomain(value, alias) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeRelayDomain(value, alias);
}

function normalizeState(value, alias) {
  if (!value || typeof value !== 'object' || ![1, STATE_VERSION].includes(value.version)) {
    throw new Error('unsupported or missing state version');
  }
  return {
    ...defaultState(),
    currentDomain: normalizeCurrentDomain(value.currentDomain, alias),
    consecutiveSourceFailures: Number.isInteger(value.consecutiveSourceFailures)
      ? Math.max(0, value.consecutiveSourceFailures) : 0,
    sourceAlertSent: value.sourceAlertSent === true,
    sourceAlertEventId: typeof value.sourceAlertEventId === 'string'
      ? value.sourceAlertEventId : null,
    lastSuccessfulCheckAt: typeof value.lastSuccessfulCheckAt === 'string'
      ? value.lastSuccessfulCheckAt : null,
    lastChangeAt: typeof value.lastChangeAt === 'string' ? value.lastChangeAt : null,
    version: STATE_VERSION
  };
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicWriteJson(file, value) {
  await ensureDirectory(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
  await syncDirectory(path.dirname(file));
}

async function preserveCorruptFile(file, now = Date.now()) {
  const suffix = new Date(now).toISOString().replace(/[:.]/g, '-');
  const destination = `${file}.corrupt-${suffix}`;
  await fs.rename(file, destination);
  return destination;
}

async function readExistingState(config) {
  try {
    return await fs.readFile(config.stateFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadState(config, logger = console, now = Date.now()) {
  await ensureDirectory(config.stateDir);
  const raw = await readExistingState(config);
  if (raw !== null) {
    let parsed;
    let state;
    try {
      parsed = JSON.parse(raw);
      state = normalizeState(parsed, config.alias);
    } catch {
      const backup = await preserveCorruptFile(config.stateFile, now);
      logger.error(`State file was invalid and preserved as ${path.basename(backup)}`);
      return { state: defaultState(), migrated: false, corruptBackup: backup };
    }
    const migrated = parsed.version !== STATE_VERSION;
    if (migrated) {
      await atomicWriteJson(config.stateFile, state);
      logger.info('Migrated state.json from version 1 to version 2');
    }
    return { state, migrated, corruptBackup: null };
  }

  try {
    const legacyDomain = (await fs.readFile(config.legacyDomainFile, 'utf8')).trim();
    if (legacyDomain) {
      const state = {
        ...defaultState(),
        currentDomain: normalizeRelayDomain(legacyDomain, config.alias)
      };
      await atomicWriteJson(config.stateFile, state);
      logger.info('Imported the legacy domain baseline');
      return { state, migrated: true, corruptBackup: null };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { state: defaultState(), migrated: false, corruptBackup: null };
}

async function saveState(config, state) {
  await atomicWriteJson(config.stateFile, normalizeState(state, config.alias));
}

async function appendEvent(config, event) {
  await ensureDirectory(config.stateDir);
  const handle = await fs.open(config.eventsFile, 'a', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function loadPending(config, logger = console, now = Date.now()) {
  try {
    const value = JSON.parse(await fs.readFile(config.pendingFile, 'utf8'));
    if (!Array.isArray(value)) throw new Error('pending notification file was not an array');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    const backup = await preserveCorruptFile(config.pendingFile, now);
    logger.error(`Pending notification file was invalid and preserved as ${path.basename(backup)}`);
    return [];
  }
}

async function savePending(config, pending) {
  await atomicWriteJson(config.pendingFile, pending);
}

function stateEvent(reason, details = {}, now = Date.now()) {
  return { event_type: 'state_warning', occurred_at: isoNow(now), reason, ...details };
}

module.exports = {
  STATE_VERSION,
  appendEvent,
  atomicWriteJson,
  defaultState,
  ensureDirectory,
  loadPending,
  loadState,
  normalizeState,
  savePending,
  saveState,
  stateEvent
};
