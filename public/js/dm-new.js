// =========================================================
// الرسائل الخاصة — الشكل الجديد (مطابق لفيديو «الرسائل الخاصة»)
// - شريط أدوات سفلي: + / هدية / مكالمة / صورة / تسجيل صوتي
// - المكالمة وإرسال الصور والتسجيل الصوتي لا تعمل إلا بعد المتابعة المتبادلة
//   (الخادم يفرض الشرط أيضاً، فلا يمكن تجاوزه من المتصفح)
// =========================================================
(function () {
  'use strict';

  const App = () => window.SoulChillApp || {};
  const toast = (m) => { const a = App(); if (a.showToast) a.showToast(m); };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICON = {
    plus: '<i class="f7-icons">plus_circle_fill</i>',
    phone: '<i class="f7-icons">phone_fill</i>',
    hang: '<i class="f7-icons" style="transform:rotate(135deg)">phone_fill</i>',
    image: '<i class="f7-icons">photo_fill</i>',
    mic: '<i class="f7-icons">mic_fill</i>',
    micOff: '<i class="f7-icons">mic_slash_fill</i>',
    smile: '<i class="f7-icons">smiley</i>',
    dots: '<i class="f7-icons">ellipsis</i>',
    back: '<i class="f7-icons">chevron_left</i>'
  };

  const QUICK_REPLIES = ['السلام عليكم', 'الطقس جميل اليوم، هل نتحاور قليلا؟'];
  const EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 ' +
    '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 👋 🤝 🙏 👏 🙌 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🔥 ✨ ⭐ 🌟 💫 🎉 🎊 🎁 🌹 🌸 🌺 🌻 🌙 ☀️ 🌈 ☕ 🍰 🍫 🍉 🍓').split(' ');

  // ---------------------------------------------------------
  // هيكل النافذة
  // ---------------------------------------------------------
  function shellHtml(partner, opts) {
    opts = opts || {};
    const name = esc(partner.name || '');
    const sub = esc(partner.soul_planet || 'كوكب الروح 🪐');
    const roomBanner = opts.activeRoom ? `
      <div style="background:rgba(139,92,246,.22);border-bottom:1px solid rgba(139,92,246,.4);padding:6px 14px;font-size:11px;color:#c084fc;display:flex;align-items:center;justify-content:space-between;">
        <span>🎙️ أنت متصل حالياً بالغرفة الصوتية [${esc(opts.activeRoom.title)}]</span>
        <span style="color:#10b981;font-weight:700;">● صوت الروم مستمر</span>
      </div>` : '';
    return `
      <div class="direct-chat-container dm-new">
        ${roomBanner}
        <div class="dm-head">
          <button type="button" class="dm-head-btn" id="close-chat-window-btn" aria-label="رجوع">${ICON.back}</button>
          <div class="dm-head-center" id="dm-head-profile">
            <span class="dm-name">${name}</span>
            <span class="dm-sub">${sub}</span>
          </div>
          ${opts.isStaff ? '<button type="button" class="dm-head-btn" id="chat-admin-credit-btn" title="شحن رصيد هذا المستخدم">💳</button>' : ''}
          <button type="button" class="dm-head-btn" id="dm-more-btn" aria-label="المزيد">${ICON.dots}</button>
        </div>

        <div class="direct-messages-stream" id="direct-chat-stream-box">
          <div style="text-align:center;padding:14px;color:#6b6b7b;font-size:11px;">🔒 محادثة خاصة مشفرة. كل ما يقال هنا بينكما فقط.</div>
        </div>

        <div class="recording-indicator-strip" id="voice-recording-strip">
          <span style="font-size:16px;">🔴</span>
          <span>جارِ تسجيل الرسالة الصوتية... <strong id="voice-recording-timer">00:00</strong></span>
          <button type="button" style="background:none;border:none;color:#fff;cursor:pointer;margin-right:auto;" id="cancel-voice-record-btn">إلغاء ✕</button>
        </div>

        <div class="dm-quick" id="dm-quick">
          ${QUICK_REPLIES.map((t) => `<button type="button" class="dm-chip" data-q="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>

        <div class="dm-input-row">
          <input type="text" id="direct-msg-input" placeholder="قل شيء..." autocomplete="off" />
          <button type="button" class="dm-send-btn" id="direct-send-btn" aria-label="إرسال" style="display:none">➤</button>
          <button type="button" class="dm-emoji-btn" id="dm-emoji-btn" aria-label="إيموجي">${ICON.smile}</button>
        </div>

        <div class="dm-emoji-panel" id="dm-emoji-panel"></div>

        <div class="dm-toolbar">
          <button type="button" class="dm-tool" id="dm-plus-btn" aria-label="المزيد">${ICON.plus}</button>
          <button type="button" class="dm-tool gift" id="chat-send-gift-btn" aria-label="هدية">🎁</button>
          <button type="button" class="dm-tool" id="dm-call-btn" data-gated aria-label="مكالمة">${ICON.phone}</button>
          <button type="button" class="dm-tool" id="dm-image-btn" data-gated aria-label="صورة">${ICON.image}</button>
          <button type="button" class="dm-tool voice-record-btn" id="mic-record-voice-btn" data-gated aria-label="تسجيل صوتي">${ICON.mic}</button>
        </div>
        <input type="file" id="dm-image-input" accept="image/*" hidden />
      </div>`;
  }

  // ---------------------------------------------------------
  // ربط السلوك بعد رسم النافذة
  // ---------------------------------------------------------
  function mount(modal, partner) {
    const A = App();
    const q = (s) => modal.querySelector(s);
    const box = q('.dm-new');
    if (!box) return; // الشكل القديم (fallback)

    let rel = { is_following: false, follows_me: false, loaded: false };
    const mutual = () => rel.loaded && rel.is_following && rel.follows_me;
    const gated = modal.querySelectorAll('[data-gated]');
    const applyLock = () => gated.forEach((el) => el.classList.toggle('dm-locked', !mutual()));
    applyLock();

    const refresh = async () => {
      if (!modal.isConnected) return;
      const st = A.fetchFollowStats ? await A.fetchFollowStats(partner.id) : null;
      if (st) rel = { is_following: !!st.is_following, follows_me: !!st.follows_me, loaded: true };
      applyLock();
    };
    refresh();
    const onFollowChanged = () => {
      if (!modal.isConnected) { window.removeEventListener('soul:follow-changed', onFollowChanged); return; }
      refresh();
    };
    window.addEventListener('soul:follow-changed', onFollowChanged);

    // ---------- الألواح السفلية ----------
    const openSheet = (html) => {
      closeSheet();
      const bd = document.createElement('div');
      bd.className = 'dm-sheet-backdrop';
      bd.innerHTML = `<div class="dm-sheet">${html}</div>`;
      bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(); });
      box.appendChild(bd);
      return bd;
    };
    const closeSheet = () => { const o = box.querySelector('.dm-sheet-backdrop'); if (o) o.remove(); };

    const lockSheet = () => {
      const nm = esc((partner.name || '').split(' ')[0] || 'هذا المستخدم');
      const row = (label, ok) => `<div class="dm-lock-row"><span>${label}</span><span class="${ok ? 'ok' : 'no'}">${ok ? '✓ تمّت' : '✗ لم تتم'}</span></div>`;
      let cta;
      if (!rel.is_following) cta = `<button type="button" class="dm-lock-cta" id="dm-lock-follow">➕ متابعة ${nm}</button>`;
      else if (!rel.follows_me) cta = '<button type="button" class="dm-lock-cta" disabled>⏳ بانتظار أن يتابعك بالمثل</button>';
      else cta = '';
      const bd = openSheet(`
        <div class="dm-lock-hero">
          <div class="big">🔒</div>
          <h3>الميزة مقفلة</h3>
          <p>المكالمات وإرسال الصور والرسائل الصوتية تُفعَّل فقط عندما تتابعان بعضكما.</p>
        </div>
        <div class="dm-lock-status">
          ${row(`أنت تتابع ${nm}`, rel.is_following)}
          ${row(`${nm} يتابعك`, rel.follows_me)}
        </div>
        ${cta}
        <button type="button" class="dm-sheet-item dm-sheet-cancel">حسناً</button>`);
      bd.querySelector('.dm-sheet-cancel').onclick = closeSheet;
      const fb = bd.querySelector('#dm-lock-follow');
      if (fb) fb.onclick = async () => {
        fb.disabled = true;
        const r = A.setFollow ? await A.setFollow(partner.id, true) : null;
        await refresh();
        if (!r) { fb.disabled = false; return; }
        if (mutual()) { closeSheet(); toast('🔓 تم تفعيل المكالمات والصور والتسجيل الصوتي'); }
        else lockSheet();
      };
    };

    // تنفيذ ميزة مقفلة: إن لم تكن المتابعة متبادلة يظهر لوح القفل
    const guard = async (fn) => {
      if (!mutual()) await refresh();
      if (mutual()) fn(); else lockSheet();
    };

    // ---------- الهيدر ----------
    q('#dm-head-profile').onclick = () => { if (A.showUserProfileCard) A.showUserProfileCard(partner); };

    q('#dm-more-btn').onclick = () => {
      const bd = openSheet(`
        <button type="button" class="dm-sheet-item" data-m="report">⚠️ إبلاغ</button>
        <button type="button" class="dm-sheet-item" data-m="unfollower">⛔ حذف المتابعين</button>
        <button type="button" class="dm-sheet-item danger" data-m="block">🚫 إضافة إلى قائمة الحظر</button>
        <button type="button" class="dm-sheet-item dm-sheet-cancel" data-m="cancel">إلغاء</button>`);
      bd.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        const act = b.dataset.m;
        closeSheet();
        if (act === 'cancel') return;
        const hdr = A.followHeaders ? A.followHeaders() : {};
        const id = encodeURIComponent(partner.id);
        try {
          if (act === 'report') {
            if (!(await window.uiConfirm('هل تريد الإبلاغ عن هذا المستخدم؟', { danger: true, okText: 'إبلاغ' }))) return;
            const r = await fetch(`/api/users/${id}/report`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'إبلاغ من المحادثة الخاصة' }) });
            toast(r.ok ? 'تم إرسال البلاغ، شكراً لك' : 'تعذر إرسال البلاغ');
          } else if (act === 'unfollower') {
            if (!(await window.uiConfirm('حذف هذا المستخدم من متابعيك؟', { danger: true, okText: 'حذف' }))) return;
            const r = await fetch(`/api/users/${id}/follower`, { method: 'DELETE', headers: hdr });
            toast(r.ok ? 'تم الحذف من متابعيك' : 'تعذر تنفيذ الطلب');
            refresh();
          } else if (act === 'block') {
            if (!(await window.uiConfirm('إضافة هذا المستخدم إلى قائمة الحظر؟', { danger: true, okText: 'حظر' }))) return;
            const r = await fetch(`/api/users/${id}/block`, { method: 'POST', headers: hdr });
            toast(r.ok ? 'تمت الإضافة إلى قائمة الحظر' : 'تعذر تنفيذ الطلب');
            refresh();
          }
        } catch (err) { toast('تعذر الاتصال بالخادم'); }
      });
    };

    // ---------- الردود السريعة + الكتابة ----------
    const input = q('#direct-msg-input');
    const quick = q('#dm-quick');
    const sendBtn = q('#direct-send-btn');
    input.addEventListener('input', () => {
      const has = input.value.trim().length > 0;
      quick.classList.toggle('hidden', has);
      sendBtn.style.display = has ? 'flex' : 'none';
    });
    sendBtn.addEventListener('click', () => setTimeout(() => input.dispatchEvent(new Event('input')), 0));
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') setTimeout(() => input.dispatchEvent(new Event('input')), 0); });
    quick.addEventListener('click', (e) => {
      const c = e.target.closest('.dm-chip');
      if (c && A.sendPrivateMessage) A.sendPrivateMessage(partner.id, 'text', c.dataset.q);
    });

    // ---------- الإيموجي ----------
    const panel = q('#dm-emoji-panel');
    q('#dm-emoji-btn').onclick = () => {
      if (!panel.dataset.built) {
        panel.innerHTML = EMOJIS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('');
        panel.dataset.built = '1';
      }
      panel.classList.toggle('open');
    };
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      input.value += b.dataset.e;
      input.dispatchEvent(new Event('input'));
      input.focus();
    });

    // ---------- الأدوات السفلية ----------
    const imgInput = q('#dm-image-input');
    q('#dm-image-btn').onclick = () => guard(() => imgInput.click());
    imgInput.onchange = async () => {
      const f = imgInput.files && imgInput.files[0];
      imgInput.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) return toast('اختر ملف صورة فقط');
      if (f.size > 10 * 1024 * 1024) return toast('حجم الصورة كبير (الحد 10 ميجابايت)');
      try {
        toast('⏳ جارِ رفع الصورة...');
        const fd = new FormData();
        fd.append('file', f, f.name);
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (d && d.success && d.url) await A.sendPrivateMessage(partner.id, 'image', '📷 صورة', d.url);
        else toast('تعذر رفع الصورة');
      } catch (e) { toast('تعذر رفع الصورة'); }
    };

    q('#dm-call-btn').onclick = () => guard(() => Call.start(partner));

    // التسجيل الصوتي: إيقاف التسجيل الجاري مسموح دائماً، أما البدء فيتطلب متابعة متبادلة
    q('#mic-record-voice-btn').onclick = () => {
      if (A.state && A.state.isRecordingVoiceNote) return A.toggleVoiceNoteRecording();
      guard(() => A.toggleVoiceNoteRecording());
    };

    q('#dm-plus-btn').onclick = () => {
      const cell = (id, icon, label, locked) => `<button type="button" class="dm-plus-cell ${locked && !mutual() ? 'dm-locked' : ''}" data-go="${id}">${icon}<span>${label}</span></button>`;
      const bd = openSheet(`
        <div class="dm-plus-grid">
          ${cell('image', ICON.image, 'صورة', true)}
          ${cell('mic', ICON.mic, 'رسالة صوتية', true)}
          ${cell('call', ICON.phone, 'مكالمة', true)}
          ${cell('gift', '<span style="font-size:24px;line-height:26px">🎁</span>', 'هدية', false)}
        </div>
        <button type="button" class="dm-sheet-item dm-sheet-cancel">إلغاء</button>`);
      bd.querySelector('.dm-sheet-cancel').onclick = closeSheet;
      bd.addEventListener('click', (e) => {
        const c = e.target.closest('[data-go]');
        if (!c) return;
        closeSheet();
        const map = { image: '#dm-image-btn', mic: '#mic-record-voice-btn', call: '#dm-call-btn', gift: '#chat-send-gift-btn' };
        const t = q(map[c.dataset.go]);
        if (t) t.click();
      });
    };
  }

  function viewImage(src) {
    const v = document.createElement('div');
    v.className = 'dm-image-viewer';
    v.innerHTML = `<img src="${esc(src)}" alt="" />`;
    v.onclick = () => v.remove();
    document.body.appendChild(v);
  }

  // =========================================================
  // المكالمات الصوتية الخاصة (WebRTC + إشارات socket.io)
  // =========================================================
  const Call = (function () {
    const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
    let ov = null, pc = null, local = null, callId = null, peer = null, role = null;
    let timer = null, secs = 0, pendingIce = [], remoteSet = false, cancelPending = false;
    let ringCtx = null, ringTimer = null, bound = null, handlers = null;

    const sock = () => (App().state && App().state.socket) || null;
    const busy = () => !!(ov || pc || callId);

    function startRing(freq) {
      stopRing();
      try {
        ringCtx = new (window.AudioContext || window.webkitAudioContext)();
        const beep = () => {
          if (!ringCtx) return;
          const o = ringCtx.createOscillator(), g = ringCtx.createGain();
          o.frequency.value = freq; g.gain.value = 0.07;
          o.connect(g); g.connect(ringCtx.destination);
          o.start(); o.stop(ringCtx.currentTime + 0.45);
        };
        beep();
        ringTimer = setInterval(beep, 1600);
        if (navigator.vibrate && freq === 520) navigator.vibrate([400, 300, 400]);
      } catch (e) { /* قد يمنع المتصفح الصوت قبل أي تفاعل */ }
    }
    function stopRing() {
      if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
      if (ringCtx) { try { ringCtx.close(); } catch (e) {} ringCtx = null; }
    }

    function setStatus(t) { const el = ov && ov.querySelector('#dm-call-status'); if (el) el.textContent = t; }

    function render(mode) {
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'dm-call-overlay';
        ov.innerHTML = `
          <div class="dm-call-top">
            <img class="dm-call-avatar" src="${esc(peer.avatar || '')}" alt="" />
            <div class="dm-call-name">${esc(peer.name || '')}</div>
            <div class="dm-call-status" id="dm-call-status"></div>
          </div>
          <audio id="dm-call-audio" autoplay playsinline></audio>
          <div class="dm-call-actions" id="dm-call-actions"></div>`;
        document.body.appendChild(ov);
      }
      const act = ov.querySelector('#dm-call-actions');
      if (mode === 'incoming') {
        act.innerHTML = `
          <button type="button" class="dm-call-btn hang" id="dm-call-reject" aria-label="رفض">${ICON.hang}</button>
          <button type="button" class="dm-call-btn accept" id="dm-call-accept" aria-label="رد">${ICON.phone}</button>`;
        act.querySelector('#dm-call-reject').onclick = reject;
        act.querySelector('#dm-call-accept').onclick = accept;
        setStatus('مكالمة صوتية واردة…');
      } else {
        act.innerHTML = `
          <button type="button" class="dm-call-btn" id="dm-call-mute" aria-label="كتم">${ICON.mic}</button>
          <button type="button" class="dm-call-btn hang" id="dm-call-hang" aria-label="إنهاء">${ICON.hang}</button>`;
        act.querySelector('#dm-call-hang').onclick = hangup;
        const mb = act.querySelector('#dm-call-mute');
        mb.onclick = () => {
          if (!local) return;
          const track = local.getAudioTracks()[0];
          if (!track) return;
          track.enabled = !track.enabled;
          mb.classList.toggle('on', !track.enabled);
          mb.innerHTML = track.enabled ? ICON.mic : ICON.micOff;
        };
      }
    }

    async function getMic() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
        return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        toast('تعذر الوصول إلى المايكروفون — اسمح بالإذن من المتصفح');
        return null;
      }
    }

    function makePc() {
      pc = new RTCPeerConnection(RTC_CFG);
      remoteSet = false; pendingIce = [];
      local.getTracks().forEach((t) => pc.addTrack(t, local));
      pc.onicecandidate = (e) => {
        if (e.candidate && sock() && callId) sock().emit('dm_call_signal', { callId, data: { candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        const a = ov && ov.querySelector('#dm-call-audio');
        if (a) { a.srcObject = e.streams[0]; const p = a.play(); if (p && p.catch) p.catch(() => {}); }
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === 'connected') onConnected();
        else if (pc.connectionState === 'failed') { toast('انقطع الاتصال'); hangup(); }
      };
    }

    function onConnected() {
      if (timer) return;
      stopRing();
      if (ov) ov.classList.add('connected');
      secs = 0;
      const tick = () => { const m = String(Math.floor(secs / 60)).padStart(2, '0'); const s = String(secs % 60).padStart(2, '0'); setStatus(`${m}:${s}`); };
      tick();
      timer = setInterval(() => { secs++; tick(); }, 1000);
    }

    function cleanup() {
      stopRing();
      if (timer) { clearInterval(timer); timer = null; }
      if (pc) { try { pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); } catch (e) {} pc = null; }
      if (local) { local.getTracks().forEach((t) => t.stop()); local = null; }
      if (ov) { ov.remove(); ov = null; }
      callId = null; peer = null; role = null; pendingIce = []; remoteSet = false; secs = 0;
    }

    // ---------- إجراءات المستخدم ----------
    async function start(partner) {
      if (busy()) return toast('أنت في مكالمة بالفعل');
      if (!sock()) return toast('الاتصال بالخادم غير جاهز');
      peer = partner; role = 'caller'; cancelPending = false;
      local = await getMic();
      if (!local) { cleanup(); return; }
      render('calling');
      setStatus('جارِ الاتصال…');
      startRing(440);
      sock().emit('dm_call_invite', { toUserId: partner.id });
    }

    async function accept() {
      if (!callId) return;
      stopRing();
      local = await getMic();
      if (!local) { sock().emit('dm_call_reject', { callId }); cleanup(); return; }
      makePc();
      render('calling');
      setStatus('جارِ الاتصال…');
      sock().emit('dm_call_accept', { callId });
    }

    function reject() { if (sock() && callId) sock().emit('dm_call_reject', { callId }); cleanup(); }

    function hangup() {
      if (sock() && callId) sock().emit('dm_call_end', { callId });
      else if (role === 'caller') cancelPending = true; // أُرسلت الدعوة ولم يصل رقم المكالمة بعد: تُلغى فور وصوله
      cleanup();
    }

    // ---------- أحداث الخادم ----------
    async function onSignal({ callId: id, data }) {
      if (id !== callId || !pc || !data) return;
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          remoteSet = true;
          for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
          pendingIce = [];
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          sock().emit('dm_call_signal', { callId, data: { type: 'answer', sdp: ans.sdp } });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          remoteSet = true;
          for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
          pendingIce = [];
        } else if (data.candidate) {
          if (remoteSet) await pc.addIceCandidate(data.candidate).catch(() => {});
          else pendingIce.push(data.candidate);
        }
      } catch (e) { console.error('call signal error', e); }
    }

    function bind(s) {
      if (bound === s) return;
      if (bound && handlers) Object.keys(handlers).forEach((k) => bound.off(k, handlers[k]));
      bound = s;
      handlers = {
        dm_call_ringing: ({ callId: id }) => {
          if (cancelPending) { cancelPending = false; s.emit('dm_call_end', { callId: id }); return; }
          if (role !== 'caller' || callId) return;
          callId = id;
          setStatus('جارِ الرنين…');
        },
        dm_call_denied: ({ message }) => {
          cancelPending = false;
          if (role === 'caller') { toast(message || 'تعذر إجراء المكالمة'); cleanup(); }
        },
        dm_call_incoming: ({ callId: id, from }) => {
          if (busy()) { s.emit('dm_call_reject', { callId: id }); return; }
          callId = id; peer = from; role = 'callee';
          render('incoming');
          startRing(520);
        },
        dm_call_accepted: async ({ callId: id }) => {
          if (id !== callId || role !== 'caller' || !local) return;
          try {
            makePc();
            setStatus('جارِ الاتصال…');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            s.emit('dm_call_signal', { callId, data: { type: 'offer', sdp: offer.sdp } });
          } catch (e) { console.error(e); toast('تعذر بدء المكالمة'); hangup(); }
        },
        dm_call_signal: onSignal,
        dm_call_ended: ({ callId: id, reason }) => {
          if (id !== callId) return;
          const msg = { rejected: 'تم رفض المكالمة', no_answer: 'لم يتم الرد', disconnected: 'انقطع الاتصال', ended: 'انتهت المكالمة' }[reason];
          if (msg && reason !== 'answered_elsewhere') toast(msg);
          cleanup();
        }
      };
      Object.keys(handlers).forEach((k) => s.on(k, handlers[k]));
    }

    // الـ socket يُنشأ بعد تسجيل الدخول؛ نراقبه ونعيد الربط إذا تغيّر
    setInterval(() => { const s = sock(); if (s) bind(s); }, 1000);

    return { start };
  })();

  window.SoulDM = { shellHtml, mount, viewImage, Call };
})();
