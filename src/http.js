'use strict';

class HttpError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.details = details;
  }
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new HttpError('request timed out', 'timeout');
    }
    throw new HttpError('request failed', 'network_error', { cause: error?.message });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new HttpError('response was not valid JSON', 'invalid_json');
  }
}

module.exports = { HttpError, fetchWithTimeout, readJson };
