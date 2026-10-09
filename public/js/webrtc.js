// =========================================================
// SoulChill Professional WebRTC Audio & Video Streaming Engine
// Handles real peer-to-peer audio & video transmission,
// live broadcasting, co-host PK split streams, and voice stages
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
    this.isCameraMirrored = localStorage.getItem('soulchill_video_mirror') !== '0';
    this.peerConnections = new Map(); // key -> RTCPeerConnection
    this.audioElements = new Map(); // key -> HTMLAudioElement
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  toggleCameraMirroring(explicitState = null) {
    if (explicitState !== null) {
      this.isCameraMirrored = explicitState;
    } else {
      this.isCameraMirrored = !this.isCameraMirrored;
    }
    localStorage.setItem('soulchill_video_mirror', this.isCameraMirrored ? '1' : '0');
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

    // 1. A viewer or peer requested our stream
    this.socket.on('webrtc_stream_requested', async ({ viewerSocketId, userId }) => {
      if (this.isBroadcastingVideo && this.localStream) {
        await this.createSenderPeer(viewerSocketId, this.localStream, 'video_broadcast');
      }
      if (this.isBroadcastingCohost && this.localCohostStream) {
        await this.createSenderPeer(viewerSocketId, this.localCohostStream, 'cohost_video');
      }
      if (this.isBroadcastingVoice && this.localAudioStream) {
        await this.createSenderPeer(viewerSocketId, this.localAudioStream, 'voice_seat');
      }
    });

    // 2. Incoming Offer from Broadcaster or Speaker
    this.socket.on('webrtc_signal_offer', async ({ senderSocketId, offer, streamType, user, roomId }) => {
      await this.handleIncomingOffer(senderSocketId, offer, streamType, user, roomId);
    });

    // 3. Incoming Answer from Viewer or Peer
    this.socket.on('webrtc_signal_answer', async ({ senderSocketId, answer, streamType }) => {
      const pcKey = `sender:${streamType || 'video_broadcast'}:${senderSocketId}`;
      let pc = this.peerConnections.get(pcKey) || this.peerConnections.get(`s_${senderSocketId}`) || this.peerConnections.get(senderSocketId);
      if (pc && pc.signalingState !== 'stable') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
          console.warn('Error setting remote description for answer:', e);
        }
      }
    });

    // 4. Incoming ICE Candidate
    this.socket.on('webrtc_signal_ice_candidate', async ({ senderSocketId, candidate, streamType, role }) => {
      let pc = null;
      if (role === 'sender') {
        pc = this.peerConnections.get(`receiver:${streamType}:${senderSocketId}`) || this.peerConnections.get(`r_${senderSocketId}`);
      } else if (role === 'receiver') {
        pc = this.peerConnections.get(`sender:${streamType}:${senderSocketId}`) || this.peerConnections.get(`s_${senderSocketId}`);
      }
      if (!pc) {
        pc = this.peerConnections.get(`receiver:${streamType}:${senderSocketId}`) 
          || this.peerConnections.get(`sender:${streamType}:${senderSocketId}`) 
          || this.peerConnections.get(senderSocketId);
      }
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    });

    // 5. Broadcaster or Speaker is Ready in Room
    this.socket.on('webrtc_broadcaster_ready', ({ broadcasterSocketId, userId, mediaType }) => {
      // If we are in the room as viewer, request their stream
      if (this.currentRoomId && broadcasterSocketId !== this.socket.id) {
        this.socket.emit('webrtc_request_stream', {
          roomId: this.currentRoomId,
          userId: this.currentUser?.id
        });
      }
    });

    // 6. Stream Ended by Broadcaster
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

    // 7. Speakers Force Stopped / Moderated
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

    // Broadcast that host stream is ready to everyone in this room
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
      });
      this.voiceBaseStream = this.localAudioStream;
    }
    this.isVoiceMuted = false;

    // الموسيقى كانت تعمل قبل (أو أثناء) صعودي/تبديل مقعدي: نعيد دمجها مع المايك الجديد قبل إعلان البث.
    if (this.pendingMusicStream) this.setVoiceMusicStream(this.pendingMusicStream);

    // Broadcast voice ready to room
    this.socket.emit('webrtc_broadcaster_ready', {
      roomId,
      userId: this.currentUser?.id,
      mediaType: 'voice'
    });

    return this.localAudioStream;
  }

  setVoiceMuted(isMuted) {
    this.isVoiceMuted = !!isMuted;
    // كتم المايك يخص صوتي أنا فقط؛ مسار الموسيقى المدموج يبقى مفتوحاً كي لا تنقطع عن الحاضرين.
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

  replaceVoiceAudioTrack(track) {
    if (!track) return;
    for (const [key, pc] of this.peerConnections.entries()) {
      if (!key.startsWith('sender:voice_seat:')) continue; // اتصالات إرسال صوتي فقط، لا اتصالات الاستماع
      const sender = pc.getSenders().find(item => item.track && item.track.kind === 'audio');
      if (sender) sender.replaceTrack(track).catch(() => {});
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
    const streams = new Set([this.localAudioStream, this.voiceBaseStream].filter(Boolean));
    streams.forEach(stream => stream.getTracks().forEach(t => {
      try { t.enabled = false; t.stop(); } catch (e) {}
    }));
    this.localAudioStream = null;
    this.voiceBaseStream = null;
    this.voiceMusicStream = null;
    this.isBroadcastingVoice = false;
    this.isVoiceMuted = true;

    // أغلق اتصالات إرسال صوتي الخاصة بي فقط.
    // لا نمس اتصالات الاستقبال (receiver:*) كي أبقى أسمع من ما زالوا على المقاعد بعد نزولي،
    // ولا اتصالات بث الفيديو (video_broadcast / cohost_video).
    for (const [key, pc] of Array.from(this.peerConnections.entries())) {
      const isVoiceSender = key.startsWith('sender:voice_seat:');
      const isVoiceAlias = key.startsWith('s_') && pc && pc.streamType === 'voice_seat';
      if (!isVoiceSender && !isVoiceAlias) continue;
      try {
        pc.getSenders().forEach(s => {
          if (s.track) { s.track.stop(); s.track.enabled = false; }
        });
        pc.close();
      } catch (e) {}
      this.peerConnections.delete(key);
    }
  }

  // Create an Offer Peer Connection for a specific viewer or peer
  async createSenderPeer(targetSocketId, stream, streamType) {
    const pcKey = `sender:${streamType || 'video_broadcast'}:${targetSocketId}`;
    if (this.peerConnections.has(pcKey)) {
      try { this.peerConnections.get(pcKey).close(); } catch (e) {}
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.streamType = streamType || 'video_broadcast';
    this.peerConnections.set(pcKey, pc);
    this.peerConnections.set(`s_${targetSocketId}`, pc);

    // Add local tracks to peer connection
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc_signal_ice_candidate', {
          targetSocketId,
          candidate: event.candidate,
          streamType,
          role: 'sender'
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(pcKey);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.socket.emit('webrtc_signal_offer', {
        targetSocketId,
        offer,
        streamType,
        user: this.currentUser,
        roomId: this.currentRoomId
      });
    } catch (err) {
      console.error('Error creating WebRTC sender offer:', err);
    }
  }

  // ============================================
  // RECEIVER (VIEWER / AUDIENCE / PEER)
  // ============================================
  requestRoomStream(roomId) {
    this.setCurrentRoom(roomId);
    if (!this.socket) return;

    this.socket.emit('webrtc_request_stream', {
      roomId,
      userId: this.currentUser?.id
    });
  }

  async handleIncomingOffer(senderSocketId, offer, streamType, user, roomId) {
    const pcKey = `receiver:${streamType || 'video_broadcast'}:${senderSocketId}`;
    if (this.peerConnections.has(pcKey)) {
      try { this.peerConnections.get(pcKey).close(); } catch (e) {}
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.remoteUserId = user && user.id ? String(user.id) : null;
    pc.senderSocketId = senderSocketId;
    if (user && user.id) {
      if (!this.userSocketMap) this.userSocketMap = new Map();
      this.userSocketMap.set(String(user.id), senderSocketId);
    }
    this.peerConnections.set(pcKey, pc);
    this.peerConnections.set(`r_${senderSocketId}`, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc_signal_ice_candidate', {
          targetSocketId: senderSocketId,
          candidate: event.candidate,
          streamType,
          role: 'receiver'
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);

      if (event.track.kind === 'video') {
        if (streamType === 'cohost_video') {
          // Co-host Challenger Video
          this.remoteCohostStream = remoteStream;
          const guestVideo = document.getElementById('stream-split-guest-video');
          if (guestVideo) {
            guestVideo.srcObject = remoteStream;
            guestVideo.style.display = 'block';
            guestVideo.style.transform = 'scaleX(1)'; // Remote incoming stream is unmirrored
            guestVideo.play().catch(e => console.log('Co-host video play caught:', e));
          }
        } else {
          // Main Host Live Video
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
            hostSplitVideo.play().catch(e => console.log('Host split video play caught:', e));
          }
          if (fallback) fallback.style.display = 'none';
        }
      }

      if (event.track.kind === 'audio') {
        const audioKey = `${streamType || 'audio'}:${senderSocketId}`;
        let audioEl = this.audioElements.get(audioKey);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.playsInline = true;
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
          this.audioElements.set(audioKey, audioEl);
        }
        if (user && user.id) {
          const uidStr = String(user.id);
          audioEl.dataset.userId = uidStr;
          if (!this.userAudioMap.has(uidStr)) {
            this.userAudioMap.set(uidStr, new Set());
          }
          this.userAudioMap.get(uidStr).add(audioEl);
        }
        audioEl.dataset.senderSocketId = senderSocketId;
        audioEl.dataset.streamType = streamType || 'audio';
        audioEl.srcObject = remoteStream;
        audioEl.play().catch(e => console.log('Audio autoplay caught:', e));
        // تذبذبات حول صورة المتحدث حسب مستوى صوته (ويشمل الأغنية التي يشغّلها)
        if (user && user.id && window.voiceRings) window.voiceRings.watchStream(String(user.id), remoteStream, 'rtc:' + audioKey);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(pcKey);
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('webrtc_signal_answer', {
        targetSocketId: senderSocketId,
        answer,
        streamType,
        role: 'receiver'
      });
    } catch (err) {
      console.error('Error handling incoming WebRTC offer:', err);
    }
  }

  // ============================================
  // CLEANUP & SYNTHETIC MEDIA FALLBACK
  // ============================================
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

    // 4. Close any PeerConnection associated with this remote user
    for (const [key, pc] of Array.from(this.peerConnections.entries())) {
      if (key.includes(uidStr) || pc.remoteUserId === uidStr) {
        try {
          pc.getReceivers().forEach(r => {
            if (r.track) { try { r.track.stop(); r.track.enabled = false; } catch (e) {} }
          });
          pc.getSenders().forEach(s => {
            if (s.track) { try { s.track.stop(); s.track.enabled = false; } catch (e) {} }
          });
          pc.close();
        } catch (e) {}
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

    this.isBroadcastingVideo = false;
    this.isBroadcastingCohost = false;
    this.isBroadcastingVoice = false;

    // Close all peers
    for (const [key, pc] of this.peerConnections) {
      try { pc.close(); } catch (e) {}
    }
    this.peerConnections.clear();

    for (const [key, el] of this.audioElements) {
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
        ctx.fillText('🔴 بث مباشر عالي الدقة • Real WebRTC MediaStream', canvas.width / 2, canvas.height / 2 + 60);

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
