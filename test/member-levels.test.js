const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const L = require('../member-levels');

// عميل Socket.IO خفيف بدون أي تبعيات خارجية عبر WebSocket المدمج في Node 22
function connectSocketIo(baseUrl) {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  const ws = new WebSocket(wsUrl);
  const listeners = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const raw = String(ev.data || '');
      if (raw.startsWith('0')) ws.send('40');
      else if (raw.startsWith('40')) resolve();
      else if (raw === '2') ws.send('3');
      else if (raw.startsWith('42')) {
        try {
          const [name, payload] = JSON.parse(raw.slice(2));
          const list = listeners.get(name) || [];
          listeners.set(name, []);
          list.forEach(fn => fn(payload));
        } catch (e) {}
      }
    });
  });
  return {
    ready,
    emit: (event, data) => ws.send('42' + JSON.stringify([event, data])),
    once: (event) => new Promise(resolve => {
      const arr = listeners.get(event) || [];
      arr.push(resolve);
      listeners.set(event, arr);
    }),
    close: () => { try { ws.close(); } catch (e) {} }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. اختبارات الوحدات الشاملة لوحدة المستويات والرتب (member-levels.js)
// ═══════════════════════════════════════════════════════════════════════════
test('levelThreshold matches client curve anchors up to Royal Lv.60', () => {
  assert.strictEqual(L.levelThreshold(1), 0);
  assert.strictEqual(L.levelThreshold(2), 70);
  assert.strictEqual(L.levelThreshold(5), 2160);
  assert.strictEqual(L.levelThreshold(30), 5000000);
  assert.strictEqual(L.levelThreshold(51), 43664283);
  assert.strictEqual(L.levelThreshold(60), 90000000);
});

test('levelFromPoints converts points to level 1..60 and Roman Royal ranks I..X', () => {
  assert.strictEqual(L.levelFromPoints(0).level, 1);
  assert.strictEqual(L.levelFromPoints(69).level, 1);
  assert.strictEqual(L.levelFromPoints(70).level, 2);
  assert.strictEqual(L.levelFromPoints(2160).level, 5);
  assert.strictEqual(L.levelFromPoints(44000000).level, 51);
  assert.strictEqual(L.levelFromPoints(99999999).level, 60);
  assert.strictEqual(L.levelFromPoints(99999999).progress, 100);
  assert.strictEqual(L.levelFromPoints(-5).level, 1);

  assert.strictEqual(L.royalIndexFromLevel(50), 0);
  assert.strictEqual(L.royalIndexFromLevel(51), 1);
  assert.strictEqual(L.toRoman(L.royalIndexFromLevel(55)), 'V');
  assert.strictEqual(L.toRoman(L.royalIndexFromLevel(60)), 'X');
  assert.strictEqual(L.formatWealthBadgeText(51), 'الملكي I');
  assert.strictEqual(L.formatWealthBadgeText(60), 'الملكي X');
});

test('pointsForAmount', () => {
  assert.strictEqual(L.pointsForAmount(50, 'diamonds'), 50);
  assert.strictEqual(L.pointsForAmount(100, 'coins'), 10);
  assert.strictEqual(L.pointsForAmount(9, 'coins'), 0);
  assert.strictEqual(L.pointsForAmount(100, 'coins', { coins_per_point: 5 }), 20);
});

test('VIP / Aristocracy activity, expiry, Viscount..Sultan ranks, Stealth & Anti-Track', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  const active = { vip_level: 2, vip_until: '2026-10-20T00:00:00Z' };
  const expired = { vip_level: 2, vip_until: '2026-10-01T00:00:00Z' };
  assert.strictEqual(L.activeVipLevel(active, now), 2);
  assert.strictEqual(L.activeVipLevel(expired, now), 0);
  assert.strictEqual(L.vipDaysLeft(active, now), 10);
  assert.strictEqual(L.computeVipExpiry(active, 2, 30, now), '2026-11-19T00:00:00.000Z');
  assert.strictEqual(L.computeVipExpiry(active, 3, 30, now), '2026-11-09T00:00:00.000Z');

  assert.strictEqual(L.nobilityRankInfo(1).title_en, 'Viscount');
  assert.strictEqual(L.nobilityRankInfo(7).title_en, 'Sultan');
  assert.strictEqual(L.nobilityRankInfo(2).anti_track, false);
  assert.strictEqual(L.nobilityRankInfo(3).anti_track, true);
  assert.strictEqual(L.nobilityRankInfo(3).stealth_entry, false);
  assert.strictEqual(L.nobilityRankInfo(4).stealth_entry, true);
});

test('Wealth moderation, Royal immunity, Tail lights, Charm exposure & Room/Family capacities', () => {
  const beginner = { id: 'u-beg', wealth_level: 8 };
  const advanced = { id: 'u-adv', wealth_level: 35 };
  const royal = { id: 'u-roy', wealth_level: 55 };
  const pubRoom = { id: 'r1', host_id: 'u-host', has_password: false };
  const privRoom = { id: 'r2', host_id: 'u-host', has_password: true };

  // صلاحية الكتم/الطرد للمستوى المتقدم في الغرف العامة فقط، مع احترام الحصانة الملكية
  assert.strictEqual(L.canWealthModerateTarget(advanced, beginner, pubRoom), true);
  assert.strictEqual(L.canWealthModerateTarget(advanced, beginner, privRoom), false);
  assert.strictEqual(L.canWealthModerateTarget(advanced, royal, pubRoom), false);
  assert.strictEqual(L.hasModerationImmunity(royal), true);
  assert.strictEqual(L.hasMessageTailLights(royal), true);
  assert.strictEqual(L.hasMessageTailLights(beginner), false);

  // تعزيز الظهور في الاستكشاف من الجاذبية
  assert.ok(L.charmExposureBoost(40) > L.charmExposureBoost(10));

  // سعة المقاعد في الغرف وسعة الأعضاء في العائلات
  assert.strictEqual(L.roomLevelFromXp(0).max_mic_seats, 5);
  assert.strictEqual(L.roomLevelFromXp(2000).max_mic_seats, 9);
  assert.strictEqual(L.roomLevelFromXp(25000).max_mic_seats, 12);
  assert.strictEqual(L.roomLevelFromXp(120000).max_mic_seats, 15);
  assert.ok(L.familyLevelFromXp(50000).member_capacity > L.familyLevelFromXp(0).member_capacity);
});

test('buildCards: الثروة / الرواج / VIP', () => {
  const c = L.buildCards({ wealth_points: 2160, popularity_points: 70, wealth_level: 3, charm_level: 4, vip_level: 0 }, Date.now());
  assert.strictEqual(c.vip.text, 'VIP0');
  assert.ok(/^Lv\.\d+$/.test(c.wealth.text));
  assert.strictEqual(c.wealth.label, 'الثروة');
  assert.strictEqual(c.popularity.label, 'الرواج');
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. اختبار تكامل شامل حي (HTTP APIs + Socket.IO) على خادم وقاعدة بيانات معزولة
// ═══════════════════════════════════════════════════════════════════════════
test('Full-stack E2E: Profile & Room Gifts, Wealth/Charm Levels, Aristocracy, Stealth/Anti-Track, Moderation/Immunity, Room & Family Daily Rewards', async (t) => {
  const tmpDb = path.join(os.tmpdir(), `soulchill-e2e-${process.pid}-${Date.now()}.sqlite`);
  const port = 19400 + Math.floor(Math.random() * 400);
  const httpsPort = port + 500;
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      SOULCHILL_DB_PATH: tmpDb,
      PORT: String(port),
      HTTPS_PORT: String(httpsPort)
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(() => {
    try { child.kill('SIGKILL'); } catch (e) {}
    try { if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb); } catch (e) {}
  });

  // انتظار جاهزية الخادم وتهيئة الجداول والبذور بالكامل
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = async () => {
      try {
        const r = await fetch(`${base}/api/gifts`);
        if (r.ok) {
          const g = await r.json();
          if (Array.isArray(g) && g.some(x => x.id === 'charm_vip_crown')) return resolve();
        }
      } catch (e) {}
      if (Date.now() > deadline) return reject(new Error('Server startup timed out'));
      setTimeout(check, 200);
    };
    check();
  });

  // تهيئة 3 مستخدمين في قاعدة البيانات المعزولة للاختبار الشامل
  const richUser = { id: 'sc-test-rich', name: 'الإمبراطور طارق' };
  const hostUser = { id: 'sc-test-host', name: 'المضيفة ليلى' };
  const newbieUser = { id: 'sc-test-newbie', name: 'عضو مبتدئ' };
  {
    const sdb = new DatabaseSync(tmpDb);
    const ins = sdb.prepare(`INSERT INTO users (id, email, name, avatar, coins, diamonds, wealth_level, charm_level, level, wealth_points, popularity_points)
      VALUES (?, ?, ?, '/avatars/avatar-1.png', ?, ?, ?, 1, 1, ?, 0)`);
    ins.run(richUser.id, 'tycoon@example.com', richUser.name, 900000, 6500000, 35, 6500000);
    ins.run(hostUser.id, 'host@example.com', hostUser.name, 5000, 5000, 1, 0);
    ins.run(newbieUser.id, 'newbie@example.com', newbieUser.name, 1000, 100, 3, 200);
    sdb.close();
  }

  const api = async (method, url, body, userId) => {
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers['x-user-id'] = userId;
    const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };

  // 1) إنشاء غرفة عامة للمضيفة
  const roomRes = await api('POST', '/api/rooms', { title: 'سهرة النجوم الملكية', category: 'chat', seat_count: 8 }, hostUser.id);
  assert.strictEqual(roomRes.status, 200);
  const room = roomRes.data.room || roomRes.data;

  // 2) بوابة هدايا الجاذبية الحصرية: تفشل قبل وصول المضيفة إلى Lv.20 جاذبية!
  const vipGiftBlocked = await api('POST', '/api/gifts/send', {
    receiver_id: hostUser.id,
    gift_id: 'charm_vip_crown'
  }, richUser.id);
  assert.strictEqual(vipGiftBlocked.status, 400);
  assert.match(vipGiftBlocked.data.error || '', /20/);

  // 3) إرسال هدية عبر الملف الشخصي (بدون room_id) + إنشاء عائلة + إرسال هدايا قصر الأحلام داخل الغرفة
  const profileGift = await api('POST', '/api/gifts/send', {
    receiver_id: hostUser.id,
    gift_id: 'crown'
  }, richUser.id);
  assert.strictEqual(profileGift.status, 200);
  assert.strictEqual(profileGift.data.success, true);

  const famCreate = await api('POST', '/api/families', { name: 'ملوك المجرة', badge_emoji: '👑', slogan: 'القمة لنا' }, richUser.id);
  assert.strictEqual(famCreate.status, 200);
  const familyId = famCreate.data.family.id;

  // إهداء متكرر يرفع المضيفة فوق Lv.20 جاذبية ويرفع المرسل ومستوى الغرفة والعائلة!
  for (let i = 0; i < 35; i++) {
    const r = await api('POST', '/api/gifts/send', {
      receiver_id: hostUser.id,
      room_id: room.id,
      gift_id: 'castle'
    }, richUser.id);
    assert.strictEqual(r.status, 200);
  }

  // الآن تُفتح هدية VIP الحصرية للمضيفة بعد تجاوزها مستوى السحر المطلوب!
  const vipGiftAllowed = await api('POST', '/api/gifts/send', {
    receiver_id: hostUser.id,
    room_id: room.id,
    gift_id: 'charm_vip_crown'
  }, richUser.id);
  assert.strictEqual(vipGiftAllowed.status, 200);
  assert.strictEqual(vipGiftAllowed.data.success, true);

  // 4) استلام مكافأة مستوى الثراء + تفعيل الإطار + إرسال هدية مجانية من الحقيبة بدون خصم رصيد!
  const claimLv = await api('POST', '/api/levels/claim-reward', { track: 'wealth', milestone: 11 }, richUser.id);
  assert.strictEqual(claimLv.status, 200);
  assert.strictEqual(claimLv.data.success, true);

  const equipFrame = await api('POST', '/api/levels/equip-perk', { frame_id: 'wealth_gold' }, richUser.id);
  assert.strictEqual(equipFrame.status, 200);
  assert.strictEqual(equipFrame.data.user.avatar_frame, 'wealth_gold');

  const freeBagList = await api('GET', '/api/levels/free-gifts', null, richUser.id);
  assert.strictEqual(freeBagList.status, 200);
  assert.ok(freeBagList.data.free_gifts.length > 0);
  const freeGiftSend = await api('POST', '/api/gifts/send', {
    receiver_id: newbieUser.id,
    gift_id: freeBagList.data.free_gifts[0].gift_id,
    use_free_bag: true
  }, richUser.id);
  assert.strictEqual(freeGiftSend.status, 200);
  assert.strictEqual(freeGiftSend.data.used_free_bag, true);

  // 5) رتب النبلاء والأرستقراطية: تفعيل رتبة السلطان (VIP 7) + منع التتبع + إخفاء التواجد في الغرف
  const buySultan = await api('POST', '/api/vip/buy', { level: 7 }, richUser.id);
  assert.strictEqual(buySultan.status, 200);
  assert.strictEqual(buySultan.data.vip.rank_title, 'السلطان (Sultan)');
  assert.ok(buySultan.data.vip.bonus_coins > 0);

  const privRes = await api('POST', '/api/vip/privacy', { vip_stealth: true, vip_anti_track: true }, richUser.id);
  assert.strictEqual(privRes.status, 200);
  assert.strictEqual(privRes.data.vip_stealth, true);
  assert.strictEqual(privRes.data.vip_anti_track, true);

  // زيارة ملف العضو المبتدئ مع تفعيل منع التتبع لا تُسجَّل نهائياً!
  const visitBlocked = await api('POST', `/api/users/${newbieUser.id}/visit`, {}, richUser.id);
  assert.strictEqual(visitBlocked.status, 200);
  assert.strictEqual(visitBlocked.data.skipped, true);
  assert.strictEqual(visitBlocked.data.stealth, true);

  // 6) تعزيز ظهور غرفة المضيفة في الاستكشاف + مستوى الغرفة ومكافأة اليوم (كيس حظ + 2x XP) + مكافأة العائلة اليومية
  const roomsExplore = await api('GET', '/api/rooms');
  const foundRoom = roomsExplore.data.find(x => x.id === room.id);
  assert.ok(foundRoom);
  assert.ok(foundRoom.room_level >= 2, 'Room should have leveled up from gifts');
  assert.ok(foundRoom.exposure_boost_pct > 0, 'High-charm host should boost room exposure');

  const seatOpts = await api('GET', `/api/rooms/${room.id}/seat-options`, null, hostUser.id);
  assert.strictEqual(seatOpts.status, 200);
  assert.ok(seatOpts.data.options.some(o => o.count === 12), '12-seat option exists');

  const roomDaily = await api('POST', `/api/rooms/${room.id}/claim-daily`, {}, hostUser.id);
  assert.strictEqual(roomDaily.status, 200);
  assert.strictEqual(roomDaily.data.success, true);

  const famDaily = await api('POST', `/api/families/${familyId}/claim-daily`, {}, richUser.id);
  assert.strictEqual(famDaily.status, 200);
  assert.strictEqual(famDaily.data.success, true);
  assert.ok(famDaily.data.coins_awarded > 0);

  // 7) اختبار Socket.IO حي: دخول سري (Stealth) مقابل رسائل مع أضواء الذيل (Tail Lights) + صلاحية الثراء على المبتدئ
  const sock = connectSocketIo(base);
  t.after(() => sock.close());
  await sock.ready;

  sock.emit('join_room', { roomId: room.id, user: { id: richUser.id, name: richUser.name } });
  await new Promise(r => setTimeout(r, 250));

  // لأن vip_stealth مفعّل، لا يظهر السلطان في قائمة المتواجدين للعضو المبتدئ!
  const peopleRes = await api('GET', `/api/rooms/${room.id}/people`, null, newbieUser.id);
  assert.strictEqual(peopleRes.status, 200);
  assert.strictEqual(peopleRes.data.online.some(u => u.id === richUser.id), false);

  // وعند إرسال رسالة دردشة، تصل مع أضواء الذيل الملكية (has_tail_lights = true)!
  const chatMsgPromise = sock.once('room_message');
  sock.emit('send_room_message', { roomId: room.id, userId: richUser.id, content: 'السلام عليكم يا ملوك السهر!' });
  const liveMsg = await chatMsgPromise;
  assert.strictEqual(liveMsg.has_tail_lights, true);
  assert.strictEqual(liveMsg.sender_vip_level, 7);

  // وفحص صلاحية الإشراف بالثراء (richUser يستطيع كتم/طرد newbieUser في الغرفة العامة بدون أن يكون مشرفاً!)
  const relCheck = await api('GET', `/api/rooms/${room.id}/relation/${newbieUser.id}`, null, richUser.id);
  assert.strictEqual(relCheck.status, 200);
  assert.strictEqual(relCheck.data.viewer_can_wealth_moderate, true);
});
