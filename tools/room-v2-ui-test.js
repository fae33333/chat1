/* ============================================================================
   ROOM V2 — UI smoke test (dev only)
   Boots public/index.html + public/js/app.js inside jsdom with a fake socket,
   then drives exactly the flow the room admin uses:
     1) enter the room  → premium stage with ornate seats
     2) click ⚙️ إعدادات الغرفة  → settings sheet
     3) click data-id="bg"      → background picker (18 backgrounds)
     4) click data-id="seats"   → seat-count picker (6/8/12/16)
     5) apply → emits admin_update_room_settings
     6) simulate the broadcast → live stage re-render

   Run:  node tools/room-v2-ui-test.js
============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (label, condition, extra = '') => {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label} ${extra}`);
  }
};

function makeRoom(seatCount = 8) {
  const seats = [{ seat_index: 0, user_id: 'host-1', name: 'المضيف الذهبي', avatar: '/avatars/avatar-1.png', avatar_frame: '', level: 30, charm_level: 44, role: 'owner', is_muted: 0, is_locked: 0 }];
  for (let i = 1; i <= seatCount; i++) {
    if (i === 1) {
      seats.push({ seat_index: i, user_id: 'u-2', name: 'لويتا', avatar: '/avatars/avatar-2.png', avatar_frame: 'angel_wings', level: 21, charm_level: 44, role: 'user', is_muted: 0, is_locked: 0 });
    } else if (i === 2) {
      seats.push({ seat_index: i, user_id: null, name: null, avatar: null, is_muted: 0, is_locked: 1 });
    } else if (i === 4) {
      seats.push({ seat_index: i, user_id: 'u-9', name: 'ريم', avatar: '/avatars/avatar-3.png', avatar_frame: 'galaxy_halo', level: 12, charm_level: 9, role: 'user', is_muted: 1, is_locked: 0 });
    } else {
      seats.push({ seat_index: i, user_id: null, name: null, avatar: null, is_muted: 0, is_locked: 0 });
    }
  }
  return {
    id: 'room-test-1',
    title: 'روم الأدمن الفخم 👑',
    category: 'chill',
    cover_image: '/avatars/avatar-1.png',
    host_id: 'host-1',
    host_name: 'المضيف الذهبي',
    host_avatar: '/avatars/avatar-1.png',
    host_frame: 'imperial_owner',
    audience_count: 6,
    seat_count: seatCount,
    room_bg: 'cosmic_purple',
    seat_style: 'auto',
    mic_mode: 'open',
    announcement: 'أهلاً بكم في الروم ✨',
    seats
  };
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // route console output from the page realm to the node console
  const pageLog = (...args) => console.log('[page]', ...args.map(a => (typeof a === 'string' ? a : (a && a.stack) || JSON.stringify(a))));
  window.__nodeLog = pageLog;
  window.console = { log: pageLog, error: (...a) => pageLog('ERR', ...a), warn: () => {}, info: pageLog, debug: () => {} };
  window.addEventListener('error', e => pageLog('WINDOW ERROR:', e.message, e.error && e.error.stack));

  // ---- fake socket.io -----------------------------------------------------
  const handlers = {};
  const emitted = [];
  const socket = {
    on: (event, cb) => { handlers[event] = cb; },
    emit: (event, payload) => { emitted.push({ event, payload }); },
    id: 'socket-test'
  };
  window.io = () => socket;

  // ---- fake fetch router --------------------------------------------------
  const room = makeRoom(8);
  const adminUser = { id: 'host-1', name: 'المضيف الذهبي', avatar: '/avatars/avatar-1.png', role: 'owner', level: 30, charm_level: 44, coins: 5000, diamonds: 900 };
  const json = (data) => ({ ok: true, json: async () => data });
  window.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/messages')) return json([]);
    if (target.includes('/api/users/me')) return json(adminUser);
    if (target.includes('/api/geo/')) return json({ success: true, country_code: 'JO', country_name: 'الأردن', country_flag: '🇯🇴', countries: [] });
    if (target.includes('/api/gifts')) return json([]);
    if (target.match(/\/api\/rooms\/[^/]+$/)) return json(room);
    if (target.includes('/api/rooms')) return json([room]);
    return json({});
  };
  // pre-seed the stored session so the app boots already signed in
  window.localStorage.setItem('soulchill_user', JSON.stringify(adminUser));
  window.localStorage.setItem('soulchill_token', 'test-token');

  window.confirm = () => true;
  window.navigator.clipboard = { writeText: () => {} };
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};

  // ---- load the real application -----------------------------------------
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  window.eval(appJs);

  const App = window.SoulChillApp;
  if (!App) { console.log('❌ window.SoulChillApp not exported'); process.exit(1); }

  App.state.socket = socket;
  App.state.currentUser = { id: 'host-1', name: 'المضيف الذهبي', avatar: '/avatars/avatar-1.png', role: 'owner', level: 30, charm_level: 44 };
  App.state.rooms = [room];

  console.log('\n1) الدخول إلى الغرفة (renderLiveRoomModal)');
  await App.openVoiceRoom('room-test-1');
  await new Promise(r => setTimeout(r, 60));

  const modal = window.document.getElementById('live-voice-room-modal');
  ok('room modal rendered', Boolean(modal));
  const container = modal && modal.querySelector('.live-room-container');
  ok('premium container has room background class', Boolean(container && container.classList.contains('rv-bg-cosmic_purple')));
  ok('top bar exists', Boolean(modal && modal.querySelector('.rv-top-bar')));
  ok('settings button matches the requested markup', Boolean(modal && modal.querySelector('button.rv-top-btn[title="إعدادات الغرفة"]')));
  const seatCount = modal ? modal.querySelectorAll('.guest-seats-grid .stage-seat').length : 0;
  ok('8 guest mic seats rendered', seatCount === 8, `(got ${seatCount})`);
  ok('host throne rendered', Boolean(modal && modal.querySelector('#host-seat-0 .host-crown-badge')));
  ok('ornate gold frame applied on host seat', Boolean(modal && modal.querySelector('#host-seat-0 .rv-frame--gold')));
  ok('high-charm guest seat 1 gets the legend frame', Boolean(modal && modal.querySelector('#stage-seat-1 .rv-frame--legend')));
  ok('mid-tier guest seat 4 gets the neon frame', Boolean(modal && modal.querySelector('#stage-seat-4 .rv-frame--neon')));
  ok('muted guest shows the muted mic chip', Boolean(modal && modal.querySelector('#stage-seat-4 .seat-mic-status:not(.unmuted)')));
  ok('seat gem badge rendered', Boolean(modal && modal.querySelector('.rv-seat-gem')));
  ok('seat number + name plate rendered', Boolean(modal && modal.querySelector('#stage-seat-3 .seat-number-badge') && modal.querySelector('#stage-seat-3 .seat-user-name')));
  ok('locked seat shows the lock state', Boolean(modal && modal.querySelector('#stage-seat-2.stage-seat.locked')));
  ok('stage brand watermark exists', Boolean(modal && modal.querySelector('.rv-stage-brandtext')));
  ok('legacy ids preserved (#room-inroom-messages-btn / #live-audience-counter)', Boolean(modal && modal.querySelector('#room-inroom-messages-btn') && modal.querySelector('#live-audience-counter')));

  console.log('\n2) النقر على إعدادات الغرفة → image-2');
  modal.querySelector('#rv-open-settings-btn').click();
  await new Promise(r => setTimeout(r, 20));
  const settings = window.document.getElementById('rv-settings-overlay');
  ok('settings sheet opened', Boolean(settings));
  ok('sheet title is "إعدادات الغرفة"', Boolean(settings && settings.querySelector('.rv-sheet-title').textContent.includes('إعدادات الغرفة')));
  const tiles = settings ? settings.querySelectorAll('.rv-tile[data-id]').length : 0;
  ok('12 settings tiles rendered', tiles === 12, `(got ${tiles})`);
  ok('tile data-id="bg" exists', Boolean(settings && settings.querySelector('.rv-tile[data-id="bg"]')));
  ok('tile data-id="seats" exists', Boolean(settings && settings.querySelector('.rv-tile[data-id="seats"]')));
  ok('quick admin shortcuts rendered', Boolean(settings && settings.querySelector('[data-quick="lock-all"]')));

  console.log('\n3) النقر على data-id="bg" → image-3');
  settings.querySelector('.rv-tile[data-id="bg"]').click();
  await new Promise(r => setTimeout(r, 20));
  const bg = window.document.getElementById('rv-bg-overlay');
  ok('background picker opened', Boolean(bg));
  const bgCards = bg ? bg.querySelectorAll('.rv-bg-card').length : 0;
  ok('18 room backgrounds offered', bgCards === 18, `(got ${bgCards})`);
  ok('category tabs rendered', Boolean(bg && bg.querySelectorAll('#rv-bg-tabs .rv-tab').length === 6));
  ok('live preview rendered', Boolean(bg && bg.querySelector('#rv-bg-preview')));
  ok('VIP backgrounds flagged', Boolean(bg && bg.querySelector('.rv-bg-card[data-bg-id="vip_galaxy_hd"] .rv-vip-ribbon')));
  // pick a new background and apply
  bg.querySelector('.rv-bg-card[data-bg-id="neon_tokyo"]').click();
  ok('selection highlights the chosen background', Boolean(bg.querySelector('.rv-bg-card[data-bg-id="neon_tokyo"]').classList.contains('selected')));
  bg.querySelector('#rv-bg-apply').click();
  await new Promise(r => setTimeout(r, 20));
  const bgEmit = emitted.filter(e => e.event === 'admin_update_room_settings').pop();
  ok('applying a background emits admin_update_room_settings', Boolean(bgEmit && bgEmit.payload.roomBg === 'neon_tokyo'), JSON.stringify(bgEmit && bgEmit.payload));
  ok('room container switched background instantly', Boolean(container.classList.contains('rv-bg-neon_tokyo')), container.className);

  console.log('\n4) النقر على data-id="seats" → image-4');
  modal.querySelector('#rv-open-settings-btn').click();
  await new Promise(r => setTimeout(r, 20));
  window.document.getElementById('rv-settings-overlay').querySelector('.rv-tile[data-id="seats"]').click();
  await new Promise(r => setTimeout(r, 20));
  const seatsPanel = window.document.getElementById('rv-seats-overlay');
  ok('seat-count picker opened', Boolean(seatsPanel));
  ok('seat map diagram rendered', Boolean(seatsPanel && seatsPanel.querySelector('.rv-seatmap-seat')));
  const plans = seatsPanel ? seatsPanel.querySelectorAll('.rv-count-card').length : 0;
  ok('4 seat plans offered (6/8/12/16)', plans === 4, `(got ${plans})`);
  ok('current plan marked as selected', Boolean(seatsPanel && seatsPanel.querySelector('.rv-count-card[data-count="8"]').classList.contains('selected')));
  ok('VIP upsell tag rendered', Boolean(seatsPanel && seatsPanel.querySelector('.rv-count-card[data-count="16"] .rv-count-tag')));
  // choose 12 seats and apply
  seatsPanel.querySelector('.rv-count-card[data-count="12"]').click();
  ok('seat map redraws for the chosen plan', seatsPanel.querySelectorAll('.rv-seatmap-seat').length === 12, `(got ${seatsPanel.querySelectorAll('.rv-seatmap-seat').length})`);
  seatsPanel.querySelector('#rv-seats-apply').click();
  await new Promise(r => setTimeout(r, 20));
  const seatsEmit = emitted.filter(e => e.event === 'admin_update_room_settings').pop();
  ok('applying a seat plan emits admin_update_room_settings', Boolean(seatsEmit && seatsEmit.payload.seatCount === 12), JSON.stringify(seatsEmit && seatsEmit.payload));

  console.log('\n5) بث إعدادات الغرفة لكل الحضور (room_settings_updated)');
  const broadcastRoom = makeRoom(12);
  broadcastRoom.room_bg = 'vip_galaxy_hd';
  broadcastRoom.seat_count = 12;
  handlers['room_settings_updated']({ roomId: 'room-test-1', room: broadcastRoom, seats: broadcastRoom.seats, updatedBy: { id: 'host-1', name: 'المضيف' } });
  await new Promise(r => setTimeout(r, 30));
  const seatsAfter = modal.querySelectorAll('.guest-seats-grid .stage-seat').length;
  ok('stage re-rendered with 12 seats live', seatsAfter === 12, `(got ${seatsAfter})`);
  ok('layout class rv-seats-12 applied', Boolean(modal.querySelector('.guest-seats-grid.rv-seats-12')));
  ok('new background applied to the room for everyone', Boolean(container.classList.contains('rv-bg-vip_galaxy_hd')), container.className);
  ok('host top-bar title updated', Boolean(modal.querySelector('#rv-top-room-title')));

  console.log('\n6) صلاحيات غير المدير');
  App.state.currentUser = { id: 'u-2', name: 'لويتا', avatar: '/avatars/avatar-2.png', role: 'user', level: 21 };
  App.openVoiceRoom('room-test-1');
  await new Promise(r => setTimeout(r, 60));
  const modal2 = window.document.getElementById('live-voice-room-modal');
  ok('non-admin sees the settings button but with a lock badge', Boolean(modal2.querySelector('#rv-open-settings-btn .rv-btn-badge')));
  modal2.querySelector('#rv-open-settings-btn').click();
  await new Promise(r => setTimeout(r, 20));
  const settings2 = window.document.getElementById('rv-settings-overlay');
  ok('locked tiles flagged for non-admins', Boolean(settings2 && settings2.querySelector('.rv-tile.locked')));
  ok('no quick admin shortcuts for non-admins', !settings2.querySelector('[data-quick="lock-all"]'));
  settings2.querySelector('.rv-tile[data-id="bg"]').click();
  await new Promise(r => setTimeout(r, 20));
  ok('non-admin cannot open the background picker', !window.document.getElementById('rv-bg-overlay'));

  console.log(`\n${failures === 0 ? '🎉 ALL ROOM V2 UI CHECKS PASSED' : `⚠️  ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('UI test crashed:', err);
  process.exit(1);
});
