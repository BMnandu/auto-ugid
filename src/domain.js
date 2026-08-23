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

function embyPublicInfoUrl(domain) {
  return `https://${domain}/emby/System/Info/Public`;
}

function embyBaseUrl(domain) {
  return `https://${domain}/emby/`;
}

module.exports = { embyBaseUrl, embyPublicInfoUrl, expectedDomainPattern, validateRelayDomain };
