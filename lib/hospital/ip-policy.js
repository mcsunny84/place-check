'use strict';
// global-unicast allow-only 판정 (v0.3 §2-A-0, GPT-30-001). denylist 열거가 아니라
// "global unicast가 아닌 모든 것 거부" — IPv4는 예약 블록 규칙으로, IPv6는 2000::/3 밖 전부 거부.
const net = require('node:net');

function normalizeIpLiteral(host) {
  if (typeof host !== 'string' || !host) return null;
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return net.isIP(h) ? h : null;
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function isPublicUnicastIpv4(ip) {
  const n = ipv4ToInt(ip);
  const inCidr = (base, bits) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits));
  // 비-global 블록(IANA special-purpose): 하나라도 걸리면 거부
  const special = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  if (n === 0xffffffff) return false; // broadcast
  return !special.some(([b, bits]) => inCidr(b, bits));
}

function extractMappedIpv4(ip6) {
  // ::ffff:a.b.c.d (dotted) 또는 ::ffff:xxxx:xxxx (hex) — 둘 다 IPv4로 환원
  const m = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  const hex = ip6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

function isPublicUnicastIp(ip) {
  const norm = normalizeIpLiteral(ip);
  if (!norm) return false;
  const kind = net.isIP(norm);
  if (kind === 4) return isPublicUnicastIpv4(norm);
  // IPv6: mapped/compatible → IPv4 환원 재검사
  const mapped = extractMappedIpv4(norm);
  if (mapped) return net.isIP(mapped) === 4 ? isPublicUnicastIpv4(mapped) : false;
  if (/^::(\d+\.\d+\.\d+\.\d+)$/.test(norm)) return false; // IPv4-compatible(폐기) — 거부
  // global unicast는 2000::/3. 그 밖(loopback ::1, unspecified ::, fc00::/7, fe80::/10, ff00::/8 등) 전부 거부
  const firstHextet = parseInt((norm.split(':')[0] || '0') || '0', 16);
  if (norm === '::' || norm === '::1') return false;
  if (!(firstHextet >= 0x2000 && firstHextet <= 0x3fff)) return false;
  // 2000::/3 안의 특수 블록: 2001:db8::/32(documentation), 64:ff9b는 /3 밖이라 이미 거부됨
  if (/^2001:0?db8:/i.test(norm) || norm.startsWith('2001:db8:') || /^2001:db8$/.test(norm.split('::')[0])) return false;
  return true;
}

module.exports = { isPublicUnicastIp, normalizeIpLiteral };
