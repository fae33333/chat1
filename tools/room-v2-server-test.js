/* ============================================================================
   ROOM V2 — live server test (dev only)
   Drives the real Express + Socket.IO server exactly like the browser does:
     • create a room via REST        (POST /api/rooms)
     • join with 2 live sockets      (host + guest)
     • change the room background    (admin_update_room_settings → room_settings_updated)
     • grow the stage 8 → 12 seats   (new room_seats rows + live broadcast)
     • shrink the stage 12 → 6 seats (occupants are kicked safely)
     • verify permissions            (non-admin gets room_settings_error)
     • clean up                      (DELETE /api/rooms/:id)

   Run (server must already be listening on PORT, default 3000):
       node tools/room-v2-server-test.js
============================================================================ */
'use strict';

const { io } = require('socket.io-client');

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (label, condition, extra = '') => {
  if (condition) console.log(`  ✅ ${label}`);
  else { failures++; console.log(`  ❌ ${label} ${extra}`); }
};

const api = async (method, url, body, headers = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data };
};

const waitFor = (socket, event, timeout = 6000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
  socket.once(event, (payload) => {
    clearTimeout(timer);
    resolve(payload);
  });
});

const connect = () => new Promise((resolve, reject) => {
  const socket = io(BASE, { transports: ['websocket', 'polling'], reconnection: false, timeout: 5000 });
  socket.on('connect', () => resolve(socket));
  socket.on('connect_error', reject);
});

(async () => {
  console.log('\nROOM V2 — live server test\n' + '='.repeat(40));

  const hostId = `roomv2-host-${Date.now().toString().slice(-6)}`;

  // pick a real, non-staff account from the database to act as the guest listener
  const usersRes = await api('GET', '/api/users');
  const guestUser = (usersRes.data || []).find(u => u && u.role === 'user') || (usersRes.data || [])[0];
  if (!guestUser) { console.log('❌ no users available to act as guest'); process.exit(1); }
  const guest = { id: guestUser.id, name: guestUser.name, avatar: guestUser.avatar, role: guestUser.role };
  console.log(`   (guest account: ${guest.name} / ${guest.id} / ${guest.role})`);

  console.log('\n1) إنشاء غرفة جديدة (POST /api/rooms)');
  const created = await api('POST', '/api/rooms', {
    title: 'غرفة اختبار ROOM V2 🎙️',
    category: 'chill',
    announcement: 'اختبار الخلفيات وعدد المقاعد'
  }, { 'x-user-id': hostId });
  const roomId = created.data && (created.data.id || (created.data.room && created.data.room.id));
  ok('room created', created.status === 200 && Boolean(roomId), JSON.stringify(created.data).slice(0, 200));
  if (!roomId) process.exit(1);

  let details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('default layout = seat 0 + 8 mic seats', details.seat_count === 8 && details.seats.length === 9, `seats=${details.seats.length}`);
  ok('default background = cosmic_purple', details.room_bg === 'cosmic_purple');
  ok('host starts seated on the throne (seat 0)', details.seats.some(s2 => s2.seat_index === 0 && s2.user_id === hostId));

  console.log('\n2) اتصال المضيف والضيف بالغرفة (Socket.IO join_room)');
  const hostSocket = await connect();
  const guestSocket = await connect();
  const hostUser = { id: hostId, name: 'مضيف الاختبار', avatar: '/avatars/avatar-1.png', role: 'user' };
  hostSocket.emit('join_room', { roomId, user: hostUser });
  guestSocket.emit('join_room', { roomId, user: guest });
  await new Promise(r => setTimeout(r, 400));
  ok('both sockets connected and joined', hostSocket.connected && guestSocket.connected);

  console.log('\n3) تغيير خلفية الغرفة لكل الحضور');
  const guestGotBg = waitFor(guestSocket, 'room_settings_updated');
  hostSocket.emit('admin_update_room_settings', { roomId, adminId: hostId, roomBg: 'neon_tokyo' });
  const bgEvent = await guestGotBg;
  ok('guest received room_settings_updated', Boolean(bgEvent));
  ok('broadcast carries the new background', bgEvent.room && bgEvent.room.room_bg === 'neon_tokyo', JSON.stringify(bgEvent.room && bgEvent.room.room_bg));
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('background persisted in SQLite', details.room_bg === 'neon_tokyo');

  console.log('\n4) توسيع المسرح إلى 12 مقعداً');
  const guestGotSeats = waitFor(guestSocket, 'room_settings_updated');
  hostSocket.emit('admin_update_room_settings', { roomId, adminId: hostId, seatCount: 12 });
  const seatsEvent = await guestGotSeats;
  ok('broadcast announces the new seat count', seatsEvent.room && seatsEvent.room.seat_count === 12, `seat_count=${seatsEvent.room && seatsEvent.room.seat_count}`);
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('12 guest seats + host throne created (13 rows)', details.seats.length === 13, `rows=${details.seats.length}`);
  ok('highest seat index is 12', Math.max(...details.seats.map(s => s.seat_index)) === 12);

  console.log('\n5) قلص المسرح إلى 6 مقاعد وإنزال المتحدثين تلقائياً');
  const guestTookSeat = waitFor(guestSocket, 'seat_updated');
  guestSocket.emit('take_seat', { roomId, seatIndex: 11, userId: guest.id });
  await guestTookSeat;
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('guest is on seat 11', details.seats.some(s => s.seat_index === 11 && s.user_id === guest.id));

  const kicked = waitFor(guestSocket, 'user_kicked_from_seat');
  hostSocket.emit('admin_update_room_settings', { roomId, adminId: hostId, seatCount: 6 });
  const kickEvent = await kicked;
  ok('guest was moved off the removed seat', Boolean(kickEvent && kickEvent.seatIndex === 11), JSON.stringify(kickEvent));
  ok('kick reason is seat_count_change', kickEvent.reason === 'seat_count_change');
  await new Promise(r => setTimeout(r, 400)); // let the settings UPDATE settle
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('layout now holds seat 0 + 6 mic seats', details.seats.length === 7 && Math.max(...details.seats.map(s => s.seat_index)) === 6, `rows=${details.seats.length}`);
  ok('seat_count persisted', Number(details.seat_count) === 6, `value=${JSON.stringify(details.seat_count)} (${typeof details.seat_count})`);

  console.log('\n6) حفظ اسم الغرفة والإعلان نمط المايك');
  hostSocket.emit('admin_update_room_settings', {
    roomId,
    adminId: hostId,
    title: 'اسم جديد من الإعدادات ✏️',
    announcement: 'إعلان محدث 📢',
    micMode: 'request',
    seatStyle: 'gold'
  });
  await new Promise(r => setTimeout(r, 400));
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('title persisted', details.title === 'اسم جديد من الإعدادات ✏️', details.title);
  ok('announcement persisted', details.announcement === 'إعلان محدث 📢');
  ok('mic_mode persisted', details.mic_mode === 'request');
  ok('seat_style persisted', details.seat_style === 'gold');

  console.log('\n7) الحماية: غير المدير لا يستطيع تغيير الإعدادات');
  const denied = waitFor(guestSocket, 'room_settings_error');
  guestSocket.emit('admin_update_room_settings', { roomId, adminId: guest.id, roomBg: 'vip_gold_palace' });
  const deniedEvent = await denied;
  ok('non-admin received room_settings_error', Boolean(deniedEvent && deniedEvent.message));
  details = (await api('GET', `/api/rooms/${roomId}`)).data;
  ok('background unchanged after the rejected attempt', details.room_bg === 'neon_tokyo');

  console.log('\n8) مشغل الموسيقى (اسم الأغنية على المقعد)');
  // 8a) a member who is NOT seated cannot start the music
  const notSeatedErr = waitFor(guestSocket, 'room_music_error');
  guestSocket.emit('room_music_update', { roomId, userId: guest.id, playing: true, trackId: 'lofi_night', trackName: 'ليل لوفي هادئ' });
  const notSeated = await notSeatedErr;
  ok('non-seated member gets room_music_error', Boolean(notSeated && notSeated.message));

  // 8b) the host (seat 0) starts a track → everyone in the room gets the broadcast
  const guestGotMusic = waitFor(guestSocket, 'room_music_update');
  const hostGotMusic = waitFor(hostSocket, 'room_music_update');
  hostSocket.emit('room_music_update', { roomId, userId: hostId, seatIndex: 0, playing: true, trackId: 'oud_tal', trackName: 'طرب عود شرقي' });
  const [musicToGuest, musicToHost] = await Promise.all([guestGotMusic, hostGotMusic]);
  ok('guest received room_music_update', Boolean(musicToGuest && musicToGuest.playing === true));
  ok('host received room_music_update', Boolean(musicToHost && musicToHost.playing === true));
  ok('broadcast carries the song name', musicToGuest.trackName === 'طرب عود شرقي', JSON.stringify(musicToGuest));
  ok('broadcast carries the playing seat', musicToGuest.seatIndex === 0 && musicToGuest.userId === hostId);

  // 8c) a newcomer joining mid-song immediately gets the now-playing state
  const joiner = await connect();
  const joinerGotMusic = waitFor(joiner, 'room_music_update');
  joiner.emit('join_room', { roomId, user: { id: 'roomv2-joiner', name: 'زائر متأخر', avatar: '/avatars/avatar-4.png' } });
  const joinerMusic = await joinerGotMusic;
  ok('late joiner synced with the now-playing track', Boolean(joinerMusic && joinerMusic.playing === true && joinerMusic.trackName === 'طرب عود شرقي'));

  // 8d) a random member cannot stop someone else's music
  const stopDenied = waitFor(guestSocket, 'room_music_error');
  guestSocket.emit('room_music_update', { roomId, userId: guest.id, playing: false });
  const stopDeniedEvent = await stopDenied;
  ok('only the player or a manager may stop the music', Boolean(stopDeniedEvent && stopDeniedEvent.message));

  // 8e) a seated guest starts their own track → it replaces the host's song
  const guestTookSeat2 = waitFor(guestSocket, 'seat_updated');
  guestSocket.emit('take_seat', { roomId, seatIndex: 3, userId: guest.id });
  await guestTookSeat2;
  const hostGotGuestMusic = waitFor(hostSocket, 'room_music_update');
  guestSocket.emit('room_music_update', { roomId, userId: guest.id, seatIndex: 3, playing: true, trackId: 'coffee_rain', trackName: 'قهوة ومطر' });
  const guestMusic = await hostGotGuestMusic;
  ok('a seated guest can take over the music', Boolean(guestMusic && guestMusic.userId === guest.id && guestMusic.seatIndex === 3 && guestMusic.trackName === 'قهوة ومطر'), JSON.stringify(guestMusic));

  // 8f) kicking the player off their seat stops the music automatically
  const hostSawKick = waitFor(hostSocket, 'user_kicked_from_seat');
  const musicStopped = waitFor(hostSocket, 'room_music_update');
  hostSocket.emit('admin_kick_seat', { roomId, seatIndex: 3, adminId: hostId });
  await hostSawKick;
  const stoppedEvent = await musicStopped;
  ok('kicking the player auto-stops the music', Boolean(stoppedEvent && stoppedEvent.playing === false), JSON.stringify(stoppedEvent));
  joiner.close();

  console.log('\n9) التنظيف');
  const deleted = await api('DELETE', `/api/rooms/${roomId}`, null, { 'x-user-id': hostId });
  ok('test room deleted', deleted.status === 200 && deleted.data.success === true, JSON.stringify(deleted.data).slice(0, 120));
  hostSocket.close();
  guestSocket.close();

  console.log(`\n${failures === 0 ? '🎉 ALL ROOM V2 SERVER CHECKS PASSED' : `⚠️  ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('server test crashed:', err);
  process.exit(1);
});
