import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMediaMime,
  isPrivateOrReservedIp,
  sanitizeProjectFilePath,
  validateRemoteScanUrl,
} from './security';

test('SSRF blocks localhost, loopback, private IPv4/IPv6, and cloud metadata endpoints', () => {
  const blockedUrls = [
    'http://localhost:3000',
    'http://127.0.0.1/admin',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/',
    'http://172.16.0.4/api',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:8080/',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://user:pass@example.com',
    'http://2130706433/',
  ];
  for (const url of blockedUrls) {
    const res = validateRemoteScanUrl(url);
    assert.equal(res.valid, false, `Expected ${url} to be blocked`);
  }
});

test('SSRF allows valid public http/https URLs', () => {
  const res = validateRemoteScanUrl('https://example.com/docs');
  assert.equal(res.valid, true);
  assert.equal(res.hostname, 'example.com');
});

test('isPrivateOrReservedIp detects IPv4-mapped IPv6 loopback and private addresses', () => {
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:10.1.2.3'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
});

test('sanitizeProjectFilePath prevents directory traversal and normalizes clean paths', () => {
  assert.equal(sanitizeProjectFilePath('/src/utils/auth.ts'), 'src/utils/auth.ts');
  assert.equal(sanitizeProjectFilePath('src\\api\\routes.js'), 'src/api/routes.js');
  assert.throws(() => sanitizeProjectFilePath('../../etc/passwd'));
  assert.throws(() => sanitizeProjectFilePath('src/../../../secret.env'));
});

test('classifyMediaMime classifies supported image, audio, video and rejects unsafe types', () => {
  assert.equal(classifyMediaMime('image/png'), 'image');
  assert.equal(classifyMediaMime('audio/mpeg'), 'audio');
  assert.equal(classifyMediaMime('video/mp4'), 'video');
  assert.equal(classifyMediaMime('application/x-msdownload'), null);
});
