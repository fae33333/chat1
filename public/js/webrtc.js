// =========================================================
// SoulChill LiveKit Audio & Video Streaming Engine
// البث الصوتي والمرئي المباشر (الراديو والكاميرا والميكروفون) عبر LiveKit
// — استبدل تمامًا اتصالات WebRTC P2P القديمة بمكتبة livekit-client ESM.
// يدعم: مقاعد الصوت (Mic seats)، بث الكاميرا، البث المشترك (Co-host/PK)،
// إعادة الانضمام بعد انقطاع الشبكة، دمج الموسيقى مع المايك، والكتم.
// =========================================================

class SoulRtcEngine {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.currentRoomId = null;
    this.localStream = null;
    this.localCohostStream = null;
    this.localAudioStream = null;
    this.remoteHostStream = null;
    this.remoteCohostStream = null;
    this.isBroadcastingVideo = false;
    this.isBroadcastingCohost = false;
    this.isBroadcastingVoice = false;
    this.isVoiceMuted = false;
    this.userAudioMap = new Map(); // userId -> Set of HTMLAudioElement
    // Camera mirroring preference: default to natural selfie mirror
    this.isCameraMirrored = sessionStorage.getItem('soulchill_video_mirror') !== '0';
    this.peerConnections = new Map(); // معطّل — يُترك للتوافق مع الواجهات القديمة (لا RTCPeerConnection بعد الآن)
    this.audioElements = new Map(); // key -> HTMLAudioElement
    // LiveKit room state
    this.lkRoom = null;
    this.lkRoomName = null;
    this.lkJoinPromise = null;
    this.lkShouldJoin = false; // إعادة الانضمام تلقائيًا عند فقدان الاتصال
    this._micChain = Promise.resolve(); // تسلسل نشر/استبدال مسار المايك
    this._deadSids = new Set();        // مسارات صوت أُسكتت صراحةً (طرد/نزول) فلا يعيد المزامِن ربطها
    this._voiceOp = 0;                 // رقم عملية الصوت: يلغي أي صعود قيد التنفيذ إذا نزلنا قبل اكتماله
    this._voiceStartPromise = null;    // يمنع فتح مايكين عند استدعاءات صعود متزامنة
    this._voiceStartRoom = null;
    this._pendingPlay = new Set();     // عناصر audio منعها المتصفح (autoplay) لإعادة تشغيلها عند أول لمسة
    this._gestureBound = false;
  }

  toggleCameraMirroring(explicitState = null) {
    if (explicitState !== null) {
      this.isCameraMirrored = explicitState;
    } else {
      this.isCameraMirrored = !this.isCameraMirrored;
    }
    sessionStorage.setItem('soulchill_video_mirror', this.isCameraMirrored ? '1' : '0');
    this.applyCameraMirroring();
    return this.isCameraMirrored;
  }

  applyCameraMirroring() {
    const hostVideo = document.getElementById('stream-host-video');
    const hostSplitVideo = document.getElementById('stream-split-host-video');
    const guestVideo = document.getElementById('stream-split-guest-video');

    if (this.isBroadcastingVideo) {
      if (hostVideo) hostVideo.style.transform = this.isCameraMirrored ? 'scaleX(-1)' : 'scaleX(1)';
      if (hostSplitVideo) hostSplitVideo.style.transform = this.isCameraMirrored ? 'scaleX(-1)' : 'scaleX(1)';
    }

    if (this.isBroadcastingCohost) {
      if (guestVideo) guestVideo.style.transform = this.isCameraMirrored ? 'scaleX(-1)' : 'scaleX(1)';
    }
  }

  init(socket, currentUser) {
    this.socket = socket;
    this.currentUser = currentUser;

    if (!this.socket) return;

    // مراقبة دورية + عند العودة للتطبيق/الشبكة: نتأكد أن صوتي حي وأن غرفة LiveKit متصلة
    if (!this._watchdogStarted) {
      this._watchdogStarted = true;
      const check = () => {
        if (this.isBroadcastingVoice) this.ensureVoiceAlive().catch(() => {});
        if (this.lkShouldJoin && this.currentRoomId && (!this.lkRoom || this.lkRoom.state === 'disconnected')) {
          this.requestRoomStream(this.currentRoomId);
        }
        // شبكة أمان: أي مسار صوت مشترَك بلا عنصر تشغيل يُربط، وأي عنصر بلا مسار حي يُزال
        this._syncRemoteAudio();
      };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(check, 300); });
      window.addEventListener('online', () => setTimeout(check, 800));
      window.addEventListener('focus', () => setTimeout(check, 300));
      setInterval(check, 4000);
    }

    // البث ينضم لمجموعة LiveKit تلقائيًا (autoSubscribe) — لا حاجة لإشارات
    // العرض/الإجابة/ICE القديمة (webrtc_signal_* حُذفت نهائيًا).

    // البث انتهى عند المتحدث (يحمله الخادم لبقية العملاء) — ننظّف واجهاتنا
    this.socket.on('webrtc_stream_ended', ({ senderSocketId, streamType, userId }) => {
      // لا نحذف صوت المتحدث هنا مباشرةً: هذا الحدث (سوكت) قد يصل متأخرًا بعد أن صعد
      // (هو أو غيره) ونُشر مسار جديد، فكان يقتل الصوت الجديد. التنظيف الفعلي يتم عبر
      // TrackUnsubscribed ثم مطابقة حالة LiveKit الحقيقية.
      if (userId) {
        setTimeout(() => this._syncRemoteAudio(), 700);
      }
      if (senderSocketId) {
        this.closePeer(`receiver:${streamType}:${senderSocketId}`);
        this.closePeer(senderSocketId);
        const audioKey = `${streamType || 'audio'}:${senderSocketId}`;
        const audioEl = this.audioElements.get(audioKey);
        if (audioEl) {
          try {
            audioEl.pause();
            audioEl.srcObject = null;
            audioEl.remove();
          } catch (e) {}
          this.audioElements.delete(audioKey);
        }
      }
      if (streamType === 'video_broadcast') {
        this.remoteHostStream = null;
        const videoEl = document.getElementById('stream-host-video');
        const hostSplit = document.getElementById('stream-split-host-video');
        const fallback = document.getElementById('stream-fallback-container');
        if (videoEl) videoEl.style.display = 'none';
        if (hostSplit) hostSplit.srcObject = null;
        if (fallback) fallback.style.display = 'flex';
      } else if (streamType === 'cohost_video') {
        this.remoteCohostStream = null;
        const cohostVideo = document.getElementById('stream-split-guest-video');
        if (cohostVideo) cohostVideo.srcObject = null;
      }
    });

    // إيقاف قسري للمتحدثين (إدارة/مشرف) — نصمت صوت هؤلاء المستخدمين محليًا
    this.socket.on('webrtc_speakers_force_stopped', ({ userIds }) => {
      if (Array.isArray(userIds)) {
        userIds.forEach(uid => this.removeRemoteUserAudio(uid));
      }
    });

    // متحدث جديد صعد وبدأ البث: نتأكد فورًا أن غرفتنا متصلة وأن صوته رُبط (بدل انتظار المراقِب الدوري)
    this.socket.on('webrtc_broadcaster_ready', () => {
      if (!this.currentRoomId) return;
      if (!this.lkRoom || this.lkRoom.state === 'disconnected') {
        this.requestRoomStream(this.currentRoomId);
        return;
      }
      [400, 1500, 3500].forEach(ms => setTimeout(() => this._syncRemoteAudio(), ms));
    });

    // الإدارة حفظت إعدادات LiveKit أثناء وجودنا في غرفة: ننضم فورًا بلا إعادة تحميل
    this.socket.on('livekit_settings_updated', ({ configured } = {}) => {
      if (configured && this.currentRoomId && (!this.lkRoom || this.lkRoom.state === 'disconnected')) {
        this.requestRoomStream(this.currentRoomId);
      }
    });
  }

  setCurrentRoom(roomId) {
    if (this.currentRoomId && this.currentRoomId !== roomId) {
      this.leaveCurrentRoom();
    }
    this.currentRoomId = roomId;
  }

  // ==================================================
  // LiveKit: اسم الغرفة + الانضمام والنشر
  // ==================================================
  _livekitRoomName(roomId) {
    const raw = `sc-${roomId}`;
    return raw.replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 64) || null;
  }

  // الانضمام إلى غرفة LiveKit للغرفة الحالية (مرة واحدة لكل اسم غرفة)
  async _ensureLiveKitRoom(roomId) {
    if (!window.scLivekit) {
      const e = new Error('LIVEKIT_MISSING');
      e.code = 'LIVEKIT_MISSING';
      throw e;
    }
    const want = this._livekitRoomName(roomId);
    if (!want) throw new Error('اسم غرفة LiveKit غير صالح');

    // أي حالة غير 'disconnected' (ومنها reconnecting) تعني أن الغرفة حية: لا نهدمها ونبنيها من جديد
    // (كان ذلك يقطع الاستماع للجميع كلما استُدعيت الدالة أثناء إعادة اتصال تلقائية).
    if (this.lkRoom && this.lkRoomName === want && this.lkRoom.state !== 'disconnected') {
      return this.lkRoom;
    }
    if (this.lkJoinPromise) {
      try { await this.lkJoinPromise; } catch (e) {}
      if (this.lkRoom && this.lkRoomName === want && this.lkRoom.state !== 'disconnected') return this.lkRoom;
    }
    if (this.lkRoom) {
      try { this.lkRoom.disconnect(); } catch (e) {}
      this.lkRoom = null;
      this.lkRoomName = null;
      this._teardownRemoteMedia();
    }

    this.lkJoinPromise = (async () => {
      const liveId = (window.SoulChillApp && window.SoulChillApp.state && window.SoulChillApp.state.currentUser && window.SoulChillApp.state.currentUser.id) || '';
      const room = await window.scLivekit.joinRoom(want, this._livekitHandlers(), {
        userId: liveId || (this.currentUser && this.currentUser.id) || ''
      });
      this.lkRoom = room;
      this.lkRoomName = want;
      // إعادة النشر بعد إعادة الانضمام (انقطاع شبكة / إعادة اتصال السوكت):
      // المايك والكاميرا ما زالت محلية لدينا فنعيد إرسالها دون المساس بها.
      try {
        if (this.isBroadcastingVoice && this.localAudioStream) {
          await this._publishMicTrack(this.localAudioStream); // idempotent: يستبدل أي نشر ميت
        }
        if (this.isBroadcastingVideo && this.localStream && !room.localParticipant.getTrackPublicationByName('video_broadcast')) {
          const vt = this.localStream.getVideoTracks()[0];
          if (vt) await this._publishVideoTrack(vt, 'video_broadcast');
        }
        if (this.isBroadcastingCohost && this.localCohostStream && !room.localParticipant.getTrackPublicationByName('cohost_video')) {
          const ct = this.localCohostStream.getVideoTracks()[0];
          if (ct) await this._publishVideoTrack(ct, 'cohost_video');
        }
      } catch (e) {
        console.warn('LiveKit republish after join failed:', e);
      }
      // بعد الانضمام: اربط أصوات من هم على المقاعد الآن (إن فاتتنا أحداثهم)
      [600, 2000].forEach(ms => setTimeout(() => this._syncRemoteAudio(), ms));
    })();

    try {
      await this.lkJoinPromise;
      this.lkShouldJoin = true;
      return this.lkRoom;
    } finally {
      this.lkJoinPromise = null;
    }
  }

  // معالجات أحداث الغرفة: الصوت يُركّب كعناصر audio لكل مستخدم (نفس عقد القديم
  // حتى تبقى كتم/إزالة/حلقات الصوت تعمل)، والفيديو يُوجَّه حسب اسم المسار.
  _livekitHandlers() {
    return {
      onTrackSubscribed: (track, publication, participant) => this._onRemoteTrack(track, publication, participant),
      onTrackUnsubscribed: (track, publication, participant) => this._onRemoteTrackUnsubscribed(track, publication, participant),
      onParticipantDisconnected: (participant) => {
        // نحذف صوت هذه الجلسة بعينها فقط (identity كاملة). حذف كل صوت المستخدم كان يقتل جلسته
        // الجديدة عندما تتأخر LiveKit في إسقاط جلسته القديمة بعد إعادة اتصال أو فتح تبويب ثانٍ.
        this._removeAudioByIdentity(participant && participant.identity);
      },
      onReconnected: () => {
        [500, 2000].forEach(ms => setTimeout(() => this._syncRemoteAudio(), ms));
        if (this.isBroadcastingVoice) this.ensureVoiceAlive().catch(() => {});
      },
      onAudioPlaybackChanged: (canPlay) => {
        if (canPlay) this._resumePendingPlayback();
      },
      onConnectionStateChanged: (state) => {
        // حالة إعادة الاتصال تُدار تلقائيًا بواسطة LiveKit؛ نراقب فقط
        if (state === 'disconnected' && this.lkShouldJoin && this.currentRoomId) {
          setTimeout(() => {
            if (this.lkShouldJoin && this.currentRoomId && (!this.lkRoom || this.lkRoom.state === 'disconnected')) {
              this.requestRoomStream(this.currentRoomId);
            }
          }, 1500);
        }
      }
    };
  }

  // الهوية = معرّف المستخدم + '~' + لاحقة فريدة لكل انضمام (تمنع دفع علبة تبويب مزدوجة)
  _identityUserId(participant) {
    const idn = participant && participant.identity ? String(participant.identity) : '';
    if (!idn) return null;
    return idn.split('~')[0] || null;
  }

  _onRemoteTrack(track, publication, participant) {
    try {
      const uid = this._identityUserId(participant);
      if (track.kind === 'video') {
        const name = (publication && publication.trackName) || '';
        const stream = track.mediaStream || new MediaStream([track.mediaStreamTrack]);
        if (name === 'cohost_video') {
          this._attachCohostVideo(stream);
        } else {
          this._attachHostVideo(stream);
        }
      } else if (track.kind === 'audio') {
        this._attachRemoteAudio(track, publication, uid, participant && participant.identity);
      }
    } catch (e) {
      console.warn('LiveKit track attach error:', e);
    }
  }

  _attachHostVideo(remoteStream) {
    this.remoteHostStream = remoteStream;
    const hostVideo = document.getElementById('stream-host-video');
    const hostSplitVideo = document.getElementById('stream-split-host-video');
    const fallback = document.getElementById('stream-fallback-container');

    if (hostVideo) {
      hostVideo.srcObject = remoteStream;
      hostVideo.style.display = 'block';
      hostVideo.style.transform = 'scaleX(1)'; // Remote incoming stream is unmirrored
      hostVideo.play().catch(e => console.log('Host video play caught:', e));
    }
    if (hostSplitVideo) {
      hostSplitVideo.srcObject = remoteStream;
      hostSplitVideo.style.display = 'block';
      hostSplitVideo.style.transform = 'scaleX(1)'; // Remote incoming stream is unmirrored
      hostSplitVideo.play().catch(e => console.log('Host video play caught:', e));
    }
    if (fallback) fallback.style.display = 'none';
  }

  _attachCohostVideo(remoteStream) {
    this.remoteCohostStream = remoteStream;
    const guestVideo = document.getElementById('stream-split-guest-video');
    if (guestVideo) {
      guestVideo.srcObject = remoteStream;
      guestVideo.style.display = 'block';
      guestVideo.style.transform = 'scaleX(1)'; // Remote incoming stream is unmirrored
      guestVideo.play().catch(e => console.log('Co-host video play caught:', e));
    }
  }

  _attachRemoteAudio(track, publication, uid, identity) {
    const sid = (publication && publication.trackSid) || Math.random().toString(36).slice(2);
    const audioKey = `lk:${sid}`;
    this._deadSids.delete(sid); // مسار جديد (sid جديد) ⇒ ليس من المُسكتين
    const remoteStream = track.mediaStream || new MediaStream([track.mediaStreamTrack]);

    let audioEl = this.audioElements.get(audioKey);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      this.audioElements.set(audioKey, audioEl);
    }
    audioEl.dataset.attachedAt = String(Date.now());
    if (identity) audioEl.dataset.identity = String(identity);
    if (uid) {
      const uidStr = String(uid);
      audioEl.dataset.userId = uidStr;
      if (!this.userAudioMap.has(uidStr)) {
        this.userAudioMap.set(uidStr, new Set());
      }
      this.userAudioMap.get(uidStr).add(audioEl);
    }
    audioEl.dataset.streamType = 'voice_seat';
    audioEl.muted = false;
    audioEl.volume = 1;
    if (audioEl.srcObject !== remoteStream) audioEl.srcObject = remoteStream;
    this._tryPlay(audioEl);
    // تذبذبات حول صورة المتحدث حسب مستوى صوته (ويشمل الأغنية التي يشغّلها)
    if (uid && window.voiceRings) window.voiceRings.watchStream(String(uid), remoteStream, 'rtc:' + audioKey);
  }

  // تشغيل عنصر الصوت؛ إن منعه المتصفح (autoplay) نعيد المحاولة عند أول لمسة/نقرة
  _tryPlay(el) {
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.then(() => this._pendingPlay.delete(el)).catch(err => {
          if (err && err.name === 'AbortError') {
            // انقطع بسبب تغيير srcObject — نعيد المحاولة بعد لحظة
            setTimeout(() => { if (el.isConnected && el.paused) this._tryPlay(el); }, 250);
            return;
          }
          this._pendingPlay.add(el);
          this._bindGestureResume();
        });
      }
    } catch (e) { /* تجاهل */ }
  }

  _bindGestureResume() {
    if (this._gestureBound) return;
    this._gestureBound = true;
    const resume = () => this._resumePendingPlayback();
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev =>
      document.addEventListener(ev, resume, { passive: true, capture: true }));
  }

  _resumePendingPlayback() {
    try { if (this.lkRoom && this.lkRoom.canPlaybackAudio === false) this.lkRoom.startAudio(); } catch (e) {}
    Array.from(this._pendingPlay).forEach(el => {
      if (!el.isConnected) { this._pendingPlay.delete(el); return; }
      const p = el.play();
      if (p && typeof p.then === 'function') p.then(() => this._pendingPlay.delete(el)).catch(() => {});
    });
  }

  // إزالة عنصر صوت واحد بالكامل (دون إيقاف المسار البعيد: LiveKit هو من يملكه وقد يعيد استخدامه)
  _dropAudioKey(key, markDead) {
    const el = this.audioElements.get(key);
    if (key && key.startsWith('lk:')) {
      const sid = key.slice(3);
      if (markDead) this._deadSids.add(sid);
    }
    if (!el) return;
    try {
      if (window.voiceRings && el.dataset && el.dataset.userId) window.voiceRings.unwatch(el.dataset.userId, 'rtc:' + key);
    } catch (e) {}
    try {
      el.pause();
      el.srcObject = null;
      el.remove();
    } catch (e) {}
    this._pendingPlay.delete(el);
    for (const set of this.userAudioMap.values()) set.delete(el);
    for (const [u, set] of Array.from(this.userAudioMap.entries())) { if (!set.size) this.userAudioMap.delete(u); }
    this.audioElements.delete(key);
  }

  _removeAudioByIdentity(identity) {
    if (!identity) return;
    const idn = String(identity);
    for (const [key, el] of Array.from(this.audioElements.entries())) {
      if (el.dataset && el.dataset.identity === idn) this._dropAudioKey(key, false);
    }
  }

  // مطابقة حالة الصوت عندنا مع حالة LiveKit الفعلية:
  //  - مسار صوت مشترَك بلا عنصر تشغيل (أُزيل خطأً/فاته حدث) ⇒ يُربط من جديد
  //  - عنصر تشغيل لمسار اختفى أو مات ⇒ يُزال
  _syncRemoteAudio() {
    const room = this.lkRoom;
    if (!room || room.state === 'disconnected') return;
    const present = new Set();
    try {
      room.remoteParticipants.forEach(p => {
        p.audioTrackPublications.forEach(pub => {
          const t = pub.track;
          if (!pub.isSubscribed || !t) return;
          const mst = t.mediaStreamTrack;
          if (mst && mst.readyState === 'ended') return;
          const sid = pub.trackSid;
          present.add(sid);
          if (this._deadSids.has(sid)) return;
          const key = `lk:${sid}`;
          const el = this.audioElements.get(key);
          if (!el) {
            this._attachRemoteAudio(t, pub, this._identityUserId(p), p.identity);
          } else {
            if (!el.srcObject) { const ms = t.mediaStream || new MediaStream([t.mediaStreamTrack]); el.srcObject = ms; }
            if (el.paused) this._tryPlay(el);
          }
        });
      });
    } catch (e) {
      console.warn('syncRemoteAudio failed:', e);
      return;
    }
    for (const [key] of Array.from(this.audioElements.entries())) {
      if (key.startsWith('lk:') && !present.has(key.slice(3))) this._dropAudioKey(key, false);
    }
    for (const sid of Array.from(this._deadSids)) { if (!present.has(sid)) this._deadSids.delete(sid); }
  }

  _onRemoteTrackUnsubscribed(track, publication, participant) {
    try {
      if (track.kind === 'audio') {
        const sid = publication && publication.trackSid;
        if (sid) {
          this._dropAudioKey(`lk:${sid}`, false);
          this._deadSids.delete(sid);
        }
        return;
      }
      const name = (publication && publication.trackName) || '';
      if (name === 'cohost_video') {
        this.remoteCohostStream = null;
        const cohostVideo = document.getElementById('stream-split-guest-video');
        if (cohostVideo) cohostVideo.srcObject = null;
      } else {
        // livekit-client v2: videoTrackPublications (الخاصية القديمة videoTracks لم تعد موجودة)
        let stillHas = false;
        try {
          if (participant && participant.videoTrackPublications) {
            participant.videoTrackPublications.forEach(pub => {
              if (pub && pub.track && pub.trackSid !== (publication && publication.trackSid) && pub.trackName !== 'cohost_video') stillHas = true;
            });
          }
        } catch (e) {}
        if (!stillHas) {
          this.remoteHostStream = null;
          const videoEl = document.getElementById('stream-host-video');
          const hostSplit = document.getElementById('stream-split-host-video');
          const fallback = document.getElementById('stream-fallback-container');
          if (videoEl) videoEl.style.display = 'none';
          if (hostSplit) hostSplit.srcObject = null;
          if (fallback) fallback.style.display = 'flex';
        }
      }
    } catch (e) {
      console.warn('LiveKit track detach error:', e);
    }
  }

  // تنظيف كل واجهات البث البعيدة (فيديو + صوت) دون المساس بالمسارات المحلية
  _teardownRemoteMedia() {
    for (const [key, el] of Array.from(this.audioElements.entries())) {
      try {
        if (window.voiceRings && el.dataset && el.dataset.userId) window.voiceRings.unwatch(el.dataset.userId, 'rtc:' + key);
      } catch (e) {}
      try { el.pause(); el.srcObject = null; el.remove(); } catch (e) {}
      this.audioElements.delete(key);
    }
    this.userAudioMap.clear();
    this._deadSids.clear();
    this._pendingPlay.clear();
    this.remoteHostStream = null;
    this.remoteCohostStream = null;

    const videoEl = document.getElementById('stream-host-video');
    const hostSplit = document.getElementById('stream-split-host-video');
    const guestVideo = document.getElementById('stream-split-guest-video');
    const fallback = document.getElementById('stream-fallback-container');
    if (videoEl) { try { videoEl.pause(); } catch (e) {} videoEl.srcObject = null; videoEl.style.display = 'none'; }
    if (hostSplit) hostSplit.srcObject = null;
    if (guestVideo) guestVideo.srcObject = null;
    if (fallback) fallback.style.display = 'flex';
  }

  // نشر مسار المايك (يُستعمل أيضًا لاستبداله عند دمج الموسيقى) — بتسلسل آمن
  _publishMicTrack(stream) {
    const run = async () => {
      const room = this.lkRoom;
      if (!room || !stream) return null;
      const track = stream.getAudioTracks()[0];
      if (!track) return null;
      const lp = room.localParticipant;
      try {
        const existing = lp.getTrackPublication('microphone');
        if (existing && existing.track && existing.track.mediaStreamTrack === track) return existing;
        if (existing && existing.track) {
          try { await lp.unpublishTrack(existing.track, false); } catch (e) { console.warn('mic unpublish:', e); }
        }
        return await lp.publishTrack(track, { source: 'microphone', name: 'mic' });
      } catch (err) {
        console.warn('LiveKit mic publish failed:', err);
        return null;
      }
    };
    this._micChain = this._micChain.catch(() => {}).then(run);
    return this._micChain;
  }

  // نشر مسار كاميرا باسم يحدّد مسار العرض عند المشاهدين
  async _publishVideoTrack(track, name) {
    const room = this.lkRoom;
    if (!room || !track) return null;
    const lp = room.localParticipant;
    try {
      const existing = lp.getTrackPublicationByName(name);
      if (existing && existing.track && existing.track.mediaStreamTrack === track) return existing;
      if (existing && existing.track) {
        try { await lp.unpublishTrack(existing.track, false); } catch (e) {}
      }
      return await lp.publishTrack(track, { source: 'camera', name });
    } catch (err) {
      console.warn(`LiveKit video publish failed (${name}):`, err);
      return null;
    }
  }

  // هل يوجد نشر مايك حي فعلًا؟ (النشر الميت = مسار متوقف ما زال مسجّلًا في الغرفة)
  _hasLiveMicPub() {
    const room = this.lkRoom;
    if (!room) return false;
    try {
      const pub = room.localParticipant.getTrackPublication('microphone');
      const mst = pub && pub.track && pub.track.mediaStreamTrack;
      return !!(mst && mst.readyState === 'live');
    } catch (e) { return false; }
  }

  // إلغاء نشر المايك. النشر يتم بالمصدر 'microphone' (واسم 'mic') — البحث القديم بالاسم 'microphone'
  // لم يكن يجد شيئًا فيبقى نشر ميت يمنع نشر المايك عند الصعود التالي.
  // preserve: مجموعة مسارات (كاميرا/مضيف مشارك) لا نلغي نشرها لأنها ليست مايك المقعد.
  _unpublishMic(preserveTracks) {
    const run = async () => {
      const room = this.lkRoom;
      if (!room) return;
      const lp = room.localParticipant;
      const pubs = [];
      try {
        lp.audioTrackPublications.forEach(pub => {
          if (pub.source === 'microphone' || pub.trackName === 'mic') pubs.push(pub);
        });
      } catch (e) {}
      for (const pub of pubs) {
        const t = pub.track;
        if (!t) continue;
        if (preserveTracks && preserveTracks.has(t.mediaStreamTrack)) continue;
        try { await lp.unpublishTrack(t, false); } catch (e) { console.warn('mic unpublish:', e); }
      }
      // مضيف بث/مشارك فيديو نزل من المقعد: يبقى صوت كاميرته منشورًا
      try {
        const vs = (this.isBroadcastingVideo && this.localStream) || (this.isBroadcastingCohost && this.localCohostStream) || null;
        const at = vs && vs.getAudioTracks().find(x => x.readyState === 'live');
        if (at && !this.isBroadcastingVoice && !this._hasLiveMicPub()) {
          await lp.publishTrack(at, { source: 'microphone', name: 'mic' });
        }
      } catch (e) {}
    };
    this._micChain = this._micChain.catch(() => {}).then(run);
    return this._micChain;
  }

  async _unpublishByName(name) {
    const room = this.lkRoom;
    if (!room) return;
    try {
      const pub = room.localParticipant.getTrackPublicationByName(name);
      if (pub && pub.track) await room.localParticipant.unpublishTrack(pub.track, false);
    } catch (e) {}
  }

  // ============================================
  // SENDER (HOST / BROADCASTER / SPEAKER)
  // ============================================
  async startBroadcastingVideo(roomId, videoElement, audioOnly = false) {
    this.setCurrentRoom(roomId);
    this.isBroadcastingVideo = true;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: !audioOnly ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: true
        });
      } else {
        throw new Error('MediaDevices not supported');
      }
    } catch (err) {
      console.warn('Real camera/mic unavailable, starting simulated broadcast canvas stream:', err.message);
      this.localStream = this.createSyntheticStream(!audioOnly, true);
    }

    if (videoElement && this.localStream) {
      videoElement.srcObject = this.localStream;
      videoElement.style.display = 'block';
      videoElement.muted = true; // Always mute local monitor to prevent feedback
      this.applyCameraMirroring();
      videoElement.play().catch(() => {});
    }

    // انضمام LiveKit ونشر الكاميرا (+ الصوت إن لم يكن منشورًا للمقعد الصوتي)
    try {
      const room = await this._ensureLiveKitRoom(roomId);
      if (room) {
        const vt = this.localStream && this.localStream.getVideoTracks()[0];
        if (vt && !room.localParticipant.getTrackPublicationByName('video_broadcast')) {
          await this._publishVideoTrack(vt, 'video_broadcast');
        }
        if (!this._hasLiveMicPub()) {
          const at = this.localStream && this.localStream.getAudioTracks()[0];
          if (at) await this._publishMicTrack(this.localStream);
        }
      }
    } catch (err) {
      window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      console.warn('LiveKit video join/publish failed:', err);
    }

    // Broadcast that host stream is ready to everyone in this room (توافق قديم — بلا مستمع جديد)
    this.socket.emit('webrtc_broadcaster_ready', {
      roomId,
      userId: this.currentUser?.id,
      mediaType: 'video'
    });

    return this.localStream;
  }

  async startBroadcastingCohost(roomId, videoElement) {
    this.setCurrentRoom(roomId);
    this.isBroadcastingCohost = true;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.localCohostStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });
      } else {
        throw new Error('MediaDevices not supported');
      }
    } catch (err) {
      console.warn('Real camera/mic unavailable for co-host, using synthetic stream:', err.message);
      this.localCohostStream = this.createSyntheticStream(true, true);
    }

    if (videoElement && this.localCohostStream) {
      videoElement.srcObject = this.localCohostStream;
      videoElement.style.display = 'block';
      videoElement.muted = true;
      this.applyCameraMirroring();
      videoElement.play().catch(() => {});
    }

    try {
      const room = await this._ensureLiveKitRoom(roomId);
      if (room) {
        const ct = this.localCohostStream && this.localCohostStream.getVideoTracks()[0];
        if (ct && !room.localParticipant.getTrackPublicationByName('cohost_video')) {
          await this._publishVideoTrack(ct, 'cohost_video');
        }
        if (!this._hasLiveMicPub()) {
          const at = this.localCohostStream && this.localCohostStream.getAudioTracks()[0];
          if (at) await this._publishMicTrack(this.localCohostStream);
        }
      }
    } catch (err) {
      window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      console.warn('LiveKit cohost join/publish failed:', err);
    }

    this.socket.emit('webrtc_broadcaster_ready', {
      roomId,
      userId: this.currentUser?.id,
      mediaType: 'cohost_video'
    });

    return this.localCohostStream;
  }

  stopBroadcastingCohost() {
    if (this.isBroadcastingCohost) {
      if (this.socket && this.currentRoomId) {
        this.socket.emit('webrtc_stream_ended', {
          roomId: this.currentRoomId,
          streamType: 'cohost_video',
          userId: this.currentUser?.id
        });
      }
    }
    this._unpublishByName('cohost_video');
    if (this.localCohostStream) {
      this.localCohostStream.getTracks().forEach(t => t.stop());
      this.localCohostStream = null;
    }
    this.isBroadcastingCohost = false;
  }

  // صعود/تفعيل المايك. الطلبات المتزامنة (صعود + سوكت + زر المايك) تُدمج في عملية واحدة،
  // وأي نزول أثناء التنفيذ يُبطلها (رقم العملية _voiceOp) فلا يبقى مايك شبحي مفتوحًا.
  startBroadcastingVoice(roomId) {
    this.setCurrentRoom(roomId);
    if (this._voiceStartPromise && this._voiceStartRoom === roomId) return this._voiceStartPromise;
    const p = this._startBroadcastingVoiceImpl(roomId);
    this._voiceStartPromise = p;
    this._voiceStartRoom = roomId;
    const clear = () => { if (this._voiceStartPromise === p) { this._voiceStartPromise = null; this._voiceStartRoom = null; } };
    p.then(clear, clear);
    return p;
  }

  async _startBroadcastingVoiceImpl(roomId) {
    // إن كان المايك يعمل أصلاً (مثلاً أثناء تشغيل موسيقى) لا نفتح مايكاً جديداً حتى لا ينقطع الدمج.
    const liveBase = this.voiceBaseStream && this.voiceBaseStream.getAudioTracks().some(t => t.readyState === 'live');
    if (this.isBroadcastingVoice && liveBase) {
      const op0 = this._voiceOp;
      this.setVoiceMuted(false);
      try {
        const room = await this._ensureLiveKitRoom(roomId);
        if (op0 !== this._voiceOp) return null; // نزلنا أثناء الانتظار
        if (room) await this._publishMicTrack(this.localAudioStream || this.voiceBaseStream); // idempotent
      } catch (err) {
        window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      }
      this.socket.emit('webrtc_broadcaster_ready', { roomId, userId: this.currentUser?.id, mediaType: 'voice' });
      return this.localAudioStream;
    }

    const op = ++this._voiceOp;
    const stale = () => op !== this._voiceOp;
    this.isBroadcastingVoice = true;

    let stream = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw new Error('MediaDevices not supported');
      }
    } catch (err) {
      console.warn('Real microphone unavailable, starting synthetic audio stream:', err.message);
      stream = this.createSyntheticStream(false, true);
    }

    // نزل المستخدم (أو بدّل مقعده) أثناء انتظار إذن المايك: نحرر المايك ولا ننشر شيئًا
    if (stale()) {
      try { stream && stream.getTracks().forEach(t => { try { t.enabled = false; t.stop(); } catch (e) {} }); } catch (e) {}
      return null;
    }

    this.localAudioStream = stream;
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = true;
        // إن قطع النظام المايك (مكالمة/تطبيق آخر/تصغير) نعيد فتحه تلقائياً بدل أن يبقى صامتاً
        track.onended = () => {
          if (this.voiceBaseStream !== this.localAudioStream && !(this.voiceBaseStream && this.voiceBaseStream.getAudioTracks().includes(track))) return;
          if (!this.isBroadcastingVoice) return;
          setTimeout(() => this.ensureVoiceAlive().catch(() => {}), 500);
        };
      });
      this.voiceBaseStream = this.localAudioStream;
    }
    this.isVoiceMuted = false;

    // الموسيقى كانت تعمل قبل (أو أثناء) صعودي/تبديل مقعدي: نعيد دمجها مع المايك الجديد قبل النشر.
    if (this.pendingMusicStream) this.setVoiceMusicStream(this.pendingMusicStream);

    // انضمام LiveKit ونشر مسار الصوت (المايك أو المخرج المدموج)
    try {
      const room = await this._ensureLiveKitRoom(roomId);
      if (stale()) return null;
      // نستدعي النشر دائمًا (idempotent): أي نشر ميت من صعود سابق يُستبدل بدل أن يُتخطّى
      if (room) await this._publishMicTrack(this.localAudioStream);
    } catch (err) {
      window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      console.warn('LiveKit voice join/publish failed:', err);
    }
    if (stale()) return null;

    // Broadcast voice ready to room — يستفيد منه الآخرون لمزامنة صوتك فورًا
    this.socket.emit('webrtc_broadcaster_ready', {
      roomId,
      userId: this.currentUser?.id,
      mediaType: 'voice'
    });

    return this.localAudioStream;
  }

  // بعد إعادة اتصال السوكت: نفصل غرفة LiveKit القديمة ونبقي مساراتنا المحلية
  // (لا نلمس المايك إطلاقًا — يُعاد نشره تلقائيًا عند إعادة الانضمام)
  resetPeerConnections() {
    if (this.lkRoom) {
      try { this.lkRoom.disconnect(); } catch (e) {}
      this.lkRoom = null;
      this.lkRoomName = null;
    }
    this._teardownRemoteMedia();
    for (const [key, pc] of Array.from(this.peerConnections.entries())) {
      try { pc._dead = true; pc.close(); } catch (e) {}
      this.peerConnections.delete(key);
    }
  }

  // يتأكد أن مايكي ما زال حياً وأن غرفة LiveKit متصلة ومنشورة؛ وإلا يعيد فتحه ويُعلن
  // (يحدث عند التصغير/الخلفية/قطع النظام للمايك)
  async ensureVoiceAlive() {
    if (!this.isBroadcastingVoice || !this.currentRoomId) return;
    const base = this.voiceBaseStream || this.localAudioStream;
    const alive = base && base.getAudioTracks().some(t => t.readyState === 'live');
    if (!alive) {
      const roomId = this.currentRoomId;
      const wasMuted = this.isVoiceMuted;
      this.isBroadcastingVoice = false;
      this.localAudioStream = null;
      this.voiceBaseStream = null;
      await this.startBroadcastingVoice(roomId);
      if (wasMuted) this.setVoiceMuted(true);
      return;
    }
    // المايك حي: نتأكد أن الغرفة متصلة وأن المسار منشور فعلًا
    try {
      const room = await this._ensureLiveKitRoom(this.currentRoomId);
      // النشر الميت (مسار متوقف) يُعدّ غير موجود؛ _publishMicTrack يستبدله ولا يكرر الحي
      if (room && this.isBroadcastingVoice) await this._publishMicTrack(this.localAudioStream || this.voiceBaseStream);
    } catch (e) {
      console.warn('LiveKit voice heal failed:', e);
    }
    if (this.voiceMixerContext && this.voiceMixerContext.state === 'suspended') this.voiceMixerContext.resume().catch(() => {});
  }

  setVoiceMuted(isMuted) {
    this.isVoiceMuted = !!isMuted;
    // كتم المايك يخص صوتي أنا فقط؛ مسار الموسيقى المدموج يبقى مفتوحاً كي لا تنقطع عن الحاضرين.
    // (تعطيل المسار محليًا يُرسل صمتًا عبر LiveKit — نفس سلوك الصمت القديم)
    if (this.voiceBaseStream) {
      this.voiceBaseStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
    }
    if (this.localAudioStream && this.localAudioStream !== this.voiceBaseStream) {
      const mixed = !!this.voiceMixerDestination && this.localAudioStream === this.voiceMixerDestination.stream;
      this.localAudioStream.getAudioTracks().forEach(track => { track.enabled = mixed ? true : !isMuted; });
    }
  }

  // يخلط الموسيقى مع ميكروفون المقعد ويستبدل مسار الصوت المرسل دون فتح ميكروفون ثانٍ.
  // إن لم يكن المايك جاهزاً بعد نتذكر الموسيقى ونضيفها تلقائياً عند بدء البث.
  setVoiceMusicStream(musicStream) {
    if (!musicStream) return false;
    this.pendingMusicStream = musicStream;
    if (!this.isBroadcastingVoice || !this.voiceBaseStream) return false;
    // نفس الدمج قائم أصلاً: لا نعيد بناءه
    if (this.voiceMixerContext && this.voiceMusicStream === musicStream && this.voiceMixerBase === this.voiceBaseStream) return true;
    this._unmixVoice();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      const ac = new AudioCtx();
      const micSource = ac.createMediaStreamSource(this.voiceBaseStream);
      const musicSource = ac.createMediaStreamSource(musicStream);
      const destination = ac.createMediaStreamDestination();
      micSource.connect(destination);
      musicSource.connect(destination);
      this.voiceMixerContext = ac;
      this.voiceMixerDestination = destination;
      this.voiceMixerBase = this.voiceBaseStream;
      this.voiceMusicStream = musicStream;
      this.localAudioStream = destination.stream;
      this.setVoiceMuted(this.isVoiceMuted);
      this.replaceVoiceAudioTrack(destination.stream.getAudioTracks()[0]);
      const wake = () => { if (ac.state === 'suspended') ac.resume().catch(() => {}); };
      ac.onstatechange = wake;
      ac.resume().catch(() => {});
      return true;
    } catch (err) {
      console.warn('Voice/music mix unavailable:', err);
      return false;
    }
  }

  // حارس انقطاع الموسيقى عند المستمعين: يوقظ سياق الدمج إن علّقه المتصفح (تصغير/خلفية/شاشة مقفلة)،
  // ويعيد الدمج إن سقط، ويتأكد أن المسار المنشور حي.
  ensureMixerAlive() {
    try {
      if (!this.isBroadcastingVoice) return;
      if (this.pendingMusicStream && this.voiceBaseStream && !this.voiceMixerContext) {
        this.setVoiceMusicStream(this.pendingMusicStream);
        return;
      }
      const ac = this.voiceMixerContext;
      if (ac && ac.state !== 'running') ac.resume().catch(() => {});
      const out = this.voiceMixerDestination && this.voiceMixerDestination.stream.getAudioTracks()[0];
      if (out && out.readyState === 'ended' && this.pendingMusicStream) {
        this.voiceMixerContext = null; // يُبنى من جديد
        this.setVoiceMusicStream(this.pendingMusicStream);
      } else if (out && !out.enabled) {
        out.enabled = true; // المسار المدموج يبقى مفتوحاً دائماً كي لا تنقطع الموسيقى
      }
    } catch (e) { console.warn('ensureMixerAlive:', e); }
  }

  // فك الدمج فقط (يُبقي الموسيقى المطلوبة محفوظة لإعادة دمجها لاحقاً)
  _unmixVoice() {
    if (!this.voiceMixerContext) return;
    const base = this.voiceBaseStream;
    try {
      this.voiceMixerDestination?.stream?.getTracks().forEach(track => track.stop());
      this.voiceMixerContext.onstatechange = null;
      this.voiceMixerContext.close();
    } catch (e) {}
    this.voiceMixerContext = null;
    this.voiceMixerDestination = null;
    this.voiceMixerBase = null;
    this.voiceMusicStream = null;
    if (base) {
      this.localAudioStream = base;
      this.replaceVoiceAudioTrack(base.getAudioTracks()[0]);
      this.setVoiceMuted(this.isVoiceMuted);
    }
  }

  // تُستدعى عند إيقاف الموسيقى فعلياً: تفك الدمج وتنسى الموسيقى المطلوبة
  clearVoiceMusicStream() {
    this.pendingMusicStream = null;
    this._unmixVoice();
  }

  // استبدال مسار الصوت المنشور في LiveKit (الدمج الجديد: موسيقى + مايك)
  replaceVoiceAudioTrack(track) {
    if (!track) return;
    if (this.lkRoom && this.isBroadcastingVoice) {
      this._publishMicTrack(this.localAudioStream || this.voiceBaseStream).catch(() => {});
    }
  }

  stopBroadcastingVoice() {
    // يُبطل أي صعود قيد التنفيذ (انتظار إذن مايك/انضمام) حتى لا ينشر بعد نزولنا
    this._voiceOp++;
    this._voiceStartPromise = null;
    this._voiceStartRoom = null;

    if (this.isBroadcastingVoice) {
      if (this.socket && this.currentRoomId) {
        this.socket.emit('webrtc_stream_ended', {
          roomId: this.currentRoomId,
          streamType: 'voice_seat',
          userId: this.currentUser?.id
        });
      }
    }

    // نجمع مسارات المايك قبل فك الدمج (لنعرف أي نشر يخص مقعدنا)
    const streams = new Set([this.localAudioStream, this.voiceBaseStream].filter(Boolean));
    const voiceTracks = new Set();
    streams.forEach(st => st.getAudioTracks().forEach(t => voiceTracks.add(t)));
    // مسارات كاميرا المضيف/المشارك لا نلغي نشرها عند النزول من المقعد
    const preserve = new Set();
    [this.localStream, this.localCohostStream].forEach(st => {
      if (st) st.getAudioTracks().forEach(t => { if (!voiceTracks.has(t)) preserve.add(t); });
    });

    // مهم: نصفّر الحالة قبل _unmixVoice، فهي تستدعي replaceVoiceAudioTrack التي كانت تعيد نشر
    // المايك أثناء النزول نفسه (فيبقى نشر ميت يمنع الصوت في الصعود التالي).
    this.isBroadcastingVoice = false;
    this.isVoiceMuted = true;
    this._unmixVoice();

    // إلغاء نشر مسار المايك فعليًا (قبل إيقاف المسارات) — بقية مسارات الغرفة تبقى كما هي
    this._unpublishMic(preserve);

    streams.forEach(stream => stream.getTracks().forEach(t => {
      try { t.enabled = false; t.stop(); } catch (e) {}
    }));
    this.localAudioStream = null;
    this.voiceBaseStream = null;
    this.voiceMusicStream = null;
  }

  // ============================================
  // RECEIVER (VIEWER / AUDIENCE / PEER)
  // ============================================
  requestRoomStream(roomId) {
    this.setCurrentRoom(roomId);
    if (!this.socket) return;

    // LiveKit: الاشتراك تلقائي عند الانضمام (autoSubscribe) — لا طلبات عرض/إجابة
    this._ensureLiveKitRoom(roomId)
      .then(() => {
        // توافق قديم: إشعار الخادم أن المشاهد يريد البث (لا مستمع له على العميل بعد الآن)
        if (this.socket && this.socket.connected) {
          this.socket.emit('webrtc_request_stream', {
            roomId,
            userId: this.currentUser?.id
          });
        }
      })
      .catch(err => {
        window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
        console.warn('LiveKit join failed:', err);
      });
  }

  // ==================================================
  // CLEANUP helpers (نفس العقد القديم — عناصر audio لكل مستخدم)
  // ==================================================
  closePeer(key) {
    const pc = this.peerConnections.get(key);
    if (pc) {
      try { pc.close(); } catch (e) {}
      this.peerConnections.delete(key);
    }
    const audioEl = this.audioElements.get(key);
    if (audioEl) {
      if (window.voiceRings && audioEl.dataset && audioEl.dataset.userId) window.voiceRings.unwatch(audioEl.dataset.userId, 'rtc:' + key);
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      } catch (e) {}
      this.audioElements.delete(key);
    }
  }

  silenceRemoteUser(userId, isMuted) {
    if (!userId) return;
    const uidStr = String(userId);
    if (this.userAudioMap.has(uidStr)) {
      for (const el of this.userAudioMap.get(uidStr)) {
        el.muted = !!isMuted;
        el.volume = isMuted ? 0 : 1;
      }
    }
    for (const [key, el] of this.audioElements.entries()) {
      if (el.dataset.userId === uidStr) {
        el.muted = !!isMuted;
        el.volume = isMuted ? 0 : 1;
      }
    }
  }

  removeRemoteUserAudio(userId) {
    if (!userId) return;
    const uidStr = String(userId);
    const now = Date.now();
    // مسار صوت رُبط للتو (أقل من 700ms) غالبًا هو صعود جديد وصل قبل حدث «المقعد خلا» المتأخر:
    // لا نقتله حتى لا يضيع صوت المتحدث الجديد.
    const isFresh = (el) => el && el.dataset && (now - Number(el.dataset.attachedAt || 0)) < 700;
    let removedAny = false;

    // لا نوقف (stop) المسارات البعيدة: هي ملك LiveKit وقد يُعاد استخدامها لمتحدث لاحق
    // (إيقافها كان يجعل صوت من يصعد بعد ذلك لا يظهر أبدًا).
    for (const [key, el] of Array.from(this.audioElements.entries())) {
      const sameUser = el.dataset.userId === uidStr || (el.dataset.senderSocketId && this.userSocketMap?.get(uidStr) === el.dataset.senderSocketId);
      if (!sameUser || isFresh(el)) continue;
      this._dropAudioKey(key, true);
      removedAny = true;
    }

    // أي عناصر صوت يتيمة لهذا المستخدم خارج الخريطة
    document.querySelectorAll(`audio[data-user-id="${uidStr}"]`).forEach(el => {
      if (isFresh(el)) return;
      try { el.pause(); el.srcObject = null; el.remove(); } catch (e) {}
      this._pendingPlay.delete(el);
    });

    if (removedAny && window.voiceRings) {
      // نُبقي مراقبة أي مسار طازج؛ unwatchUser كان يمسح الكل
      const keep = Array.from(this.audioElements.entries()).some(([, el]) => el.dataset.userId === uidStr);
      if (!keep) window.voiceRings.unwatchUser(uidStr);
    }
    const set = this.userAudioMap.get(uidStr);
    if (set && !set.size) this.userAudioMap.delete(uidStr);

    // (توافق قديم) إغلاق أي اتصالات متبقية مرتبطة بهذا المستخدم
    for (const [key, pc] of Array.from(this.peerConnections.entries())) {
      if (key.includes(uidStr) || pc.remoteUserId === uidStr) {
        try { pc.close(); } catch (e) {}
        this.peerConnections.delete(key);
      }
    }
  }

  leaveCurrentRoom() {
    if (this.isBroadcastingVideo || this.isBroadcastingVoice || this.isBroadcastingCohost) {
      if (this.socket && this.currentRoomId) {
        this.socket.emit('webrtc_stream_ended', {
          roomId: this.currentRoomId,
          streamType: this.isBroadcastingVideo ? 'video_broadcast' : (this.isBroadcastingCohost ? 'cohost_video' : 'voice_seat'),
          userId: this.currentUser?.id
        });
      }
    }

    // إبطال أي صعود صوتي قيد التنفيذ
    this._voiceOp++;
    this._voiceStartPromise = null;
    this._voiceStartRoom = null;
    this._deadSids.clear();
    this._pendingPlay.clear();

    // مغادرة غرفة LiveKit (يُغلق كل النشر تلقائيًا عندها)
    this.lkShouldJoin = false;
    if (this.lkRoom) {
      try { this.lkRoom.disconnect(); } catch (e) {}
      this.lkRoom = null;
      this.lkRoomName = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.localCohostStream) {
      this.localCohostStream.getTracks().forEach(t => t.stop());
      this.localCohostStream = null;
    }
    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach(t => t.stop());
      this.localAudioStream = null;
    }
    this.voiceBaseStream = null;

    this.isBroadcastingVideo = false;
    this.isBroadcastingCohost = false;
    this.isBroadcastingVoice = false;

    // Close all peers (توافق قديم — الخريطة فارغة في نموذج LiveKit)
    for (const [key, pc] of this.peerConnections) {
      try { pc.close(); } catch (e) {}
    }
    this.peerConnections.clear();

    for (const [key, el] of this.audioElements) {
      if (window.voiceRings && el.dataset && el.dataset.userId) {
        try { window.voiceRings.unwatch(el.dataset.userId, 'rtc:' + key); } catch (e) {}
      }
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioElements.clear();
    this.userAudioMap.clear();

    this.remoteHostStream = null;
    this.remoteCohostStream = null;
    this.currentRoomId = null;
  }

  // Generates animated cosmic live stream canvas + Web Audio chime loop when no physical webcam exists
  createSyntheticStream(hasVideo = true, hasAudio = true) {
    const stream = new MediaStream();

    if (hasVideo) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      let angle = 0;

      const drawLoop = () => {
        angle += 0.02;
        // Cosmic gradient background
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, '#1a0b2e');
        grad.addColorStop(0.5, '#3b1263');
        grad.addColorStop(1, '#0f051d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Rotating planetary rings
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.arc(0, 0, 180, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.6)';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, 0, 260, 90, Math.PI / 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.restore();

        // Broadcast Badge
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📡 SoulChill Live Broadcast Studio', canvas.width / 2, canvas.height / 2 + 10);

        ctx.font = '22px sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('🔴 بث مباشر عالي الدقة • LiveKit Media Stream', canvas.width / 2, canvas.height / 2 + 60);

        requestAnimationFrame(drawLoop);
      };
      drawLoop();

      const canvasStream = canvas.captureStream(30);
      canvasStream.getVideoTracks().forEach(t => stream.addTrack(t));
    }

    if (hasAudio) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.01, audioCtx.currentTime); // Gentle audible tone
        osc.connect(gain);

        const dest = audioCtx.createMediaStreamDestination();
        gain.connect(dest);
        osc.start();

        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      }
    }

    return stream;
  }
}

window.soulRtc = new SoulRtcEngine();
