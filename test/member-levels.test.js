const test = require('node:test');
const assert = require('node:assert');
const L = require('../member-levels');

test('levelThreshold matches client curve anchors', () => {
  assert.strictEqual(L.levelThreshold(1), 0);
  assert.strictEqual(L.levelThreshold(2), 70);
  assert.strictEqual(L.levelThreshold(5), 2160);
  assert.strictEqual(L.levelThreshold(30), 5000000);
});

test('levelFromPoints converts points to level', () => {
  assert.strictEqual(L.levelFromPoints(0).level, 1);
  assert.strictEqual(L.levelFromPoints(69).level, 1);
  assert.strictEqual(L.levelFromPoints(70).level, 2);
  assert.strictEqual(L.levelFromPoints(2160).level, 5);
  assert.strictEqual(L.levelFromPoints(99999999).level, 30);
  assert.strictEqual(L.levelFromPoints(99999999).progress, 100);
  assert.strictEqual(L.levelFromPoints(-5).level, 1);
});

test('pointsForAmount', () => {
  assert.strictEqual(L.pointsForAmount(50, 'diamonds'), 50);
  assert.strictEqual(L.pointsForAmount(100, 'coins'), 10);
  assert.strictEqual(L.pointsForAmount(9, 'coins'), 0);
  assert.strictEqual(L.pointsForAmount(100, 'coins', { coins_per_point: 5 }), 20);
});

test('VIP activity and expiry', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  const active = { vip_level: 2, vip_until: '2026-10-20T00:00:00Z' };
  const expired = { vip_level: 2, vip_until: '2026-10-01T00:00:00Z' };
  assert.strictEqual(L.activeVipLevel(active, now), 2);
  assert.strictEqual(L.activeVipLevel(expired, now), 0);
  assert.strictEqual(L.activeVipLevel({ vip_level: 0 }, now), 0);
  assert.strictEqual(L.vipDaysLeft(active, now), 10);
  // same level extends from current end, different level starts now
  assert.strictEqual(L.computeVipExpiry(active, 2, 30, now), '2026-11-19T00:00:00.000Z');
  assert.strictEqual(L.computeVipExpiry(active, 3, 30, now), '2026-11-09T00:00:00.000Z');
  assert.strictEqual(L.computeVipExpiry(expired, 2, 30, now), '2026-11-09T00:00:00.000Z');
});

test('buildCards: الثروة / الرواج / VIP', () => {
  const c = L.buildCards({ wealth_points: 2160, popularity_points: 70, wealth_level: 3, charm_level: 4, vip_level: 0 }, Date.now());
  assert.strictEqual(c.vip.text, 'VIP0');
  assert.ok(/^Lv\.\d+$/.test(c.wealth.text));
  assert.strictEqual(c.wealth.label, 'الثروة');
  assert.strictEqual(c.popularity.label, 'الرواج');
});
