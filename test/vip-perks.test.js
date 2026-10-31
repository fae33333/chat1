const test = require('node:test');
const assert = require('node:assert');
const V = require('../vip-perks');

const future = () => new Date(Date.now() + 5 * 86400000).toISOString();
const past = () => new Date(Date.now() - 86400000).toISOString();

test('perk counts per VIP level match the client table (7/9/13/15/17/23)', () => {
  V.configure({});
  const counts = [1, 2, 3, 4, 5, 6].map(l => V.perksForLevel(l).length);
  assert.deepStrictEqual(counts, [7, 9, 13, 15, 17, 23]);
  assert.strictEqual(V.perksForLevel(0).length, 0);
  assert.strictEqual(V.VIP_PERKS.length, 23);
});

test('perks are cumulative', () => {
  V.configure({});
  for (let l = 1; l < 6; l++) {
    const lower = new Set(V.perksForLevel(l));
    V.perksForLevel(l + 1).length >= lower.size;
    for (const k of lower) assert.ok(V.perksForLevel(l + 1).includes(k), `${k} lost at VIP${l + 1}`);
  }
});

test('VIP3 gets animated avatar / bubble but not kick immunity', () => {
  V.configure({});
  const u = { vip_level: 3, vip_until: future() };
  assert.ok(V.hasPerk(u, 'animated_avatar'));
  assert.ok(V.hasPerk(u, 'chat_bubble'));
  assert.ok(V.hasPerk(u, 'frame'));
  assert.ok(!V.hasPerk(u, 'kick_immunity'));
  assert.ok(!V.hasPerk(u, 'global_announce'));
});

test('VIP6 gets everything', () => {
  V.configure({});
  const u = { vip_level: 6, vip_until: future() };
  assert.ok(V.VIP_PERKS.every(p => V.hasPerk(u, p.key)));
});

test('expired or missing VIP gets nothing', () => {
  V.configure({});
  assert.ok(!V.hasPerk({ vip_level: 6, vip_until: past() }, 'frame'));
  assert.ok(!V.hasPerk({ vip_level: 6, vip_until: null }, 'frame'));
  assert.ok(!V.hasPerk(null, 'frame'));
  assert.ok(!V.hasPerk({ vip_level: 3, vip_until: future() }, 'unknown_perk'));
});

test('admin overrides: move a perk or disable it', () => {
  V.configure({ global_announce: 3, kick_immunity: 0, bogus: 2 });
  const u3 = { vip_level: 3, vip_until: future() };
  const u6 = { vip_level: 6, vip_until: future() };
  assert.ok(V.hasPerk(u3, 'global_announce'));
  assert.ok(!V.hasPerk(u6, 'kick_immunity'));
  assert.strictEqual(V.perkLevel('bogus'), Infinity);
  V.configure({});
  assert.ok(V.hasPerk(u6, 'kick_immunity'));
});

test('describe() flags unlocked perks', () => {
  V.configure({});
  const d = V.describe({ vip_level: 2, vip_until: future() });
  assert.strictEqual(d.filter(p => p.unlocked).length, 9);
  assert.strictEqual(d.length, 23);
});
