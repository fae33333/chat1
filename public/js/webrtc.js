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
      };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(check, 300); });
      window.addEventListener('online', () => setTimeout(check, 800));
      window.addEventListener('focus', () => setTimeout(check, 300));
      setInterval(check, 10000);
    }

    // البث ينضم لمجموعة LiveKit تلقائيًا (autoSubscribe) — لا حاجة لإشارات
    // العرض/الإجابة/ICE القديمة (webrtc_signal_* حُذفت نهائيًا).

    // البث انتهى عند المتحدث (يحمله الخادم لبقية العملاء) — ننظّف واجهاتنا
    this.socket.on('webrtc_stream_ended', ({ senderSocketId, streamType, userId }) => {
      if (userId) {
        this.removeRemoteUserAudio(userId);
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

    if (this.lkRoom && this.lkRoomName === want && (this.lkRoom.state === 'connected' || this.lkRoom.state === 'connecting')) {
      return this.lkRoom;
    }
    if (this.lkJoinPromise) {
      try { await this.lkJoinPromise; } catch (e) {}
      if (this.lkRoom && this.lkRoomName === want && this.lkRoom.state === 'connected') return this.lkRoom;
    }
    if (this.lkRoom) {
      try { this.lkRoom.disconnect(); } catch (e) {}
      this.lkRoom = null;
      this.lkRoomName = null;
      this._teardownRemoteMedia();
    }

    this.lkJoinPromise = (async () => {
      const room = await window.scLivekit.joinRoom(want, this._livekitHandlers(), {
        userId: this.currentUser?.id
      });
      this.lkRoom = room;
      this.lkRoomName = want;
      // إعادة النشر بعد إعادة الانضمام (انقطاع شبكة / إعادة اتصال السوكت):
      // المايك والكاميرا ما زالت محلية لدينا فنعيد إرسالها دون المساس بها.
      try {
        if (this.isBroadcastingVoice && this.localAudioStream && !room.localParticipant.getTrackPublication('microphone')) {
          await this._publishMicTrack(this.localAudioStream);
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
        const uid = this._identityUserId(participant);
        if (uid) this.removeRemoteUserAudio(uid);
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

  // المعرّف يحمل معرّف المستخدم قبل الشرطة (معرّف فريد لكل علبة تبويب/جهاز)
  _identityUserId(participant) {
    const idn = participant && participant.identity ? String(participant.identity) : '';
    if (!idn) return null;
    const num = idn.split('-')[0];
    return num || null;
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
        this._attachRemoteAudio(track, publication, uid);
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

  _attachRemoteAudio(track, publication, uid) {
    const audioKey = `lk:${(publication && publication.trackSid) || Math.random().toString(36).slice(2)}`;
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
    if (uid) {
      const uidStr = String(uid);
      audioEl.dataset.userId = uidStr;
      if (!this.userAudioMap.has(uidStr)) {
        this.userAudioMap.set(uidStr, new Set());
      }
      this.userAudioMap.get(uidStr).add(audioEl);
    }
    audioEl.dataset.streamType = 'voice_seat';
    audioEl.srcObject = remoteStream;
    audioEl.play().catch(e => console.log('Audio autoplay caught:', e));
    // تذبذبات حول صورة المتحدث حسب مستوى صوته (ويشمل الأغنية التي يشغّلها)
    if (uid && window.voiceRings) window.voiceRings.watchStream(String(uid), remoteStream, 'rtc:' + audioKey);
  }

  _onRemoteTrackUnsubscribed(track, publication, participant) {
    try {
      if (track.kind === 'audio') {
        const sid = publication && publication.trackSid;
        if (sid) this.closePeer(`lk:${sid}`);
        return;
      }
      const name = (publication && publication.trackName) || '';
      if (name === 'cohost_video') {
        this.remoteCohostStream = null;
        const cohostVideo = document.getElementById('stream-split-guest-video');
        if (cohostVideo) cohostVideo.srcObject = null;
      } else {
        const stillHas = participant && participant.videoTracks && participant.videoTracks.size > 0;
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
        if (!room.localParticipant.getTrackPublication('microphone')) {
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
        if (!room.localParticipant.getTrackPublication('microphone')) {
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

  async startBroadcastingVoice(roomId) {
    this.setCurrentRoom(roomId);

    // إن كان المايك يعمل أصلاً (مثلاً أثناء تشغيل موسيقى) لا نفتح مايكاً جديداً حتى لا ينقطع الدمج.
    const liveBase = this.voiceBaseStream && this.voiceBaseStream.getAudioTracks().some(t => t.readyState === 'live');
    if (this.isBroadcastingVoice && liveBase) {
      this.setVoiceMuted(false);
      try {
        const room = await this._ensureLiveKitRoom(roomId);
        if (room && !room.localParticipant.getTrackPublication('microphone')) {
          await this._publishMicTrack(this.localAudioStream || this.voiceBaseStream);
        }
      } catch (err) {
        window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      }
      this.socket.emit('webrtc_broadcaster_ready', { roomId, userId: this.currentUser?.id, mediaType: 'voice' });
      return this.localAudioStream;
    }
    this.isBroadcastingVoice = true;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw new Error('MediaDevices not supported');
      }
    } catch (err) {
      console.warn('Real microphone unavailable, starting synthetic audio stream:', err.message);
      this.localAudioStream = this.createSyntheticStream(false, true);
    }

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

    // انضمام LiveKit ونشر مسار الصوت (المic أو المخرج المدموج)
    try {
      const room = await this._ensureLiveKitRoom(roomId);
      if (room && !room.localParticipant.getTrackPublication('microphone')) {
        await this._publishMicTrack(this.localAudioStream);
      }
    } catch (err) {
      window.scLivekit && window.scLivekit.notifyUnavailable && window.scLivekit.notifyUnavailable(err);
      console.warn('LiveKit voice join/publish failed:', err);
    }

    // Broadcast voice ready to room (توافق قديم)
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
      const pub = room && room.localParticipant.getTrackPublication('microphone');
      if (room && !pub) await this._publishMicTrack(this.localAudioStream);
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
    if (this.isBroadcastingVoice) {
      if (this.socket && this.currentRoomId) {
        this.socket.emit('webrtc_stream_ended', {
          roomId: this.currentRoomId,
          streamType: 'voice_seat',
          userId: this.currentUser?.id
        });
      }
    }
    this._unmixVoice();
    // إلغاء نشر مسار المايك — بقية مسارات الغرفة (فيديو/بقيّة المتحدثين) تبقى كما هي
    this._unpublishByName('microphone');
    const streams = new Set([this.localAudioStream, this.voiceBaseStream].filter(Boolean));
    streams.forEach(stream => stream.getTracks().forEach(t => {
      try { t.enabled = false; t.stop(); } catch (e) {}
    }));
    this.localAudioStream = null;
    this.voiceBaseStream = null;
    this.voiceMusicStream = null;
    this.isBroadcastingVoice = false;
    this.isVoiceMuted = true;
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
    if (window.voiceRings) window.voiceRings.unwatchUser(uidStr);

    // 1. Pause and remove from userAudioMap
    if (this.userAudioMap.has(uidStr)) {
      for (const el of this.userAudioMap.get(uidStr)) {
        try {
          el.pause();
          el.muted = true;
          el.volume = 0;
          if (el.srcObject) {
            el.srcObject.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) {} });
            el.srcObject = null;
          }
          el.remove();
        } catch (e) {}
      }
      this.userAudioMap.delete(uidStr);
    }

    // 2. Pause and remove from audioElements map
    for (const [key, el] of Array.from(this.audioElements.entries())) {
      if (el.dataset.userId === uidStr || (el.dataset.senderSocketId && this.userSocketMap?.get(uidStr) === el.dataset.senderSocketId)) {
        try {
          el.pause();
          el.muted = true;
          el.volume = 0;
          if (el.srcObject) {
            el.srcObject.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) {} });
            el.srcObject = null;
          }
          el.remove();
        } catch (e) {}
        this.audioElements.delete(key);
      }
    }

    // 3. Search document for ANY audio elements for this user
    document.querySelectorAll(`audio[data-user-id="${uidStr}"]`).forEach(el => {
      try {
        el.pause();
        el.muted = true;
        el.volume = 0;
        if (el.srcObject) {
          el.srcObject.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) {} });
          el.srcObject = null;
        }
        el.remove();
      } catch (e) {}
    });

    // 4. (توافق قديم) إغلاق أي اتصالات متبقية مرتبطة بهذا المستخدم
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
