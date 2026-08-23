'use strict';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectedDomainPattern(alias) {
  return new RegExp(`^(?:${escapeRegExp(alias)}\\.)?cn[0-9]+\\.ug\\.link$`);
}

function validateRelayDomain(domain, alias) {
  if (typeof domain !== 'string') return false;
  return expectedDomainPattern(alias).test(domain);
}

function normalizeRelayDomain(domain, alias) {
  if (!validateRelayDomain(domain, alias)) {
    throw new Error('relay domain did not match the allowlist');
  }
  return domain.startsWith(`${alias}.`) ? domain : `${alias}.${domain}`;
}

function ugLinkUrl(domain) {
  return `https://${domain}`;
}

module.exports = {
  expectedDomainPattern,
  normalizeRelayDomain,
  ugLinkUrl,
  validateRelayDomain
};
