// SoulChill Master Application Controller
(function() {
  'use strict';

  // Global State
  const state = {
    currentUser: null,
    token: null,
    currentTab: 'planet',
    socket: null,
    activeRoom: null,
    currentChatPartner: null,
    radarInstance: null,
    allUsers: [],
    rooms: [],
    moments: [],
    conversations: [],
    gifts: [],
    // Audio & Mic state
    localStream: null,
    audioContext: null,
    analyser: null,
    micLevelInterval: null,
    isMuted: false,
    userSeatIndex: null,
    // Voice note recording
    mediaRecorder: null,
    recordedAudioChunks: [],
    isRecordingVoiceNote: false,
    recordingTimerInterval: null,
    recordingSeconds: 0,
    // Language & Mode
    lang: 'ar',
    isFullScreen: false,
    // Room Audience & Moderation state
    activeRoomAudience: [],
    activeRoomMutedChatUsers: new Set(),
    isChatMuted: false,
    // Country / IP geolocation
    myGeo: null,
    countriesList: [],
    selectedCountry: 'all',
    selectedCategory: 'all',
    unreadMessagesCount: 0,
    favoriteRoomIds: []
  };

  function isPlatformStaff(user) {
    if (!user || !user.role) return false;
    return ['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(user.role);
  }

  function canAccessAdminPanel(user) {
    if (!user || !user.role) return false;
    return ['owner', 'super_master', 'super_admin'].includes(user.role);
  }

  // Translations dictionary
  const i18n = {
    ar: {
      appName: 'سول شل',
      appSub: 'عالم الأرواح والدردشة',
      tabPlanet: 'كوكب الروح',
      tabRooms: 'غرف صوتية',
      tabChat: 'الرسائل',
      tabMoments: 'لحظات',
      tabProfile: 'حسابي',
      dailyBonus: 'مكافأة يومية',
      claim: 'استلام',
      createRoom: 'إنشاء غرفة صوتية',
      emptySeat: 'صعود للميك',
      leaveSeat: 'نزول',
      muteMic: 'كتم المايك',
      unmuteMic: 'تحدث الآن',
      sendGift: 'إرسال هدية',
      sayHi: 'إلقاء التحية 👋',
      startChat: 'مراسلة خاصة 💬',
      rollDice: 'رمي النرد 🎲',
      luckyWheel: 'عجلة الحظ 🎡',
      pkBattle: 'تحدي PK 🔥',
      like: 'إعجاب',
      comment: 'تعليق',
      share: 'مشاركة'
    },
    en: {
      appName: 'SoulChill',
      appSub: 'Soul Party & Chill Voice',
      tabPlanet: 'Soul Planet',
      tabRooms: 'Voice Rooms',
      tabChat: 'Messages',
      tabMoments: 'Moments',
      tabProfile: 'Profile',
      dailyBonus: 'Daily Check-in',
      claim: 'Claim',
      createRoom: 'Create Room',
      emptySeat: 'Take Seat',
      leaveSeat: 'Leave Seat',
      muteMic: 'Mute',
      unmuteMic: 'Speak Now',
      sendGift: 'Send Gift',
      sayHi: 'Say Hi 👋',
      startChat: 'Private Chat 💬',
      rollDice: 'Roll Dice 🎲',
      luckyWheel: 'Lucky Wheel 🎡',
      pkBattle: 'PK Battle 🔥',
      like: 'Like',
      comment: 'Comment',
      share: 'Share'
    }
  };

  // Initialize App on DOM Ready
  document.addEventListener('DOMContentLoaded', async () => {
    initSocket();
    await fetchGeoLocation();
    await loadGiftsCatalogue();
    checkStoredAuth();
    setupEventListeners();
  });

  async function fetchGeoLocation() {
    try {
      const [geoRes, countRes] = await Promise.all([
        fetch('/api/geo/my-country').then(r => r.json()),
        fetch('/api/geo/countries').then(r => r.json())
      ]);
      if (geoRes && geoRes.success) {
        state.myGeo = geoRes;
      }
      if (countRes && countRes.success) {
        state.countriesList = countRes.countries;
      }
    } catch (e) {
      console.warn('Geo fetch fallback:', e);
      state.myGeo = { country_code: 'JO', country_name: 'الأردن', country_flag: '🇯🇴', city: 'إربد', ip: '127.0.0.1' };
    }
  }

  // 1. Socket.IO Setup
  function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
      console.log('Connected to SoulChill Realtime Server:', state.socket.id);
      if (state.currentUser) {
        state.socket.emit('user_connect', state.currentUser.id);
      }
    });

    // Room events
    state.socket.on('room_message', (msg) => {
      if (!state.currentUser) return;
      appendRoomChatMessage(msg);
    });

    state.socket.on('seat_emoji_broadcast', ({ roomId, seatIndex, emojiId, emojiSvg, emojiName, user }) => {
      if (state.activeRoom && state.activeRoom.id === roomId) {
        displaySeatEmojiReaction(seatIndex, emojiSvg, emojiName);
      }
    });

    state.socket.on('user_role_updated', ({ role, roleTitle, message }) => {
      if (state.currentUser) {
        state.currentUser.role = role;
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
        showToast(message || `تم تحديث رتبتك إلى: ${roleTitle || role}! ✨`, 'info');
      }
    });

    state.socket.on('room_presence_sync', ({ audienceCount, audience, pkState, isChatMuted, mutedChatUsers }) => {
      if (mutedChatUsers) state.activeRoomMutedChatUsers = new Set(mutedChatUsers);
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const badge = document.getElementById('room-audience-badge');
        if (badge) badge.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
      if (isChatMuted !== undefined) {
        state.isChatMuted = !!isChatMuted;
        updateRoomChatInputState();
      }
      if (pkState && pkState.active) showPKBattleUI(pkState);
    });

    state.socket.on('user_joined_room', ({ user, audienceCount, audience }) => {
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const badge = document.getElementById('room-audience-badge');
        if (badge) badge.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
      if (user && user.id !== state.currentUser?.id) {
        showToast(`دخل [${user.name}] إلى الغرفة رحبوا به! 🌟`);
      }
    });

    state.socket.on('user_left_room', ({ userId, audienceCount, audience }) => {
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const badge = document.getElementById('room-audience-badge');
        if (badge) badge.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
    });

    state.socket.on('user_kicked_from_room', ({ roomId, targetUserId, targetUserName, adminName, audienceCount, audience }) => {
      if (state.currentUser && state.currentUser.id === targetUserId) {
        leaveActiveVoiceRoom();
        alert(`قام مدير الغرفة [${adminName}] بطردك من هذه الغرفة! 🚪🚫`);
        return;
      }
      if (audience) renderRoomAudienceStrip(audience);
      if (audienceCount !== undefined) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = audienceCount.toString();
        const badge = document.getElementById('room-audience-badge');
        if (badge) badge.innerText = audienceCount.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = audienceCount.toString();
      }
      showToast(`قام مدير الغرفة بطرد [${targetUserName}] 🚪`);
    });

    state.socket.on('room_kicked_notice', ({ message }) => {
      leaveActiveVoiceRoom();
      alert(message || 'لقد تم طردك من هذه الغرفة بواسطة الإدارة! 🚫');
    });

    state.socket.on('user_chat_mute_changed', ({ targetUserId, targetUserName, isMuted, adminName }) => {
      if (isMuted) {
        state.activeRoomMutedChatUsers.add(targetUserId);
      } else {
        state.activeRoomMutedChatUsers.delete(targetUserId);
      }

      if (state.currentUser && state.currentUser.id === targetUserId) {
        state.isChatMuted = isMuted;
        updateRoomChatInputState();
        showToast(isMuted 
          ? `قام مدير الغرفة (${adminName}) بكتمك من الكتابة في الدردشة العامة! 🔇` 
          : `قام مدير الغرفة (${adminName}) بإلغاء كتم الكتابة عنك! يمكنك المشاركة الآن 🔊`);
      }

      if (state.activeRoomAudience) {
        renderRoomAudienceStrip(state.activeRoomAudience);
      }
    });

    state.socket.on('all_seats_lock_changed', ({ roomId, isLocked, adminName, vacatedUserIds }) => {
      // If seats 1-8 are locked, everyone on seats 1 to 8 must step down immediately and stop audio
      if (isLocked && state.userSeatIndex !== null && state.userSeatIndex > 0) {
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
        showToast(`🔒 قام المشرف (${adminName || 'المضيف'}) بقفل جميع المقاعد وإغلاق المايكات.`);
      }

      // Immediately remove and silence all remote audio for vacated users
      if (vacatedUserIds && Array.isArray(vacatedUserIds) && window.soulRtc) {
        vacatedUserIds.forEach(vUserId => {
          window.soulRtc.removeRemoteUserAudio(vUserId);
        });
      }

      if (state.activeRoom && state.activeRoom.seats) {
        state.activeRoom.seats.forEach(s => {
          if (s.seat_index > 0) {
            s.is_locked = isLocked ? 1 : 0;
            if (isLocked && s.user_id !== state.activeRoom.host_id) {
              s.user_id = null;
            }
          }
        });
      }

      for (let i = 1; i <= 8; i++) {
        const seatEl = document.getElementById(`stage-seat-${i}`);
        if (!seatEl) continue;
        if (isLocked) {
          seatEl.classList.remove('occupied');
          seatEl.classList.add('locked');
          seatEl.innerHTML = `
            <div class="seat-avatar-container">
              <span class="seat-empty-plus">🔒</span>
              <div class="seat-number-badge">${i}</div>
            </div>
            <div class="seat-user-name">مقعد مقفل</div>
          `;
        } else {
          seatEl.classList.remove('locked');
          const seat = (state.activeRoom.seats || []).find(s => s.seat_index === i);
          if (!seat || !seat.user_id) {
            seatEl.classList.remove('occupied');
            seatEl.innerHTML = `
              <div class="seat-avatar-container">
                <span class="seat-empty-plus">+</span>
                <div class="seat-number-badge">${i}</div>
              </div>
              <div class="seat-user-name">مقعد فارغ</div>
            `;
          }
        }
      }

      showToast(isLocked 
        ? `قام مدير الغرفة (${adminName || 'المضيف'}) بقفل جميع مقاعد المايك وإغلاق الصوت 🔒` 
        : `قام مدير الغرفة (${adminName || 'المضيف'}) بفتح جميع مقاعد المايك للجمهور 🔓`);
    });

    state.socket.on('chat_error', ({ message }) => {
      showToast(message);
    });

    state.socket.on('seat_updated', ({ seatIndex, user, isMuted }) => {
      updateRoomSeatUI(seatIndex, user, isMuted);
    });

    state.socket.on('seat_mute_changed', ({ seatIndex, userId, isMuted, adminName }) => {
      updateSeatMuteUI(seatIndex, isMuted);

      const isMe = (state.currentUser && userId && state.currentUser.id === userId) || (state.userSeatIndex === seatIndex);
      if (isMe) {
        state.isMuted = !!isMuted;
        if (window.soulRtc) {
          window.soulRtc.setVoiceMuted(!!isMuted);
        }
        if (isMuted) {
          broadcastSpeakingStatus(false, 0);
        }
        updateMicButtonUI();
        if (adminName) {
          showToast(isMuted 
            ? `🔇 قام مدير الغرفة (${adminName}) بكتم المايك الخاص بك!` 
            : `🎙️ قام مدير الغرفة (${adminName}) بفك الكتم عن المايك الخاص بك!`);
        }
      } else if (userId) {
        // Other participants in room: silence or unmute this user's audio element
        if (window.soulRtc) {
          window.soulRtc.silenceRemoteUser(userId, !!isMuted);
        }
      }
    });

    state.socket.on('user_force_muted', ({ seatIndex, userId, isMuted, adminName }) => {
      const isMe = state.currentUser && state.currentUser.id === userId;
      if (isMe) {
        state.isMuted = !!isMuted;
        if (window.soulRtc) {
          window.soulRtc.setVoiceMuted(!!isMuted);
        }
        if (isMuted) {
          broadcastSpeakingStatus(false, 0);
        }
        updateMicButtonUI();
        showToast(isMuted 
          ? `🔇 تم كتم المايكروفون الخاص بك من قبل الإدارة (${adminName || 'المشرف'})` 
          : `🎙️ تم فك كتم المايك الخاص بك من قبل الإدارة (${adminName || 'المشرف'})`);
      } else if (userId) {
        if (window.soulRtc) {
          window.soulRtc.silenceRemoteUser(userId, !!isMuted);
        }
      }
    });

    state.socket.on('user_speaking_status', ({ userId, isSpeaking }) => {
      toggleSpeakerSoundWaveUI(userId, isSpeaking);
    });

    state.socket.on('room_gift_sent', (payload) => {
      if (window.giftEffectsEngine) {
        window.giftEffectsEngine.showGiftAnimation(payload.gift, payload.sender, payload.receiver);
      }
      if (payload && payload.receiver && payload.receiver.id) {
        const openGiftsBoxes = document.querySelectorAll(`.user-received-gifts-box[data-user-id="${payload.receiver.id}"]`);
        openGiftsBoxes.forEach(box => {
          loadAndRenderUserGiftsSection(payload.receiver.id, box, state.currentUser && state.currentUser.id === payload.receiver.id);
        });
      }
    });

    state.socket.on('user_gift_received', (payload) => {
      if (!payload || !payload.receiver) return;
      if (state.currentUser && payload.receiver.id === state.currentUser.id) {
        fetchCurrentUserProfile();
        if (!state.activeRoom || state.activeRoom.id !== payload.room_id) {
          showToast(`🎁 وصلتك هدية "${payload.gift.name}" ${payload.gift.icon} من ${payload.sender?.name || 'صديق'} وتم حفظها في هداياك! ✨`);
        }
      }
      const openGiftsBoxes = document.querySelectorAll(`.user-received-gifts-box[data-user-id="${payload.receiver.id}"]`);
      openGiftsBoxes.forEach(box => {
        loadAndRenderUserGiftsSection(payload.receiver.id, box, state.currentUser && state.currentUser.id === payload.receiver.id);
      });
    });

    state.socket.on('room_entry_effect', ({ user, effectId }) => {
      showRoomEntryEffectBanner(user, effectId);
    });

    state.socket.on('dice_rolled', ({ user, value }) => {
      showDiceRollOverlay(user, value);
    });

    state.socket.on('wheel_spun', ({ user, prize }) => {
      showToast(`🎡 أدار ${user.name} عجلة الحظ وفاز بـ ${prize.label}!`);
    });

    state.socket.on('sound_effect_played', ({ effect, soundName, senderName }) => {
      if (window.soundManager) {
        if (effect === 'applause') window.soundManager.playApplause();
        if (effect === 'cheer') window.soundManager.playCheer();
        if (effect === 'laughter') window.soundManager.playLaughter();
        if (effect === 'drumroll') window.soundManager.playDrumroll();
      }
      showToast(`🎵 ${senderName} شغل صوت: ${soundName}`);
    });

    state.socket.on('pk_started', (pkState) => {
      showPKBattleUI(pkState);
    });

    state.socket.on('pk_timer_tick', ({ timeLeft, hostScore, challengerScore }) => {
      updatePKTimerUI(timeLeft, hostScore, challengerScore);
    });

    state.socket.on('pk_score_updated', ({ hostScore, challengerScore, user, team, points }) => {
      updatePKScoreUI(hostScore, challengerScore, user, team, points);
    });

    state.socket.on('pk_ended', (data) => {
      handlePkRoundEnded(data);
    });

    state.socket.on('pk_ended_manually', () => {
      handlePkRoundEnded(null);
      showToast('تم إنهاء جولة الـ PK من قبل المضيف 🛑');
    });

    // Admin & Moderation Events
    state.socket.on('seat_lock_changed', ({ seatIndex, isLocked, vacatedUserId }) => {
      const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
      if (seatEl) {
        seatEl.classList.toggle('locked', isLocked);
        if (isLocked) {
          seatEl.classList.remove('occupied');
          seatEl.querySelector('.seat-avatar-container').innerHTML = `
            <span class="seat-empty-plus">🔒</span>
            <div class="seat-number-badge">${seatIndex}</div>
          `;
          seatEl.querySelector('.seat-user-name').innerText = 'مقعد مقفل';
        } else {
          seatEl.querySelector('.seat-avatar-container').innerHTML = `
            <span class="seat-empty-plus">+</span>
            <div class="seat-number-badge">${seatIndex}</div>
          `;
          seatEl.querySelector('.seat-user-name').innerText = 'مقعد فارغ';
        }
      }

      if (isLocked) {
        // If current user is on this seat -> Step down immediately and cut hardware audio
        if (state.userSeatIndex === seatIndex) {
          state.userSeatIndex = null;
          state.isMuted = true;
          stopLocalMicCapture();
          if (window.soulRtc) {
            window.soulRtc.stopBroadcastingVoice();
          }
          updateMicButtonUI();
          showToast('🔒 تم قفل مقعدك من قِبل إدارة الغرفة وتم إنزالك للجمهور وإغلاق المايك فوراً.');
        }

        // Clear from active room seats in memory
        if (state.activeRoom && state.activeRoom.seats) {
          const s = state.activeRoom.seats.find(st => st.seat_index === seatIndex);
          if (s) {
            s.is_locked = 1;
            s.user_id = null;
          }
        }

        // Remove remote audio for this user immediately on all clients
        if (vacatedUserId && window.soulRtc) {
          window.soulRtc.removeRemoteUserAudio(vacatedUserId);
        }
      } else {
        if (state.activeRoom && state.activeRoom.seats) {
          const s = state.activeRoom.seats.find(st => st.seat_index === seatIndex);
          if (s) s.is_locked = 0;
        }
      }
    });

    state.socket.on('user_kicked_from_seat', ({ seatIndex, userId, adminName }) => {
      if (state.currentUser && state.currentUser.id === userId) {
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
        showToast(`قام مدير الروم (${adminName || 'المضيف'}) بإنزالك من مقعد المايك 🪑`);
      } else if (userId) {
        if (window.soulRtc) {
          window.soulRtc.removeRemoteUserAudio(userId);
        }
      }
    });

    state.socket.on('room_closed_by_host', ({ roomId, adminName }) => {
      if (state.activeRoom && state.activeRoom.id === roomId) {
        leaveActiveVoiceRoom();
        showToast(`أغلق المضيف (${adminName || 'المدير'}) هذه الغرفة 🚪`);
      }
    });

    // 2-Person Co-Host Video Broadcast Events
    state.socket.on('cohost_invitation_received', ({ roomId, hostUser }) => {
      const accept = confirm(`🎉 المضيف ${hostUser.name} يدعوك للانضمام إلى بث فيديو مشترك ثنائي (Co-Host Live PK)! هل تقبل الدعوة؟`);
      if (accept) {
        state.socket.emit('accept_cohost', {
          roomId,
          cohostUser: state.currentUser
        });
        showToast('تم قبول الدعوة! جارِ تفعيل كاميرتك للانضمام للبث المشترك 📹');
        if (window.triggerCohostSplitView) {
          window.triggerCohostSplitView(state.currentUser);
        }
      }
    });

    state.socket.on('cohost_joined_stream', ({ cohostUser }) => {
      if (window.triggerCohostSplitView) {
        window.triggerCohostSplitView(cohostUser);
      }
    });

    state.socket.on('cohost_left_stream', ({ userId } = {}) => {
      if (window.soulRtc && state.currentUser && userId === state.currentUser.id) {
        window.soulRtc.stopBroadcastingCohost();
      }
      if (window.revertCohostSplitView) {
        window.revertCohostSplitView();
      }
    });

    // Two-Party Mutual PK Battle Challenge Events
    state.socket.on('pk_battle_challenge_received', ({ roomId, challenger }) => {
      if (window.showIncomingPkChallengeModal) {
        window.showIncomingPkChallengeModal(roomId, challenger);
      }
    });

    state.socket.on('pk_battle_challenge_rejected', () => {
      showToast('اعتذر الطرف الآخر عن قبول جولة الـ PK حالياً ✋');
    });

    // Co-host Viewer Request & Host Decision Events
    state.socket.on('cohost_request_received', ({ roomId, requester, requestsCount, requests }) => {
      if (window.handleIncomingCohostRequest) {
        window.handleIncomingCohostRequest(requester, requestsCount, requests);
      }
    });

    state.socket.on('cohost_requests_updated', ({ count, requests }) => {
      if (window.handleCohostRequestsUpdated) {
        window.handleCohostRequestsUpdated(count, requests);
      }
    });

    state.socket.on('cohost_request_accepted', ({ roomId, hostUser }) => {
      showToast(`🎉 وافق المضيف ${hostUser?.name || ''} على طلب صعودك! جارِ تقسيم الشاشة وتفعيل الكاميرا... 📹✨`);
      const btnText = document.getElementById('stream-request-btn-text');
      if (btnText) btnText.innerText = 'على الهواء 🔴';
    });

    state.socket.on('cohost_request_rejected', () => {
      showToast('اعتذر صاحب البث عن قبول طلب الصعود حالياً ✋');
      const btnText = document.getElementById('stream-request-btn-text');
      if (btnText) btnText.innerText = 'طلب صعود (PK)';
    });

    // Supreme Owner Global Announcement
    state.socket.on('global_announcement_broadcast', ({ message }) => {
      showGlobalAnnouncementBanner(message);
    });

    // Voice Match & Blind 5-Min Call Events (SoulChill Planet)
    state.socket.on('voice_match_connected', (data) => {
      openVoiceMatchScreen(data);
    });

    state.socket.on('partner_revealed_identity', () => {
      showToast('🌟 الشريك قام بكشف هويته لك! انقر على "كشف هويتي" لتتحول المكالمة إلى بلا حدود!');
      const revealBtn = document.getElementById('btn-reveal-voice-match-identity');
      if (revealBtn && !revealBtn.classList.contains('revealed')) {
        revealBtn.innerHTML = '<span>🌟 الشريك كشف هويته! اكشف هويتك الآن ➔</span>';
        revealBtn.style.animation = 'buttonPulseGlow 0.8s infinite';
      }
    });

    state.socket.on('voice_match_both_revealed', (payload) => {
      handleVoiceMatchMutualReveal(payload);
    });

    state.socket.on('partner_speaking_status', ({ isSpeaking }) => {
      const partnerCircle = document.getElementById('vmatch-partner-avatar-circle');
      if (partnerCircle) {
        partnerCircle.classList.toggle('speaking', isSpeaking);
      }
    });

    state.socket.on('voice_match_reaction_burst', ({ emoji }) => {
      triggerVoiceMatchReactionBurst(emoji);
    });

    state.socket.on('voice_match_ended', () => {
      closeVoiceMatchScreen(true);
    });

    state.socket.on('voice_match_error', ({ message }) => {
      const radar = document.getElementById('voice-match-radar-modal');
      if (radar) radar.remove();
      showToast(message || 'تعذر التوافق الصوتي حالياً');
    });

    // Realtime Global Rooms Grid Updates (No Refresh Needed!)
    state.socket.on('room_created', ({ room }) => {
      if (!room) return;
      const idx = state.rooms.findIndex(r => r.id === room.id);
      if (idx === -1) {
        state.rooms.unshift(room);
      } else {
        state.rooms[idx] = room;
      }
      if (state.currentTab === 'rooms') {
        applyRoomsFilters();
      }
      showToast(`🎉 تم إنشاء بث/غرفة جديدة: "${room.title}"!`);
    });

    state.socket.on('room_deleted', ({ roomId }) => {
      state.rooms = state.rooms.filter(r => r.id !== roomId);
      if (state.currentTab === 'rooms') {
        applyRoomsFilters();
      }
      if (state.activeRoom && state.activeRoom.id === roomId) {
        leaveActiveVoiceRoom();
        const streamModal = document.getElementById('live-video-broadcast-modal');
        if (streamModal) streamModal.remove();
        showToast('تم إغلاق وحذف هذه الغرفة بواسطة المضيف 🚪');
      }
    });

    state.socket.on('room_updated', ({ room }) => {
      if (!room) return;
      const idx = state.rooms.findIndex(r => r.id === room.id);
      if (idx !== -1) {
        state.rooms[idx] = room;
        if (state.currentTab === 'rooms') {
          applyRoomsFilters();
        }
      }
    });

    // Realtime Accurate Occupant Counts Sync (Lobby & In-Room)
    state.socket.on('room_occupants_updated', ({ roomId, count }) => {
      const room = state.rooms.find(r => r.id === roomId);
      if (room) room.audience_count = count;
      document.querySelectorAll(`.room-card-audience-count[data-room-id="${roomId}"]`).forEach(el => {
        el.innerText = count.toString();
      });
      if (state.activeRoom && state.activeRoom.id === roomId) {
        state.activeRoom.audience_count = count;
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const badge = document.getElementById('room-audience-badge');
        if (badge) badge.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
    });

    // Global Admin & Moderator Role Sync
    state.socket.on('user_role_updated', ({ role, message }) => {
      if (state.currentUser) {
        state.currentUser.role = role;
        showToast(message || `تم تحديث رتبتك الإدارية إلى: ${role === 'moderator' ? 'مشرف عام 🛡️' : role}`);
        updateHeaderUI();
      }
    });

    // Banned Notice from Admin Control Panel
    state.socket.on('account_banned_notice', ({ message }) => {
      alert(message || 'لقد تم حظر حسابك من قبل إدارة التطبيق! 🚫');
      handleSignOut();
    });

    // Global Broadcast Broadcast from Admin Panel
    state.socket.on('global_system_broadcast', ({ title, message, sender }) => {
      showGlobalAnnouncementBanner(`📢 [${sender || 'إدارة التطبيق'}]: ${title} - ${message}`);
    });

    // Initialize WebRTC Real Audio/Video Engine
    if (window.soulRtc) {
      window.soulRtc.init(state.socket, state.currentUser);
    }

    // Private Direct Messages
    state.socket.on('private_message', (msg) => {
      if (!state.currentUser) return;
      handleIncomingPrivateMessage(msg);
    });

    // Moments Realtime
    state.socket.on('new_moment', (moment) => {
      state.moments.unshift(moment);
      if (state.currentTab === 'moments') {
        renderMomentsFeed();
      }
    });

    state.socket.on('new_moment_comment', ({ momentId, comment }) => {
      const moment = state.moments.find(m => m.id === momentId);
      if (moment) {
        if (!moment.comments) moment.comments = [];
        moment.comments.push(comment);
        if (state.currentTab === 'moments') {
          renderMomentsFeed();
        }
      }
    });

    // Realtime User Avatar Changed Across All Clients
    state.socket.on('user_avatar_changed', ({ userId, avatar }) => {
      if (state.currentUser && state.currentUser.id === userId) {
        state.currentUser.avatar = avatar;
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
        const profileImg = document.getElementById('profile-page-avatar');
        if (profileImg) profileImg.src = avatar;
      }
      if (state.activeRoomSeats) {
        state.activeRoomSeats.forEach(s => {
          if (s.user && s.user.id === userId) {
            s.user.avatar = avatar;
          }
        });
        renderRoomSeatsGrid(state.activeRoomSeats);
      }
    });
  }

  // 2. Auth State & Google Sign-In
  function requireAuth() {
    if (!state.currentUser || !state.currentUser.id) {
      showGoogleLoginModal();
      showToast('يرجى تسجيل الدخول بحساب Google أو Gmail أولاً ✨');
      return false;
    }
    return true;
  }

  async function checkStoredAuth() {
    const savedUser = localStorage.getItem('soulchill_user');
    const savedToken = localStorage.getItem('soulchill_token') || localStorage.getItem('soulchill_auth_token') || 'device-persistent-token';
    const savedUserId = localStorage.getItem('soulchill_user_id');

    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && parsed.id && parsed.id !== 'undefined' && parsed.id !== 'null') {
          state.currentUser = parsed;
          state.token = savedToken;
          localStorage.setItem('soulchill_user_id', parsed.id);
          localStorage.setItem('soulchill_token', savedToken);
          onUserAuthenticated();
          return;
        }
      } catch (e) {
        console.warn('Could not parse cached user:', e);
      }
    } else if (savedUserId && savedUserId !== 'undefined' && savedUserId !== 'null') {
      try {
        const res = await fetch('/api/users/me', {
          headers: { 'x-user-id': savedUserId }
        });
        if (res.ok) {
          const u = await res.json();
          if (u && u.id) {
            state.currentUser = u;
            state.token = savedToken;
            localStorage.setItem('soulchill_user', JSON.stringify(u));
            localStorage.setItem('soulchill_token', savedToken);
            onUserAuthenticated();
            return;
          }
        }
      } catch (e) {
        console.warn('Could not fetch user by ID:', e);
      }
    }

    // User is NOT logged in (e.g. first visit or logged out):
    state.currentUser = null;
    state.token = null;
    updateHeaderUI();
    switchTab('planet');

    // Display the professional Gmail / Google Login modal immediately
    setTimeout(() => {
      showGoogleLoginModal();
    }, 350);
  }

  function onUserAuthenticated() {
    // Hide auth modal if open
    hideModal('google-auth-modal');

    // Save account in registered device accounts list
    if (state.currentUser && state.currentUser.email) {
      saveDeviceAccount(state.currentUser);
    }

    // Register with Socket
    if (state.socket && state.currentUser) {
      state.socket.emit('user_connect', state.currentUser.id);
    }

    // Update Top Header UI
    updateHeaderUI();

    // Refresh User Profile from DB to ensure freshest stats
    fetchCurrentUserProfile();

    // Load User's Favorite Rooms
    loadFavoriteRooms();

    // Switch to Planet Tab
    switchTab(state.currentTab || 'planet');

    if (state.currentUser && state.currentUser.name) {
      showToast(`مرحباً بك يا ${state.currentUser.name} في عالم SoulChill! 🪐✨`);
    }
  }

  async function fetchCurrentUserProfile() {
    if (!state.currentUser || !state.currentUser.id) return;
    try {
      const res = await fetch('/api/users/me', {
        headers: { 'x-user-id': state.currentUser.id }
      });
      if (res.ok) {
        state.currentUser = await res.json();
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        localStorage.setItem('soulchill_user_id', state.currentUser.id);
        updateHeaderUI();
      }
      // Never wipe localStorage on network latency to guarantee device persistence
    } catch (err) {
      console.warn('Silent profile sync error:', err);
    }
  }

  // Favorite Rooms Helpers ("المفضلة")
  async function loadFavoriteRooms() {
    try {
      const raw = localStorage.getItem('soulchill_favorite_rooms');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          state.favoriteRoomIds = parsed;
        }
      }
    } catch (e) {}

    if (!state.currentUser || !state.currentUser.id) return;
    try {
      const res = await fetch('/api/rooms/favorites', {
        headers: { 'x-user-id': state.currentUser.id }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favoriteRoomIds)) {
          const merged = Array.from(new Set([...state.favoriteRoomIds, ...data.favoriteRoomIds]));
          state.favoriteRoomIds = merged;
          localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(merged));
        }
      }
    } catch (err) {
      console.warn('Silent favorite rooms sync error:', err);
    }
  }

  function isRoomFavorited(roomId) {
    if (!roomId) return false;
    if (!Array.isArray(state.favoriteRoomIds)) state.favoriteRoomIds = [];
    return state.favoriteRoomIds.includes(roomId);
  }

  async function toggleFavoriteRoom(roomId, btnEl) {
    if (!roomId) return;
    if (!Array.isArray(state.favoriteRoomIds)) state.favoriteRoomIds = [];

    const currentlyFav = state.favoriteRoomIds.includes(roomId);
    let nowFav = !currentlyFav;

    if (nowFav) {
      state.favoriteRoomIds.push(roomId);
    } else {
      state.favoriteRoomIds = state.favoriteRoomIds.filter(id => id !== roomId);
    }
    localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(state.favoriteRoomIds));

    // Update UI button immediately
    const updateBtnVisual = (el, favState) => {
      if (!el) return;
      el.classList.toggle('favorited', favState);
      el.title = favState ? 'إزالة الغرفة من المفضلة' : 'إضافة الغرفة إلى المفضلة';
      const iconEl = el.querySelector('.fav-heart-icon') || el;
      iconEl.innerText = favState ? '❤️' : '🤍';
    };

    updateBtnVisual(btnEl, nowFav);
    document.querySelectorAll(`.room-fav-heart-btn[data-room-id="${roomId}"], .room-card-fav-btn[data-room-id="${roomId}"]`).forEach(el => {
      updateBtnVisual(el, nowFav);
    });

    showToast(nowFav ? '❤️ تمت إضافة الغرفة إلى المفضلة!' : '🤍 تمت إزالة الغرفة من المفضلة');

    if (state.currentUser && state.currentUser.id) {
      try {
        const res = await fetch(`/api/rooms/${roomId}/favorite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ user_id: state.currentUser.id })
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.favoriteRoomIds)) {
            state.favoriteRoomIds = data.favoriteRoomIds;
            localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(data.favoriteRoomIds));
          }
        }
      } catch (e) {}
    }

    if (state.currentTab === 'rooms' && state.selectedCategory === 'favorites') {
      applyRoomsFilters();
    }
  }

  // User Received Gifts Wall Renderer ("هداياه")
  async function loadAndRenderUserGiftsSection(userId, containerEl, isSelf = false) {
    if (!userId || !containerEl) return;
    try {
      const res = await fetch(`/api/users/${userId}/gifts`);
      if (!res.ok) throw new Error('Failed to load user gifts');
      const data = await res.json();
      const summary = Array.isArray(data.summary) ? data.summary : [];
      const totalCount = data.totalCount || 0;

      if (summary.length === 0) {
        containerEl.innerHTML = `
          <div class="user-gifts-wall-header">
            <span>🎁 ${isSelf ? 'خزانة هداياي (الهدايا المستلمة)' : 'هداياه المستلمة (خزانة الهدايا)'}</span>
            <span class="user-gifts-count-badge">0 هدية</span>
          </div>
          <div class="user-gifts-empty-state">
            ${isSelf ? 'لم تستلم هدايا بعد.. شارك في الغرف الصوتية واستقبل الهدايا الفاخرة! ✨' : 'لم يستلم هدايا بعد.. كن أول من يهديه الآن! 🎁✨'}
          </div>
        `;
        return;
      }

      containerEl.innerHTML = `
        <div class="user-gifts-wall-header">
          <span>🎁 ${isSelf ? 'خزانة هداياي (الهدايا المستلمة)' : 'هداياه المستلمة (خزانة الهدايا)'}</span>
          <span class="user-gifts-count-badge">${totalCount} هدية</span>
        </div>
        <div class="user-gifts-wall-grid">
          ${summary.map(g => `
            <div class="user-gift-wall-item" title="${g.gift_name} (العدد: ${g.count})">
              <span class="user-gift-wall-qty">×${g.count}</span>
              <div class="user-gift-wall-icon">${g.gift_icon}</div>
              <div class="user-gift-wall-name">${g.gift_name}</div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      containerEl.innerHTML = '';
    }
  }

  function updateHeaderUI() {
    const coinsEl = document.getElementById('header-coins-val');
    const diamondsEl = document.getElementById('header-diamonds-val');
    const avatarEl = document.getElementById('header-user-avatar');
    const adminLinkBtn = document.getElementById('header-admin-link-btn');

    if (adminLinkBtn) {
      adminLinkBtn.style.display = (state.currentUser && canAccessAdminPanel(state.currentUser)) ? 'flex' : 'none';
    }

    if (!state.currentUser) {
      if (coinsEl) coinsEl.innerText = '0';
      if (diamondsEl) diamondsEl.innerText = '0';
      if (avatarEl) {
        avatarEl.src = 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=GuestSoul';
        avatarEl.className = 'header-user-avatar';
        avatarEl.title = 'تسجيل الدخول عبر Google / Gmail';
      }
      return;
    }

    if (coinsEl) coinsEl.innerText = state.currentUser.coins.toLocaleString();
    if (diamondsEl) diamondsEl.innerText = state.currentUser.diamonds.toLocaleString();
    if (avatarEl) {
      avatarEl.src = state.currentUser.avatar;
      avatarEl.className = `header-user-avatar ${state.currentUser.avatar_frame ? 'avatar-frame-' + state.currentUser.avatar_frame : ''}`;
      avatarEl.title = state.currentUser.name;
    }
  }

  // 3. Tab Navigation
  let planetSphereAnimFrame = null;
  let planetCounterInterval = null;

  function switchTab(tabName) {
    state.currentTab = tabName;

    const appContainer = document.getElementById('main-app-container');
    if (appContainer) {
      appContainer.classList.toggle('tab-planet-active', tabName === 'planet');
    }

    if (tabName !== 'planet') {
      if (planetSphereAnimFrame) {
        cancelAnimationFrame(planetSphereAnimFrame);
        planetSphereAnimFrame = null;
      }
      if (planetCounterInterval) {
        clearInterval(planetCounterInterval);
        planetCounterInterval = null;
      }
    }

    if (tabName === 'chat') {
      state.unreadMessagesCount = 0;
      const navBadge = document.getElementById('nav-chat-unread-badge');
      if (navBadge) {
        navBadge.innerText = '0';
        navBadge.style.display = 'none';
      }
    }

    // Update active nav button
    document.querySelectorAll('.nav-tab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const contentArea = document.getElementById('app-main-content');
    if (!contentArea) return;

    if (tabName === 'planet') {
      renderPlanetTab(contentArea);
    } else if (tabName === 'rooms') {
      renderRoomsTab(contentArea);
    } else if (tabName === 'chat') {
      renderChatTab(contentArea);
    } else if (tabName === 'moments') {
      renderMomentsTab(contentArea);
    } else if (tabName === 'profile') {
      renderProfileTab(contentArea);
    }
  }

  // ============================================
  // TAB 1: SOUL PLANET (SOULCHILL 3D SPHERE & VOICE MATCH)
  // ============================================
  let activeVoiceMatchSession = null;
  let voiceMatchTimerInterval = null;
  let voiceMatchSecondsLeft = 300; // 5 minutes
  let isVoiceMatchMuted = false;
  let isVoiceMatchSpeakerOn = true;
  let voiceMatchMicStream = null;
  let voiceMatchAudioContext = null;
  let voiceMatchAnalyser = null;
  let voiceMatchSimInterval = null;

  function toArabicNumerals(num) {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(num).replace(/[0-9]/g, d => arabicDigits[parseInt(d, 10)]);
  }

  function getOrnateSphereFrameSvg(frameStyle) {
    switch (frameStyle) {
      case 'gold_wings':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="gwGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fef08a"/>
              <stop offset="50%" stop-color="#f59e0b"/>
              <stop offset="100%" stop-color="#b45309"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#gwGrad)" stroke-width="3.5"/>
          <path d="M12 52 C4 40, 6 24, 20 18 C14 28, 16 40, 22 48 Z" fill="url(#gwGrad)"/>
          <path d="M88 52 C96 40, 94 24, 80 18 C86 28, 84 40, 78 48 Z" fill="url(#gwGrad)"/>
          <path d="M36 14 L43 22 L50 9 L57 22 L64 14 L60 25 L40 25 Z" fill="url(#gwGrad)"/>
          <circle cx="50" cy="11" r="2.5" fill="#ef4444"/>
          <path d="M26 80 Q50 92 74 80" fill="none" stroke="url(#gwGrad)" stroke-width="3" stroke-linecap="round"/>
        </svg>`;
      case 'silver_crystal':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="scGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="50%" stop-color="#93c5fd"/>
              <stop offset="100%" stop-color="#3b82f6"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#scGrad)" stroke-width="3.2"/>
          <path d="M10 48 C4 34, 12 20, 24 16 C18 28, 16 38, 20 48 Z" fill="url(#scGrad)"/>
          <path d="M90 48 C96 34, 88 20, 76 16 C82 28, 84 38, 80 48 Z" fill="url(#scGrad)"/>
          <polygon points="50,7 55,18 45,18" fill="#e0f2fe"/>
          <polygon points="38,12 44,20 35,21" fill="#93c5fd"/>
          <polygon points="62,12 65,21 56,20" fill="#93c5fd"/>
          <path d="M24 76 Q50 90 76 76" fill="none" stroke="#e0f2fe" stroke-width="3" stroke-linecap="round"/>
        </svg>`;
      case 'purple_floral':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="pfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f5d0fe"/>
              <stop offset="50%" stop-color="#d946ef"/>
              <stop offset="100%" stop-color="#7e22ce"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#pfGrad)" stroke-width="3.5"/>
          <circle cx="20" cy="24" r="5" fill="#f472b6"/>
          <circle cx="80" cy="24" r="5" fill="#f472b6"/>
          <circle cx="50" cy="11" r="5.5" fill="#e879f9"/>
          <circle cx="13" cy="50" r="4" fill="#c084fc"/>
          <circle cx="87" cy="50" r="4" fill="#c084fc"/>
          <path d="M25 80 Q50 92 75 80" fill="none" stroke="url(#pfGrad)" stroke-width="3.5" stroke-linecap="round"/>
        </svg>`;
      case 'emerald_leaf':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="elGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#bbf7d0"/>
              <stop offset="50%" stop-color="#4ade80"/>
              <stop offset="100%" stop-color="#15803d"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#elGrad)" stroke-width="3.4"/>
          <path d="M12 56 C8 36, 16 20, 30 14 C20 26, 18 42, 20 54 Z" fill="url(#elGrad)"/>
          <path d="M88 56 C92 36, 84 20, 70 14 C80 26, 82 42, 80 54 Z" fill="url(#elGrad)"/>
          <circle cx="50" cy="11" r="4" fill="#fef08a"/>
          <circle cx="36" cy="14" r="3" fill="#f9a8d4"/>
          <circle cx="64" cy="14" r="3" fill="#f9a8d4"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="rgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fde68a"/>
              <stop offset="50%" stop-color="#fb923c"/>
              <stop offset="100%" stop-color="#e11d48"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#rgGrad)" stroke-width="3.5"/>
          <path d="M34 15 L43 22 L50 10 L57 22 L66 15 L62 25 L38 25 Z" fill="url(#rgGrad)"/>
          <path d="M14 44 C8 32, 14 20, 24 18 C18 28, 18 38, 22 44 Z" fill="url(#rgGrad)"/>
          <path d="M86 44 C92 32, 86 20, 76 18 C82 28, 82 38, 78 44 Z" fill="url(#rgGrad)"/>
        </svg>`;
    }
  }

  async function renderPlanetTab(container) {
    if (planetSphereAnimFrame) {
      cancelAnimationFrame(planetSphereAnimFrame);
      planetSphereAnimFrame = null;
    }
    if (planetCounterInterval) {
      clearInterval(planetCounterInterval);
      planetCounterInterval = null;
    }

    container.innerHTML = `
      <div class="planet-soulchill-screen">
        <!-- Top Header Bar matching SoulChill GIF -->
        <div class="planet-top-bar">
          <!-- Right Side: SoulChill Logo + المؤدي Pill -->
          <div class="planet-top-brand-group">
            <span class="planet-brand-logo-text">SoulChill</span>
            <button class="soul-performer-pill" id="open-soul-test-btn" title="اختبار الروح">
              <span class="soul-performer-orb">
                <svg viewBox="0 0 28 28" width="18" height="18">
                  <defs>
                    <radialGradient id="perfOrbGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#f3e8ff" />
                      <stop offset="50%" stop-color="#c084fc" />
                      <stop offset="100%" stop-color="#581c87" />
                    </radialGradient>
                  </defs>
                  <polygon points="14,2 23,8 25,18 18,26 9,26 3,18 5,8" fill="url(#perfOrbGrad)" stroke="#e9d5ff" stroke-width="0.8"/>
                  <polyline points="5,8 14,13 23,8" fill="none" stroke="#f3e8ff" stroke-width="0.8" opacity="0.7"/>
                  <polyline points="14,13 14,26" fill="none" stroke="#f3e8ff" stroke-width="0.8" opacity="0.7"/>
                </svg>
              </span>
              <span class="soul-performer-text">المؤدي</span>
            </button>
          </div>

          <!-- Left Side: Golden Calendar Check-in & Purple Filter Sliders -->
          <div class="planet-top-actions">
            <button class="planet-golden-calendar-btn" id="planet-daily-checkin-btn" title="مكافأة الحضور اليومي">
              <svg viewBox="0 0 32 32" width="24" height="24">
                <defs>
                  <linearGradient id="calGoldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="50%" stop-color="#facc15" />
                    <stop offset="100%" stop-color="#ca8a04" />
                  </linearGradient>
                </defs>
                <rect x="4" y="6" width="24" height="22" rx="5" fill="url(#calGoldGrad)" stroke="#fef9c3" stroke-width="1"/>
                <rect x="6" y="12" width="20" height="14" rx="3" fill="#fffbeb"/>
                <rect x="9" y="3" width="3" height="5" rx="1.5" fill="#fef08a"/>
                <rect x="20" y="3" width="3" height="5" rx="1.5" fill="#fef08a"/>
                <path d="M12 19.5l2.8 2.8 5.5-5.6" fill="none" stroke="#d97706" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <button class="planet-sliders-filter-btn" id="planet-filter-toggle-btn" title="تصفية الأرواح">
              <svg viewBox="0 0 28 28" width="22" height="22">
                <line x1="4" y1="9" x2="24" y2="9" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round"/>
                <circle cx="17" cy="9" r="3.6" fill="#e9d5ff" stroke="#7c3aed" stroke-width="1.5"/>
                <line x1="4" y1="19" x2="24" y2="19" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round"/>
                <circle cx="11" cy="19" r="3.6" fill="#e9d5ff" stroke="#7c3aed" stroke-width="1.5"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 3D Rotating Spherical Souls Galaxy Cluster -->
        <div class="soulers-galaxy-cluster" id="soulers-galaxy-cluster">
          <div class="planet-starfield-layer" id="planet-starfield-layer"></div>
          <div class="soulers-3d-sphere-stage" id="soulers-3d-sphere-stage"></div>
        </div>

        <!-- Online Souls Counter (Exact match to GIF: عدد المستخدمين الاونلاين 540413) -->
        <div class="online-soulers-counter">
          <span class="counter-wing right-wing"></span>
          <span class="online-counter-label">عدد المستخدمين الاونلاين</span>
          <strong id="online-soulers-counter-num">540413</strong>
          <span class="counter-wing left-wing"></span>
        </div>

        <!-- First Top-Up / Recharge Rewards Banner (مكافآت الشحنة الاولى <) -->
        <div class="first-recharge-banner" id="planet-one-time-offer-btn">
          <div class="first-recharge-text-side">
            <span class="first-recharge-title">مكافآت الشحنة الاولى</span>
            <span class="first-recharge-chevron">‹</span>
          </div>

          <!-- 3D Purple Gift Box with White Ribbon Bow on the Left -->
          <div class="first-recharge-gift-illustration">
            <svg viewBox="0 0 120 96" width="96" height="78">
              <defs>
                <linearGradient id="boxFrontGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#c084fc" />
                  <stop offset="100%" stop-color="#7e22ce" />
                </linearGradient>
                <linearGradient id="boxSideGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#9333ea" />
                  <stop offset="100%" stop-color="#581c87" />
                </linearGradient>
                <linearGradient id="boxLidGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#e9d5ff" />
                  <stop offset="100%" stop-color="#a855f7" />
                </linearGradient>
                <linearGradient id="ribbonWhiteGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" />
                  <stop offset="60%" stop-color="#f3e8ff" />
                  <stop offset="100%" stop-color="#d8b4fe" />
                </linearGradient>
              </defs>
              <!-- Sparkles -->
              <circle cx="18" cy="22" r="2" fill="#fff" opacity="0.8"/>
              <circle cx="104" cy="18" r="1.8" fill="#f5d0fe" opacity="0.7"/>
              <circle cx="96" cy="68" r="1.5" fill="#fff" opacity="0.6"/>
              <g transform="rotate(-8 60 54)">
                <!-- Gift Box Base 3D -->
                <polygon points="24,44 64,52 64,90 24,80" fill="url(#boxSideGrad)" />
                <polygon points="64,52 100,42 100,78 64,90" fill="url(#boxFrontGrad)" />
                <!-- White Vertical Ribbons on Box Body -->
                <polygon points="40,47 48,49 48,86 40,84" fill="url(#ribbonWhiteGrad)" />
                <polygon points="79,48 87,45 87,82 79,85" fill="url(#ribbonWhiteGrad)" />
                <!-- Gift Box Lid 3D -->
                <polygon points="20,34 64,43 64,54 20,44" fill="url(#boxFrontGrad)" />
                <polygon points="64,43 104,32 104,43 64,54" fill="url(#boxLidGrad)" />
                <polygon points="20,34 60,24 104,32 64,43" fill="#d8b4fe" />
                <!-- White Ribbon on Lid -->
                <polygon points="38,38 47,40 47,50 38,48" fill="#ffffff" />
                <polygon points="80,38 89,36 89,47 80,49" fill="#ffffff" />
                <!-- Big 3D White Silk Bow on Top -->
                <path d="M62,33 C46,12 28,18 38,32 C44,36 54,35 62,33 Z" fill="url(#ribbonWhiteGrad)" stroke="#f3e8ff" stroke-width="1"/>
                <path d="M62,33 C78,10 96,18 86,31 C80,35 70,35 62,33 Z" fill="url(#ribbonWhiteGrad)" stroke="#f3e8ff" stroke-width="1"/>
                <path d="M56,33 L46,45 L54,46 L62,35 Z" fill="#f3e8ff"/>
                <path d="M66,33 L76,44 L68,46 L62,35 Z" fill="#ffffff"/>
                <ellipse cx="62" cy="32" rx="6" ry="4.5" fill="#ffffff" />
              </g>
            </svg>
          </div>
        </div>

        <!-- 2x2 Feature Cards Grid matching GIF -->
        <div class="planet-2x2-cards-grid">
          <!-- Card 1 (Top-Right in RTL): مكالمة صوتية -->
          <div class="planet-feature-card" id="planet-card-voice-match">
            <div class="planet-card-top-pill speed-pill">
              <span>بطاقة التسريع جاهزة للاستخدام</span>
              <span class="pill-bolt">⚡</span>
            </div>
            <div class="planet-card-header">
              <div class="planet-card-title">مكالمة صوتية</div>
              <div class="planet-card-sub">انضم لقائمة المكالمات</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <!-- 3D Glowing Cyan/Blue Ringed Planet -->
                <svg viewBox="0 0 80 70" width="66" height="58">
                  <defs>
                    <radialGradient id="cyanPlanetGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#a7f3d0" />
                      <stop offset="38%" stop-color="#38bdf8" />
                      <stop offset="75%" stop-color="#2563eb" />
                      <stop offset="100%" stop-color="#1e1b4b" />
                    </radialGradient>
                    <linearGradient id="cyanRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#cbd5e1" stop-opacity="0.85" />
                      <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.35" />
                      <stop offset="100%" stop-color="#94a3b8" stop-opacity="0.8" />
                    </linearGradient>
                  </defs>
                  <ellipse cx="40" cy="36" rx="35" ry="11" fill="none" stroke="url(#cyanRingGrad)" stroke-width="5" transform="rotate(-18 40 36)" opacity="0.75" />
                  <circle cx="40" cy="35" r="20" fill="url(#cyanPlanetGrad)" />
                  <path d="M23 30 Q40 24 57 31" fill="none" stroke="#bae6fd" stroke-width="2" opacity="0.45" />
                  <path d="M21 39 Q40 33 59 40" fill="none" stroke="#7dd3fc" stroke-width="1.6" opacity="0.35" />
                  <path d="M8 46 A35 11 0 0 0 72 26" fill="none" stroke="url(#cyanRingGrad)" stroke-width="4.5" transform="rotate(-18 40 36)" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 2 (Top-Left in RTL): رفيق الروح -->
          <div class="planet-feature-card" id="planet-card-soul-match">
            <div class="planet-card-header">
              <div class="planet-card-title">رفيق الروح</div>
              <div class="planet-card-sub">تحدث مع من يفهمك</div>
            </div>
            <div class="planet-card-footer">
              <span class="planet-card-remaining">تبقى 2</span>
              <div class="planet-card-3d-icon">
                <!-- 3D Glowing Pink/Magenta Heart Padlock & Silver Key -->
                <svg viewBox="0 0 84 70" width="68" height="58">
                  <defs>
                    <radialGradient id="heartLockGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#f5d0fe" />
                      <stop offset="45%" stop-color="#e879f9" />
                      <stop offset="80%" stop-color="#a21caf" />
                      <stop offset="100%" stop-color="#581c87" />
                    </radialGradient>
                    <linearGradient id="silverShackleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#ffffff" />
                      <stop offset="50%" stop-color="#e2e8f0" />
                      <stop offset="100%" stop-color="#94a3b8" />
                    </linearGradient>
                  </defs>
                  <g transform="rotate(-12 36 38)">
                    <!-- Padlock Shackle -->
                    <path d="M25 28 V19 A9 9 0 0 1 43 19 V28" fill="none" stroke="url(#silverShackleGrad)" stroke-width="4.2" stroke-linecap="round" />
                    <!-- 3D Heart Body -->
                    <path d="M34 56 C34 56 14 44 14 30 C14 22 21 18 28 22 C31 24 33 26 34 28 C35 26 37 24 40 22 C47 18 54 22 54 30 C54 44 34 56 34 56 Z" fill="url(#heartLockGrad)" stroke="#f5d0fe" stroke-width="0.8" />
                    <!-- Keyhole -->
                    <circle cx="34" cy="36" r="2.8" fill="#3b0764" />
                    <path d="M33 38 L32 44 L36 44 L35 38 Z" fill="#3b0764" />
                  </g>
                  <!-- Silver Key on the Right -->
                  <g transform="translate(44, 30) rotate(-18)">
                    <line x1="0" y1="8" x2="18" y2="8" stroke="url(#silverShackleGrad)" stroke-width="3.2" stroke-linecap="round" />
                    <line x1="3" y1="8" x2="3" y2="13" stroke="url(#silverShackleGrad)" stroke-width="2.5" stroke-linecap="round" />
                    <line x1="8" y1="8" x2="8" y2="12" stroke="url(#silverShackleGrad)" stroke-width="2.5" stroke-linecap="round" />
                    <circle cx="22" cy="8" r="5.5" fill="none" stroke="url(#silverShackleGrad)" stroke-width="3.2" />
                  </g>
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 3 (Bottom-Right in RTL): الأحداث -->
          <div class="planet-feature-card" id="planet-card-events">
            <div class="planet-card-top-pill blue-pill">
              <span>مكافآت وتحديات يومية</span>
              <span class="pill-bolt">🔥</span>
            </div>
            <div class="planet-card-header">
              <div class="planet-card-title">الأحداث</div>
              <div class="planet-card-sub">شارك واربح جوائز قيمة</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <svg viewBox="0 0 80 70" width="62" height="54">
                  <defs>
                    <radialGradient id="goldStarGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#fef9c3" />
                      <stop offset="50%" stop-color="#facc15" />
                      <stop offset="100%" stop-color="#b45309" />
                    </radialGradient>
                  </defs>
                  <circle cx="38" cy="36" r="19" fill="#312e81" stroke="#818cf8" stroke-width="1.5" />
                  <polygon points="38,17 43,29 56,30 46,39 49,51 38,44 27,51 30,39 20,30 33,29" fill="url(#goldStarGrad)" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 4 (Bottom-Left in RTL): غرف الدردشة -->
          <div class="planet-feature-card" id="planet-card-party">
            <div class="planet-card-header">
              <div class="planet-card-title">غرف الدردشة</div>
              <div class="planet-card-sub">تحدث واستمتع مع الأصدقاء</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <svg viewBox="0 0 80 70" width="62" height="54">
                  <defs>
                    <linearGradient id="micPartyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#f472b6" />
                      <stop offset="50%" stop-color="#a855f7" />
                      <stop offset="100%" stop-color="#6366f1" />
                    </linearGradient>
                  </defs>
                  <rect x="29" y="14" width="18" height="26" rx="9" fill="url(#micPartyGrad)" />
                  <path d="M23 30 A15 15 0 0 0 53 30" fill="none" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                  <line x1="38" y1="45" x2="38" y2="54" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                  <line x1="29" y1="54" x2="47" y2="54" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initialize Starfield in the Galaxy Cluster
    initPlanetStarfield();

    // Load users and populate 3D rotating sphere
    try {
      const res = await fetch('/api/users');
      state.allUsers = await res.json();
      populateSoulGalaxyCluster();
    } catch (err) {
      console.error('Error fetching users for galaxy:', err);
      populateSoulGalaxyCluster();
    }

    // Dynamic Online Soulers counter fluctuation around 540413
    const counterEl = container.querySelector('#online-soulers-counter-num');
    if (counterEl) {
      let count = 540413;
      planetCounterInterval = setInterval(() => {
        const el = document.getElementById('online-soulers-counter-num');
        if (!el) return;
        count += Math.floor(Math.random() * 5) - 2;
        el.innerText = String(count);
      }, 3500);
    }

    // Wire Card Clicks
    const voiceMatchCard = container.querySelector('#planet-card-voice-match');
    if (voiceMatchCard) {
      voiceMatchCard.onclick = () => startVoiceMatchSession('voice');
    }

    const soulMatchCard = container.querySelector('#planet-card-soul-match');
    if (soulMatchCard) {
      soulMatchCard.onclick = () => startVoiceMatchSession('soul');
    }

    const partyCard = container.querySelector('#planet-card-party');
    if (partyCard) {
      partyCard.onclick = () => switchTab('rooms');
    }

    const eventsCard = container.querySelector('#planet-card-events');
    if (eventsCard) {
      eventsCard.onclick = () => showPlanetEventsModal();
    }

    const soulTestBtn = container.querySelector('#open-soul-test-btn');
    if (soulTestBtn) {
      soulTestBtn.onclick = () => showSoulTestModal();
    }

    const offerBanner = container.querySelector('#planet-one-time-offer-btn');
    if (offerBanner) {
      offerBanner.onclick = () => showOneTimeOfferModal();
    }

    const dailyCheckinBtn = container.querySelector('#planet-daily-checkin-btn');
    if (dailyCheckinBtn) {
      dailyCheckinBtn.onclick = () => handleDailyCheckIn();
    }

    const filterBtn = container.querySelector('#planet-filter-toggle-btn');
    if (filterBtn) {
      let filterMode = 0; // 0: all, 1: high match, 2: same planet
      const modes = ['جميع الأرواح 🪐', 'توافق عالي +٨٢٪ 🔥', 'نفس كوكبي 🌌'];
      filterBtn.onclick = () => {
        filterMode = (filterMode + 1) % modes.length;
        showToast(`فلترة المجرة: ${modes[filterMode]}`);
        populateSoulGalaxyCluster(true, filterMode);
      };
    }
  }

  function initPlanetStarfield() {
    const starLayer = document.getElementById('planet-starfield-layer');
    if (!starLayer) return;
    starLayer.innerHTML = '';
    for (let i = 0; i < 42; i++) {
      const star = document.createElement('span');
      star.className = 'planet-bg-star';
      const size = (Math.random() * 2.2 + 1).toFixed(1);
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${(Math.random() * 96 + 2).toFixed(1)}%`;
      star.style.top = `${(Math.random() * 94 + 3).toFixed(1)}%`;
      star.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
      star.style.animationDuration = `${(Math.random() * 2.5 + 2).toFixed(2)}s`;
      starLayer.appendChild(star);
    }
  }

  // Populate 3D Rotating Sphere of Soul Avatars matching GIF
  function populateSoulGalaxyCluster(reshuffle = false, filterMode = 0) {
    const stage = document.getElementById('soulers-3d-sphere-stage');
    if (!stage) return;

    if (planetSphereAnimFrame) {
      cancelAnimationFrame(planetSphereAnimFrame);
      planetSphereAnimFrame = null;
    }

    // Authentic SoulChill users matching the names, frames, and percentages in the GIF
    const mockSoulers = [
      { id: 'souler-1', name: '🇯🇴 كـينـدا', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أحب الموسيقى والضحك واللقاءات الرايقة', matchRate: 84 },
      { id: 'souler-2', name: 'مـوناليزا...', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'fire_dragon', soul_planet: 'كوكب الفنان الملهم 🎨', bio: 'الجمال في التفاصيل الصغيرة ✨', matchRate: 83 },
      { id: 'souler-3', name: 'ملك', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أهلاً بالجميع في كوكبي الملكي 👑', matchRate: 80 },
      { id: 'souler-4', name: 'حنان S...', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'هدوء الليل والقهوة ☕', matchRate: 83 },
      { id: 'souler-5', name: 'SaMo...', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'عشاق السفر والمغامرات', matchRate: 83 },
      { id: 'souler-6', name: 'مشاكس...', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المرح والبهجة 🎈', bio: 'سوالف ووناسة ٢٤ ساعة 🔥', matchRate: 80 },
      { id: 'souler-7', name: 'ANG7...', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'موسيقى وسهر مع الأصدقاء 🎶', matchRate: 80 },
      { id: 'souler-8', name: 'الجوهر...', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'الكلمة الطيبة جواز سفر للقلوب', matchRate: 83 },
      { id: 'souler-9', name: 'لانا (٠٠٠)', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'angel_wings', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أحب الهدوء والنجوم 🌙', matchRate: 83 },
      { id: 'souler-10', name: 'ريـتاج', avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'emerald_leaf', avatar_frame: 'angel_wings', soul_planet: 'كوكب النسمة الهادئة 🍃', bio: 'صباحات جميلة وروح صافية 🌸', matchRate: 83 },
      { id: 'souler-11', name: 'نـور ❀', avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الفنان الملهم 🎨', bio: 'عاشقة الفن والموسيقى 🎨', matchRate: 81 },
      { id: 'souler-12', name: '✨ Sok...', avatar: 'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?auto=format&fit=crop&w=300&q=80', sphere_frame: 'rose_crown', avatar_frame: 'fire_dragon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'طاقة إيجابية وأجواء حماسية', matchRate: 83 },
      { id: 'souler-13', name: 'هاجر...', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أهلاً بالجميع في عالمي 💜', matchRate: 80 },
      { id: 'souler-14', name: '💎 وكـ K', avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الإمبراطور الفلكي 👑', bio: 'الفخامة عنواننا 👑', matchRate: 79 },
      { id: 'souler-15', name: '..The', avatar: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'سوالف رايقة وموسيقى هادئة', matchRate: 82 },
      { id: 'souler-16', name: '🎀 سما', avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'angel_wings', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'الحياة أجمل مع الأصدقاء', matchRate: 80 },
      { id: 'souler-17', name: 'لوليتا 🖤', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'سهر وطرب وأجواء فخمة', matchRate: 84 },
      { id: 'souler-18', name: 'دهـ🌺ـب', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب النسمة الهادئة 🍃', bio: 'قلوب صافية وأرواح متآلفة', matchRate: 83 },
      { id: 'souler-19', name: 'سـارة 🔮', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80', sphere_frame: 'emerald_leaf', avatar_frame: 'angel_wings', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'أبراج وفلك وسوالف السول', matchRate: 82 },
      { id: 'souler-20', name: 'طـارق 🎸', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'عزف جيتار وغناء مباشر', matchRate: 84 }
    ];

    let allSouls = [...mockSoulers];
    if (state.allUsers && state.allUsers.length > 0) {
      const frameChoices = ['gold_wings', 'silver_crystal', 'purple_floral', 'emerald_leaf', 'rose_crown'];
      state.allUsers.forEach((u, idx) => {
        if (state.currentUser && u.id === state.currentUser.id) return;
        if (!allSouls.find(s => s.id === u.id) && allSouls.length < 24) {
          allSouls.push({
            id: u.id,
            name: u.name.length > 10 ? u.name.slice(0, 9) + '...' : u.name,
            avatar: u.avatar || '/avatars/avatar-1.png',
            sphere_frame: frameChoices[idx % frameChoices.length],
            avatar_frame: u.avatar_frame || 'royal_gold',
            soul_planet: u.soul_planet || 'كوكب الروح 🌌',
            bio: u.bio || 'روح رائعة في SoulChill',
            matchRate: 79 + (idx % 6)
          });
        }
      });
    }

    if (filterMode === 1) {
      allSouls = allSouls.filter(s => s.matchRate >= 82);
    } else if (filterMode === 2 && state.currentUser) {
      const filtered = allSouls.filter(s => s.soul_planet === state.currentUser.soul_planet);
      if (filtered.length >= 8) allSouls = filtered;
    }

    stage.innerHTML = '';

    const count = allSouls.length;
    const sphereNodes = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      const souler = allSouls[i];
      // Fibonacci sphere 3D unit coordinates (-1..1)
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i + (reshuffle ? Math.random() * 0.8 : 0);
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;

      const itemEl = document.createElement('div');
      itemEl.className = 'souler-sphere-node';

      const arabicPercent = `${toArabicNumerals(souler.matchRate)}٪`;
      const ornateFrameSvg = getOrnateSphereFrameSvg(souler.sphere_frame);

      itemEl.innerHTML = `
        <div class="souler-sphere-avatar-wrap">
          <img src="${souler.avatar}" class="souler-sphere-img" onerror="this.onerror=null; this.src='/avatars/avatar-1.png';" />
          ${ornateFrameSvg}
        </div>
        <div class="souler-sphere-name">${souler.name}</div>
        <div class="souler-sphere-match-pill">${arabicPercent}</div>
      `;

      itemEl.onclick = (e) => {
        e.stopPropagation();
        if (window.soundManager) window.soundManager.playClick();
        openSoulProfileCard(souler, souler.matchRate);
      };

      stage.appendChild(itemEl);
      sphereNodes.push({ el: itemEl, x, y, z });
    }

    // 3D Rotation State & Interactive Dragging
    let rotY = 0;
    let rotX = 0.08;
    let velY = -0.0055; // Smooth continuous rotation matching GIF
    let velX = 0;
    let isDragging = false;
    let lastClientX = 0;
    let lastClientY = 0;

    const onPointerDown = (e) => {
      isDragging = true;
      lastClientX = e.touches ? e.touches[0].clientX : e.clientX;
      lastClientY = e.touches ? e.touches[0].clientY : e.clientY;
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - lastClientX;
      const dy = clientY - lastClientY;
      lastClientX = clientX;
      lastClientY = clientY;
      rotY += dx * 0.007;
      rotX = Math.max(-0.5, Math.min(0.5, rotX - dy * 0.005));
      velY = dx * 0.0012 || -0.0055;
    };

    const onPointerUp = () => {
      isDragging = false;
      if (Math.abs(velY) < 0.003) velY = -0.0055;
    };

    stage.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    stage.addEventListener('touchstart', onPointerDown, { passive: true });
    stage.addEventListener('touchmove', onPointerMove, { passive: true });
    stage.addEventListener('touchend', onPointerUp, { passive: true });

    const renderSphereFrame = () => {
      if (!document.getElementById('soulers-3d-sphere-stage')) return;

      if (!isDragging) {
        rotY += velY;
        velY += (-0.0055 - velY) * 0.03;
      }

      const rect = stage.getBoundingClientRect();
      const rxRadius = Math.min(148, (rect.width || 360) * 0.39);
      const ryRadius = Math.min(142, (rect.height || 350) * 0.39);

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      for (let i = 0; i < sphereNodes.length; i++) {
        const n = sphereNodes[i];
        // Rotate around Y
        const x1 = n.x * cosY - n.z * sinY;
        const z1 = n.z * cosY + n.x * sinY;
        // Rotate around X
        const y2 = n.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + n.y * sinX;

        // Depth normalized 0 (back) to 1 (front)
        const depth = (z2 + 1) / 2;
        const scale = (0.48 + depth * 0.58).toFixed(3);
        const opacity = (0.16 + Math.pow(depth, 1.45) * 0.84).toFixed(3);
        const zIdx = Math.round(depth * 100);

        const px = (x1 * rxRadius).toFixed(1);
        const py = (y2 * ryRadius).toFixed(1);

        n.el.style.transform = `translate3d(calc(-50% + ${px}px), calc(-50% + ${py}px), 0) scale(${scale})`;
        n.el.style.opacity = opacity;
        n.el.style.zIndex = zIdx;
      }

      planetSphereAnimFrame = requestAnimationFrame(renderSphereFrame);
    };

    renderSphereFrame();
  }

  // Common Profile Card Modal
  function showUserProfileCard(user) {
    if (!user) return;
    openSoulProfileCard(user, user.matchRate || 95);
  }

  // Direct Private Chat Helper
  function startPrivateChatWithUser(user) {
    if (!user) return;
    openDirectChatWithUser(user);
  }

  // Wallet Modal Opener Helper
  function openWalletModal() {
    showTopUpModal();
  }

  // Room PK Battle Opener Helper
  function startRoomPkBattle(room) {
    if (!state.currentUser) return;
    const targetRoom = room || state.activeRoom;
    if (!targetRoom) return;

    // Find a challenger from occupied seats (seat 1..8)
    const occupiedSeats = (targetRoom.seats || []).filter(s => s.seat_index > 0 && s.user_id);
    const challenger = occupiedSeats.length > 0 ? {
      id: occupiedSeats[0].user_id,
      name: occupiedSeats[0].name,
      avatar: occupiedSeats[0].avatar
    } : {
      id: 'challenger-1',
      name: 'المنافس الأزرق ⚔️',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80'
    };

    const host = {
      id: targetRoom.host_id || state.currentUser.id,
      name: targetRoom.host_name || state.currentUser.name,
      avatar: targetRoom.host_avatar || state.currentUser.avatar
    };

    state.socket.emit('start_pk', {
      roomId: targetRoom.id,
      hostUser: host,
      challengerUser: challenger,
      duration: 60
    });
    showToast('⚔️ جارِ إطلاق تحدي الـ PK في الغرفة!');
  }

  // Soul Profile Card Modal (when clicking any soul)
  function openSoulProfileCard(user, matchRate = 95) {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'soul-user-card-modal';

    const tagsHtml = (user.soul_tags || 'موسيقى,هدوء,سوالف')
      .split(',')
      .map(t => `<span class="cat-pill" style="padding: 2px 8px; font-size: 10px;">#${t.trim()}</span>`)
      .join(' ');

    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-card-btn">✕</button>

        <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
          <div class="profile-big-avatar-box">
            <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
          </div>

          <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 2px;">${user.name}</div>
          <div class="profile-planet-pill">${user.soul_planet || 'كوكب الرومانسي الحالم 🌌'}</div>

          <!-- Compatibility Bar -->
          <div style="width: 100%; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 10px; margin: 10px 0; border: 1px solid var(--border-glass);">
            <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px;">
              <span style="color: #fbbf24;">نسبة توافق الروح:</span>
              <span style="color: #ec4899;">${matchRate}% Soul Match ✨</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
              <div style="height: 100%; width: ${matchRate}%; background: var(--secondary-gradient); border-radius: 4px;"></div>
            </div>
          </div>

          <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4;">
            "${user.bio || 'أحب الحياة والموسيقى الهادئة واللقاءات الرايقة'}"
          </div>

          <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px;">
            ${tagsHtml}
          </div>

          <!-- User's Received Gifts Wall ("هداياه") -->
          <div class="user-received-gifts-box" data-user-id="${user.id}" id="soul-card-gifts-box">
            <div style="font-size: 11px; color: var(--text-muted); padding: 6px;">جارِ تحميل الهدايا... 🎁</div>
          </div>

          <!-- Action Buttons -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-bottom: 8px;">
            <button class="wallet-btn secondary" id="card-say-hi-btn">
              👋 إلقاء التحية
            </button>
            <button class="wallet-btn primary" id="card-start-chat-btn">
              💬 مراسلة خاصة
            </button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;">
            <button class="wallet-btn" style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #fff;" id="card-voice-match-btn">
              🎙️ توافق صوتي (Voice)
            </button>
            <button class="wallet-btn" style="background: var(--secondary-gradient); color: #fff;" id="card-send-gift-btn">
              🎁 إرسال هدية
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cardGiftsBox = modal.querySelector('#soul-card-gifts-box');
    if (cardGiftsBox && user.id) {
      loadAndRenderUserGiftsSection(user.id, cardGiftsBox, !!(state.currentUser && state.currentUser.id === user.id));
    }

    modal.querySelector('#close-card-btn').onclick = () => modal.remove();

    // Say Hi
    modal.querySelector('#card-say-hi-btn').onclick = async () => {
      if (window.soundManager) window.soundManager.playGiftSound(false);
      showToast(`ألقيت التحية على ${user.name}! 👋✨`);
      await sendPrivateMessage(user.id, 'text', 'مرحباً! أعجبني كوكبيك وتوافق أرواحنا في SoulChill 👋💫');
      modal.remove();
    };

    // Start Chat
    modal.querySelector('#card-start-chat-btn').onclick = () => {
      modal.remove();
      openDirectChatWithUser(user);
    };

    // Send Gift
    modal.querySelector('#card-send-gift-btn').onclick = () => {
      modal.remove();
      openGiftStoreModal(user.id, state.activeRoom ? state.activeRoom.id : null, user);
    };

    // Voice Match direct with this user
    modal.querySelector('#card-voice-match-btn').onclick = () => {
      modal.remove();
      startVoiceMatchSession('voice');
    };
  }

  // ============================================
  // SOULCHILL 5-MINUTE ANONYMOUS VOICE MATCH SYSTEM
  // ============================================
  function startVoiceMatchSession(type = 'voice') {
    if (!requireAuth()) return;

    // Remove existing radar modal if any
    const existing = document.getElementById('voice-match-radar-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'voice-match-radar-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 360px; text-align: center; padding: 30px 20px;">
        <!-- Pulsing Cosmic Radar Orbit -->
        <div style="position: relative; width: 140px; height: 140px; margin: 0 auto 16px;">
          <div style="position: absolute; inset: 0; border-radius: 50%; border: 2px dashed rgba(168,85,247,0.5); animation: rotateOrbit 10s linear infinite;"></div>
          <div style="position: absolute; inset: -15px; border-radius: 50%; border: 1.5px solid rgba(236,72,153,0.4); animation: speakingRipple 2s infinite;"></div>
          <div style="position: absolute; inset: 20px; border-radius: 50%; background: radial-gradient(circle, #8b5cf6 0%, #3b0764 100%); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 35px rgba(139,92,246,0.7);">
            <span style="font-size: 46px; animation: floatSubtle 2.5s infinite;">${type === 'voice' ? '🎙️' : '🪐'}</span>
          </div>
        </div>

        <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 6px;">
          ${type === 'voice' ? '🎙️ رادار التوافق الصوتي (Voice Match)' : '🪐 توافق الروح المباشر (Soul Match)'}
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
          جارِ البحث في المجرة عن روح متوافقة تشاركك نفس الاهتمامات لمكالمة صوتية مجهولة مدتها 5 دقائق... 🌌
        </p>

        <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-bottom: 22px;">
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#موسيقى</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#سوالف</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#شات_مجهول</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#رواق</span>
        </div>

        <button class="vmatch-end-btn" id="btn-cancel-voice-radar" style="padding: 8px 24px; font-size: 13px;">إلغاء البحث</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-cancel-voice-radar').onclick = () => {
      modal.remove();
      state.socket.emit('end_voice_match', {});
    };

    // Emit search event to server
    setTimeout(() => {
      if (document.getElementById('voice-match-radar-modal')) {
        state.socket.emit('start_voice_match', {
          userId: state.currentUser.id,
          tags: state.currentUser.soul_tags,
          planet: state.currentUser.soul_planet
        });
      }
    }, 1000);
  }

  // Open Fullscreen Masked Call Screen
  function openVoiceMatchScreen(data) {
    // Remove radar search modal
    const radar = document.getElementById('voice-match-radar-modal');
    if (radar) radar.remove();

    // Close any prior voice match screen
    closeVoiceMatchScreen(false);

    activeVoiceMatchSession = data;
    voiceMatchSecondsLeft = data.duration || 300;
    isVoiceMatchMuted = false;
    isVoiceMatchSpeakerOn = true;

    const modal = document.createElement('div');
    modal.className = 'voice-match-fullscreen-modal';
    modal.id = 'voice-match-active-modal';

    modal.innerHTML = `
      <!-- Top Bar: Header, Timer & End -->
      <div class="vmatch-header-bar">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 22px;">🪐</span>
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #fff;">مكالمة التوافق الصوتي المجهولة</div>
            <div style="font-size: 10px; color: #c084fc;">SoulChill Blind Voice Call</div>
          </div>
        </div>

        <div class="vmatch-timer-badge" id="vmatch-timer-display">
          ⏳ 05:00
        </div>

        <button class="vmatch-end-btn" id="btn-end-voice-match">🛑 إنهاء المكالمة</button>
      </div>

      <!-- Center Voice Call Stage -->
      <div class="vmatch-stage-container">
        <div class="vmatch-duo-avatars-row">
          <!-- User Masked Avatar -->
          <div class="vmatch-user-card">
            <div class="vmatch-avatar-circle" id="vmatch-self-avatar-circle">
              <img src="/avatars/masked-avatar.png" id="vmatch-self-avatar-img" onerror="this.src='/avatars/avatar-1.png'" />
              <div class="vmatch-mask-icon-tag" id="vmatch-self-mask-tag">🎭</div>
            </div>
            <div class="vmatch-name-tag" id="vmatch-self-name-label">أنت (هويتك مخفية)</div>
            <div class="vmatch-planet-tag">${state.currentUser?.soul_planet || 'كوكب الروح 🌌'}</div>
          </div>

          <!-- Compatibility Heart & Waves -->
          <div class="vmatch-compatibility-heart">
            <div class="heart-pulse-icon">💖</div>
            <div class="heart-score-val">${data.partner?.soul_score || 94}% توافق الروح</div>
            <div class="vmatch-audio-waves" id="vmatch-audio-waves">
              <div class="vmatch-wave-bar" style="height: 12px;"></div>
              <div class="vmatch-wave-bar" style="height: 18px;"></div>
              <div class="vmatch-wave-bar" style="height: 10px;"></div>
              <div class="vmatch-wave-bar" style="height: 22px;"></div>
              <div class="vmatch-wave-bar" style="height: 14px;"></div>
            </div>
          </div>

          <!-- Partner Masked Avatar -->
          <div class="vmatch-user-card">
            <div class="vmatch-avatar-circle" id="vmatch-partner-avatar-circle">
              <img src="${data.partner?.maskedAvatar || '/avatars/masked-avatar.png'}" id="vmatch-partner-avatar-img" onerror="this.src='/avatars/avatar-2.png'" />
              <div class="vmatch-mask-icon-tag" id="vmatch-partner-mask-tag">🎭</div>
            </div>
            <div class="vmatch-name-tag" id="vmatch-partner-name-label">${data.partner?.maskedName || 'روح متوافقة 🔮'}</div>
            <div class="vmatch-planet-tag" id="vmatch-partner-planet-label">${data.partner?.soul_planet || 'كوكب الحالم 🪐'}</div>
          </div>
        </div>

        <!-- Mutual Reveal Action Box -->
        <div class="vmatch-reveal-box" id="vmatch-reveal-box">
          <button class="btn-reveal-identity" id="btn-reveal-voice-match-identity">
            <span>🎭 كشف هويتي للشريك (Reveal Identity)</span>
          </button>
          <p class="vmatch-reveal-hint" id="vmatch-reveal-hint">
            💡 المكالمة المجهولة مدتها 5 دقائق! اضغط على زر كشف الهوية، وعند موافقة الطرفين تُكشف الحسابات وتتحول المكالمة إلى <strong>مفتوحة بلا حدود (Unlimited) للأبد!</strong> 🎉
          </p>
        </div>

        <!-- Icebreaker banner container -->
        <div id="vmatch-icebreaker-card" style="display: none; background: rgba(0,0,0,0.55); border: 1px dashed rgba(251,191,36,0.6); border-radius: 14px; padding: 10px 16px; max-width: 380px; font-size: 12px; color: #fde047; margin-top: 12px; line-height: 1.5; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
        </div>
      </div>

      <!-- Bottom Voice Call Controls -->
      <div class="vmatch-bottom-controls">
        <button class="vmatch-tool-btn active" id="vmatch-mic-btn" title="تفعيل/كتم المايك">🎙️</button>
        <button class="vmatch-tool-btn" id="vmatch-speaker-btn" title="مكبر الصوت">🔊</button>
        <button class="vmatch-tool-btn" id="vmatch-icebreaker-btn" title="سؤال لكسر الجليد">💡</button>
        <button class="vmatch-tool-btn" id="vmatch-reaction-btn" title="إرسال تفاعل سريع">❤️</button>
        <button class="vmatch-tool-btn" id="vmatch-next-match-btn" title="الشريك التالي">⏭️</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Start 5-Minute Timer
    voiceMatchTimerInterval = setInterval(() => {
      if (activeVoiceMatchSession && activeVoiceMatchSession.isUnlimited) return; // Freeze timer if mutual reveal

      voiceMatchSecondsLeft--;
      const mins = Math.floor(Math.max(0, voiceMatchSecondsLeft) / 60);
      const secs = Math.max(0, voiceMatchSecondsLeft) % 60;
      const timeStr = `⏳ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const timerEl = document.getElementById('vmatch-timer-display');
      if (timerEl) {
        timerEl.innerText = timeStr;
        if (voiceMatchSecondsLeft <= 30) {
          timerEl.style.borderColor = '#ef4444';
          timerEl.style.color = '#ef4444';
        }
      }

      if (voiceMatchSecondsLeft <= 0) {
        clearInterval(voiceMatchTimerInterval);
        closeVoiceMatchScreen(true);
        showToast('انتهت الـ 5 دقائق للمكالمة المجهولة دون كشف متبادل! يمكنك بدء توافق صوتي جديد أو كشف الهوية في المرة القادمة 🪐');
      }
    }, 1000);

    // Setup Local Microphone & Speech Wave Visualization
    setupVoiceMatchAudioCapture();

    // Setup Simulated Partner Speech Animation
    startPartnerVoiceWaveSimulation();

    // Wire End Call Button
    modal.querySelector('#btn-end-voice-match').onclick = () => {
      const confirmEnd = confirm('هل أنت متأكد من إنهاء مكالمة التوافق الصوتي الحالية؟');
      if (confirmEnd) {
        state.socket.emit('end_voice_match', { sessionId: data.sessionId });
        closeVoiceMatchScreen(true);
      }
    };

    // Wire Mutual Identity Reveal Button
    const revealBtn = modal.querySelector('#btn-reveal-voice-match-identity');
    revealBtn.onclick = () => {
      if (revealBtn.classList.contains('revealed')) return;

      revealBtn.classList.add('revealed');
      revealBtn.innerHTML = `<span>⏳ قمت بكشف هويتك! بانتظار موافقة الطرف الآخر...</span>`;

      state.socket.emit('reveal_voice_match_identity', {
        sessionId: data.sessionId,
        userId: state.currentUser.id
      });
      showToast('🌟 قمت بكشف هويتك! بمجرد موافقة الشريك ستتحول المكالمة إلى بلا حدود!');
    };

    // Wire Mic Toggle
    const micBtn = modal.querySelector('#vmatch-mic-btn');
    micBtn.onclick = () => {
      isVoiceMatchMuted = !isVoiceMatchMuted;
      micBtn.classList.toggle('active', !isVoiceMatchMuted);
      micBtn.classList.toggle('muted', isVoiceMatchMuted);
      micBtn.innerText = isVoiceMatchMuted ? '🔇' : '🎙️';
      if (voiceMatchMicStream) {
        voiceMatchMicStream.getAudioTracks().forEach(track => {
          track.enabled = !isVoiceMatchMuted;
        });
      }
      showToast(isVoiceMatchMuted ? 'تم كتم الميكروفون' : 'تم تفعيل الميكروفون 🎙️');
    };

    // Wire Speaker Toggle
    const spkBtn = modal.querySelector('#vmatch-speaker-btn');
    spkBtn.onclick = () => {
      isVoiceMatchSpeakerOn = !isVoiceMatchSpeakerOn;
      spkBtn.classList.toggle('active', isVoiceMatchSpeakerOn);
      showToast(isVoiceMatchSpeakerOn ? 'مكبر الصوت مفعّل 🔊' : 'سماعة الهاتف 📱');
    };

    // Wire Icebreaker Questions Button
    const iceBtn = modal.querySelector('#vmatch-icebreaker-btn');
    const iceCard = modal.querySelector('#vmatch-icebreaker-card');
    const icebreakers = [
      '💡 سؤال لكسر الجليد: لو فزت بمليون دولار غداً، ما أول شيء ستشتريه؟ 💰',
      '💡 سؤال لكسر الجليد: ما هي الأغنية التي لا تمل من تكرارها مؤخراً؟ 🎶',
      '💡 سؤال لكسر الجليد: لو كنت تستطيع السفر عبر الزمن، إلى أي عصر ستذهب؟ 🚀',
      '💡 سؤال لكسر الجليد: ما هو أكثر موقف مضحك أو غريب حدث معك هذا العام؟ 😂',
      '💡 سؤال لكسر الجليد: ما هو مشروبك المفضل في أوقات الرواق والهدوء؟ ☕'
    ];
    let iceIndex = 0;
    iceBtn.onclick = () => {
      iceCard.style.display = 'block';
      iceCard.innerText = icebreakers[iceIndex % icebreakers.length];
      iceIndex++;
      triggerVoiceMatchReactionBurst('💡');
    };

    // Wire Reactions
    const reactBtn = modal.querySelector('#vmatch-reaction-btn');
    const emojis = ['❤️', '👏', '😂', '🔥', '🌹'];
    let emojiIdx = 0;
    reactBtn.onclick = () => {
      const em = emojis[emojiIdx % emojis.length];
      emojiIdx++;
      triggerVoiceMatchReactionBurst(em);
      state.socket.emit('voice_match_reaction', {
        sessionId: data.sessionId,
        emoji: em
      });
    };

    // Wire Next Match
    const nextBtn = modal.querySelector('#vmatch-next-match-btn');
    nextBtn.onclick = () => {
      state.socket.emit('end_voice_match', { sessionId: data.sessionId });
      closeVoiceMatchScreen(false);
      startVoiceMatchSession('voice');
    };
  }

  // Handle Mutual Reveal: Transitions call into UNLIMITED & Reveals full profile
  function handleVoiceMatchMutualReveal(payload) {
    if (!activeVoiceMatchSession) return;
    activeVoiceMatchSession.isUnlimited = true;

    // Stop countdown timer
    if (voiceMatchTimerInterval) {
      clearInterval(voiceMatchTimerInterval);
    }

    // Update timer badge to Unlimited
    const timerEl = document.getElementById('vmatch-timer-display');
    if (timerEl) {
      timerEl.innerText = '♾️ مكالمة بلا حدود (صداقة مؤكدة 🎉)';
      timerEl.className = 'vmatch-timer-badge unlimited';
    }

    // Play celebration sound
    if (window.soundManager && typeof window.soundManager.playLevelUp === 'function') {
      window.soundManager.playLevelUp();
    } else if (window.soundManager && typeof window.soundManager.playCheer === 'function') {
      window.soundManager.playCheer();
    }

    // Reveal Partner Profile
    if (payload.realPartner) {
      const partnerImg = document.getElementById('vmatch-partner-avatar-img');
      if (partnerImg) {
        partnerImg.src = payload.realPartner.avatar || '/avatars/avatar-2.png';
        if (payload.realPartner.avatar_frame) {
          partnerImg.className = `avatar-frame-${payload.realPartner.avatar_frame}`;
        }
      }

      const partnerName = document.getElementById('vmatch-partner-name-label');
      if (partnerName) {
        partnerName.innerText = payload.realPartner.name;
      }

      const partnerMask = document.getElementById('vmatch-partner-mask-tag');
      if (partnerMask) {
        partnerMask.innerText = '👑';
      }

      const partnerPlanet = document.getElementById('vmatch-partner-planet-label');
      if (partnerPlanet) {
        partnerPlanet.innerText = payload.realPartner.soul_planet || 'كوكب الروح 🌌';
      }
    }

    // Reveal Self Profile
    if (payload.realSelf || state.currentUser) {
      const self = payload.realSelf || state.currentUser;
      const selfImg = document.getElementById('vmatch-self-avatar-img');
      if (selfImg) {
        selfImg.src = self.avatar;
        if (self.avatar_frame) {
          selfImg.className = `avatar-frame-${self.avatar_frame}`;
        }
      }

      const selfName = document.getElementById('vmatch-self-name-label');
      if (selfName) {
        selfName.innerText = self.name;
      }

      const selfMask = document.getElementById('vmatch-self-mask-tag');
      if (selfMask) {
        selfMask.innerText = '🌟';
      }
    }

    // Replace Reveal Box with Celebration Banner and Action Buttons
    const revealBox = document.getElementById('vmatch-reveal-box');
    if (revealBox) {
      revealBox.innerHTML = `
        <div class="vmatch-success-banner">
          🎉 مبروك! كشف كلاكما الهوية بنجاح! أصبحت المكالمة الآن <strong>مستمرة بلا حدود زمنية ومفتوحة للأبد</strong>، مرحباً بالصداقة الجديدة! ✨
        </div>
        <div style="display: flex; gap: 8px; justify-content: center; margin-top: 12px;">
          <button class="wallet-btn primary" id="btn-vmatch-friend-add" style="padding: 10px 18px; font-size: 13px;">
            ➕ متابعة وصداقة
          </button>
          <button class="wallet-btn" id="btn-vmatch-send-gift-live" style="background: linear-gradient(135deg, #ec4899, #8b5cf6); color: #fff; padding: 10px 18px; font-size: 13px;">
            🎁 إرسال هدية للمتحدث
          </button>
        </div>
      `;

      revealBox.querySelector('#btn-vmatch-friend-add').onclick = () => {
        showToast(`🎉 تم إرسال طلب الصداقة بنجاح إلى ${payload.realPartner.name}!`);
      };

      revealBox.querySelector('#btn-vmatch-send-gift-live').onclick = () => {
        openGiftStoreModal(payload.realPartner.id, null, payload.realPartner);
      };
    }

    // Trigger celebration emojis
    for (let i = 0; i < 6; i++) {
      setTimeout(() => triggerVoiceMatchReactionBurst('🎉'), i * 200);
      setTimeout(() => triggerVoiceMatchReactionBurst('💖'), i * 300);
    }
  }

  // Setup Web Audio Capture for Local Voice Waves
  async function setupVoiceMatchAudioCapture() {
    try {
      voiceMatchMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        voiceMatchAudioContext = new AudioCtx();
        const source = voiceMatchAudioContext.createMediaStreamSource(voiceMatchMicStream);
        voiceMatchAnalyser = voiceMatchAudioContext.createAnalyser();
        voiceMatchAnalyser.fftSize = 64;
        source.connect(voiceMatchAnalyser);

        const dataArray = new Uint8Array(voiceMatchAnalyser.frequencyBinCount);

        const updateWaveAnimation = () => {
          if (!activeVoiceMatchSession || !document.getElementById('voice-match-active-modal')) return;
          voiceMatchAnalyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;

          const waveBars = document.querySelectorAll('#vmatch-audio-waves .vmatch-wave-bar');
          waveBars.forEach((bar, idx) => {
            const h = Math.max(4, Math.min(26, (dataArray[idx * 2] || 10) / 8));
            bar.style.height = `${h}px`;
          });

          const selfCircle = document.getElementById('vmatch-self-avatar-circle');
          if (selfCircle) {
            const isSpeaking = avg > 25 && !isVoiceMatchMuted;
            selfCircle.classList.toggle('speaking', isSpeaking);
          }

          requestAnimationFrame(updateWaveAnimation);
        };
        updateWaveAnimation();
      }
    } catch (err) {
      console.log('Voice match audio capture initialized in simulation mode:', err.message);
    }
  }

  // Partner Voice Simulation for natural call dynamics
  function startPartnerVoiceWaveSimulation() {
    let partnerSpeaking = false;
    voiceMatchSimInterval = setInterval(() => {
      if (!activeVoiceMatchSession || !document.getElementById('voice-match-active-modal')) return;
      partnerSpeaking = Math.random() > 0.45;
      const partnerCircle = document.getElementById('vmatch-partner-avatar-circle');
      if (partnerCircle) {
        partnerCircle.classList.toggle('speaking', partnerSpeaking);
      }
    }, 2500);
  }

  // Reaction Emoji Float-Up Burst Animation
  function triggerVoiceMatchReactionBurst(emoji) {
    const modal = document.getElementById('voice-match-active-modal') || document.body;
    const emEl = document.createElement('div');
    emEl.className = 'vmatch-floating-emoji';
    emEl.innerText = emoji;
    emEl.style.left = `${35 + Math.random() * 30}%`;
    modal.appendChild(emEl);

    setTimeout(() => emEl.remove(), 2100);
  }

  // Close Voice Match Call Screen and clean up
  function closeVoiceMatchScreen(notify = false) {
    if (voiceMatchTimerInterval) {
      clearInterval(voiceMatchTimerInterval);
      voiceMatchTimerInterval = null;
    }
    if (voiceMatchSimInterval) {
      clearInterval(voiceMatchSimInterval);
      voiceMatchSimInterval = null;
    }
    if (voiceMatchMicStream) {
      voiceMatchMicStream.getTracks().forEach(t => t.stop());
      voiceMatchMicStream = null;
    }
    if (voiceMatchAudioContext) {
      voiceMatchAudioContext.close().catch(() => {});
      voiceMatchAudioContext = null;
    }

    const modal = document.getElementById('voice-match-active-modal');
    if (modal) modal.remove();

    activeVoiceMatchSession = null;
    if (notify) {
      showToast('تمت مغادرة مكالمة التوافق الصوتي 🪐');
    }
  }

  // Planet Tab Events Modal (Matching Events Card)
  function showPlanetEventsModal() {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'planet-events-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 400px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-events-btn">✕</button>
        <div style="font-size: 36px; margin-bottom: 8px;">🎈🎪</div>
        <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 4px;">فعاليات ومهرجانات كوكب SoulChill</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">شارك في بطولات الغرف والصوت واكسب جوائز ضخمة!</div>

        <div style="display: flex; flex-direction: column; gap: 10px; text-align: right; margin-bottom: 16px;">
          <div style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 14px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: #fbbf24;">🎙️ مسابقة بلبل السول (Soul Voice)</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">جوائز تصل إلى 100,000 كوينز + إطار ذهبي</div>
            </div>
            <button class="wallet-btn primary" style="padding: 6px 12px; font-size: 11px;">انضمام</button>
          </div>

          <div style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 14px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: #ec4899;">💖 كرنفال التوافق والهدايا (Soul Match Fiesta)</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">تضاعف نقاط التوافق 2X عند كشف الهوية</div>
            </div>
            <button class="wallet-btn primary" style="padding: 6px 12px; font-size: 11px;">مشاركة</button>
          </div>
        </div>

        <button class="wallet-btn secondary" id="close-events-btn-bottom" style="width: 100%;">إغلاق</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-events-btn').onclick = () => modal.remove();
    modal.querySelector('#close-events-btn-bottom').onclick = () => modal.remove();
  }

  // First Recharge Rewards Modal (مكافآت الشحنة الاولى)
  function showOneTimeOfferModal() {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'one-time-offer-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 360px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-offer-btn">✕</button>
        <div style="font-size: 44px; margin-bottom: 8px;">🎁✨</div>
        <div style="font-size: 18px; font-weight: 900; color: #fff; margin-bottom: 4px;">مكافآت الشحنة الاولى</div>
        <div style="font-size: 12px; color: #fde047; font-weight: 700; margin-bottom: 16px;">خصم 70% + 5,000 كوينز إضافية وإطار ملكي فاخر مجاناً!</div>

        <div style="background: rgba(0,0,0,0.4); border: 1.5px dashed #fbbf24; border-radius: 16px; padding: 14px; margin-bottom: 16px;">
          <div style="font-size: 24px; font-weight: 900; color: #fff;">10,000 🪙 + إطار VIP</div>
          <div style="font-size: 13px; color: #10b981; font-weight: 800; margin-top: 4px;">استلم هدايا الشحنة الأولى فوراً</div>
        </div>

        <button class="wallet-btn primary" id="claim-offer-btn" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 800;">
          ⚡ استلام وشحن العرض الآن
        </button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-offer-btn').onclick = () => modal.remove();
    modal.querySelector('#claim-offer-btn').onclick = () => {
      modal.remove();
      openWalletModal();
    };
  }

  // Soul Test Quiz Modal
  function showSoulTestModal() {
    const questions = [
      {
        q: 'كيف تحب قضاء أمسيتك المثالية؟',
        options: [
          { text: 'سماع موسيقى هادئة وتأمل النجوم 🌌', type: 'dreamer' },
          { text: 'طلعة ومغامرة وسوالف مع الأصدقاء 🚀', type: 'adventurer' },
          { text: 'جلسة رواق مع كتاب وفنجان قهوة 🔮', type: 'philosopher' },
          { text: 'تحديات ألعاب وبثوث حماسية ⚡', type: 'gamer' }
        ]
      },
      {
        q: 'ما هو العنصر الفلكي الأكثر تعبيراً عن شخصيتك؟',
        options: [
          { text: 'الماء: عميق ورومانسي وشفاف 💧', type: 'dreamer' },
          { text: 'النار: شغوف ومليء بالحماس والطاقة 🔥', type: 'adventurer' },
          { text: 'الهواء: حر ومفكر ومحب للحرية 🌬️', type: 'philosopher' },
          { text: 'الأرض: متزن وفنان ومبدع 🎨', type: 'artist' }
        ]
      },
      {
        q: 'ما الذي يجذبك أولاً في الأشخاص الآخرين؟',
        options: [
          { text: 'دفء الروح ونبرة الصوت الهادئة 🎶', type: 'dreamer' },
          { text: 'حس الفكاهة والضحك العفوي 😂', type: 'adventurer' },
          { text: 'الذكاء والحديث العميق الفلسفي 🧠', type: 'philosopher' },
          { text: 'الإيجابية والحماس المشترك ⚡', type: 'gamer' }
        ]
      }
    ];

    let currentQ = 0;
    const answers = [];

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'soul-test-modal';

    function renderQuestion() {
      const q = questions[currentQ];
      modal.innerHTML = `
        <div class="soul-modal-content">
          <button class="soul-modal-close-btn" id="close-test-btn">✕</button>
          <div class="modal-header-title">اختبار توافق الروح 🪐 (سؤال ${currentQ + 1} من ${questions.length})</div>

          <div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 16px; text-align: center;">
            ${q.q}
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${q.options.map((opt, i) => `
              <button class="google-account-option soul-quiz-opt" data-idx="${i}" style="border-radius: var(--radius-full); padding: 10px 14px; font-size: 13px;">
                ${opt.text}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      modal.querySelector('#close-test-btn').onclick = () => modal.remove();

      modal.querySelectorAll('.soul-quiz-opt').forEach(btn => {
        btn.onclick = async () => {
          if (window.soundManager) window.soundManager.playClick();
          const chosenOpt = q.options[parseInt(btn.dataset.idx)];
          answers.push(chosenOpt);

          currentQ++;
          if (currentQ < questions.length) {
            renderQuestion();
          } else {
            // Finished!
            modal.innerHTML = `
              <div class="soul-modal-content" style="text-align: center;">
                <div style="font-size: 40px; margin-bottom: 10px;">🔮</div>
                <div class="modal-header-title">جارِ تحليل ذبذبات روحك الفلكية...</div>
                <div style="font-size: 12px; color: var(--text-secondary);">نحسب توافق كوكبك في مجرة SoulChill</div>
              </div>
            `;

            try {
              const res = await fetch('/api/users/soul-test', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': state.currentUser.id
                },
                body: JSON.stringify({ answers })
              });
              const data = await res.json();
              if (data.success) {
                state.currentUser = data.user;
                localStorage.setItem('soulchill_user', JSON.stringify(data.user));
                if (window.soundManager) window.soundManager.playCheer();

                modal.innerHTML = `
                  <div class="soul-modal-content" style="text-align: center;">
                    <div style="font-size: 50px; margin-bottom: 10px;">🪐</div>
                    <div class="modal-header-title">تهانينا! اكتمل اختبار الروح ✨</div>
                    <div class="profile-planet-pill" style="font-size: 14px; margin: 10px auto;">${data.planet}</div>
                    <div style="font-size: 13px; color: #fbbf24; font-weight: 700; margin-bottom: 14px;">
                      مستوى توافق الروح: ${data.score}% 🔥
                    </div>
                    <button class="soul-submit-btn" id="finish-test-btn" style="width: 100%;">
                      دخول المجرة الآن 🚀
                    </button>
                  </div>
                `;
                modal.querySelector('#finish-test-btn').onclick = () => {
                  modal.remove();
                  switchTab('planet');
                };
              }
            } catch (err) {
              console.error('Soul test error:', err);
              modal.remove();
            }
          }
        };
      });
    }

    renderQuestion();
    document.body.appendChild(modal);
  }

  // ============================================
  // TAB 2: VOICE PARTY ROOMS & COUNTRY CLASSIFICATION
  // ============================================
  async function renderRoomsTab(container) {
    if (!state.myGeo) {
      await fetchGeoLocation();
    }

    const myCountryCode = state.myGeo?.country_code || 'JO';
    const myCountryName = state.myGeo?.country_name || 'الأردن';
    const myCountryFlag = state.myGeo?.country_flag || '🇯🇴';
    const countries = state.countriesList || [];

    // SoulChill Regional Country Bar HTML
    const countryBarHtml = `
      <div class="rooms-country-bar" id="rooms-country-bar">
        <button class="country-pill ${state.selectedCountry === 'all' ? 'active' : ''}" data-country="all">
          <span>🌍</span>
          <span>الكل / عالمي</span>
        </button>
        <button class="country-pill my-country-pill ${state.selectedCountry === myCountryCode ? 'active' : ''}" data-country="${myCountryCode}">
          <span>📍</span>
          <span>دولتي (${myCountryFlag} ${myCountryName})</span>
          <span class="country-count-tag">موصى به</span>
        </button>
        ${countries.filter(c => c.code !== 'GLOBAL' && c.code !== myCountryCode).map(c => `
          <button class="country-pill ${state.selectedCountry === c.code ? 'active' : ''}" data-country="${c.code}">
            <span>${c.flag}</span>
            <span>${c.name}</span>
            ${c.room_count > 0 ? `<span class="country-count-tag">${c.room_count}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;

    container.innerHTML = `
      <div class="rooms-view-container">
        <!-- SoulChill Regional Country Filter Bar (تصنيف حسب دولة المنشئ عبر IP) -->
        ${countryBarHtml}

        <!-- Active Country Strip & IP info -->
        <div class="country-filter-info-strip" id="country-filter-info-strip">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #fbbf24;">📍</span>
            <span>تصنيف الغرف الحالي: <strong id="active-country-label-text" style="color: #fff;">${getActiveCountryLabel()}</strong></span>
          </div>
          <div style="font-size: 10px; color: #a78bfa;">
            🌐 IP: ${state.myGeo?.ip || '127.0.0.1'} (${myCountryFlag} ${myCountryName})
          </div>
        </div>

        <!-- Room Categories Bar (Voice Rooms Only) -->
        <div class="rooms-category-bar">
          <button class="cat-pill ${state.selectedCategory === 'all' ? 'active' : ''}" data-cat="all">🌟 الكل</button>
          <button class="cat-pill ${state.selectedCategory === 'favorites' ? 'active' : ''}" data-cat="favorites">❤️ المفضلة</button>
          <button class="cat-pill ${state.selectedCategory === 'music' ? 'active' : ''}" data-cat="music">🎶 طرب وموسيقى</button>
          <button class="cat-pill ${state.selectedCategory === 'chat' ? 'active' : ''}" data-cat="chat">💬 سوالف وجمعة</button>
          <button class="cat-pill ${state.selectedCategory === 'chill' ? 'active' : ''}" data-cat="chill">☕ هدوء ورواق</button>
          <button class="cat-pill ${state.selectedCategory === 'gaming' ? 'active' : ''}" data-cat="gaming">🎮 مسابقات وألعاب</button>
          <button class="cat-pill ${state.selectedCategory === 'dating' ? 'active' : ''}" data-cat="dating">🔮 كواكب وأبراج</button>
        </div>

        <!-- Create Voice Room Banner -->
        <div class="create-room-banner" id="create-room-banner-btn">
          <div class="create-room-btn-text">
            <span class="create-room-btn-icon">+</span>
            <span>إنشاء غرفة صوتية جديدة (SoulChill Voice Party) 🎙️✨</span>
          </div>
          <span style="font-size: 18px; color: #fbbf24;">✨ ابدأ الآن</span>
        </div>

        <!-- Rooms Grid -->
        <div class="rooms-grid" id="rooms-grid-list">
          <div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">
            جارِ تحميل الغرف الصوتية...
          </div>
        </div>
      </div>
    `;

    // Load rooms
    await loadRoomsList();

    // Create room button
    container.querySelector('#create-room-banner-btn').onclick = () => showCreateRoomModal();

    // Country Pill Clicks
    container.querySelectorAll('.country-pill').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.country-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedCountry = btn.dataset.country;
        const labelEl = container.querySelector('#active-country-label-text');
        if (labelEl) labelEl.innerText = getActiveCountryLabel();
        applyRoomsFilters();
      };
    });

    // Categories Pill Clicks
    container.querySelectorAll('.cat-pill').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedCategory = btn.dataset.cat;
        applyRoomsFilters();
      };
    });
  }

  function getActiveCountryLabel() {
    if (!state.selectedCountry || state.selectedCountry === 'all') {
      return 'جميع الدول (عالمي 🌍)';
    }
    const found = (state.countriesList || []).find(c => c.code === state.selectedCountry);
    if (found) return `${found.flag} ${found.name}`;
    if (state.myGeo && state.selectedCountry === state.myGeo.country_code) {
      return `${state.myGeo.country_flag} ${state.myGeo.country_name} (دولتي)`;
    }
    return state.selectedCountry;
  }

  function applyRoomsFilters() {
    let filtered = state.rooms;

    // 1. Country filter
    if (state.selectedCountry && state.selectedCountry !== 'all') {
      filtered = filtered.filter(r => r.country_code === state.selectedCountry || r.country_code === 'GLOBAL');
    }

    // 2. Category / Favorites filter
    if (state.selectedCategory === 'favorites') {
      filtered = filtered.filter(r => isRoomFavorited(r.id));
    } else if (state.selectedCategory && state.selectedCategory !== 'all') {
      filtered = filtered.filter(r => r.category === state.selectedCategory);
    }

    renderRoomsGrid(filtered);
  }

  async function loadRoomsList() {
    try {
      await loadFavoriteRooms();
      const res = await fetch('/api/rooms');
      state.rooms = await res.json();
      applyRoomsFilters();
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  }

  function renderRoomsGrid(rooms) {
    const grid = document.getElementById('rooms-grid-list');
    if (!grid) return;

    if (rooms.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--text-muted);">
          ${state.selectedCategory === 'favorites' 
            ? 'لا توجد غرف مضافة إلى المفضلة حالياً.. اضغط على ❤️ بجانب اسم أي غرفة لإضافتها للمفضلة!' 
            : 'لا توجد غرف صوتية نشطة في هذا القسم حالياً.. كن أول من ينشئ غرفة صوتية! 🎙️🌟'}
        </div>
      `;
      return;
    }

    grid.innerHTML = rooms.map(room => {
      const countryBadgeHtml = `<span class="room-country-badge">${room.country_flag || '🇯🇴'} ${room.country_name || 'الأردن'}</span>`;
      const isFav = isRoomFavorited(room.id);

      // Voice Party Room Card (All rooms are voice rooms)
      const speakersHtml = (room.seats || [])
        .filter(s => s.user_id && s.avatar)
        .slice(0, 4)
        .map(s => `<img src="${s.avatar}" class="speaker-mini-avatar" />`)
        .join('');

      return `
        <div class="room-card" data-room-id="${room.id}" data-room-type="voice">
          <span class="room-type-badge voice">🎙️ حفلة صوتية</span>
          ${countryBadgeHtml}
          <div class="room-card-header" style="margin-top: 24px;">
            <img src="${room.host_avatar}" class="room-host-avatar ${room.host_frame ? 'avatar-frame-' + room.host_frame : ''}" />
            <div class="room-card-info">
              <div class="room-card-title-row">
                <div class="room-card-title" title="${room.title}">${room.title}</div>
                <button type="button" class="room-card-fav-btn ${isFav ? 'favorited' : ''}" data-room-id="${room.id}" title="${isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">
                  <span class="fav-heart-icon">${isFav ? '❤️' : '🤍'}</span>
                </button>
              </div>
              <div class="room-host-name">المضيف: ${room.host_name}</div>
            </div>
          </div>
          <div class="room-card-tag">#${getCategoryLabel(room.category)}</div>
          <div class="room-card-speakers-preview">
            <div style="display: flex;">${speakersHtml}</div>
            <div class="room-card-audience">
              <span>👥</span> <span class="room-card-audience-count" data-room-id="${room.id}">${room.audience_count !== undefined ? room.audience_count : 0}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.room-card-fav-btn').forEach(favBtn => {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavoriteRoom(favBtn.dataset.roomId, favBtn);
      };
    });

    grid.querySelectorAll('.room-card').forEach(card => {
      card.onclick = () => {
        const roomId = card.dataset.roomId;
        openVoiceRoom(roomId);
      };
    });
  }

  function getCategoryLabel(cat) {
    const map = {
      music: 'طرب_وموسيقى',
      chat: 'سوالف_وجمعة',
      chill: 'هدوء_ورواق',
      dating: 'توافق_وأبراج',
      gaming: 'ألعاب_وتحديات'
    };
    return map[cat] || 'روم_عام';
  }

  // Delete Room by ID Helper (Host & Owner)
  async function deleteRoomById(roomId) {
    if (!state.currentUser) return false;
    const confirmDel = confirm('هل أنت متأكد من حذف هذه الغرفة نهائياً؟ سيتم طرد جميع الحضور وإزالتها من القائمة.');
    if (!confirmDel) return false;

    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': state.currentUser.id
        }
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حذف الغرفة نهائياً وإزالتها من القائمة 🗑️');
        state.rooms = state.rooms.filter(r => r.id !== roomId);
        applyRoomsFilters();
        return true;
      } else {
        showToast(data.error || 'فشل حذف الغرفة');
        return false;
      }
    } catch (err) {
      console.error('Error deleting room:', err);
      showToast('حدث خطأ أثناء محاولة حذف الغرفة');
      return false;
    }
  }

  // Notice modal when member tries to create more than one room
  function showExistingRoomNoticeModal(existingRoom) {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'existing-room-notice-modal';

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 380px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-exist-notice-btn">✕</button>
        <div style="font-size: 42px; margin-bottom: 10px;">⚠️🚪</div>
        <div style="font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 6px;">
          لديك غرفة نشطة بالفعل!
        </div>
        <div style="font-size: 13px; color: #fbbf24; font-weight: 700; margin-bottom: 12px;">
          "${existingRoom.title}"
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 20px;">
          وفقاً لقوانين تطبيق <strong>SoulChill</strong>، يحق لكل عضو إنشاء غرفة أو بث مباشر واحد فقط في نفس الوقت.
          لإنشاء غرفة جديدة، يجب عليك أولاً <strong>حذف أو إغلاق غرفتك الحالية</strong>.
        </p>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="wallet-btn primary" id="btn-goto-existing-room" style="padding: 11px; font-size: 13px;">
            🚪 الدخول إلى غرفتي الحالية
          </button>
          <button class="wallet-btn danger" id="btn-delete-and-recreate" style="background: rgba(239,68,68,0.25); border: 1px solid #ef4444; color: #fca5a5; padding: 11px; font-size: 13px;">
            🗑️ حذف الغرفة الحالية وإنشاء غرفة جديدة
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-exist-notice-btn').onclick = () => modal.remove();

    modal.querySelector('#btn-goto-existing-room').onclick = () => {
      modal.remove();
      openVoiceRoom(existingRoom.id);
    };

    modal.querySelector('#btn-delete-and-recreate').onclick = async () => {
      const ok = await deleteRoomById(existingRoom.id);
      if (ok) {
        modal.remove();
        showCreateRoomModal();
      }
    };
  }

  // Create Voice Room Modal (Voice Only)
  function showCreateRoomModal() {
    if (!requireAuth()) return;

    // Single Active Room Rule: A member cannot create more than one active room at the same time
    const existing = state.rooms.find(r => r.host_id === state.currentUser?.id);
    if (existing && state.currentUser?.role !== 'owner') {
      showExistingRoomNoticeModal(existing);
      return;
    }

    const selectedRoomType = 'voice';
    const presetCovers = [
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80'
    ];
    let selectedCover = presetCovers[0];

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'create-room-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-create-room-btn">✕</button>
        <div class="modal-header-title">🎙️ إنشاء غرفة صوتية جديدة (SoulChill Voice Room)</div>

        <div class="custom-google-login-form" style="margin-top: 6px; padding-top: 0; border: none;">
          <div class="form-group-soul">
            <label>عنوان الغرفة الصوتية</label>
            <input type="text" id="new-room-title" class="form-input-soul" placeholder="مثال: سهرة طرب ووناسة وسوالف ليلية 🎙️✨" />
          </div>

          <div class="form-group-soul">
            <label>تصنيف الروم الصوتي</label>
            <select id="new-room-category" class="form-input-soul" style="background: rgba(255,255,255,0.08); color: #fff;">
              <option value="chill">☕ هدوء ورواق ودردشة</option>
              <option value="music">🎶 طرب وغناء وعزف</option>
              <option value="chat">💬 سوالف وجمعة وضحك</option>
              <option value="gaming">🎮 ألعاب ومسابقات صوتية</option>
              <option value="dating">🔮 تحليل شخصيات وتوافق كواكب</option>
            </select>
          </div>

          <!-- IP Detected Country Classification -->
          <div class="form-group-soul">
            <label>دولة الغرفة (تم التحديد تلقائياً عبر عنوان الـ IP الخاص بك)</label>
            <div class="ip-detected-pill" style="margin-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>🌐 عنوان الـ IP المكتشف: <strong style="color: #fbbf24;">${state.myGeo?.ip || '127.0.0.1'}</strong></span>
                <span style="background: rgba(16,185,129,0.2); color: #10b981; padding: 2px 6px; border-radius: 4px; font-size: 10px;">✓ IP نشط</span>
              </div>
              <div style="margin-top: 4px;">📍 الدولة المحددة: <strong style="color: #fff;">${state.myGeo?.country_flag || '🇯🇴'} ${state.myGeo?.country_name || 'الأردن'} (${state.myGeo?.city || 'إربد'})</strong></div>
            </div>
            <select id="new-room-country" class="form-input-soul" style="background: rgba(255,255,255,0.08); color: #fff;">
              ${(state.countriesList || []).map(c => `
                <option value="${c.code}" ${(state.myGeo && state.myGeo.country_code === c.code) || (!state.myGeo && c.code === 'JO') ? 'selected' : ''}>
                  ${c.flag} ${c.name} ${c.isGlobal ? '(لجميع الدول)' : ''}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-group-soul" id="cover-select-group">
            <label>صورة غلاف الغرفة الصوتية</label>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <input type="file" id="room-custom-cover-input" accept="image/*" style="display: none;" />
              <button type="button" class="wallet-btn secondary" id="btn-trigger-room-upload" style="padding: 7px 12px; font-size: 11px;">
                📁 رفع صورة من جهازك
              </button>
              <span id="room-cover-upload-feedback" style="font-size: 11px; color: #10b981; display: none;">✅ تم الرفع!</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">أو اختر من الأغلفة الجاهزة:</div>
            <div style="display: flex; gap: 6px; margin-top: 4px;">
              ${presetCovers.map((img, i) => `
                <img src="${img}" class="create-cover-thumb ${i === 0 ? 'selected' : ''}" data-url="${img}" style="width: 58px; height: 48px; border-radius: 8px; object-fit: cover; cursor: pointer; border: 2px solid ${i === 0 ? 'var(--primary)' : 'transparent'};" />
              `).join('')}
            </div>
          </div>

          <div class="form-group-soul">
            <label>رسالة الترحيب / الإعلان</label>
            <input type="text" id="new-room-announcement" class="form-input-soul" placeholder="أهلاً بكل من دخل الروم، شرفتونا! 🌟" />
          </div>

          <button class="soul-submit-btn" id="submit-create-room-btn" style="margin-top: 10px; padding: 12px; font-size: 14px;">
            إطلاق الغرفة الصوتية للجمهور الآن 🎙️🚀
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-create-room-btn').onclick = () => modal.remove();

    const submitBtn = modal.querySelector('#submit-create-room-btn');

    // Device File Upload Handler
    const triggerUploadBtn = modal.querySelector('#btn-trigger-room-upload');
    const fileInput = modal.querySelector('#room-custom-cover-input');
    const uploadFeedback = modal.querySelector('#room-cover-upload-feedback');

    triggerUploadBtn.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append('file', file);

      uploadFeedback.style.display = 'inline';
      uploadFeedback.style.color = '#fbbf24';
      uploadFeedback.innerText = 'جارِ رفع صورتك... ⏳';

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success && data.url) {
          selectedCover = data.url;
          uploadFeedback.style.color = '#10b981';
          uploadFeedback.innerText = '✅ تم رفع صورتك كغلاف!';
          modal.querySelectorAll('.create-cover-thumb').forEach(t => t.style.borderColor = 'transparent');
          showToast('تم رفع صورة غلاف الغرفة من جهازك بنجاح! 📸');
        } else {
          uploadFeedback.style.color = '#f43f5e';
          uploadFeedback.innerText = '❌ فشل الرفع';
        }
      } catch (err) {
        console.error('Upload error:', err);
        uploadFeedback.style.color = '#f43f5e';
        uploadFeedback.innerText = '❌ خطأ بالرفع';
      }
    };

    // Preset Cover picker
    modal.querySelectorAll('.create-cover-thumb').forEach(thumb => {
      thumb.onclick = () => {
        modal.querySelectorAll('.create-cover-thumb').forEach(t => t.style.borderColor = 'transparent');
        thumb.style.borderColor = 'var(--primary)';
        selectedCover = thumb.dataset.url;
        uploadFeedback.style.display = 'none';
      };
    });

    submitBtn.onclick = async () => {
      if (!requireAuth()) return;
      const title = modal.querySelector('#new-room-title').value.trim();
      const category = modal.querySelector('#new-room-category').value;
      const announcement = modal.querySelector('#new-room-announcement').value.trim();
      const country_code = modal.querySelector('#new-room-country')?.value || state.myGeo?.country_code || 'JO';

      if (!title) {
        showToast('يرجى كتابة عنوان للغرفة أو البث!');
        return;
      }

      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser?.id || ''
          },
          body: JSON.stringify({
            title,
            category,
            country_code,
            room_type: selectedRoomType,
            cover_image: selectedCover,
            announcement,
            creator_id: state.currentUser?.id || ''
          })
        });
        const data = await res.json();
        if (data.hasActiveRoom && data.existingRoom) {
          modal.remove();
          showExistingRoomNoticeModal(data.existingRoom);
          return;
        }

        const roomData = data.room || (data.id ? data : null);
        if (data.success && roomData) {
          modal.remove();
          showToast(`تم إنشاء ${selectedRoomType === 'video' ? 'البث المباشر' : 'الغرفة الصوتية'} بنجاح! 🚀✨`);

          if (selectedRoomType === 'video') {
            openLiveVideoStream(roomData);
          } else {
            openVoiceRoom(roomData.id);
          }
        } else {
          showToast(data.error || 'فشل إنشاء الغرفة، يرجى المحاولة ثانية');
        }
      } catch (err) {
        console.error('Error creating room:', err);
        showToast('حدث خطأ أثناء إنشاء الغرفة');
      }
    };
  }

  // ============================================
  // LIVE VIDEO BROADCAST / STREAMING (بث مباشر فيديو)
  // ============================================
  let activeVideoStream = null;
  let isVideoEnabled = true;
  let isAudioEnabled = true;
  let isBeautifyOn = false;

  async function openLiveVideoStream(room) {
    if (!room) {
      console.error('openLiveVideoStream: room parameter is null or undefined');
      showToast('تعذر فتح البث المباشر: بيانات الغرفة غير متوفرة');
      return;
    }

    // If room is just an ID string, fetch full details from API
    if (typeof room === 'string') {
      try {
        const res = await fetch(`/api/rooms/${room}`);
        const data = await res.json();
        room = data.room || data;
      } catch (e) {
        console.error('Failed to fetch room details', e);
      }
    }

    if (!room || !room.id) {
      showToast('تعذر فتح البث المباشر');
      return;
    }

    // Safely populate any missing host properties
    room.host_id = room.host_id || (state.currentUser ? state.currentUser.id : '');
    room.host_name = room.host_name || (state.currentUser ? state.currentUser.name : 'المضيف');
    room.host_avatar = room.host_avatar || (state.currentUser ? state.currentUser.avatar : '/avatars/avatar-1.png');
    room.host_frame = room.host_frame || (state.currentUser ? state.currentUser.avatar_frame : '');
    room.title = room.title || 'بث مباشر';

    state.activeRoom = room;
    const isHost = Boolean(state.currentUser && state.currentUser.id === room.host_id);

    // Join socket room
    state.socket.emit('join_room', { roomId: room.id, user: state.currentUser });

    let existing = document.getElementById('live-video-broadcast-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'live-stream-modal';
    modal.id = 'live-video-broadcast-modal';

    modal.innerHTML = `
      <div class="live-stream-container">
        <!-- Co-Host PK Battle Header Bar -->
        <div class="pk-battle-bar" id="stream-cohost-pk-bar" style="display: none; position: absolute; top: 68px; left: 16px; right: 16px; z-index: 30; border-radius: 12px; backdrop-filter: blur(8px); background: rgba(15, 10, 30, 0.88); border: 1.5px solid rgba(255, 255, 255, 0.15); padding: 8px 14px;">
          <div class="pk-header">
            <span class="pk-team-host">🔴 <span id="stream-cohost-host-name">${room.host_name || 'المضيف'}</span>: <span id="stream-cohost-host-score" style="font-size: 16px; font-weight: 900;">100</span></span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="pk-timer" id="stream-pk-timer" style="background: rgba(0,0,0,0.6); padding: 3px 10px; border-radius: 999px; border: 1px solid #fbbf24; color: #fbbf24; font-size: 13px; font-weight: 800;">⚔️ 02:00</span>
              ${isHost ? `<button class="pk-end-btn-fast" id="stream-bar-end-pk-btn" title="إنهاء الجولة فوراً">🛑 إنهاء الجولة</button>` : ''}
            </div>
            <span class="pk-team-challenger">🔵 <span id="stream-cohost-name-label">الشريك</span>: <span id="stream-cohost-guest-score" style="font-size: 16px; font-weight: 900;">100</span></span>
          </div>
          <div class="pk-progress-track" style="height: 12px; border-radius: 999px;">
            <div class="pk-progress-fill-host" id="stream-cohost-pk-fill" style="width: 50%;"></div>
          </div>
          <div class="pk-boost-btns" style="display: flex; justify-content: space-between; margin-top: 6px; align-items: center;">
            <button class="pk-boost-btn red" id="stream-pk-boost-host" style="cursor: pointer; padding: 4px 12px; font-size: 11px;">❤️ دعم المضيف (+50)</button>
            <span style="font-size: 10px; color: #fbbf24; font-weight: 700;">🎁 الهدايا تزيد نقاط الفوز مباشرة!</span>
            <button class="pk-boost-btn blue" id="stream-pk-boost-challenger" style="cursor: pointer; padding: 4px 12px; font-size: 11px;">💙 دعم المنافس (+50)</button>
          </div>
        </div>

        <!-- Video Viewport / Streamer Stage -->
        <div class="video-viewport-wrapper" id="stream-video-viewport">
          <video id="stream-host-video" autoplay playsinline ${isHost ? 'muted' : ''} style="display: none;"></video>

          <!-- 2-Person Video Split Screen Container -->
          <div class="video-split-container" id="stream-split-screen-box" style="display: none;">
            <div class="video-split-half left-streamer" id="stream-split-half-host" title="انقر لإرسال هدية للمضيف">
              <video id="stream-split-host-video" autoplay playsinline ${isHost ? 'muted' : ''}></video>
              <div class="cohost-name-tag">👑 المضيف: <span id="split-tag-host-name">${room.host_name || 'المضيف'}</span></div>
              <button class="split-direct-gift-chip host-gift" id="btn-split-gift-host" type="button">
                🎁 إرسال هدية للمضيف
              </button>
            </div>
            <div class="video-split-half right-streamer" id="stream-split-half-cohost" title="انقر لإرسال هدية للشريك">
              <video id="stream-split-guest-video" autoplay playsinline></video>
              <div class="cohost-name-tag" id="stream-split-guest-name">⚔️ الشريك المشترك</div>
              <button class="split-direct-gift-chip cohost-gift" id="btn-split-gift-cohost" type="button">
                🎁 إرسال هدية للشريك
              </button>
            </div>
          </div>
          
          <div class="video-fallback-streamer" id="stream-fallback-container">
            <div class="streamer-avatar-live-pulse">
              <img src="${room.host_avatar || (state.currentUser ? state.currentUser.avatar : '')}" class="${room.host_frame ? 'avatar-frame-' + room.host_frame : ''}" />
            </div>
            <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 4px;">${room.host_name || room.title}</div>
            <div style="font-size: 11px; color: #c084fc;">📡 استوديو البث المباشر • SoulChill Live</div>
          </div>

          <!-- Flying Bullet Chat Layer (Danmaku) -->
          <div class="bullet-chat-container" id="stream-bullet-layer"></div>

          <!-- Floating Hearts Layer -->
          <div class="stream-hearts-container" id="stream-hearts-layer"></div>

          <!-- Floating Quick Flip / Mirror Button -->
          <button class="stream-flip-toggle-badge" id="stream-quick-flip-btn" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">
            <span>🔄</span> <span>قلب الكاميرا</span>
          </button>
        </div>

        <!-- Top Stream HUD -->
        <div class="stream-top-hud">
          <div class="streamer-profile-badge">
            <img src="${room.host_avatar || state.currentUser.avatar}" class="streamer-badge-avatar" />
            <div class="streamer-badge-info">
              <span class="streamer-badge-name">${room.host_name || room.title}</span>
              <span class="streamer-badge-likes">❤️ <span id="stream-likes-count">${room.likes_count || 120}</span> إعجاب</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="stream-live-pill">
              <span>●</span> LIVE مباشر
            </div>
            <div style="background: rgba(0,0,0,0.5); padding: 3px 8px; border-radius: 9999px; font-size: 11px; color: #fff;">
              👥 <span id="stream-viewers-count">${room.audience_count !== undefined ? room.audience_count : 1}</span>
            </div>
            ${(isHost || isPlatformStaff(state.currentUser)) ? `
              <button class="close-room-btn danger" id="stream-delete-btn" style="background: rgba(239,68,68,0.25); border: 1px solid #ef4444; color: #fca5a5; padding: 4px 10px; font-size: 11px; cursor: pointer;">🗑️ ${isHost ? 'حذف البث' : 'إغلاق البث (إدارة)'}</button>
            ` : ''}
            <button class="close-room-btn" id="leave-stream-btn" style="padding: 4px 10px; font-size: 11px;">🚪 خروج</button>
          </div>
        </div>

        <!-- Stream Chat Messages Preview (Bottom Left) -->
        <div class="stream-chat-preview-box" id="stream-chat-preview-box">
          <div class="stream-chat-msg-row">
            <span style="color: #fbbf24;">📢 نظام البث:</span> مرحباً بكم في البث المباشر! اضغط على الشاشة لإرسال القلوب ❤️
          </div>
          ${room.announcement ? `
            <div class="stream-chat-msg-row">
              <span style="color: #c084fc;">إعلان المذيع:</span> ${room.announcement}
            </div>
          ` : ''}
        </div>

        <!-- Bottom Stream Controls HUD -->
        <div class="stream-bottom-hud">
          <div class="room-chat-input-wrapper" style="background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2);">
            <input type="text" class="room-chat-input" id="stream-bullet-input" placeholder="أرسل تعليقاً طائراً على الشاشة..." />
            <button class="room-chat-send-btn" id="stream-send-bullet-btn">➤</button>
          </div>

          ${isHost ? `
            <!-- Host Controls -->
            <button class="room-tool-btn" id="stream-toggle-cam-btn" title="تشغيل / إيقاف الكاميرا">📹</button>
            <button class="room-tool-btn" id="stream-flip-cam-btn" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">🔄</button>
            <button class="room-tool-btn" id="stream-toggle-mic-btn" title="كتم / تشغيل المايك">🎙️</button>
            <button class="room-tool-btn" id="stream-cohost-requests-btn" style="position: relative; background: rgba(245,158,11,0.25); border: 1.5px solid #fbbf24; color: #fbbf24; font-size: 11px; padding: 6px 10px; gap: 4px;" title="طلبات الصعود للبث المشترك">
              <span>📥 طلبات الصعود</span>
              <span id="stream-cohost-req-badge" style="display: none; position: absolute; top: -6px; right: -6px; background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; width: 18px; height: 18px; border-radius: 50%; align-items: center; justify-content: center;">0</span>
            </button>
            <button class="room-tool-btn" id="stream-invite-cohost-btn" title="دعوة لبث مشترك ثنائي (PK / Co-Host)">👥 دعوة</button>
            <button class="room-tool-btn" id="stream-start-pk-btn" style="display: none; background: rgba(239,68,68,0.25); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 10px;" title="بدء جولة تحدي PK بالاتفاق">⚔️ بدء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-end-pk-round-btn" style="display: none; background: rgba(239,68,68,0.35); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 12px; gap: 4px;" title="إنهاء جولة الـ PK فوراً">🛑 إنهاء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-end-cohost-btn" style="display: none; background: rgba(244,63,94,0.3); border-color: #f43f5e;" title="إنزال الشريك المشترك">❌ إنزال الشريك</button>
            <button class="room-tool-btn" id="stream-beautify-btn" title="فلتر الإضاءة والجمال">✨</button>
            <button class="room-tool-btn" id="stream-screenshare-btn" title="مشاركة الشاشة">🖥️</button>
          ` : `
            <!-- Viewer Controls -->
            <button class="room-tool-btn" id="stream-tap-heart-btn" style="background: var(--secondary-gradient); border-color: transparent;" title="إرسال قلب">❤️</button>
            <button class="room-tool-btn" id="stream-request-cohost-btn" style="background: rgba(168,85,247,0.3); border: 1.5px solid #c084fc; color: #fff; font-size: 11px; padding: 6px 12px; gap: 4px;" title="طلب الصعود في بث ثنائي وتقسيم الشاشة للتحدي">
              <span>✋</span>
              <span id="stream-request-btn-text">طلب صعود (PK)</span>
            </button>
            <!-- Co-host dynamic controls when on stage -->
            <button class="room-tool-btn" id="stream-cohost-flip-cam-btn" style="display: none;" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">🔄</button>
            <button class="room-tool-btn" id="stream-cohost-request-pk-btn" style="display: none; background: rgba(245,158,11,0.25); border: 1.5px solid #fbbf24; color: #fbbf24; font-size: 11px; padding: 6px 10px; gap: 4px;" title="طلب بدء جولة PK مع المضيف">⚔️ بدء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-cohost-stepdown-btn" style="display: none; background: rgba(239,68,68,0.25); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 12px; gap: 4px;" title="النزول من البث المشترك والعودة كمشاهد">🚪 النزول من البث</button>
          `}

          <!-- Virtual Gifts Button -->
          <button class="room-tool-btn gift-btn" id="stream-open-gifts-btn" title="إرسال هدية فاخرة للمذيع أو المنافس">🎁</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const videoEl = modal.querySelector('#stream-host-video');
    const fallbackEl = modal.querySelector('#stream-fallback-container');

    // Real WebRTC Audio & Video Streaming
    if (isHost) {
      if (window.soulRtc) {
        window.soulRtc.startBroadcastingVideo(room.id, videoEl).then(stream => {
          activeVideoStream = stream;
          videoEl.style.display = 'block';
          fallbackEl.style.display = 'none';
          showToast('📹 تم تشغيل الكاميرا وتدفق الفيديو والصوت عبر WebRTC!');
        }).catch(err => {
          console.warn('WebRTC broadcast failed:', err);
        });
      }
    } else {
      if (window.soulRtc) {
        window.soulRtc.requestRoomStream(room.id);
        showToast('📡 جارِ استقبال تدفق البث المباشر والصوت عبر WebRTC...');
      }
    }

    // Leave stream event
    modal.querySelector('#leave-stream-btn').onclick = () => {
      if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
      if (activeVideoStream) {
        activeVideoStream.getTracks().forEach(t => t.stop());
        activeVideoStream = null;
      }
      state.socket.emit('leave_room', {
        roomId: room.id,
        userId: state.currentUser ? state.currentUser.id : null
      });
      state.activeRoom = null;
      modal.remove();
    };

    const deleteStreamBtn = modal.querySelector('#stream-delete-btn');
    if (deleteStreamBtn) {
      deleteStreamBtn.onclick = async () => {
        const ok = await deleteRoomById(room.id);
        if (ok) {
          if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
          if (activeVideoStream) {
            activeVideoStream.getTracks().forEach(t => t.stop());
            activeVideoStream = null;
          }
          state.activeRoom = null;
          modal.remove();
        }
      };
    }

    // Tap to like on video stage
    const viewport = modal.querySelector('#stream-video-viewport');
    viewport.onclick = (e) => {
      // Don't trigger if clicked on controls
      if (e.target.closest('.stream-top-hud') || e.target.closest('.stream-bottom-hud')) return;
      triggerHeartAnimation();
      const uid = state.currentUser ? state.currentUser.id : 'guest-' + Date.now();
      state.socket.emit('stream_like', { roomId: room.id, userId: uid });
    };

    const heartBtn = modal.querySelector('#stream-tap-heart-btn');
    if (heartBtn) {
      heartBtn.onclick = () => {
        triggerHeartAnimation();
        const uid = state.currentUser ? state.currentUser.id : 'guest-' + Date.now();
        state.socket.emit('stream_like', { roomId: room.id, userId: uid });
      };
    }

    // Host controls
    if (isHost) {
      // Toggle Cam
      const camBtn = modal.querySelector('#stream-toggle-cam-btn');
      camBtn.onclick = () => {
        isVideoEnabled = !isVideoEnabled;
        if (activeVideoStream) {
          activeVideoStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
        }
        camBtn.style.opacity = isVideoEnabled ? '1' : '0.5';
        showToast(isVideoEnabled ? 'تم تشغيل الكاميرا 📹' : 'تم إيقاف الكاميرا 🚫');
      };

      // Toggle Mic
      const micBtn = modal.querySelector('#stream-toggle-mic-btn');
      micBtn.onclick = () => {
        isAudioEnabled = !isAudioEnabled;
        if (activeVideoStream) {
          activeVideoStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
        }
        micBtn.style.opacity = isAudioEnabled ? '1' : '0.5';
        showToast(isAudioEnabled ? 'تم تفعيل المايكروفون 🎙️' : 'تم كتم المايكروفون 🔇');
      };

      // Beautify Filter
      const beautyBtn = modal.querySelector('#stream-beautify-btn');
      beautyBtn.onclick = () => {
        isBeautifyOn = !isBeautifyOn;
        videoEl.classList.toggle('beautify-filter-active', isBeautifyOn);
        beautyBtn.style.background = isBeautifyOn ? 'var(--secondary)' : '';
        showToast(isBeautifyOn ? 'تم تفعيل فلتر التجميل والإضاءة ✨' : 'تم إيقاف فلتر التجميل');
      };

      // Screen Share
      const shareBtn = modal.querySelector('#stream-screenshare-btn');
      shareBtn.onclick = async () => {
        try {
          if (navigator.mediaDevices.getDisplayMedia) {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            videoEl.srcObject = screenStream;
            videoEl.style.display = 'block';
            fallbackEl.style.display = 'none';
            showToast('🖥️ جارِ مشاركة شاشتك في البث المباشر!');
            screenStream.getVideoTracks()[0].onended = () => {
              if (activeVideoStream) videoEl.srcObject = activeVideoStream;
            };
          }
        } catch (e) {
          showToast('تم إلغاء مشاركة الشاشة');
        }
      };

      // Flip / Mirror Camera orientation
      const flipBtn = modal.querySelector('#stream-flip-cam-btn');
      const quickFlipBtn = modal.querySelector('#stream-quick-flip-btn');
      const handleFlip = () => {
        if (window.soulRtc) {
          const isMirrored = window.soulRtc.toggleCameraMirroring();
          showToast(isMirrored ? '🔄 تم ضبط اتجاه الكاميرا على وضع المرآة (معكوس)' : '🔄 تم ضبط اتجاه الكاميرا على الوضع الطبيعي (غير معكوس)');
        }
      };
      if (flipBtn) flipBtn.onclick = handleFlip;
      if (quickFlipBtn) quickFlipBtn.onclick = handleFlip;

      // Invite Co-Host for 2-Person Live Broadcast & PK
      const inviteCohostBtn = modal.querySelector('#stream-invite-cohost-btn');
      const endCohostBtn = modal.querySelector('#stream-end-cohost-btn');
      const startPkBtn = modal.querySelector('#stream-start-pk-btn');
      const cohostReqsBtn = modal.querySelector('#stream-cohost-requests-btn');

      if (inviteCohostBtn) {
        inviteCohostBtn.onclick = () => {
          showCohostInviteModal(room);
        };
      }

      if (cohostReqsBtn) {
        cohostReqsBtn.onclick = () => {
          showCohostRequestsModal(room);
        };
      }

      if (startPkBtn) {
        startPkBtn.onclick = () => {
          if (!state.activeCohostUser) {
            showToast('يجب أن يصعد شريك معك في البث أولاً لبدء التحدي!');
            return;
          }
          state.socket.emit('request_pk_battle', {
            roomId: room.id,
            fromUser: state.currentUser
          });
          showToast(`📨 تم إرسال طلب تحدي جولة PK إلى ${state.activeCohostUser.name}! بانتظار الموافقة...`);
        };
      }

      // Host PK round manual termination button
      const endPkRoundBtn = modal.querySelector('#stream-end-pk-round-btn');
      if (endPkRoundBtn) {
        endPkRoundBtn.onclick = () => {
          state.socket.emit('end_pk', { roomId: room.id });
          showToast('🛑 جارِ إنهاء جولة الـ PK واحتساب النتيجة...');
        };
      }

      const barEndPkBtn = modal.querySelector('#stream-bar-end-pk-btn');
      if (barEndPkBtn) {
        barEndPkBtn.onclick = () => {
          state.socket.emit('end_pk', { roomId: room.id });
          showToast('🛑 جارِ إنهاء جولة الـ PK واحتساب النتيجة...');
        };
      }

      if (endCohostBtn) {
        endCohostBtn.onclick = () => {
          state.socket.emit('end_cohost', { roomId: room.id });
          disableSplitScreenMode();
          endCohostBtn.style.display = 'none';
          showToast('تم إنهاء البث المشترك والعودة للبث الفردي');
        };
      }
    } else {
      // Viewer & Co-host Controls
      const reqCohostBtn = modal.querySelector('#stream-request-cohost-btn');
      if (reqCohostBtn) {
        reqCohostBtn.onclick = () => {
          if (!requireAuth()) return;
          state.socket.emit('request_cohost_join', {
            roomId: room.id,
            requester: state.currentUser
          });
          const btnText = document.getElementById('stream-request-btn-text');
          if (btnText) btnText.innerText = 'بانتظار القبول ⏳';
          showToast('تم إرسال طلب الصعود إلى صاحب البث! بانتظار الموافقة وتقسيم الشاشة للتحدي 🚀');
        };
      }

      const cohostFlipBtn = modal.querySelector('#stream-cohost-flip-cam-btn');
      if (cohostFlipBtn) cohostFlipBtn.onclick = handleFlip;

      const cohostPkBtn = modal.querySelector('#stream-cohost-request-pk-btn');
      if (cohostPkBtn) {
        cohostPkBtn.onclick = () => {
          if (!requireAuth()) return;
          state.socket.emit('request_pk_battle', {
            roomId: room.id,
            fromUser: state.currentUser
          });
          showToast(`📨 تم إرسال طلب تحدي جولة PK إلى المضيف (${room.host_name})! بانتظار موافقته...`);
        };
      }

      const cohostStepdownBtn = modal.querySelector('#stream-cohost-stepdown-btn');
      if (cohostStepdownBtn) {
        cohostStepdownBtn.onclick = () => {
          if (confirm('هل ترغب في النزول من البث المشترك والعودة كمشاهد؟')) {
            if (window.soulRtc) window.soulRtc.stopBroadcastingCohost();
            state.socket.emit('cohost_leave_stage', {
              roomId: room.id,
              userId: state.currentUser ? state.currentUser.id : null
            });
            showToast('🚪 قمت بالنزول من البث المشترك');
          }
        };
      }
    }

    // Direct click on streamer halves to open gift modal
    const halfHost = modal.querySelector('#stream-split-half-host');
    const halfCohost = modal.querySelector('#stream-split-half-cohost');
    const giftDirectHostBtn = modal.querySelector('#btn-split-gift-host');
    const giftDirectCohostBtn = modal.querySelector('#btn-split-gift-cohost');

    const handleGiftHost = (e) => {
      if (e) e.stopPropagation();
      openGiftStoreModal(room.host_id, room.id, {
        id: room.host_id,
        name: room.host_name,
        avatar: room.host_avatar
      });
    };

    const handleGiftCohost = (e) => {
      if (e) e.stopPropagation();
      if (state.activeCohostUser) {
        openGiftStoreModal(state.activeCohostUser.id, room.id, state.activeCohostUser);
      } else {
        showToast('لا يوجد شريك في البث حالياً');
      }
    };

    if (halfHost) halfHost.onclick = handleGiftHost;
    if (giftDirectHostBtn) giftDirectHostBtn.onclick = handleGiftHost;
    if (halfCohost) halfCohost.onclick = handleGiftCohost;
    if (giftDirectCohostBtn) giftDirectCohostBtn.onclick = handleGiftCohost;

    // PK Boost Buttons
    const boostHostBtn = modal.querySelector('#stream-pk-boost-host');
    const boostChallengerBtn = modal.querySelector('#stream-pk-boost-challenger');

    if (boostHostBtn) {
      boostHostBtn.onclick = () => {
        state.socket.emit('pk_support', {
          roomId: room.id,
          team: 'host',
          points: 50,
          user: state.currentUser || { name: 'داعم' }
        });
      };
    }

    if (boostChallengerBtn) {
      boostChallengerBtn.onclick = () => {
        state.socket.emit('pk_support', {
          roomId: room.id,
          team: 'challenger',
          points: 50,
          user: state.currentUser || { name: 'داعم' }
        });
      };
    }

    // Co-host Requests State & Functions
    let pendingCohostRequests = [];

    function updateReqBadge() {
      const badge = document.getElementById('stream-cohost-req-badge');
      if (!badge) return;
      if (pendingCohostRequests.length > 0) {
        badge.style.display = 'flex';
        badge.innerText = pendingCohostRequests.length;
      } else {
        badge.style.display = 'none';
      }
    }

    function showIncomingCohostBanner(requester) {
      if (!isHost) return;
      const existing = document.getElementById(`cohost-banner-${requester.id}`);
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.className = 'cohost-req-banner';
      banner.id = `cohost-banner-${requester.id}`;

      banner.innerHTML = `
        <img src="${requester.avatar}" class="req-banner-avatar" />
        <div class="req-banner-info">
          <span style="font-weight: 800; color: #fbbf24; font-size: 12px;">${requester.name}</span>
          <span style="font-size: 11px; color: #fff;">يطلب الصعود معك في البث وتقسيم الشاشة للتحدي!</span>
        </div>
        <div class="req-banner-btns">
          <button class="req-accept-btn" id="btn-banner-accept-${requester.id}">✅ قبول</button>
          <button class="req-reject-btn" id="btn-banner-reject-${requester.id}">❌ رفض</button>
        </div>
      `;

      modal.appendChild(banner);

      if (window.soundManager) {
        window.soundManager.playCheer();
      }

      banner.querySelector(`#btn-banner-accept-${requester.id}`).onclick = () => {
        state.socket.emit('accept_cohost_request', {
          roomId: room.id,
          cohostUser: requester
        });
        pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== requester.id);
        updateReqBadge();
        banner.remove();
        showToast(`وافقت على صعود ${requester.name}! جارِ تقسيم الشاشة وبدء التحدي 🚀`);
      };

      banner.querySelector(`#btn-banner-reject-${requester.id}`).onclick = () => {
        state.socket.emit('reject_cohost_request', {
          roomId: room.id,
          targetUserId: requester.id
        });
        pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== requester.id);
        updateReqBadge();
        banner.remove();
      };

      setTimeout(() => {
        if (banner.parentElement) banner.remove();
      }, 15000);
    }

    function showCohostRequestsModal(currentRoom) {
      const reqModal = document.createElement('div');
      reqModal.className = 'soul-modal-backdrop';
      reqModal.id = 'cohost-requests-modal';

      reqModal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 400px;">
          <button class="soul-modal-close-btn" id="close-cohost-reqs-btn">✕</button>
          <div class="modal-header-title">📥 طلبات الصعود للبث المشترك (PK)</div>
          <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; text-align: center;">
            المشاهدون الذين يطلبون الصعود معك وتقسيم الشاشة لبدء التحدي
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;" id="cohost-reqs-list">
            ${pendingCohostRequests.length === 0 ? `
              <div style="text-align: center; color: var(--text-muted); padding: 25px 10px; font-size: 12px;">
                لا توجد طلبات صعود معلقة حالياً.<br>يمكن للمشاهدين طلب الصعود بالضغط على زر "✋ طلب صعود (PK)".
              </div>
            ` : pendingCohostRequests.map(u => `
              <div class="google-account-option" style="padding: 10px 12px; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${u.avatar}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--border-glow);" />
                  <div>
                    <div style="font-size: 13px; font-weight: 800; color: #fff;">${u.name}</div>
                    <div style="font-size: 10px; color: #fbbf24;">مستوى ${u.level || 1} • راغب بالتحدي</div>
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="req-accept-btn fast-accept-req" data-user-id="${u.id}">✅ قبول</button>
                  <button class="req-reject-btn fast-reject-req" data-user-id="${u.id}">❌ رفض</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(reqModal);

      reqModal.querySelector('#close-cohost-reqs-btn').onclick = () => reqModal.remove();

      reqModal.querySelectorAll('.fast-accept-req').forEach(btn => {
        btn.onclick = () => {
          const u = pendingCohostRequests.find(r => r.id === btn.dataset.userId);
          if (u) {
            state.socket.emit('accept_cohost_request', {
              roomId: currentRoom.id,
              cohostUser: u
            });
            pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== u.id);
            updateReqBadge();
            reqModal.remove();
            showToast(`تمت الموافقة على صعود ${u.name}! جارِ تقسيم الشاشة وبدء التحدي... 📹🔥`);
          }
        };
      });

      reqModal.querySelectorAll('.fast-reject-req').forEach(btn => {
        btn.onclick = () => {
          const uId = btn.dataset.userId;
          state.socket.emit('reject_cohost_request', {
            roomId: currentRoom.id,
            targetUserId: uId
          });
          pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== uId);
          updateReqBadge();
          btn.closest('.google-account-option').remove();
          showToast('تم رفض الطلب');
        };
      });
    }

    window.handleIncomingCohostRequest = (requester, requestsCount, requests) => {
      if (requests && Array.isArray(requests)) {
        pendingCohostRequests = requests;
      } else if (!pendingCohostRequests.some(r => r.id === requester.id)) {
        pendingCohostRequests.push(requester);
      }
      updateReqBadge();
      showIncomingCohostBanner(requester);
    };

    window.handleCohostRequestsUpdated = (count, requests) => {
      if (requests && Array.isArray(requests)) {
        pendingCohostRequests = requests;
      }
      updateReqBadge();
    };

    window.showIncomingPkChallengeModal = (roomId, challenger) => {
      let existing = document.getElementById('pk-challenge-received-modal');
      if (existing) existing.remove();

      const challengeModal = document.createElement('div');
      challengeModal.className = 'soul-modal-backdrop animate-fade-in';
      challengeModal.id = 'pk-challenge-received-modal';
      challengeModal.style.zIndex = '99999';

      challengeModal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 380px; text-align: center; border: 2px solid #fbbf24; box-shadow: 0 0 35px rgba(251, 191, 36, 0.5); border-radius: 20px;">
          <div style="font-size: 46px; margin-bottom: 6px; animation: buttonPulseGlow 1.5s infinite;">⚔️🔥</div>
          <div style="font-size: 18px; font-weight: 900; color: #fbbf24; margin-bottom: 8px;">طلب تحدي جولة PK!</div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 12px; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 12px;">
            <img src="${challenger.avatar || '/avatars/avatar-1.png'}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #fbbf24; object-fit: cover;" />
            <div style="text-align: right;">
              <div style="font-size: 14px; font-weight: 800; color: #fff;">${challenger.name}</div>
              <div style="font-size: 11px; color: #fbbf24;">يرغب ببدء منافسة PK معك!</div>
            </div>
          </div>
          <p style="font-size: 12px; color: #e2e8f0; margin-bottom: 16px; line-height: 1.6;">
            جولة حماسية مدتها دقيقتان! تعتمد على دعم وهدايا الجمهور لتحديد الفائز مع عقاب للخاسر. هل تقبل التحدي؟
          </p>
          <div style="display: flex; gap: 10px;">
            <button class="wallet-btn primary" id="btn-accept-pk-challenge-now" style="flex: 1; padding: 10px; font-size: 13px; font-weight: 800;">
              🔥 قبول التحدي
            </button>
            <button class="wallet-btn secondary" id="btn-reject-pk-challenge-now" style="flex: 1; padding: 10px; font-size: 13px;">
              ❌ رفض
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(challengeModal);

      challengeModal.querySelector('#btn-accept-pk-challenge-now').onclick = () => {
        state.socket.emit('accept_pk_battle', { roomId });
        challengeModal.remove();
        showToast('🎉 تم قبول التحدي! جولة الـ PK تنطلق الآن...');
      };

      challengeModal.querySelector('#btn-reject-pk-challenge-now').onclick = () => {
        state.socket.emit('reject_pk_battle', { roomId, fromUserId: challenger.id });
        challengeModal.remove();
        showToast('تم رفض التحدي');
      };

      setTimeout(() => {
        if (challengeModal.parentElement) challengeModal.remove();
      }, 25000);
    };

    // Co-host Split Screen Helpers
    function enableSplitScreenMode(cohostUser) {
      state.activeCohostUser = cohostUser;
      const splitBox = document.getElementById('stream-split-screen-box');
      const pkBar = document.getElementById('stream-cohost-pk-bar');
      const fallback = document.getElementById('stream-fallback-container');
      const singleVideo = document.getElementById('stream-host-video');
      const guestName = document.getElementById('stream-split-guest-name');
      const guestVideo = document.getElementById('stream-split-guest-video');
      const hostSplitVideo = document.getElementById('stream-split-host-video');
      const endBtn = document.getElementById('stream-end-cohost-btn');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      const guestLabel = document.getElementById('stream-cohost-name-label');
      const splitTagHost = document.getElementById('split-tag-host-name');
      const btnDirectCohost = document.getElementById('btn-split-gift-cohost');
      const btnDirectHost = document.getElementById('btn-split-gift-host');
      const endPkBtn = document.getElementById('stream-end-pk-round-btn');
      const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');

      if (!splitBox) return;

      // 50/50 Split view becomes visible, single video hides
      splitBox.style.display = 'flex';
      // PK round does NOT start automatically! Wait for mutual agreement challenge
      if (pkBar) pkBar.style.display = 'none';
      if (fallback) fallback.style.display = 'none';
      if (singleVideo) singleVideo.style.display = 'none';
      if (endPkBtn) endPkBtn.style.display = 'none';
      if (barEndPkBtn) barEndPkBtn.style.display = 'none';

      if (guestName) guestName.innerText = `⚔️ ${cohostUser.name}`;
      if (guestLabel) guestLabel.innerText = cohostUser.name;
      if (splitTagHost) splitTagHost.innerText = room.host_name || 'المضيف';
      if (btnDirectCohost) btnDirectCohost.innerHTML = `🎁 إرسال هدية لـ <strong>${cohostUser.name}</strong>`;
      if (btnDirectHost) btnDirectHost.innerHTML = `🎁 إرسال هدية لـ <strong>${room.host_name || 'المضيف'}</strong>`;

      if (isHost) {
        if (endBtn) endBtn.style.display = 'inline-flex';
        if (startPkBtn) startPkBtn.style.display = 'inline-flex';
      }

      // Connect host video into left half (works for host, co-host, and viewers alike!)
      if (hostSplitVideo) {
        let streamToUse = null;
        if (isHost && activeVideoStream) {
          streamToUse = activeVideoStream;
        } else if (window.soulRtc && window.soulRtc.remoteHostStream) {
          streamToUse = window.soulRtc.remoteHostStream;
        } else if (singleVideo && singleVideo.srcObject) {
          streamToUse = singleVideo.srcObject;
        } else if (window.soulRtc && window.soulRtc.localStream) {
          streamToUse = window.soulRtc.localStream;
        }

        if (streamToUse) {
          hostSplitVideo.srcObject = streamToUse;
          hostSplitVideo.style.display = 'block';
          hostSplitVideo.play().catch(e => console.log('hostSplitVideo play caught:', e));
        } else if (!isHost && window.soulRtc) {
          window.soulRtc.requestRoomStream(room.id);
        }
      }

      // If current user is the cohost, start camera for right half and show cohost controls
      if (state.currentUser && state.currentUser.id === cohostUser.id) {
        const cohostStepdown = document.getElementById('stream-cohost-stepdown-btn');
        if (cohostStepdown) cohostStepdown.style.display = 'inline-flex';
        const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
        if (cohostPkBtn) cohostPkBtn.style.display = 'inline-flex';
        const cohostFlipBtn = document.getElementById('stream-cohost-flip-cam-btn');
        if (cohostFlipBtn) cohostFlipBtn.style.display = 'inline-flex';
        const reqCohostBtn = document.getElementById('stream-request-cohost-btn');
        if (reqCohostBtn) reqCohostBtn.style.display = 'none';

        if (window.soulRtc) {
          window.soulRtc.startBroadcastingCohost(room.id, guestVideo).then(stream => {
            showToast('📹 أنت الآن على الهواء مباشرة بجانب المضيف في الشاشة المقسمة!');
            // Request host stream to ensure bidirectional video feed
            window.soulRtc.requestRoomStream(room.id);
          });
        }
      } else {
        if (guestVideo) {
          let guestStream = null;
          if (window.soulRtc && window.soulRtc.remoteCohostStream) {
            guestStream = window.soulRtc.remoteCohostStream;
          }
          if (guestStream) {
            guestVideo.srcObject = guestStream;
            guestVideo.style.display = 'block';
            guestVideo.play().catch(e => console.log('guestVideo play caught:', e));
          } else if (!guestVideo.srcObject) {
            guestVideo.poster = cohostUser.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
          }
        }
      }

      if (window.soulRtc) {
        window.soulRtc.applyCameraMirroring();
      }

      showToast(`✨ انضم ${cohostUser.name} للبث المشترك! الشاشة أصبحت مقسمة، يمكنك النقر لإرسال الهدايا أو بدء تحدي PK بالاتفاق.`);
    }

    function disableSplitScreenMode() {
      state.activeCohostUser = null;
      const splitBox = document.getElementById('stream-split-screen-box');
      const pkBar = document.getElementById('stream-cohost-pk-bar');
      const singleVideo = document.getElementById('stream-host-video');
      const fallback = document.getElementById('stream-fallback-container');
      const hostSplitVideo = document.getElementById('stream-split-host-video');
      const guestVideo = document.getElementById('stream-split-guest-video');
      const endBtn = document.getElementById('stream-end-cohost-btn');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      const endPkBtn = document.getElementById('stream-end-pk-round-btn');
      const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
      const stepdownBtn = document.getElementById('stream-cohost-stepdown-btn');
      const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
      const cohostFlipBtn = document.getElementById('stream-cohost-flip-cam-btn');
      const reqCohostBtn = document.getElementById('stream-request-cohost-btn');

      if (hostSplitVideo) hostSplitVideo.srcObject = null;
      if (guestVideo) guestVideo.srcObject = null;

      if (splitBox) splitBox.style.display = 'none';
      if (pkBar) pkBar.style.display = 'none';
      if (endBtn) endBtn.style.display = 'none';
      if (startPkBtn) startPkBtn.style.display = 'none';
      if (endPkBtn) endPkBtn.style.display = 'none';
      if (barEndPkBtn) barEndPkBtn.style.display = 'none';
      if (stepdownBtn) stepdownBtn.style.display = 'none';
      if (cohostPkBtn) cohostPkBtn.style.display = 'none';
      if (cohostFlipBtn) cohostFlipBtn.style.display = 'none';

      if (reqCohostBtn) {
        reqCohostBtn.style.display = 'inline-flex';
        const btnText = document.getElementById('stream-request-btn-text');
        if (btnText) btnText.innerText = 'طلب صعود (PK)';
      }

      // Return screen to single full-screen mode for the host
      if (singleVideo) {
        let streamToRestore = null;
        if (isHost && activeVideoStream) {
          streamToRestore = activeVideoStream;
        } else if (window.soulRtc && window.soulRtc.remoteHostStream) {
          streamToRestore = window.soulRtc.remoteHostStream;
        } else if (singleVideo.srcObject) {
          streamToRestore = singleVideo.srcObject;
        }

        if (streamToRestore) {
          singleVideo.srcObject = streamToRestore;
          singleVideo.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
          singleVideo.play().catch(() => {});
        } else if (fallback) {
          fallback.style.display = 'flex';
        }
      }

      if (window.soulRtc) {
        window.soulRtc.applyCameraMirroring();
      }
    }

    window.triggerCohostSplitView = enableSplitScreenMode;
    window.revertCohostSplitView = disableSplitScreenMode;

    function showCohostInviteModal(currentRoom) {
      const candidates = (state.allUsers || []).filter(u => !state.currentUser || u.id !== state.currentUser.id);
      const modal = document.createElement('div');
      modal.className = 'soul-modal-backdrop';
      modal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 380px;">
          <button class="soul-modal-close-btn" id="close-cohost-modal-btn">✕</button>
          <div class="modal-header-title">👥 دعوة لبث مشترك ثنائي (Co-Host Live PK)</div>
          <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; text-align: center;">
            اختر صديقاً أو مذيعاً للانضمام معك في شاشة مقسومة نصفين ومنافسة PK حماسية
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
            ${candidates.map(u => `
              <div class="google-account-option fast-cohost-user" data-user-id="${u.id}" data-user-name="${u.name}" style="padding: 8px 12px; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${u.avatar}" class="google-account-avatar" />
                  <div>
                    <div style="font-size: 13px; font-weight: 700; color: #fff;">${u.name}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">${u.soul_planet || 'عضو مميز'}</div>
                  </div>
                </div>
                <button class="wallet-btn primary" style="padding: 4px 10px; font-size: 11px;">دعوة ⚔️</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#close-cohost-modal-btn').onclick = () => modal.remove();

      modal.querySelectorAll('.fast-cohost-user').forEach(btn => {
        btn.onclick = () => {
          const targetUserId = btn.dataset.userId;
          const targetUserName = btn.dataset.userName;
          const targetObj = candidates.find(c => c.id === targetUserId);

          state.socket.emit('invite_cohost', {
            roomId: currentRoom.id,
            targetUserId,
            hostUser: state.currentUser
          });

          // Instant preview for testing if other user is not a separate window
          state.socket.emit('accept_cohost', {
            roomId: currentRoom.id,
            cohostUser: targetObj || { id: targetUserId, name: targetUserName, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80' }
          });

          modal.remove();
          showToast(`تم إرسال دعوة البث المشترك لـ ${targetUserName}! 👥🔥`);
        };
      });
    }

    // Bullet Chat & Comments
    const bulletInput = modal.querySelector('#stream-bullet-input');
    const sendBulletBtn = modal.querySelector('#stream-send-bullet-btn');

    const handleSendBullet = () => {
      const text = bulletInput.value.trim();
      if (!text) return;
      bulletInput.value = '';

      state.socket.emit('stream_bullet_chat', {
        roomId: room.id,
        user: state.currentUser,
        text
      });
      // Also send as standard room chat
      state.socket.emit('send_room_message', {
        roomId: room.id,
        userId: state.currentUser.id,
        content: text
      });
    };

    sendBulletBtn.onclick = handleSendBullet;
    bulletInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleSendBullet();
    };

    // Open gifts modal
    modal.querySelector('#stream-open-gifts-btn').onclick = () => {
      openGiftStoreModal(room.host_id, room.id, { name: room.host_name, avatar: room.host_avatar });
    };

    // Socket listeners for this live stream
    state.socket.on('stream_like_burst', () => {
      triggerHeartAnimation();
      const likesEl = document.getElementById('stream-likes-count');
      if (likesEl) {
        let count = parseInt(likesEl.innerText) || 0;
        likesEl.innerText = count + 1;
      }
    });

    state.socket.on('stream_bullet_message', ({ user, text }) => {
      addBulletCommentToScreen(user, text);
      addChatMessageToStreamPreview(user, text);
    });
  }

  function triggerHeartAnimation() {
    const layer = document.getElementById('stream-hearts-layer');
    if (!layer) return;

    const hearts = ['❤️', '💖', '💜', '💙', '✨', '🔥', '🌟'];
    const heart = document.createElement('div');
    heart.className = 'floating-tap-heart';
    heart.innerText = hearts[Math.floor(Math.random() * hearts.length)];
    heart.style.right = `${Math.random() * 60 + 10}px`;

    layer.appendChild(heart);
    setTimeout(() => heart.remove(), 2200);
  }

  function addBulletCommentToScreen(user, text) {
    const layer = document.getElementById('stream-bullet-layer');
    if (!layer) return;

    const bullet = document.createElement('div');
    bullet.className = 'bullet-comment-item';
    bullet.style.top = `${Math.random() * 120}px`;
    bullet.innerHTML = `
      <img src="${user.avatar}" style="width: 20px; height: 20px; border-radius: 9999px;" />
      <span style="color: #fbbf24;">${user.name}:</span>
      <span>${text}</span>
    `;

    layer.appendChild(bullet);
    setTimeout(() => bullet.remove(), 6200);
  }

  function addChatMessageToStreamPreview(user, text) {
    const box = document.getElementById('stream-chat-preview-box');
    if (!box) return;

    const row = document.createElement('div');
    row.className = 'stream-chat-msg-row';
    row.innerHTML = `<span class="stream-chat-user">${user.name}:</span> ${text}`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  // ============================================
  // LIVE VOICE PARTY ROOM SCREEN (FULL EXPERIENCE)
  // ============================================
  async function openVoiceRoom(roomId) {
    if (!state.currentUser) {
      showGoogleLoginModal();
      showToast('يجب تسجيل الدخول بحساب Gmail أولاً للدخول إلى الغرفة ورؤية الدردشة! 🔒');
      return;
    }
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (!res.ok) {
        showToast('تعذر العثور على الغرفة!');
        return;
      }
      const room = await res.json();
      state.activeRoom = room;

      // Determine if current user is already in a seat
      const userSeat = (room.seats || []).find(s => state.currentUser && s.user_id === state.currentUser.id);
      state.userSeatIndex = userSeat ? userSeat.seat_index : null;
      state.isMuted = userSeat ? !!userSeat.is_muted : false;

      // Render Live Room Modal first so chat stream and entry effect slot are ready in DOM
      renderLiveRoomModal(room);

      // Fetch Chat Messages first so the entry effect integrates directly at the bottom of the chat stream
      await loadRoomChatMessages(roomId);

      // Join socket room (broadcasts entry effect to all room participants)
      state.socket.emit('join_room', { roomId, user: state.currentUser });

      // WebRTC real audio stream
      if (window.soulRtc) {
        window.soulRtc.requestRoomStream(roomId);
        if (userSeat && !userSeat.is_muted) {
          window.soulRtc.startBroadcastingVoice(roomId);
        }
      }
    } catch (err) {
      console.error('Error opening room:', err);
    }
  }

  // ============================================
  // SOULCHILL MIC SEAT ANIMATED STICKERS CATALOG
  // ============================================
  const SOULCHILL_MIC_STICKERS = [
    {
      id: 'shy_pointing',
      name: 'خجول وكيوت 👉👈',
      svg: `<svg viewBox="0 0 100 100" class="seat-sticker-svg" style="width: 100%; height: 100%;">
        <defs>
          <radialGradient id="shyGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.95" />
            <stop offset="60%" stop-color="#fed7aa" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#f97316" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="faceGrad" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stop-color="#fff7ed" />
            <stop offset="65%" stop-color="#ffedd5" />
            <stop offset="100%" stop-color="#fed7aa" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#shyGlow)" opacity="0.65" />
        <path d="M 38 18 L 44 25 L 50 14 L 56 25 L 62 18 L 59 29 L 41 29 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.5" />
        <circle cx="50" cy="14" r="2.5" fill="#ef4444" />
        <circle cx="50" cy="52" r="33" fill="url(#faceGrad)" stroke="#ea580c" stroke-width="2.8" />
        <ellipse cx="31" cy="56" rx="5.5" ry="4" fill="#f43f5e" opacity="0.7" />
        <ellipse cx="69" cy="56" rx="5.5" ry="4" fill="#f43f5e" opacity="0.7" />
        <path d="M 32 46 Q 39 41 46 46" stroke="#b91c1c" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 54 46 Q 61 41 68 46" stroke="#b91c1c" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 47 58 Q 50 60 53 58" stroke="#ea580c" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <g transform="translate(25, 57)">
          <circle cx="8" cy="10" r="7" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
          <path d="M 13 8 L 24 8 Q 25.5 8 25.5 9.5 Q 25.5 11 24 11 L 13 11" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
        </g>
        <g transform="translate(51, 57)">
          <circle cx="16" cy="10" r="7" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
          <path d="M 11 8 L 0 8 Q -1.5 8 -1.5 9.5 Q -1.5 11 0 11 L 11 11" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
        </g>
      </svg>`
    },
    {
      id: 'king_crown',
      name: 'فخم وملكي 👑',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <defs>
          <radialGradient id="kgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fef08a" />
            <stop offset="100%" stop-color="#eab308" stop-opacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#kgGlow)" opacity="0.6" />
        <circle cx="50" cy="52" r="32" fill="#fef08a" stroke="#ca8a04" stroke-width="2.5" />
        <path d="M 28 20 L 36 32 L 50 14 L 64 32 L 72 20 L 68 38 L 32 38 Z" fill="#f59e0b" stroke="#b45309" stroke-width="2" />
        <circle cx="50" cy="14" r="3" fill="#ef4444" />
        <circle cx="28" cy="20" r="2.5" fill="#3b82f6" />
        <circle cx="72" cy="20" r="2.5" fill="#10b981" />
        <circle cx="39" cy="48" r="3.5" fill="#1e293b" />
        <circle cx="61" cy="48" r="3.5" fill="#1e293b" />
        <path d="M 38 62 Q 50 72 62 62" stroke="#b45309" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <ellipse cx="31" cy="55" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
        <ellipse cx="69" cy="55" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'laugh_tears',
      name: 'ضحك هستيري 😂',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 30 42 Q 38 34 46 44" stroke="#78350f" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 54 44 Q 62 34 70 42" stroke="#78350f" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 34 54 Q 50 74 66 54 Z" fill="#991b1b" stroke="#78350f" stroke-width="2" />
        <path d="M 40 67 Q 50 72 60 67" fill="#f43f5e" />
        <path d="M 23 44 C 20 44 18 50 21 54 C 24 57 28 53 27 48 Z" fill="#38bdf8" />
        <path d="M 77 44 C 80 44 82 50 79 54 C 76 57 72 53 73 48 Z" fill="#38bdf8" />
      </svg>`
    },
    {
      id: 'heart_love',
      name: 'غرقان حب 😍',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fde047" stroke="#ca8a04" stroke-width="2.5" />
        <path d="M 38 34 C 33 26 24 30 25 38 C 26 46 38 52 38 52 C 38 52 50 46 51 38 C 52 30 43 26 38 34 Z" fill="#ef4444" transform="scale(0.7) translate(14, 18)" />
        <path d="M 38 34 C 33 26 24 30 25 38 C 26 46 38 52 38 52 C 38 52 50 46 51 38 C 52 30 43 26 38 34 Z" fill="#ef4444" transform="scale(0.7) translate(48, 18)" />
        <path d="M 36 60 Q 50 72 64 60" stroke="#b45309" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <ellipse cx="28" cy="58" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
        <ellipse cx="72" cy="58" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'cool_vip',
      name: 'روقان وفخامة 😎',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 24 40 L 47 40 C 48 48 42 54 34 54 C 26 54 22 48 24 40 Z" fill="#0f172a" stroke="#000" stroke-width="2" />
        <path d="M 53 40 L 76 40 C 78 48 74 54 66 54 C 58 54 52 48 53 40 Z" fill="#0f172a" stroke="#000" stroke-width="2" />
        <line x1="47" y1="42" x2="53" y2="42" stroke="#0f172a" stroke-width="3" />
        <path d="M 38 64 Q 50 72 62 64" stroke="#92400e" stroke-width="3.5" stroke-linecap="round" fill="none" />
      </svg>`
    },
    {
      id: 'fire_hype',
      name: 'حريقة وحماس 🔥',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <path d="M 50 14 C 58 28 68 34 68 48 C 68 62 58 74 50 82 C 42 74 32 62 32 48 C 32 38 40 26 50 14 Z" fill="#f97316" stroke="#c2410c" stroke-width="2.5" />
        <path d="M 50 34 C 55 42 60 48 60 56 C 60 64 55 70 50 74 C 45 70 40 64 40 56 C 40 48 45 42 50 34 Z" fill="#fde047" />
        <circle cx="45" cy="54" r="3" fill="#000" />
        <circle cx="55" cy="54" r="3" fill="#000" />
        <path d="M 46 62 Q 50 65 54 62" stroke="#000" stroke-width="2" stroke-linecap="round" fill="none" />
      </svg>`
    },
    {
      id: 'party_popper',
      name: 'احتفال وبارتي 🥳',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="52" r="32" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 32 32 L 50 10 L 62 30 Z" fill="#8b5cf6" stroke="#6d28d9" stroke-width="2" />
        <circle cx="50" cy="10" r="3.5" fill="#f43f5e" />
        <path d="M 50 60 L 76 66 L 74 72 L 48 64 Z" fill="#ec4899" stroke="#be185d" stroke-width="1.5" />
        <circle cx="38" cy="48" r="3.5" fill="#1e293b" />
        <circle cx="58" cy="46" r="3.5" fill="#1e293b" />
        <ellipse cx="32" cy="56" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'spooky_ghost',
      name: 'مقلب وشبح 👻',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <path d="M 50 20 C 34 20 28 32 28 48 C 28 62 26 76 34 76 C 40 76 44 68 50 76 C 56 68 60 76 66 76 C 74 76 72 62 72 48 C 72 32 66 20 50 20 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2.5" />
        <ellipse cx="42" cy="44" rx="4" ry="5" fill="#0f172a" />
        <ellipse cx="58" cy="44" rx="4" ry="5" fill="#0f172a" />
        <ellipse cx="50" cy="56" rx="5" ry="7" fill="#0f172a" />
        <path d="M 48 59 Q 50 67 52 59" fill="#f43f5e" />
      </svg>`
    }
  ];

  function displaySeatEmojiReaction(seatIndex, svgHtml, name) {
    let seatContainer = null;
    if (seatIndex === 0) {
      seatContainer = document.querySelector('#host-seat-0 .host-avatar-box');
    } else {
      seatContainer = document.querySelector(`#stage-seat-${seatIndex} .seat-avatar-container`);
    }
    if (!seatContainer) return;

    // Remove any existing active overlay on this seat
    const oldOverlay = seatContainer.querySelector('.seat-animated-sticker-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'seat-animated-sticker-overlay';
    overlay.innerHTML = svgHtml;

    seatContainer.appendChild(overlay);

    if (window.soundManager) window.soundManager.playCheer();

    // Auto remove after 6 seconds
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
    }, 6000);
  }

  function updateRoomMicEmojiButtonState() {
    const btn = document.getElementById('room-chat-emoji-toggle-btn');
    const drawer = document.getElementById('seat-emojis-picker-drawer');
    const isSittingOnMic = state.userSeatIndex !== null && state.userSeatIndex !== undefined;

    if (btn) {
      btn.style.display = 'flex';
    }
    if (!isSittingOnMic && drawer) {
      drawer.style.display = 'none';
    }
  }

  function renderSeatEmojisGrid(container, room) {
    if (!container) return;
    container.innerHTML = SOULCHILL_MIC_STICKERS.map(s => `
      <div class="seat-emoji-item-card" data-emoji-id="${s.id}">
        <div class="seat-sticker-preview">${s.svg}</div>
        <div class="seat-emoji-label">${s.name}</div>
      </div>
    `).join('');

    container.querySelectorAll('.seat-emoji-item-card').forEach(card => {
      card.onclick = () => {
        const emojiId = card.dataset.emojiId;
        const sticker = SOULCHILL_MIC_STICKERS.find(s => s.id === emojiId);
        if (!sticker) return;

        if (state.userSeatIndex === null || state.userSeatIndex === undefined) {
          showToast('يجب أن تكون على المقعد لإرسال هذا السمايل التفاعلي! 🎙️');
          return;
        }

        // Emit reaction to room
        state.socket.emit('seat_emoji_reaction', {
          roomId: room.id,
          seatIndex: state.userSeatIndex,
          emojiId: sticker.id,
          emojiSvg: sticker.svg,
          emojiName: sticker.name,
          user: state.currentUser
        });

        // Locally display immediately
        displaySeatEmojiReaction(state.userSeatIndex, sticker.svg, sticker.name);

        const drawer = document.getElementById('seat-emojis-picker-drawer');
        if (drawer) drawer.style.display = 'none';
      };
    });
  }

  function renderLiveRoomModal(room) {
    if (!room || !room.id) {
      console.error('renderLiveRoomModal called with invalid room:', room);
      showToast('تعذر تحميل بيانات الغرفة الصوتية');
      return;
    }

    room.host_id = room.host_id || (state.currentUser ? state.currentUser.id : '');
    room.host_name = room.host_name || (state.currentUser ? state.currentUser.name : 'المضيف');
    room.host_avatar = room.host_avatar || (state.currentUser ? state.currentUser.avatar : '/avatars/avatar-1.png');
    room.host_frame = room.host_frame || '';

    let existing = document.getElementById('live-voice-room-modal');
    if (existing) existing.remove();

    const isRoomAdmin = state.currentUser && (
      room.host_id === state.currentUser.id || 
      isPlatformStaff(state.currentUser)
    );
    const mySeat = (room.seats || []).find(s => state.currentUser && s.user_id === state.currentUser.id);
    state.userSeatIndex = mySeat ? mySeat.seat_index : null;
    state.isMuted = mySeat ? !!mySeat.is_muted : false;

    const hostSeat = (room.seats || []).find(s => s.seat_index === 0);
    const isHostSeatOccupied = Boolean(hostSeat && hostSeat.user_id);
    const hostOccupant = isHostSeatOccupied ? hostSeat : null;

    const modal = document.createElement('div');
    modal.className = 'live-room-modal';
    modal.id = 'live-voice-room-modal';

    let headerRoleBadge = '';
    if (state.currentUser) {
      if (state.currentUser.role === 'owner') headerRoleBadge = '<span style="background: #ec4899; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">👑 مالك التطبيق</span>';
      else if (state.currentUser.role === 'super_master') headerRoleBadge = '<span style="background: #a855f7; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">💎 سوبر ماستر</span>';
      else if (state.currentUser.role === 'super_admin') headerRoleBadge = '<span style="background: #f59e0b; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">⚡ سوبر ادمن</span>';
      else if (state.currentUser.role === 'admin' || state.currentUser.role === 'moderator') headerRoleBadge = '<span style="background: #3b82f6; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">🛡️ ادمن الدردشة</span>';
      else if (room.host_id === state.currentUser.id) headerRoleBadge = '<span style="background: #fbbf24; color: #000; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">👑 مدير الغرفة</span>';
    }

    // 8 Seats HTML (indices 1 to 8)
    const seatsHtml = [1, 2, 3, 4, 5, 6, 7, 8].map(idx => {
      const seat = (room.seats || []).find(s => s.seat_index === idx);
      const isOccupied = seat && seat.user_id;
      const isLocked = seat && seat.is_locked;
      return `
        <div class="stage-seat ${isOccupied ? 'occupied' : ''} ${isLocked ? 'locked' : ''}" id="stage-seat-${idx}" data-seat-idx="${idx}">
          <div class="seat-avatar-container">
            ${isOccupied 
              ? `<img src="${seat.avatar}" class="${seat.avatar_frame ? 'avatar-frame-' + seat.avatar_frame : ''}" />` 
              : (isLocked ? `<span class="seat-empty-plus">🔒</span>` : `<span class="seat-empty-plus">+</span>`)
            }
            <div class="seat-number-badge">${idx}</div>
            ${isOccupied 
              ? `<div class="seat-mic-status ${seat.is_muted ? 'muted' : 'unmuted'}" style="display: ${seat.is_muted ? 'flex' : 'none'};">🔇</div>` 
              : ''
            }
          </div>
          <div class="seat-user-name">${isOccupied ? seat.name : (isLocked ? 'مقعد مقفل' : 'مقعد فارغ')}</div>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="live-room-container">
        <!-- Room Header -->
        <div class="live-room-header">
          <div class="live-room-title-box">
            <div class="live-room-name">
              <span class="live-room-mic-icon">🎙️</span>
              <span class="live-room-title-text" title="${room.title}">${room.title}</span>
              <button type="button" class="room-fav-heart-btn ${isRoomFavorited(room.id) ? 'favorited' : ''}" id="room-fav-toggle-btn" data-room-id="${room.id}" title="${isRoomFavorited(room.id) ? 'إزالة الغرفة من المفضلة' : 'إضافة الغرفة إلى المفضلة'}">
                <span class="fav-heart-icon">${isRoomFavorited(room.id) ? '❤️' : '🤍'}</span>
              </button>
              ${headerRoleBadge}
            </div>
            <div class="live-room-id-tag">ID: ${room.id} • 👥 <span id="live-audience-counter">${room.audience_count !== undefined ? room.audience_count : 1}</span> مستمع</div>
          </div>
          <div class="live-room-actions">
            <button class="header-action-btn" id="room-chill-music-btn" title="موسيقى هادئة لوفاي">🎵</button>
            <button class="close-room-btn" id="leave-room-btn">🚪 خروج</button>
          </div>
        </div>

        ${isRoomAdmin ? `
          <!-- Host & Admin Toolbar (Sleek organized single-row bar) -->
          <div class="host-admin-toolbar">
            <div class="host-toolbar-badge">
              <span>👑</span>
              <span>الإدارة</span>
            </div>
            <div class="host-toolbar-actions">
              <button class="host-tool-mini-btn" id="btn-admin-edit-announcement" title="تعديل الإعلان">📢 الإعلان</button>
              <button class="host-tool-mini-btn lock" id="btn-admin-lock-all-seats" title="قفل جميع المقاعد">🔒 قفل المقاعد</button>
              <button class="host-tool-mini-btn unlock" id="btn-admin-unlock-all-seats" title="فتح جميع المقاعد">🔓 فتح المقاعد</button>
              <button class="host-tool-mini-btn pk" id="btn-admin-start-pk" title="بدء تحدي PK">⚔️ PK</button>
              <button class="host-tool-mini-btn danger" id="btn-admin-close-room" title="إغلاق الغرفة">🛑 إغلاق</button>
            </div>
          </div>
        ` : ''}

        <!-- PK Battle Bar (Host Red vs Challenger Blue) -->
        <div class="pk-battle-bar" id="room-pk-battle-bar">
          <div class="pk-header">
            <span class="pk-team-host">🔴 المضيف: <span id="pk-host-score">100</span></span>
            <span class="pk-timer" id="pk-countdown-timer">00:45</span>
            <span class="pk-team-challenger">🔵 المنافس: <span id="pk-challenger-score">100</span></span>
          </div>
          <div class="pk-progress-track">
            <div class="pk-progress-fill-host" id="pk-progress-fill"></div>
          </div>
          <div class="pk-boost-btns">
            <button class="pk-boost-btn red" id="pk-boost-host-btn">❤️ دعم المضيف (+50)</button>
            <button class="pk-boost-btn blue" id="pk-boost-challenger-btn">💙 دعم المنافس (+50)</button>
          </div>
        </div>

        <!-- Stage: Host & 8 Seats -->
        <div class="room-stage-section">
          <!-- Host Central Seat (Index 0) -->
          <div class="host-seat-wrapper ${isHostSeatOccupied ? 'occupied' : 'empty'}" id="host-seat-0" data-seat-idx="0" style="cursor: pointer;">
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box ${isHostSeatOccupied ? '' : 'empty-host-seat'}" style="${isHostSeatOccupied ? '' : 'border: 2px dashed rgba(251, 191, 36, 0.6); background: rgba(251, 191, 36, 0.08); display: flex; align-items: center; justify-content: center;'}">
              ${isHostSeatOccupied 
                ? `<img src="${hostOccupant.avatar || room.host_avatar}" class="${hostOccupant.avatar_frame ? 'avatar-frame-' + hostOccupant.avatar_frame : ''}" />
                   <div class="seat-mic-status ${hostOccupant.is_muted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${hostOccupant.is_muted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>` 
                : `<span class="seat-empty-plus" style="font-size: 26px; color: #fbbf24; font-weight: 800;">+</span>
                   <div class="seat-mic-status unmuted" id="host-mic-badge" style="display: none; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>`
              }
            </div>
            <div class="host-name-label" style="${isHostSeatOccupied ? '' : 'color: #fbbf24;'}">
              ${isHostSeatOccupied ? (hostOccupant.name || room.host_name) : 'مقعد المضيف (فارغ)'}
            </div>
          </div>

          <!-- 8 Seats Grid -->
          <div class="guest-seats-grid">
            ${seatsHtml}
          </div>
        </div>

        <!-- Compact SoulChill Visitors / Audience Strip under the seats -->
        <div class="room-audience-strip-container">
          <div class="audience-strip-badge-pill" title="المتواجدون في الغرفة">
            <span class="audience-person-icon">👤</span>
            <span class="audience-count-pill" id="room-audience-badge">0</span>
          </div>
          <div class="room-audience-scroll-track" id="room-audience-list">
            <!-- Dynamic visitor avatars rendered here -->
          </div>
        </div>

        <!-- Entry Effect Banner Container -->
        <div class="room-entry-effect-slot" id="room-entry-effect-slot"></div>

        <!-- Live Chat Messages Stream (Swipe Right to Hide, Swipe Left to Restore) -->
        <div class="room-chat-stream" id="room-chat-messages-container" title="اسحب لليمين لإخفاء الرسائل، واسحب لليسار لإظهارها">
          <div class="room-chat-bubble system-notice">
            🌟 مرحباً بكم في الروم! الرجاء الالتزام بالاحترام المتبادل والمحبة.
          </div>
          ${room.announcement ? `
            <div class="room-chat-bubble system-notice">
              📢 إعلان المضيف: ${room.announcement}
            </div>
          ` : ''}
        </div>

        <!-- Floating Restore Chat Hint when Public Chat is Swiped Hidden -->
        <button type="button" class="room-chat-restore-pill" id="room-chat-restore-pill" style="display: none;">
          <span>💬 اسحب لليسار أو اضغط لإظهار العام</span>
        </button>

        <!-- Room Bottom Controls Bar (Exact SoulChill Layout matching image-1.png & image-2.png) -->
        <div class="room-bottom-controls">
          <!-- Rightmost in RTL: Pill Input ("مرحبًا" + Smiley Icon on Left inside pill) -->
          <div class="room-chat-input-wrapper">
            <input type="text" class="room-chat-input" id="room-chat-text-input" placeholder="مرحبًا" />
            <button type="button" class="room-chat-send-btn" id="room-send-chat-btn" title="إرسال">➤</button>
            <button type="button" class="room-chat-emoji-btn" id="room-chat-emoji-toggle-btn" title="سمايلات وتفاعلات">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <circle cx="12" cy="12" r="9.5" stroke="#ffffff" stroke-width="1.8"/>
                <circle cx="9" cy="10" r="1.3" fill="#ffffff"/>
                <circle cx="15" cy="10" r="1.3" fill="#ffffff"/>
                <path d="M8.5 14.2C9.4 15.8 10.6 16.5 12 16.5C13.4 16.5 14.6 15.8 15.5 14.2" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 1. Royal Treasure / Privilege Box Button -->
          <button type="button" class="room-tool-btn chest-btn" id="room-open-chest-btn" title="صندوق المكافآت والامتيازات">
            <span class="chest-3d-icon">👑💎</span>
          </button>

          <!-- 2. Accessories Button (Exact image-2.png: 3 horizontal lines short-long-short) -->
          <button type="button" class="room-tool-btn accessories-btn" id="room-accessories-btn" title="إكسسوارات (إطارات الرسالة وتأثيرات الدخول)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M8 7.5H16M5 12H19M8 16.5H16" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round"/>
            </svg>
          </button>

          <!-- 3. Golden Gamepad Button (Games Selector) -->
          <button type="button" class="room-tool-btn games-btn" id="room-open-games-btn" title="ألعاب وتحديات الغرفة">
            <span class="gamepad-3d-icon">🎮</span>
          </button>

          <!-- 4. In-Room Private Messages Button (Speech Bubble with 2 lines) -->
          <button type="button" class="room-tool-btn inroom-msg-btn" id="room-inroom-messages-btn" title="الرسائل والمحادثات الخاصة 💬" style="position: relative;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M6 5H18C19.6569 5 21 6.34315 21 8V14C21 15.6569 19.6569 17 18 17H14L12 19.5L10 17H6C4.34315 17 3 15.6569 3 14V8C3 6.34315 4.34315 5 6 5Z" stroke="#e9d5ff" stroke-width="1.9" stroke-linejoin="round"/>
              <path d="M8.5 9.5H15.5M8.5 13H13.5" stroke="#e9d5ff" stroke-width="1.9" stroke-linecap="round"/>
            </svg>
            <span class="inroom-unread-dot" id="inroom-unread-dot" style="display: none; position: absolute; top: 2px; right: 2px; width: 9px; height: 9px; background: #ef4444; border-radius: 50%; border: 1.5px solid #000;"></span>
          </button>

          <!-- 5. Virtual Gift Box Button -->
          <button type="button" class="room-tool-btn gift-btn" id="room-open-gifts-btn" title="إرسال هدية فاخرة">
            <span class="gift-3d-icon">🎁</span>
          </button>

          <!-- 6. Mic Toggle Button (Strictly shown only when sitting on a seat) -->
          <button type="button" class="room-tool-btn mic-btn ${state.userSeatIndex !== null && state.userSeatIndex !== undefined && !state.isMuted ? 'active' : ''}" id="room-mic-toggle-btn" title="المايكروفون" style="display: ${state.userSeatIndex !== null && state.userSeatIndex !== undefined ? 'flex' : 'none'};">
            ${state.userSeatIndex !== null && state.userSeatIndex !== undefined && !state.isMuted ? '🎙️' : '🔇'}
          </button>
        </div>

        <!-- Mic Seat Emojis / Animated Stickers Picker Drawer -->
        <div class="seat-emojis-picker-drawer" id="seat-emojis-picker-drawer" style="display: none;">
          <div class="seat-emojis-header">
            <span>🎭 سمايلات وتفاعلات المايك (تظهر على مقعدك)</span>
            <button type="button" id="close-seat-emojis-btn" style="background: none; border: none; color: #fff; font-size: 16px; cursor: pointer;">✕</button>
          </div>
          <div class="seat-emojis-grid" id="seat-emojis-grid"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initial check of mic & emoji button visibility based on whether user is on mic
    updateMicButtonUI();

    // Event: Favorite Room Heart Button inside live-room-title-box
    const favToggleBtn = modal.querySelector('#room-fav-toggle-btn');
    if (favToggleBtn) {
      favToggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavoriteRoom(room.id, favToggleBtn);
      };
    }

    // Event: Leave Room
    modal.querySelector('#leave-room-btn').onclick = () => {
      leaveActiveVoiceRoom();
    };

    // Event: Chill Music toggle
    const musicBtn = modal.querySelector('#room-chill-music-btn');
    musicBtn.onclick = () => {
      if (window.soundManager) {
        const playing = window.soundManager.toggleChillMusic(
          () => {
            musicBtn.style.background = 'var(--secondary)';
            showToast('🎵 تم تشغيل موسيقى لوفاي الهادئة');
          },
          () => {
            musicBtn.style.background = '';
            showToast('تم إيقاف الموسيقى');
          }
        );
      }
    };

    // Event: In-Room Private Messages Button (Located at Bottom Controls next to gifts)
    const inroomMsgBtn = modal.querySelector('#room-inroom-messages-btn');
    if (inroomMsgBtn) {
      inroomMsgBtn.onclick = () => {
        const dot = document.getElementById('inroom-unread-dot');
        if (dot) dot.style.display = 'none';
        openInRoomMessagesDrawer();
      };
    }

    // Event: Treasure / Privilege Box Button
    const chestBtn = modal.querySelector('#room-open-chest-btn');
    if (chestBtn) {
      chestBtn.onclick = () => {
        showOneTimeOfferModal();
      };
    }

    // Event: Accessories Button (image-2.png -> Opens Message Frames & Entry Effects)
    const accessoriesBtn = modal.querySelector('#room-accessories-btn');
    if (accessoriesBtn) {
      accessoriesBtn.onclick = () => {
        openRoomAccessoriesModal(room);
      };
    }

    // Event: Games Button (Golden Gamepad)
    const gamesBtn = modal.querySelector('#room-open-games-btn');
    if (gamesBtn) {
      gamesBtn.onclick = () => {
        showRoomGamesSelectorModal(room);
      };
    }

    // Event: Mic Emoji Stickers Toggle & Selection
    const emojiToggleBtn = modal.querySelector('#room-chat-emoji-toggle-btn');
    const emojisDrawer = modal.querySelector('#seat-emojis-picker-drawer');
    const closeEmojisBtn = modal.querySelector('#close-seat-emojis-btn');
    const emojisGrid = modal.querySelector('#seat-emojis-grid');

    if (closeEmojisBtn && emojisDrawer) {
      closeEmojisBtn.onclick = () => {
        emojisDrawer.style.display = 'none';
      };
    }

    if (emojiToggleBtn && emojisDrawer) {
      emojiToggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (state.userSeatIndex === null || state.userSeatIndex === undefined) {
          // If not on mic seat, insert a quick smile emoji or let user know
          const inputEl = modal.querySelector('#room-chat-text-input');
          if (inputEl && !inputEl.disabled) {
            inputEl.value += ' 😊';
            inputEl.focus();
          } else {
            showToast('سمايلات وتفاعلات المايك تظهر عندما تكون على المقعد! 🎙️');
          }
          return;
        }
        const isHidden = emojisDrawer.style.display === 'none' || !emojisDrawer.style.display;
        if (isHidden) {
          renderSeatEmojisGrid(emojisGrid, room);
          emojisDrawer.style.display = 'block';
        } else {
          emojisDrawer.style.display = 'none';
        }
      };
    }

    // Setup Swipe Right to Hide Public Chat & Swipe Left to Restore
    setupRoomChatSwipeToggle(modal);

    // Event: Host & Admin Control Actions
    const editAnnounceBtn = modal.querySelector('#btn-admin-edit-announcement');
    if (editAnnounceBtn) {
      editAnnounceBtn.onclick = () => {
        const newAnn = prompt('اكتب رسالة الإعلان الجديدة للروم:', room.announcement || '');
        if (newAnn !== null) {
          state.socket.emit('send_room_message', {
            roomId: room.id,
            userId: state.currentUser.id,
            content: `📢 [إعلان المضيف]: ${newAnn}`
          });
          showToast('تم تحديث إعلان الروم! 📢');
        }
      };
    }

    const lockAllSeatsBtn = modal.querySelector('#btn-admin-lock-all-seats');
    if (lockAllSeatsBtn) {
      lockAllSeatsBtn.onclick = () => {
        if (confirm('هل ترغب بقفل جميع مقاعد المايك ومنع صعود الجمهور؟ 🔒')) {
          state.socket.emit('admin_lock_all_seats', {
            roomId: room.id,
            adminId: state.currentUser.id,
            isLocked: true
          });
        }
      };
    }

    const unlockAllSeatsBtn = modal.querySelector('#btn-admin-unlock-all-seats');
    if (unlockAllSeatsBtn) {
      unlockAllSeatsBtn.onclick = () => {
        state.socket.emit('admin_lock_all_seats', {
          roomId: room.id,
          adminId: state.currentUser.id,
          isLocked: false
        });
      };
    }

    const startPkBtn = modal.querySelector('#btn-admin-start-pk');
    if (startPkBtn) {
      startPkBtn.onclick = () => {
        startRoomPkBattle(room);
      };
    }

    const closeRoomBtn = modal.querySelector('#btn-admin-close-room');
    if (closeRoomBtn) {
      closeRoomBtn.onclick = async () => {
        const ok = await deleteRoomById(room.id);
        if (ok) {
          if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
          leaveActiveVoiceRoom();
        }
      };
    }

    // Host Seat 0 Click
    const hostSeatEl = modal.querySelector('#host-seat-0');
    if (hostSeatEl) {
      hostSeatEl.onclick = () => {
        handleSeatClick(0);
      };
    }

    // Event: Seat Clicks (Take Seat, Leave Seat, Mute, Host Moderation)
    modal.querySelectorAll('.stage-seat').forEach(seatEl => {
      seatEl.onclick = () => {
        const seatIdx = parseInt(seatEl.dataset.seatIdx);
        handleSeatClick(seatIdx);
      };
    });

    // Event: Mic Toggle button
    const micBtn = modal.querySelector('#room-mic-toggle-btn');
    micBtn.onclick = () => {
      toggleUserMic();
    };

    // Event: Open Gifts Store
    modal.querySelector('#room-open-gifts-btn').onclick = () => {
      openGiftStoreModal(null, room.id, null);
    };

    // Event: Send Chat Message
    const chatInput = modal.querySelector('#room-chat-text-input');
    const sendBtn = modal.querySelector('#room-send-chat-btn');

    const handleSend = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      state.socket.emit('send_room_message', {
        roomId: room.id,
        userId: state.currentUser.id,
        content: text
      });
      chatInput.value = '';
    };

    sendBtn.onclick = handleSend;
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    // PK Boost buttons
    modal.querySelector('#pk-boost-host-btn').onclick = () => {
      state.socket.emit('pk_support', { roomId: room.id, team: 'host', points: 50, user: state.currentUser });
    };
    modal.querySelector('#pk-boost-challenger-btn').onclick = () => {
      state.socket.emit('pk_support', { roomId: room.id, team: 'challenger', points: 50, user: state.currentUser });
    };

    // Render initial audience strip and chat input state
    renderRoomAudienceStrip(state.activeRoomAudience || []);
    updateRoomChatInputState();
  }

  // Swipe Right on #room-chat-messages-container to Hide Public Chat, Swipe Left to Restore
  function setupRoomChatSwipeToggle(modal) {
    const chatContainer = modal.querySelector('#room-chat-messages-container');
    const restorePill = modal.querySelector('#room-chat-restore-pill');
    const roomContainer = modal.querySelector('.live-room-container');
    if (!chatContainer || !roomContainer) return;

    let startX = null;
    let startY = null;

    const setChatHidden = (hidden) => {
      chatContainer.classList.toggle('chat-stream-hidden-right', hidden);
      if (restorePill) {
        restorePill.style.display = hidden ? 'inline-flex' : 'none';
      }
      showToast(hidden ? 'تم إخفاء رسائل العام 👈 اسحب لليسار لإرجاعها' : 'تم إرجاع رسائل الدردشة العامة 💬');
    };

    if (restorePill) {
      restorePill.onclick = () => setChatHidden(false);
    }

    const handleGestureEnd = (endX, endY) => {
      if (startX === null || startY === null) return;
      const dx = endX - startX;
      const dy = endY - startY;
      startX = null;
      startY = null;

      // Require clear horizontal swipe (at least 45px and mostly horizontal)
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const isCurrentlyHidden = chatContainer.classList.contains('chat-stream-hidden-right');
        if (dx > 0 && !isCurrentlyHidden) {
          // Swiped Right -> Hide public chat messages
          setChatHidden(true);
        } else if (dx < 0 && isCurrentlyHidden) {
          // Swiped Left -> Restore public chat messages
          setChatHidden(false);
        }
      }
    };

    roomContainer.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      // Ignore swipes inside horizontal scroll tracks
      if (e.target.closest('#room-audience-list, .host-toolbar-actions')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    roomContainer.addEventListener('touchend', (e) => {
      if (!e.changedTouches || e.changedTouches.length === 0) return;
      handleGestureEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }, { passive: true });

    roomContainer.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, input, #room-audience-list, .host-toolbar-actions')) return;
      startX = e.clientX;
      startY = e.clientY;
    });

    roomContainer.addEventListener('mouseup', (e) => {
      handleGestureEnd(e.clientX, e.clientY);
    });
  }

  // Room Accessories Modal (Opened by clicking the 3-lines button image-2.png)
  // Displays: 1. إطارات الرسالة (Message Frames for .room-chat-bubble)  2. تأثيرات الدخول (Entry Effects)
  const ROOM_CHAT_BUBBLE_FRAMES = [
    { id: '', name: 'الإطار الكلاسيكي (بنفسجي سول)', icon: '💜', desc: 'إطار الرسائل الافتراضي الأنيق', previewClass: '' },
    { id: 'royal_gold', name: 'إطار الإمبراطور الذهبي', icon: '👑', desc: 'إطار ملكي ذهبي متوهج للرسائل', previewClass: 'chat-frame-royal_gold' },
    { id: 'cyber_neon', name: 'إطار النيون السماوي', icon: '⚡', desc: 'إطار نيون مضيء بتدرج أزرق وبنفسجي', previewClass: 'chat-frame-cyber_neon' },
    { id: 'fire_dragon', name: 'إطار لهب التنين', icon: '🔥', desc: 'إطار ناري متوهج يلفت الأنظار في العام', previewClass: 'chat-frame-fire_dragon' },
    { id: 'emerald_vip', name: 'إطار الزمرد الملكي VIP', icon: '🟢', desc: 'إطار زمردي فاخر لأصحاب الثروة العالية', previewClass: 'chat-frame-emerald_vip' },
    { id: 'rose_romance', name: 'إطار الياقوت الوردي', icon: '🌸', desc: 'إطار رومانسي ناعم متألق', previewClass: 'chat-frame-rose_romance' }
  ];

  const ROOM_ENTRY_EFFECTS = [
    {
      id: 'royal_eagle',
      name: 'دخولية الصقر الملكي المتحركة (GIF)',
      gifUrl: '/uploads/royal_eagle.gif',
      crestCode: 'M✪H',
      ribbonText: 'وكالة مملكة الاخوه',
      badge: 'صورة متحركة 🦅',
      primaryGold: '#facc15',
      secondaryAccent: '#10b981'
    },
    {
      id: 'royal_wings_moh',
      name: 'أجنحة وكالة مملكة الأخوة (M✪H)',
      gifUrl: '/uploads/royal_eagle.gif',
      crestCode: 'M✪H',
      ribbonText: 'وكالة مملكة الاخوه',
      badge: 'ملكي 👑',
      primaryGold: '#facc15',
      secondaryAccent: '#10b981'
    },
    {
      id: 'golden_lambo',
      name: 'أجنحة الإمبراطور الذهبية (VIP)',
      crestCode: 'V✪I✪P',
      ribbonText: 'موكب الإمبراطور الذهبي',
      badge: 'VIP 7',
      primaryGold: '#fbbf24',
      secondaryAccent: '#ec4899'
    },
    {
      id: 'royal_dragon',
      name: 'أجنحة تنين المجرة الناري',
      crestCode: 'K✪I✪N✪G',
      ribbonText: 'تنين المجرة الناري',
      badge: 'أسطوري 🔥',
      primaryGold: '#f97316',
      secondaryAccent: '#ef4444'
    },
    {
      id: 'imperial_crown',
      name: 'شعار عرش الملوك المجنح',
      crestCode: 'R✪O✪Y✪L',
      ribbonText: 'مملكة الملوك والأمراء',
      badge: 'الملكي',
      primaryGold: '#fde047',
      secondaryAccent: '#8b5cf6'
    },
    {
      id: 'luxury_yacht',
      name: 'أجنحة يخت السول الماسي',
      crestCode: 'S✪O✪U✪L',
      ribbonText: 'أسطول السول الماسي',
      badge: 'VIP 5',
      primaryGold: '#38bdf8',
      secondaryAccent: '#06b6d4'
    }
  ];

  // Generates the exact Ornate 3D Golden Feathered Wings + M✪H Shield (with animated GIF support) + Crown + "وكالة مملكة الاخوه" Ribbon
  function getOrnateWingedEntryCrestSvg(eff) {
    const item = eff || ROOM_ENTRY_EFFECTS[0];
    const uid = (item.id || 'moh') + '-' + Math.floor(Math.random() * 10000);
    const gemColor = item.secondaryAccent || '#10b981';
    const customGif = localStorage.getItem('soulchill_custom_entry_gif');
    const activeGifUrl = (item.id === 'custom_gif' && customGif) ? customGif : item.gifUrl;

    return `
      <svg viewBox="0 0 300 185" class="ornate-winged-crest-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldWingGrad-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fffbeb"/>
            <stop offset="28%" stop-color="#fde047"/>
            <stop offset="62%" stop-color="#eab308"/>
            <stop offset="88%" stop-color="#b45309"/>
            <stop offset="100%" stop-color="#451a03"/>
          </linearGradient>
          <linearGradient id="goldDarkGrad-${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fde047"/>
            <stop offset="50%" stop-color="#ca8a04"/>
            <stop offset="100%" stop-color="#713f12"/>
          </linearGradient>
          <radialGradient id="shieldCore-${uid}" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stop-color="#2e1d08"/>
            <stop offset="70%" stop-color="#120a02"/>
            <stop offset="100%" stop-color="#050200"/>
          </radialGradient>
          <radialGradient id="goldBackGlow-${uid}" cx="50%" cy="52%" r="48%">
            <stop offset="0%" stop-color="#facc15" stop-opacity="0.55"/>
            <stop offset="65%" stop-color="#a855f7" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
          <clipPath id="shieldGifClip-${uid}">
            <circle cx="150" cy="92" r="35"/>
          </clipPath>
          <filter id="goldDropShadow-${uid}" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.75"/>
          </filter>
        </defs>

        <!-- Ambient Golden & Royal Aura -->
        <ellipse cx="150" cy="95" rx="135" ry="75" fill="url(#goldBackGlow-${uid})" />

        <!-- LEFT ORNATE 3D GOLDEN EAGLE WING -->
        <g class="sc-wing-left" filter="url(#goldDropShadow-${uid})">
          <path d="M115 95 C 75 75, 38 42, 14 14 C 24 38, 48 64, 98 92 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M112 100 C 68 85, 28 58, 8 34 C 22 56, 52 80, 96 98 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M110 105 C 64 96, 25 76, 10 56 C 26 74, 56 92, 96 104 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M110 110 C 68 106, 30 94, 16 78 C 34 92, 62 104, 98 110 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M112 115 C 74 115, 40 108, 26 98 C 44 108, 70 114, 102 116 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M115 120 C 82 124, 54 120, 40 114 C 58 120, 80 122, 106 121 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M118 92 C 88 76, 62 52, 44 30 C 54 52, 74 72, 106 94 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
          <path d="M116 98 C 86 88, 58 70, 42 52 C 56 70, 78 86, 106 100 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
          <path d="M116 104 C 88 98, 62 86, 48 74 C 62 86, 82 96, 108 106 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
        </g>

        <!-- RIGHT ORNATE 3D GOLDEN EAGLE WING (Mirrored) -->
        <g class="sc-wing-right" filter="url(#goldDropShadow-${uid})">
          <path d="M185 95 C 225 75, 262 42, 286 14 C 276 38, 252 64, 202 92 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M188 100 C 232 85, 272 58, 292 34 C 278 56, 248 80, 204 98 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M190 105 C 236 96, 275 76, 290 56 C 274 74, 244 92, 204 104 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M190 110 C 232 106, 270 94, 284 78 C 266 92, 238 104, 202 110 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M188 115 C 226 115, 260 108, 274 98 C 256 108, 230 114, 198 116 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M185 120 C 218 124, 246 120, 260 114 C 242 120, 220 122, 194 121 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="0.8"/>
          <path d="M182 92 C 212 76, 238 52, 256 30 C 246 52, 226 72, 194 94 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
          <path d="M184 98 C 214 88, 242 70, 258 52 C 244 70, 222 86, 194 100 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
          <path d="M184 104 C 212 98, 238 86, 252 74 C 238 86, 218 96, 192 106 Z" fill="url(#goldDarkGrad-${uid})" stroke="#fef08a" stroke-width="0.6"/>
        </g>

        <!-- TOP ROYAL GOLDEN CROWN -->
        <g filter="url(#goldDropShadow-${uid})">
          <path d="M124 48 L132 30 L142 42 L150 24 L158 42 L168 30 L176 48 Z" fill="url(#goldWingGrad-${uid})" stroke="#fef08a" stroke-width="1"/>
          <circle cx="150" cy="22" r="2.8" fill="#ef4444" stroke="#fef08a" stroke-width="0.8"/>
          <circle cx="132" cy="29" r="2.2" fill="${gemColor}" stroke="#fef08a" stroke-width="0.7"/>
          <circle cx="168" cy="29" r="2.2" fill="${gemColor}" stroke="#fef08a" stroke-width="0.7"/>
        </g>

        <!-- CENTRAL ROYAL SHIELD MEDALLION (M✪H + Animated GIF inside Shield) -->
        <g filter="url(#goldDropShadow-${uid})">
          <circle cx="150" cy="92" r="44" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="1.5"/>
          <circle cx="150" cy="92" r="39" fill="none" stroke="#fef08a" stroke-width="1.2" stroke-dasharray="3 2"/>
          <circle cx="150" cy="92" r="36" fill="url(#shieldCore-${uid})" stroke="url(#goldWingGrad-${uid})" stroke-width="2"/>
          ${activeGifUrl ? `
            <image href="${activeGifUrl}" x="114" y="56" width="72" height="72" preserveAspectRatio="xMidYMid slice" clip-path="url(#shieldGifClip-${uid})" />
            <circle cx="150" cy="92" r="35" fill="rgba(0,0,0,0.22)" />
          ` : ''}
          <circle cx="150" cy="92" r="31" fill="none" stroke="rgba(253, 224, 71, 0.55)" stroke-width="1"/>
          <text x="150" y="${activeGifUrl ? '116' : '98'}" text-anchor="middle" fill="url(#goldWingGrad-${uid})" stroke="#1c1004" stroke-width="0.6" font-size="${activeGifUrl ? '15' : '19'}" font-weight="900" font-family="serif" letter-spacing="1.5">${item.crestCode}</text>
        </g>

        <!-- LOWER ORNATE 3D RIBBON BANNER ("وكالة مملكة الاخوه") -->
        <g filter="url(#goldDropShadow-${uid})">
          <circle cx="54" cy="144" r="12" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="1.2"/>
          <circle cx="54" cy="144" r="7.5" fill="${gemColor}" stroke="#fef08a" stroke-width="1"/>
          <circle cx="246" cy="144" r="12" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="1.2"/>
          <circle cx="246" cy="144" r="7.5" fill="${gemColor}" stroke="#fef08a" stroke-width="1"/>

          <path d="M58 132 Q 150 122 242 132 L 248 158 Q 150 148 52 158 Z" fill="url(#goldWingGrad-${uid})" stroke="#78350f" stroke-width="1.4"/>
          <path d="M63 135 Q 150 126 237 135 L 241 154 Q 150 145 59 154 Z" fill="#1c1004" stroke="#fde047" stroke-width="1"/>

          <text x="150" y="149" text-anchor="middle" fill="url(#goldWingGrad-${uid})" font-size="15.5" font-weight="900" font-family="'Cairo', 'Tajawal', sans-serif">${item.ribbonText}</text>
        </g>

        <!-- Floating Golden Sparkles -->
        <circle cx="42" cy="28" r="2.2" fill="#fef08a" opacity="0.9"/>
        <circle cx="258" cy="26" r="2.2" fill="#fef08a" opacity="0.9"/>
        <circle cx="85" cy="22" r="1.6" fill="#fde047" opacity="0.8"/>
        <circle cx="215" cy="22" r="1.6" fill="#fde047" opacity="0.8"/>
        <circle cx="28" cy="122" r="1.8" fill="#fef08a" opacity="0.85"/>
        <circle cx="272" cy="122" r="1.8" fill="#fef08a" opacity="0.85"/>
      </svg>
    `;
  }

  function openRoomAccessoriesModal(room) {
    if (!requireAuth()) return;
    const existing = document.getElementById('room-accessories-modal');
    if (existing) existing.remove();

    let activeAccTab = 'chat_frames'; // 'chat_frames' | 'entry_effects'

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'room-accessories-modal';

    const renderAccContent = () => {
      const bodyEl = modal.querySelector('#accessories-tab-body');
      if (!bodyEl) return;

      if (activeAccTab === 'chat_frames') {
        const selectedFrame = (state.currentUser && state.currentUser.chat_frame) || localStorage.getItem('soulchill_chat_frame') || '';
        bodyEl.innerHTML = `
          <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px; text-align: center;">
            اختر إطار رسالتك ليظهر لجميع المتواجدين في الدردشة العامة داخل الغرفة 💬✨
          </div>
          <div class="accessories-grid">
            ${ROOM_CHAT_BUBBLE_FRAMES.map(f => {
              const isEquipped = selectedFrame === f.id;
              return `
                <div class="accessory-card-item ${isEquipped ? 'equipped' : ''}" data-chat-frame-id="${f.id}">
                  <div class="acc-preview-bubble ${f.previewClass}">
                    <span style="font-size: 16px;">${f.icon}</span>
                    <span style="font-size: 10px; font-weight: 700; color: #fff;">أهلاً بكم ✨</span>
                  </div>
                  <div class="acc-item-title">${f.name}</div>
                  <div class="acc-item-desc">${f.desc}</div>
                  <button type="button" class="acc-equip-btn ${isEquipped ? 'active' : ''}">
                    ${isEquipped ? '✅ مفعل الآن' : 'تفعيل الإطار'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        `;

        bodyEl.querySelectorAll('.accessory-card-item').forEach(card => {
          card.onclick = async () => {
            const frameId = card.dataset.chatFrameId;
            localStorage.setItem('soulchill_chat_frame', frameId);
            if (state.currentUser) {
              state.currentUser.chat_frame = frameId;
              localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
              try {
                await fetch('/api/users/accessories', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': state.currentUser.id
                  },
                  body: JSON.stringify({ chat_frame: frameId })
                });
              } catch (e) {}
            }
            const frameObj = ROOM_CHAT_BUBBLE_FRAMES.find(x => x.id === frameId);
            showToast(`💬 تم تفعيل "${frameObj ? frameObj.name : 'إطار الرسالة'}" لرسائلك في الغرفة! ✨`);
            renderAccContent();
          };
        });
      } else {
        const selectedEntry = (state.currentUser && state.currentUser.entry_effect) || localStorage.getItem('soulchill_entry_effect') || 'royal_eagle';
        bodyEl.innerHTML = `
          <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px; text-align: center;">
            اختر دخوليتك المتحركة (GIF) أو شعار الأجنحة الملكية ليظهر عند دخول الغرفة أو اضغط للتجربة الآن 🦅👑
          </div>
          <div class="accessories-grid">
            ${ROOM_ENTRY_EFFECTS.map(eff => {
              const isEquipped = selectedEntry === eff.id;
              return `
                <div class="accessory-card-item ${isEquipped ? 'equipped' : ''}" data-entry-id="${eff.id}">
                  <div class="acc-entry-badge">${eff.badge}</div>
                  ${eff.id === 'royal_eagle' ? `
                    <div class="acc-gif-preview-card">
                      <img src="${eff.gifUrl}" alt="${eff.name}" class="acc-gif-preview-img" />
                    </div>
                  ` : `
                    <div class="acc-winged-preview-box">${getOrnateWingedEntryCrestSvg(eff)}</div>
                  `}
                  <div class="acc-item-title">${eff.name}</div>
                  <button type="button" class="acc-equip-btn ${isEquipped ? 'active' : ''}">
                    ${isEquipped ? '🚀 مفعل (اضغط للتجربة)' : 'تفعيل وتجربة الدخول'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        `;

        bodyEl.querySelectorAll('.accessory-card-item').forEach(card => {
          card.onclick = async () => {
            const entryId = card.dataset.entryId;
            localStorage.setItem('soulchill_entry_effect', entryId);
            if (state.currentUser) {
              state.currentUser.entry_effect = entryId;
              localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
              try {
                await fetch('/api/users/accessories', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': state.currentUser.id
                  },
                  body: JSON.stringify({ entry_effect: entryId })
                });
              } catch (e) {}
            }
            if (room && room.id && state.socket) {
              state.socket.emit('trigger_entry_effect', {
                roomId: room.id,
                user: state.currentUser,
                effectId: entryId
              });
            } else {
              showRoomEntryEffectBanner(state.currentUser, entryId);
            }
            modal.remove();
          };
        });
      }
    };

    modal.innerHTML = `
      <div class="soul-modal-content accessories-modal-box" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-accessories-modal-btn">✕</button>
        <div class="modal-header-title">
          ✨ إكسسوارات الغرفة الملكية
        </div>

        <div class="accessories-tabs-bar">
          <button type="button" class="acc-tab-btn active" id="tab-btn-chat-frames">
            💬 إطارات الرسالة
          </button>
          <button type="button" class="acc-tab-btn" id="tab-btn-entry-effects">
            🦅 تأثيرات الدخول (GIF)
          </button>
        </div>

        <div id="accessories-tab-body" style="margin-top: 10px;"></div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-accessories-modal-btn').onclick = () => modal.remove();

    const tabChatBtn = modal.querySelector('#tab-btn-chat-frames');
    const tabEntryBtn = modal.querySelector('#tab-btn-entry-effects');

    tabChatBtn.onclick = () => {
      activeAccTab = 'chat_frames';
      tabChatBtn.classList.add('active');
      tabEntryBtn.classList.remove('active');
      renderAccContent();
    };

    tabEntryBtn.onclick = () => {
      activeAccTab = 'entry_effects';
      tabEntryBtn.classList.add('active');
      tabChatBtn.classList.remove('active');
      renderAccContent();
    };

    renderAccContent();
  }

  let entryEffectTimeoutId = null;

  function showRoomEntryEffectBanner(user, effectId) {
    const slot = document.getElementById('room-entry-effect-slot');
    const chatStream = document.getElementById('room-chat-messages-container');
    const eff = ROOM_ENTRY_EFFECTS.find(e => e.id === effectId) || ROOM_ENTRY_EFFECTS[0];
    if (!slot || !user) return;

    if (entryEffectTimeoutId) {
      clearTimeout(entryEffectTimeoutId);
      entryEffectTimeoutId = null;
    }

    const userAvatar = user.avatar || '/avatars/avatar-1.png';
    const userName = user.name || 'عضو ملكي';
    const wealthLevel = user.wealth_level || (user.role === 'owner' ? 99 : 11);
    const userLevel = user.level || 7;
    const gifToPlay = eff.gifUrl || '/uploads/royal_eagle.gif';

    // Remove any previous full-room seamless layer
    const oldSeamlessLayer = document.getElementById('soulchill-seamless-room-entry-layer');
    if (oldSeamlessLayer) oldSeamlessLayer.remove();

    // 1. Frameless Full-Room Seamless Animation Layer (بدون أي قالب أو إطار صندوقي - مدمج مباشرة في خلفية/شاشة قالب الدردشة نفسه)
    const roomContainer = slot.closest('.live-room-container') || document.body;
    const seamlessLayer = document.createElement('div');
    seamlessLayer.id = 'soulchill-seamless-room-entry-layer';
    seamlessLayer.className = 'soulchill-seamless-room-entry-layer';
    seamlessLayer.innerHTML = `
      <img src="${gifToPlay}" alt="${eff.name}" class="seamless-room-entry-gif" />
    `;
    roomContainer.appendChild(seamlessLayer);

    // 2. Frameless Entry Stream Strip inside #room-entry-effect-slot (part of the chat area itself, no card/box frame)
    const strip = document.createElement('div');
    strip.className = 'chat-inline-entry-strip';
    strip.innerHTML = `
      <img src="${gifToPlay}" alt="" class="chat-inline-entry-gif-bg" />
      <div class="chat-inline-entry-content">
        <img src="${userAvatar}" class="chat-inline-entry-avatar" onerror="this.src='/avatars/avatar-1.png'" />
        <span class="room-chat-wealth-pill wealth-tier-gold">
          <span class="wealth-emblem">✪</span>
          <span>Lv.${wealthLevel}</span>
        </span>
        <span class="room-chat-level-pill level-tier-purple">
          <span class="level-triangle">△</span>
          <span>Lv.${userLevel}</span>
        </span>
        <span class="chat-inline-entry-name">${userName}</span>
        <span class="chat-inline-entry-verb">دخل الغرفة ✨</span>
      </div>
    `;
    slot.innerHTML = '';
    slot.appendChild(strip);

    // 3. Also append directly inside #room-chat-messages-container (من ضمن قالب الدردشة نفسه) as an inline chat message with the animated GIF blended into the chat bubble
    if (chatStream) {
      const chatEntryEl = document.createElement('div');
      chatEntryEl.className = 'room-chat-bubble chat-entry-gif-bubble';
      chatEntryEl.innerHTML = `
        <img src="${gifToPlay}" alt="" class="chat-bubble-embedded-gif" />
        <div class="room-chat-card-inner" style="position: relative; z-index: 2;">
          <div class="room-chat-header-row">
            <img src="${userAvatar}" class="room-chat-avatar" onerror="this.src='/avatars/avatar-1.png'" />
            <span class="room-chat-sender-name">${userName}</span>
            <span class="room-chat-wealth-pill wealth-tier-gold">
              <span class="wealth-emblem">✪</span>
              <span>Lv.${wealthLevel}</span>
            </span>
            <span class="room-chat-level-pill level-tier-purple">
              <span class="level-triangle">△</span>
              <span>Lv.${userLevel}</span>
            </span>
          </div>
          <div class="room-chat-text" style="color: #fde047; font-weight: 800;">
            🦅 دخل إلى الغرفة (${eff.name}) ✨
          </div>
        </div>
      `;
      chatStream.appendChild(chatEntryEl);
      chatStream.scrollTop = chatStream.scrollHeight;
    }

    entryEffectTimeoutId = setTimeout(() => {
      seamlessLayer.classList.add('fade-out');
      strip.classList.add('fade-out');
      setTimeout(() => {
        if (seamlessLayer.parentElement) seamlessLayer.remove();
        if (strip.parentElement) strip.remove();
      }, 450);
    }, 5200);
  }

  async function loadRoomChatMessages(roomId) {
    if (!state.currentUser) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`);
      const messages = await res.json();
      messages.forEach(msg => appendRoomChatMessage(msg));
    } catch (err) {
      console.error('Error fetching room messages:', err);
    }
  }

  function appendRoomChatMessage(msg) {
    if (!state.currentUser) return;
    const stream = document.getElementById('room-chat-messages-container');
    if (!stream) return;

    const el = document.createElement('div');

    // Determine equipped chat bubble frame
    let chatFrame = msg.sender_chat_frame || '';
    if (!chatFrame && state.currentUser && msg.sender_id === state.currentUser.id) {
      chatFrame = state.currentUser.chat_frame || localStorage.getItem('soulchill_chat_frame') || '';
    }
    const frameClass = chatFrame ? `chat-frame-${chatFrame}` : '';

    el.className = `room-chat-bubble ${msg.message_type === 'gift' ? 'gift-notice' : ''} ${frameClass}`.trim();

    // Calculate Wealth Level (الثروة) and User Level (الليفيل) matching image-3.png
    const isSelf = state.currentUser && msg.sender_id === state.currentUser.id;
    const wealthLevel = msg.sender_wealth_level || (isSelf ? state.currentUser.wealth_level : null) || (msg.sender_role === 'owner' ? 99 : 11);
    const userLevel = msg.sender_level || (isSelf ? state.currentUser.level : null) || 7;

    // Wealth badge color tier based on wealth_level
    let wealthTierClass = 'wealth-tier-green';
    if (wealthLevel >= 50) wealthTierClass = 'wealth-tier-imperial';
    else if (wealthLevel >= 25) wealthTierClass = 'wealth-tier-gold';
    else if (wealthLevel >= 15) wealthTierClass = 'wealth-tier-cyan';

    // Level badge color tier based on level
    let levelTierClass = 'level-tier-purple';
    if (userLevel >= 50) levelTierClass = 'level-tier-royal';
    else if (userLevel >= 20) levelTierClass = 'level-tier-magenta';

    // Format @mentions in warm gold like image-3.png ("أهلاً، @mratab")
    const safeContent = String(msg.content || '').replace(/(@[\w\u0600-\u06FF._-]+)/g, '<span class="chat-mention-highlight">$1</span>');

    el.innerHTML = `
      <div class="room-chat-card-inner">
        <!-- Top Header Row (RTL: Avatar -> Name + Clan Tag -> Medals -> Gold Host Icon -> Green Wealth Level Pill) -->
        <div class="room-chat-header-row">
          <img src="${msg.sender_avatar}" class="room-chat-avatar ${msg.sender_frame ? 'avatar-frame-' + msg.sender_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
          <span class="room-chat-sender-name">${msg.sender_name || 'عضو'}</span>
          <span class="room-chat-clan-badges">
            <span class="clan-crown-emoji">👑</span>
            <span class="clan-square-char">S</span>
            <span class="clan-square-char">R</span>
            <span class="clan-heart-wing">❥</span>
          </span>
          <span class="room-chat-medals-capsule">
            <span class="mini-medal blue">🛡️</span>
            <span class="mini-medal green">🏛️</span>
          </span>
          <span class="room-chat-gold-seat-badge">👤</span>
          <span class="room-chat-wealth-pill ${wealthTierClass}">
            <span class="wealth-emblem">✪</span>
            <span>Lv.${wealthLevel}</span>
          </span>
        </div>

        <!-- Second Row: Purple Level Badge (△ Lv.7) -->
        <div class="room-chat-sublevel-row">
          <span class="room-chat-level-pill ${levelTierClass}">
            <span class="level-triangle">△</span>
            <span>Lv.${userLevel}</span>
          </span>
        </div>

        <!-- Third Row: Message Text -->
        <div class="room-chat-text">${safeContent}</div>
      </div>
    `;

    // Clicking sender avatar/name mentions @username in input
    const avatarEl = el.querySelector('.room-chat-avatar');
    if (avatarEl && msg.sender_name) {
      avatarEl.style.cursor = 'pointer';
      avatarEl.onclick = () => {
        const inputEl = document.getElementById('room-chat-text-input');
        if (inputEl && !inputEl.disabled) {
          inputEl.value = `أهلاً، @${msg.sender_name.split(' ')[0]} `;
          inputEl.focus();
        }
      };
    }

    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  // Handle Stage Seat Click
  function handleSeatClick(seatIndex) {
    if (!requireAuth()) return;
    if (!state.activeRoom) return;

    const currentRoom = state.activeRoom;
    const isRoomAdmin = state.currentUser && (currentRoom.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    const seat = (currentRoom.seats || []).find(s => s.seat_index === seatIndex);
    const isOccupied = seat && seat.user_id;

    // Special handling for Seat 0 (Host Central Throne)
    if (seatIndex === 0) {
      if (state.userSeatIndex === 0) {
        // Current user is occupying seat 0 -> Show menu with mic mute/unmute and step down option!
        showOwnSeatMenu(0);
        return;
      }
      if (isOccupied) {
        if (isRoomAdmin) {
          showAdminSeatModerationModal(0, seat);
        } else {
          showUserProfileCard({
            id: seat.user_id,
            name: seat.name,
            avatar: seat.avatar,
            avatar_frame: seat.avatar_frame,
            level: seat.level || 10,
            wealth_level: 5,
            charm_level: 6,
            soul_planet: 'كوكب صاحب الروم 👑'
          });
        }
        return;
      }
      // Seat 0 is EMPTY: only room host / owner can sit on seat 0
      if (isRoomAdmin) {
        takeSeatAction(0);
        showToast('صعدت إلى مقعد المضيف على المايك! 👑🎙️');
      } else {
        showToast('هذا المقعد مخصص لصاحب الغرفة (المضيف) فقط 👑');
      }
      return;
    }

    // Case 1: Current user clicks their own seat -> Show personal mic / leave seat controls
    if (state.userSeatIndex === seatIndex) {
      showOwnSeatMenu(seatIndex);
      return;
    }

    // Case 2: Seat is occupied by another user
    if (isOccupied) {
      if (isRoomAdmin) {
        showAdminSeatModerationModal(seatIndex, seat);
      } else {
        showUserProfileCard({
          id: seat.user_id,
          name: seat.name,
          avatar: seat.avatar,
          avatar_frame: seat.avatar_frame,
          level: seat.level || 6,
          wealth_level: 4,
          charm_level: seat.charm_level || 5,
          soul_planet: 'كوكب السول 🌟'
        });
      }
      return;
    }

    // Case 3: Empty Seat that is locked
    if (seat && seat.is_locked) {
      if (isRoomAdmin) {
        const unlock = confirm(`المقعد رقم ${seatIndex} مقفل حالياً. هل ترغب بفتحه للجمهور؟`);
        if (unlock) {
          state.socket.emit('admin_lock_seat', {
            roomId: currentRoom.id,
            seatIndex,
            adminId: state.currentUser.id,
            isLocked: false
          });
          seat.is_locked = 0;
          updateRoomSeatUI(seatIndex, null, false);
          showToast(`تم فتح المقعد رقم ${seatIndex} للجميع! 🔓`);
        }
      } else {
        showToast('هذا المقعد مقفل من قِبل إدارة الروم 🔒');
      }
      return;
    }

    // Case 4: User is ALREADY in another seat (e.g. seat 1) and clicks an empty seat (e.g. seat 2)
    // Moving to new seat automatically vacates their previous seat (only ONE seat per user)
    if (state.userSeatIndex !== null && state.userSeatIndex !== seatIndex) {
      if (state.userSeatIndex === 0) {
        // Host sitting on central throne (seat 0)
        if (isRoomAdmin) {
          showEmptySeatAdminModal(seatIndex);
          return;
        }
      }
      const prevSeat = state.userSeatIndex;
      takeSeatAction(seatIndex);
      showToast(`انتقلت من المقعد #${prevSeat} إلى المقعد #${seatIndex} 🎙️`);
      return;
    }

    // Case 5: If admin clicks empty seat, offer to take or lock
    if (isRoomAdmin) {
      showEmptySeatAdminModal(seatIndex);
      return;
    }

    // Case 6: Regular user takes empty seat
    takeSeatAction(seatIndex);
  }

  function takeSeatAction(seatIndex) {
    if (!state.activeRoom || !state.currentUser) return;
    state.socket.emit('take_seat', {
      roomId: state.activeRoom.id,
      seatIndex,
      userId: state.currentUser.id
    });
    state.userSeatIndex = seatIndex;
    state.isMuted = false;
    startLocalMicCapture();
    if (window.soulRtc && state.activeRoom) {
      window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
      window.soulRtc.setVoiceMuted(false);
    }
    updateMicButtonUI();
    showToast(`صعدت إلى المقعد رقم ${seatIndex} على المايك! 🎙️`);
  }

  function showOwnSeatMenu(seatIndex) {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 12px;">🎙️ إدارة مقعدك الحالي (#${seatIndex})</div>
        <button class="seat-admin-action-btn" id="btn-toggle-own-mic">
          <span>${state.isMuted ? '🎙️ إلغاء كتم المايك وتحدث' : '🔇 كتم صوت المايك'}</span>
        </button>
        <button class="seat-admin-action-btn danger" id="btn-leave-own-seat">
          <span>🪑 النزول من مقعد المايك إلى الجمهور</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-close-own-menu" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-toggle-own-mic').onclick = () => {
      toggleUserMic();
      modal.remove();
    };
    modal.querySelector('#btn-leave-own-seat').onclick = () => {
      state.socket.emit('leave_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        userId: state.currentUser.id
      });
      state.userSeatIndex = null;
      state.isMuted = true;
      stopLocalMicCapture();
      if (window.soulRtc) {
        window.soulRtc.stopBroadcastingVoice();
      }
      updateMicButtonUI();
      modal.remove();
      showToast('نزلت من مقعد المايك إلى الجمهور 👥');
    };
    modal.querySelector('#btn-close-own-menu').onclick = () => modal.remove();
  }

  function showAdminSeatModerationModal(seatIndex, seat) {
    const isMuted = !!seat.is_muted;
    const isChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(seat.user_id);
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px; text-align: right;">
          <img src="${seat.avatar}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--primary);" />
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #fff;">${seat.name}</div>
            <div style="font-size: 11px; color: #fbbf24;">مقعد المايك #${seatIndex}</div>
          </div>
        </div>

        <button class="seat-admin-action-btn" id="admin-mute-seat-btn">
          <span>${isMuted ? '🎙️ إلغاء كتم مايك هذا العضو' : '🔇 كتم مايك هذا العضو إجبارياً'}</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-toggle-chat-mute-seat-btn" style="background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.4); color: #fbbf24;">
          <span>${isChatMuted ? '🔊 إلغاء كتم العضو من الكتابة' : '🔇 كتم العضو من الكتابة ع العام'}</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-kick-seat-btn">
          <span>🪑 إنزال العضو من المايك إلى الجمهور</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-lock-occupied-seat-btn" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5;">
          <span>🔒 إنزال العضو وقفل هذا المقعد</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-kick-room-seat-btn">
          <span>🚪 طرد العضو من الغرفة نهائياً</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-gift-seat-btn">
          <span>🎁 إرسال هدية فاخرة لهذا المقعد</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-profile-seat-btn">
          <span>👤 عرض البروفايل الكامل والبيو</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-cancel-btn" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إغلاق</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#admin-mute-seat-btn').onclick = () => {
      const willMute = !isMuted;
      state.socket.emit('admin_mute_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isMuted: willMute
      });
      seat.is_muted = willMute ? 1 : 0;
      updateSeatMuteUI(seatIndex, willMute);
      if (seat.user_id && window.soulRtc) {
        window.soulRtc.silenceRemoteUser(seat.user_id, willMute);
      }
      showToast(willMute ? `تم كتم صوت المايك للمقعد ${seatIndex}! 🔇` : `تم فتح صوت المايك للمقعد ${seatIndex}! 🎙️`);
      modal.remove();
    };

    modal.querySelector('#admin-toggle-chat-mute-seat-btn').onclick = () => {
      const willMute = !isChatMuted;
      state.socket.emit('admin_mute_user_chat', {
        roomId: state.activeRoom.id,
        targetUserId: seat.user_id,
        adminId: state.currentUser.id,
        isMuted: willMute
      });
      if (willMute) {
        state.activeRoomMutedChatUsers.add(seat.user_id);
        showToast(`تم كتم ${seat.name} من الكتابة ع العام! 🔇`);
      } else {
        state.activeRoomMutedChatUsers.delete(seat.user_id);
        showToast(`تم إلغاء كتم الكتابة عن ${seat.name}! 🔊`);
      }
      renderRoomAudienceStrip(state.activeRoomAudience);
      modal.remove();
    };

    modal.querySelector('#admin-kick-seat-btn').onclick = () => {
      const kickedUserId = seat.user_id;
      state.socket.emit('admin_kick_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id
      });
      seat.user_id = null;
      updateRoomSeatUI(seatIndex, null, false);
      if (kickedUserId && window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(kickedUserId);
      }
      showToast(`تم إنزال العضو من المقعد رقم ${seatIndex} بنجاح! 🪑`);
      modal.remove();
    };

    modal.querySelector('#admin-lock-occupied-seat-btn').onclick = () => {
      const kickedUserId = seat.user_id;
      state.socket.emit('admin_lock_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isLocked: true
      });
      seat.user_id = null;
      seat.is_locked = 1;
      updateRoomSeatUI(seatIndex, null, false);
      if (kickedUserId && window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(kickedUserId);
      }
      showToast(`تم إنزال العضو وقفل المقعد رقم ${seatIndex} بنجاح! 🔒`);
      modal.remove();
    };

    modal.querySelector('#admin-kick-room-seat-btn').onclick = () => {
      if (confirm(`هل أنت متأكد من طرد [${seat.name}] من الغرفة نهائياً؟ 🚪`)) {
        state.socket.emit('admin_kick_user_from_room', {
          roomId: state.activeRoom.id,
          targetUserId: seat.user_id,
          adminId: state.currentUser.id
        });
        modal.remove();
      }
    };

    modal.querySelector('#admin-gift-seat-btn').onclick = () => {
      modal.remove();
      openGiftStoreModal(seat.user_id, state.activeRoom.id, { name: seat.name });
    };

    modal.querySelector('#admin-profile-seat-btn').onclick = () => {
      modal.remove();
      showUserProfileCard({
        id: seat.user_id,
        name: seat.name,
        avatar: seat.avatar,
        avatar_frame: seat.avatar_frame,
        level: 6,
        wealth_level: 4,
        charm_level: 5,
        soul_planet: 'كوكب السول 🌟'
      });
    };

    modal.querySelector('#admin-cancel-btn').onclick = () => modal.remove();
  }

  function showEmptySeatAdminModal(seatIndex) {
    const seat = (state.activeRoom?.seats || []).find(s => s.seat_index === seatIndex);
    const isLocked = seat ? !!seat.is_locked : false;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 12px;">🪑 إدارة المقعد رقم #${seatIndex}</div>
        <button class="seat-admin-action-btn" id="btn-admin-take-seat">
          <span>🎙️ الصعود إلى هذا المقعد وتفعيل المايك</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-admin-lock-this-seat">
          <span>${isLocked ? '🔓 فتح المقعد للجمهور' : '🔒 قفل المقعد (منع أي شخص من الصعود)'}</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-close-empty-menu" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-admin-take-seat').onclick = () => {
      modal.remove();
      takeSeatAction(seatIndex);
    };

    modal.querySelector('#btn-admin-lock-this-seat').onclick = () => {
      const newLockState = !isLocked;
      state.socket.emit('admin_lock_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isLocked: newLockState
      });
      if (seat) seat.is_locked = newLockState ? 1 : 0;
      updateRoomSeatUI(seatIndex, null, false);
      showToast(newLockState ? `تم قفل المقعد رقم ${seatIndex} بنجاح! 🔒` : `تم فتح المقعد رقم ${seatIndex} للجمهور! 🔓`);
      modal.remove();
    };

    modal.querySelector('#btn-close-empty-menu').onclick = () => modal.remove();
  }

  function updateRoomSeatUI(seatIndex, user, isMuted) {
    // 1. Sync state.activeRoom.seats in memory
    let prevUserId = null;
    if (state.activeRoom) {
      if (!state.activeRoom.seats) state.activeRoom.seats = [];
      let seatObj = state.activeRoom.seats.find(s => s.seat_index === seatIndex);
      if (seatObj) {
        prevUserId = seatObj.user_id;
        seatObj.user_id = user ? user.id : null;
        seatObj.name = user ? user.name : null;
        seatObj.avatar = user ? user.avatar : null;
        seatObj.avatar_frame = user ? user.avatar_frame : null;
        seatObj.is_muted = isMuted ? 1 : 0;
      } else {
        state.activeRoom.seats.push({
          seat_index: seatIndex,
          user_id: user ? user.id : null,
          name: user ? user.name : null,
          avatar: user ? user.avatar : null,
          avatar_frame: user ? user.avatar_frame : null,
          is_muted: isMuted ? 1 : 0,
          is_locked: 0
        });
      }
    }

    // 2. Track whether this affected current user's seat status
    if (state.currentUser) {
      if (user && user.id === state.currentUser.id) {
        state.userSeatIndex = seatIndex;
        updateMicButtonUI();
      } else if (!user && state.userSeatIndex === seatIndex) {
        // Current user was removed or vacated this seat
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
      }
    }

    // If another user was vacated, clean up their remote audio on this client
    if (!user && prevUserId && (!state.currentUser || prevUserId !== state.currentUser.id)) {
      if (window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(prevUserId);
      }
    }

    // 3. Update the DOM
    if (seatIndex === 0) {
      const hostEl = document.getElementById('host-seat-0');
      if (hostEl) {
        if (user) {
          hostEl.classList.add('occupied');
          hostEl.classList.remove('empty');
          hostEl.innerHTML = `
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box">
              <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
              <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${isMuted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>
            </div>
            <div class="host-name-label">${user.name}</div>
          `;
        } else {
          hostEl.classList.remove('occupied');
          hostEl.classList.add('empty');
          hostEl.innerHTML = `
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box empty-host-seat" style="border: 2px dashed rgba(251, 191, 36, 0.6); background: rgba(251, 191, 36, 0.08); display: flex; align-items: center; justify-content: center;">
              <span class="seat-empty-plus" style="font-size: 26px; color: #fbbf24; font-weight: 800;">+</span>
              <div class="seat-mic-status unmuted" id="host-mic-badge" style="display: none; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>
            </div>
            <div class="host-name-label" style="color: #fbbf24;">مقعد المضيف (فارغ)</div>
          `;
        }
      }
      return;
    }

    const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
    if (!seatEl) return;

    if (user) {
      seatEl.classList.add('occupied');
      seatEl.classList.remove('locked');
      seatEl.innerHTML = `
        <div class="seat-avatar-container">
          <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
          <div class="seat-number-badge">${seatIndex}</div>
          <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" style="display: ${isMuted ? 'flex' : 'none'};">🔇</div>
        </div>
        <div class="seat-user-name">${user.name}</div>
      `;
    } else {
      seatEl.classList.remove('occupied');
      const isLocked = state.activeRoom && (state.activeRoom.seats || []).find(s => s.seat_index === seatIndex)?.is_locked;
      seatEl.classList.toggle('locked', !!isLocked);
      seatEl.innerHTML = `
        <div class="seat-avatar-container">
          <span class="seat-empty-plus">${isLocked ? '🔒' : '+'}</span>
          <div class="seat-number-badge">${seatIndex}</div>
        </div>
        <div class="seat-user-name">${isLocked ? 'مقعد مقفل' : 'مقعد فارغ'}</div>
      `;
    }
  }

  function updateSeatMuteUI(seatIndex, isMuted) {
    if (seatIndex === 0) {
      const hostBadge = document.getElementById('host-mic-badge');
      if (hostBadge) {
        hostBadge.className = `seat-mic-status ${isMuted ? 'muted' : 'unmuted'}`;
        hostBadge.style.display = isMuted ? 'flex' : 'none';
        hostBadge.innerText = '🔇';
      }
      return;
    }
    const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
    if (!seatEl) return;
    const micStatus = seatEl.querySelector('.seat-mic-status');
    if (micStatus) {
      micStatus.className = `seat-mic-status ${isMuted ? 'muted' : 'unmuted'}`;
      micStatus.style.display = isMuted ? 'flex' : 'none';
      micStatus.innerText = '🔇';
    }
  }

  function toggleSpeakerSoundWaveUI(userId, isSpeaking) {
    // If speaking, add .speaking class to their seat
    if (!state.activeRoom) return;

    // Check host seat 0
    const hostSeat = (state.activeRoom.seats || []).find(s => s.seat_index === 0);
    const hostEl = document.getElementById('host-seat-0');
    if (hostEl && hostSeat && hostSeat.user_id === userId) {
      hostEl.classList.toggle('speaking', isSpeaking);
    }

    // Check 8 guest seats
    (state.activeRoom.seats || []).forEach(seat => {
      if (seat.seat_index !== 0 && seat.user_id === userId) {
        const seatEl = document.getElementById(`stage-seat-${seat.seat_index}`);
        if (seatEl) {
          seatEl.classList.toggle('speaking', isSpeaking);
        }
      }
    });
  }

  // Real Microphone Capture & Sound Wave Analyser
  async function startLocalMicCapture() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported in this browser context');
        return;
      }

      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioCtx();
      const source = state.audioContext.createMediaStreamSource(state.localStream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
      source.connect(state.analyser);

      const bufferLength = state.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let wasSpeaking = false;
      state.micLevelInterval = setInterval(() => {
        if (state.isMuted || !state.analyser) {
          if (wasSpeaking) {
            wasSpeaking = false;
            broadcastSpeakingStatus(false, 0);
          }
          return;
        }

        state.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const isSpeaking = avg > 20; // threshold

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          broadcastSpeakingStatus(isSpeaking, avg / 255);
        }
      }, 150);
    } catch (err) {
      console.log('Mic permission not granted or available, running in virtual mic mode:', err.message);
    }
  }

  function broadcastSpeakingStatus(isSpeaking, volume) {
    if (!state.activeRoom || !state.currentUser) return;
    state.socket.emit('mic_speaking', {
      roomId: state.activeRoom.id,
      userId: state.currentUser.id,
      isSpeaking,
      volume
    });
    toggleSpeakerSoundWaveUI(state.currentUser.id, isSpeaking);
  }

  function stopLocalMicCapture() {
    if (state.micLevelInterval) {
      clearInterval(state.micLevelInterval);
      state.micLevelInterval = null;
    }
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => {
        try {
          t.enabled = false;
          t.stop();
        } catch (e) {}
      });
      state.localStream = null;
    }
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (e) {}
      state.audioContext = null;
      state.analyser = null;
    }
    broadcastSpeakingStatus(false, 0);
  }

  function toggleUserMic() {
    if (state.userSeatIndex === null) {
      showToast('يجب أن تصعد إلى مقعد المايك أولاً للتحدث! 🎙️');
      return;
    }

    const currentSeat = (state.activeRoom?.seats || []).find(s => s.seat_index === state.userSeatIndex);
    const isRoomAdmin = state.currentUser && state.activeRoom && (state.activeRoom.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    if (state.isMuted && currentSeat && currentSeat.is_muted && !isRoomAdmin) {
      showToast('⚠️ لقد تم كتم المايك الخاص بك من قِبل إدارة الروم، لا يمكنك التحدث!');
      return;
    }

    state.isMuted = !state.isMuted;
    if (!state.isMuted) {
      startLocalMicCapture();
      if (window.soulRtc && state.activeRoom) {
        if (!window.soulRtc.isBroadcastingVoice) {
          window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
        }
        window.soulRtc.setVoiceMuted(false);
      }
    } else {
      stopLocalMicCapture();
      if (window.soulRtc) {
        window.soulRtc.setVoiceMuted(true);
      }
    }

    state.socket.emit('toggle_mute', {
      roomId: state.activeRoom.id,
      seatIndex: state.userSeatIndex,
      isMuted: state.isMuted
    });
    updateMicButtonUI();

    if (state.userSeatIndex !== null && state.userSeatIndex !== undefined) {
      updateSeatMuteUI(state.userSeatIndex, state.isMuted);
    }

    showToast(state.isMuted ? 'تم كتم المايكروفون 🔇' : 'المايكروفون مفعل الآن والصوت يتدفق لجميع الحضور عبر WebRTC 🎙️✨');
  }

  function updateMicButtonUI() {
    const btn = document.getElementById('room-mic-toggle-btn');
    const isSittingOnMic = state.userSeatIndex !== null && state.userSeatIndex !== undefined;
    if (btn) {
      btn.style.display = isSittingOnMic ? 'flex' : 'none';
      const active = isSittingOnMic && !state.isMuted;
      btn.className = `room-tool-btn mic-btn ${active ? 'active' : ''}`;
      btn.innerText = active ? '🎙️' : '🔇';
    }
    updateRoomMicEmojiButtonState();
  }

  function leaveActiveVoiceRoom() {
    if (window.soulRtc) {
      window.soulRtc.leaveCurrentRoom();
    }
    if (state.activeRoom) {
      if (state.userSeatIndex !== null && state.currentUser) {
        state.socket.emit('leave_seat', {
          roomId: state.activeRoom.id,
          seatIndex: state.userSeatIndex,
          userId: state.currentUser.id
        });
      }
      state.socket.emit('leave_room', {
        roomId: state.activeRoom.id,
        userId: state.currentUser ? state.currentUser.id : null
      });
    }
    stopLocalMicCapture();
    state.activeRoom = null;
    state.userSeatIndex = null;
    state.isMuted = true;
    state.activeRoomAudience = [];
    state.activeRoomMutedChatUsers = new Set();
    state.isChatMuted = false;
    const modal = document.getElementById('live-voice-room-modal');
    if (modal) modal.remove();
  }

  // Audience & Public Chat Moderation Helpers
  function updateRoomChatInputState() {
    const chatInput = document.getElementById('room-chat-text-input');
    const sendBtn = document.getElementById('room-send-chat-btn');
    if (!chatInput) return;

    if (state.isChatMuted) {
      chatInput.disabled = true;
      chatInput.placeholder = 'تم كتمك من الكتابة في الدردشة العامة من قِبل إدارة الغرفة 🔇';
      if (sendBtn) sendBtn.disabled = true;
    } else {
      chatInput.disabled = false;
      chatInput.placeholder = 'اكتب رسالة في الروم...';
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function renderRoomAudienceStrip(audience) {
    state.activeRoomAudience = audience || [];
    const container = document.getElementById('room-audience-list');
    const badge = document.getElementById('room-audience-badge');
    const headerCounter = document.getElementById('live-audience-counter');

    const totalCount = state.activeRoomAudience.length;
    if (badge) badge.innerText = totalCount.toString();
    if (headerCounter) headerCounter.innerText = totalCount > 0 ? totalCount.toString() : '1';

    if (!container) return;

    if (!audience || audience.length === 0) {
      container.innerHTML = `
        <div class="audience-empty-hint">لا يوجد زوار حالياً 🌟</div>
      `;
      return;
    }

    const hostId = state.activeRoom ? state.activeRoom.host_id : null;

    container.innerHTML = audience.map(v => {
      const isHost = v.id === hostId || v.role === 'owner';
      const isChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(v.id);
      return `
        <div class="audience-strip-item ${isHost ? 'is-host' : ''}" data-user-id="${v.id}" title="${v.name} (Lv.${v.level || 1})">
          <div class="audience-strip-avatar-box">
            <img src="${v.avatar}" class="${v.avatar_frame ? 'avatar-frame-' + v.avatar_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
            ${isHost ? '<span class="audience-host-badge">👑</span>' : ''}
            ${isChatMuted ? '<span class="audience-muted-dot">🔇</span>' : ''}
          </div>
          <span class="audience-strip-name">${v.name}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.audience-strip-item').forEach(item => {
      item.onclick = () => {
        const uId = item.dataset.userId;
        const visitor = state.activeRoomAudience.find(u => u.id === uId);
        if (visitor) {
          showAudienceMemberModal(visitor);
        }
      };
    });
  }

  function showAudienceMemberModal(visitor) {
    if (!visitor) return;
    const isRoomAdmin = state.currentUser && (state.activeRoom?.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    const isTargetSelf = state.currentUser && state.currentUser.id === visitor.id;
    const isTargetHost = state.activeRoom && state.activeRoom.host_id === visitor.id;
    const isTargetChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(visitor.id);

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box" style="max-width: 340px; text-align: center;">
        <div style="position: relative; width: 72px; height: 72px; margin: 0 auto 10px;">
          <img src="${visitor.avatar}" class="${visitor.avatar_frame ? 'avatar-frame-' + visitor.avatar_frame : ''}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />
          ${isTargetHost ? '<span style="position: absolute; top: -8px; right: -4px; font-size: 20px;">👑</span>' : ''}
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 2px;">${visitor.name}</div>
        <div style="font-size: 11px; color: #fbbf24; margin-bottom: 6px;">${visitor.soul_planet || 'كوكب السول 🪐'} • Lv.${visitor.level || 1}</div>
        <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.4;">${visitor.bio || 'مستمع متفاعل في غرفة السول 🎧'}</p>

        <!-- Visitor's Received Gifts Wall ("هداياه") -->
        <div class="user-received-gifts-box" data-user-id="${visitor.id}" id="audience-visitor-gifts-box">
          <div style="font-size: 10px; color: var(--text-muted); padding: 4px;">جارِ تحميل الهدايا... 🎁</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          ${!isTargetSelf ? `
            <button class="seat-admin-action-btn" id="btn-audience-send-gift" style="background: linear-gradient(135deg, rgba(236,72,153,0.2), rgba(139,92,246,0.2)); border: 1px solid rgba(236,72,153,0.4);">
              <span>🎁 إرسال هدية فاخرة لهذا الزائر</span>
            </button>
            <button class="seat-admin-action-btn" id="btn-audience-private-chat">
              <span>💬 بدء محادثة خاصة (شات)</span>
            </button>
          ` : ''}

          ${isRoomAdmin && !isTargetSelf && !isTargetHost ? `
            <!-- Room Creator / Admin Powers -->
            <button class="seat-admin-action-btn" id="btn-audience-toggle-chat-mute" style="background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.4); color: #fbbf24;">
              <span>${isTargetChatMuted ? '🔊 إلغاء كتم الزائر من الكتابة العامة' : '🔇 كتم الزائر من الكتابة ع العام'}</span>
            </button>
            <button class="seat-admin-action-btn danger" id="btn-audience-kick-room">
              <span>🚪 طرد الزائر من الغرفة نهائياً</span>
            </button>
          ` : ''}

          <button class="seat-admin-action-btn" id="btn-close-audience-modal" style="background: transparent; border: none; color: var(--text-muted); justify-content: center; margin-top: 4px;">إغلاق</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const visitorGiftsBox = modal.querySelector('#audience-visitor-gifts-box');
    if (visitorGiftsBox && visitor.id) {
      loadAndRenderUserGiftsSection(visitor.id, visitorGiftsBox, isTargetSelf);
    }

    modal.querySelector('#btn-close-audience-modal').onclick = () => modal.remove();

    if (!isTargetSelf) {
      modal.querySelector('#btn-audience-send-gift').onclick = () => {
        modal.remove();
        openGiftStoreModal(visitor.id, state.activeRoom.id, visitor);
      };
      modal.querySelector('#btn-audience-private-chat').onclick = () => {
        modal.remove();
        leaveActiveVoiceRoom();
        startPrivateChatWithUser(visitor);
      };
    }

    if (isRoomAdmin && !isTargetSelf && !isTargetHost) {
      // Toggle Chat Mute
      modal.querySelector('#btn-audience-toggle-chat-mute').onclick = () => {
        const willMute = !isTargetChatMuted;
        state.socket.emit('admin_mute_user_chat', {
          roomId: state.activeRoom.id,
          targetUserId: visitor.id,
          adminId: state.currentUser.id,
          isMuted: willMute
        });
        if (willMute) {
          state.activeRoomMutedChatUsers.add(visitor.id);
          showToast(`تم كتم ${visitor.name} من الكتابة ع العام! 🔇`);
        } else {
          state.activeRoomMutedChatUsers.delete(visitor.id);
          showToast(`تم إلغاء كتم الكتابة عن ${visitor.name}! 🔊`);
        }
        renderRoomAudienceStrip(state.activeRoomAudience);
        modal.remove();
      };

      // Kick from room
      modal.querySelector('#btn-audience-kick-room').onclick = () => {
        if (confirm(`هل أنت متأكد من طرد الزائر [${visitor.name}] من الغرفة نهائياً؟ 🚪`)) {
          state.socket.emit('admin_kick_user_from_room', {
            roomId: state.activeRoom.id,
            targetUserId: visitor.id,
            adminId: state.currentUser.id
          });
          modal.remove();
        }
      };
    }
  }

  // Room Games Modal: Dice, Wheel, PK Battle
  function showRoomGamesSelectorModal(room) {
    if (!requireAuth()) return;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'room-games-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-games-btn">✕</button>
        <div class="modal-header-title">🎲 ألعاب ومسابقات الروم الحماسية</div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
          <!-- Game 1: Lucky Dice -->
          <button class="google-account-option" id="btn-roll-dice" style="padding: 12px;">
            <div style="font-size: 28px;">🎲</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">رمي النرد التفاعلي (Lucky Dice)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">ارمي النرد بحركة 3D لجميع أعضاء الروم</div>
            </div>
          </button>

          <!-- Game 2: Lucky Wheel -->
          <button class="google-account-option" id="btn-spin-wheel" style="padding: 12px;">
            <div style="font-size: 28px;">🎡</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">عجلة الحظ والجوائز (Spin Wheel)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">جوائز وتحديات فورية ومكافآت كوينز</div>
            </div>
          </button>

          <!-- Game 3: PK Battle -->
          <button class="google-account-option" id="btn-start-pk" style="padding: 12px;">
            <div style="font-size: 28px;">🔥</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">تحدي الـ PK الناري (PK Battle)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">معركة دعم نارية بين المضيف والمنافسين</div>
            </div>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-games-btn').onclick = () => modal.remove();

    // Roll Dice
    modal.querySelector('#btn-roll-dice').onclick = () => {
      modal.remove();
      state.socket.emit('roll_dice', { roomId: room.id, user: state.currentUser });
    };

    // Spin Wheel
    modal.querySelector('#btn-spin-wheel').onclick = () => {
      modal.remove();
      state.socket.emit('spin_wheel', { roomId: room.id, user: state.currentUser });
    };

    // Start PK
    modal.querySelector('#btn-start-pk').onclick = () => {
      modal.remove();
      state.socket.emit('start_pk', {
        roomId: room.id,
        hostUser: { name: room.host_name, id: room.host_id },
        challengerUser: { name: state.currentUser.name, id: state.currentUser.id },
        duration: 60
      });
    };
  }

  // 3D Dice Roll Animation Display
  function showDiceRollOverlay(user, value) {
    if (window.soundManager) window.soundManager.playDiceSound();

    const diceIcons = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const diceIcon = diceIcons[value - 1] || '🎲';

    const overlay = document.createElement('div');
    overlay.className = 'soul-modal-backdrop';
    overlay.style.zIndex = '350';
    overlay.innerHTML = `
      <div class="soul-modal-content" style="text-align: center; max-width: 300px;">
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">
          رمى <strong>${user.name}</strong> النرد 🎲
        </div>
        <div class="dice-animation-container">
          <div class="dice-cube">${diceIcon}</div>
          <div class="dice-result-text">الرقم: ${value} ⭐</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
    }, 2800);
  }

  // PK Battle UI
  function showPKBattleUI(pkState) {
    // 1. Voice room PK bar
    const bar = document.getElementById('room-pk-battle-bar');
    if (bar) {
      bar.classList.add('active');
      const hostScoreEl = document.getElementById('pk-host-score');
      const challengerScoreEl = document.getElementById('pk-challenger-score');
      if (hostScoreEl) hostScoreEl.innerText = pkState.hostScore;
      if (challengerScoreEl) challengerScoreEl.innerText = pkState.challengerScore;
    }

    // 2. Live video stream PK bar
    const streamPkBar = document.getElementById('stream-cohost-pk-bar');
    if (streamPkBar) {
      streamPkBar.style.display = 'block';
      const hostScoreEl = document.getElementById('stream-cohost-host-score');
      const guestScoreEl = document.getElementById('stream-cohost-guest-score');
      if (hostScoreEl) hostScoreEl.innerText = pkState.hostScore;
      if (guestScoreEl) guestScoreEl.innerText = pkState.challengerScore;
      const hostLabel = document.getElementById('stream-cohost-host-name');
      const guestLabel = document.getElementById('stream-cohost-name-label');
      if (hostLabel && pkState.host) hostLabel.innerText = pkState.host.name;
      if (guestLabel && pkState.challenger) guestLabel.innerText = pkState.challenger.name;
    }

    // Hide challenge start buttons during active battle
    const startPkBtn = document.getElementById('stream-start-pk-btn');
    if (startPkBtn) startPkBtn.style.display = 'none';
    const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
    if (cohostPkBtn) cohostPkBtn.style.display = 'none';

    // Show host PK round termination buttons
    const isRoomHost = state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner');
    const endPkRoundBtn = document.getElementById('stream-end-pk-round-btn');
    if (endPkRoundBtn && isRoomHost) endPkRoundBtn.style.display = 'inline-flex';
    const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
    if (barEndPkBtn && isRoomHost) barEndPkBtn.style.display = 'inline-block';

    if (window.soundManager) {
      window.soundManager.playPkStart();
    }
    showToast('🔥 انطلق تحدي الـ PK الحماسي بالاتفاق! الهدايا تحدد الفائز الآن!');
  }

  function updatePKTimerUI(timeLeft, hostScore, challengerScore) {
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    const timeStr = `0${min}:${sec < 10 ? '0' : ''}${sec}`;

    const timerEl = document.getElementById('pk-countdown-timer');
    if (timerEl) timerEl.innerText = timeStr;

    const streamTimerEl = document.getElementById('stream-pk-timer');
    if (streamTimerEl) streamTimerEl.innerText = `⚔️ ${timeStr}`;
  }

  function updatePKScoreUI(hostScore, challengerScore, user, team, points) {
    // 1. Voice room elements
    const hostScoreEl = document.getElementById('pk-host-score');
    const challengerScoreEl = document.getElementById('pk-challenger-score');
    const fillEl = document.getElementById('pk-progress-fill');

    if (hostScoreEl) hostScoreEl.innerText = hostScore;
    if (challengerScoreEl) challengerScoreEl.innerText = challengerScore;

    const total = hostScore + challengerScore;
    const hostPercent = total > 0 ? (hostScore / total) * 100 : 50;
    if (fillEl) fillEl.style.width = `${hostPercent}%`;

    // 2. Stream split PK elements
    const streamHostScore = document.getElementById('stream-cohost-host-score');
    const streamGuestScore = document.getElementById('stream-cohost-guest-score');
    const streamFill = document.getElementById('stream-cohost-pk-fill');

    if (streamHostScore) streamHostScore.innerText = hostScore;
    if (streamGuestScore) streamGuestScore.innerText = challengerScore;
    if (streamFill) streamFill.style.width = `${hostPercent}%`;

    const teamTitle = team === 'host' ? 'المضيف' : 'المنافس';
    showToast(`⚡ ${user.name} دعم ${teamTitle} بـ +${points} نقطة في التحدي! 🎁🔥`);
  }

  function handlePkRoundEnded(data) {
    const streamPkBar = document.getElementById('stream-cohost-pk-bar');
    if (streamPkBar) streamPkBar.style.display = 'none';

    const roomPkBar = document.getElementById('room-pk-battle-bar');
    if (roomPkBar) roomPkBar.classList.remove('active');

    const endPkRoundBtn = document.getElementById('stream-end-pk-round-btn');
    if (endPkRoundBtn) endPkRoundBtn.style.display = 'none';

    const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
    if (barEndPkBtn) barEndPkBtn.style.display = 'none';

    // Restore PK challenge buttons if co-host is still on split screen
    if (state.activeCohostUser) {
      const isHost = state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      if (startPkBtn && isHost) startPkBtn.style.display = 'inline-flex';

      const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
      if (cohostPkBtn && state.currentUser && state.currentUser.id === state.activeCohostUser.id) {
        cohostPkBtn.style.display = 'inline-flex';
      }
    }

    if (data) {
      showPkWinnerCelebrationModal(data);
    }
  }

  function showPkWinnerCelebrationModal(data) {
    if (window.soundManager) {
      window.soundManager.playVictory();
    }

    let winnerName = '';
    let isDraw = data.winner === 'draw';

    if (data.winner === 'host') {
      winnerName = data.host?.name || 'المضيف';
    } else if (data.winner === 'challenger') {
      winnerName = data.challenger?.name || 'المنافس';
    }

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop animate-fade-in';
    modal.id = 'pk-winner-celebration-modal';
    modal.style.zIndex = '9999';

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 440px; text-align: center; padding: 26px 20px; background: linear-gradient(135deg, #1f1035, #120924); border: 2px solid #fbbf24; box-shadow: 0 0 35px rgba(251, 191, 36, 0.45); border-radius: 20px;">
        <button class="soul-modal-close-btn" id="close-pk-winner-btn">✕</button>

        <div style="font-size: 56px; margin-bottom: 4px; animation: pkTrophyPulse 1.2s infinite ease-in-out;">
          ${isDraw ? '🤝' : '🏆'}
        </div>

        <div style="font-size: 22px; font-weight: 900; color: #fbbf24; margin-bottom: 6px; text-shadow: 0 0 12px rgba(251,191,36,0.6);">
          ${isDraw ? 'تعادل حماسي أسطوري!' : `👑 فوز ساحق لـ ${winnerName}! 👑`}
        </div>

        <div style="font-size: 13px; color: #fff; margin-bottom: 16px;">
          انتهت جولة التحدي (PK Battle) عبر دعم وهدايا الجمهور!
        </div>

        <!-- Scores Breakdown -->
        <div style="display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 18px; background: rgba(0,0,0,0.4); padding: 12px; border-radius: 14px;">
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 12px; color: #f87171; font-weight: 800; margin-bottom: 2px;">🔴 ${data.host?.name || 'المضيف'}</div>
            <div style="font-size: 22px; font-weight: 900; color: #fff;">${data.hostScore}</div>
            <div style="font-size: 10px; color: var(--text-muted);">نقطة هدية</div>
          </div>
          <div style="font-size: 18px; font-weight: 900; color: #fbbf24;">VS</div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 12px; color: #60a5fa; font-weight: 800; margin-bottom: 2px;">🔵 ${data.challenger?.name || 'المنافس'}</div>
            <div style="font-size: 22px; font-weight: 900; color: #fff;">${data.challengerScore}</div>
            <div style="font-size: 10px; color: var(--text-muted);">نقطة هدية</div>
          </div>
        </div>

        <!-- Loser Penalty / Dare -->
        ${!isDraw ? `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1.5px dashed #ef4444; border-radius: 14px; padding: 12px; margin-bottom: 20px; text-align: right;">
            <div style="font-size: 12px; font-weight: 800; color: #fca5a5; margin-bottom: 4px;">
              🎭 عقاب الخاسر (${data.loser === 'host' ? data.host?.name : data.challenger?.name}):
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #fff; line-height: 1.5;">
              ${data.penalty || 'تنفيذ عقاب التحدي أمام الجمهور!'}
            </div>
          </div>
        ` : ''}

        <div style="display: flex; gap: 10px; justify-content: center;">
          ${(state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner')) ? `
            <button class="wallet-btn primary" id="btn-pk-rematch" style="flex: 1; padding: 10px; font-size: 13px;">
              ⚔️ طلب جولة إعادة (Rematch)
            </button>
          ` : ''}
          <button class="wallet-btn secondary" id="btn-pk-close-overlay" style="flex: 1; padding: 10px; font-size: 13px;">
            إغلاق
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-pk-winner-btn').onclick = () => modal.remove();
    modal.querySelector('#btn-pk-close-overlay').onclick = () => modal.remove();

    const rematchBtn = modal.querySelector('#btn-pk-rematch');
    if (rematchBtn) {
      rematchBtn.onclick = () => {
        modal.remove();
        state.socket.emit('request_pk_battle', {
          roomId: state.activeRoom.id,
          fromUser: state.currentUser
        });
        showToast('📨 تم إرسال طلب جولة إعادة (Rematch) إلى الطرف الآخر! بانتظار موافقته...');
      };
    }
  }

  // ============================================
  // TAB 3: DIRECT MESSAGES & VOICE NOTES
  // ============================================
  async function renderChatTab(container) {
    if (!state.currentUser) {
      container.innerHTML = `
        <div class="chat-tab-container" style="text-align: center; padding: 60px 16px;">
          <div style="font-size: 54px; margin-bottom: 14px;">🔒</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 8px;">الدردشة مقفلة للزوار</div>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6; max-width: 360px; margin-left: auto; margin-right: auto;">
            يجب تسجيل الدخول وتوثيق حسابك عبر بريد Gmail لتتمكن من رؤية المحادثات الخاصة ومراسلة الأصدقاء والغرف الصوتية.
          </p>
          <button class="google-official-primary-btn" id="btn-chat-guest-login" style="max-width: 290px; margin: 0 auto; box-shadow: 0 4px 20px rgba(66, 133, 244, 0.4);">
            <svg class="google-g-icon" viewBox="0 0 24 24" style="width: 20px; height: 20px;">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>دخول بجيميل لفتح الدردشة 🚀</span>
          </button>
        </div>
      `;
      const btn = container.querySelector('#btn-chat-guest-login');
      if (btn) btn.onclick = () => showGoogleLoginModal();
      return;
    }

    container.innerHTML = `
      <div class="chat-tab-container">
        <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span>💬 المحادثات الخاصة</span>
          <span style="font-size: 11px; color: var(--text-muted);">مشفرة ومباشرة</span>
        </div>

        <div class="chat-conversations-list" id="conversations-list-container">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            جارِ تحميل المحادثات...
          </div>
        </div>
      </div>
    `;

    await loadConversationsList();
  }

  async function loadConversationsList() {
    if (!state.currentUser) return;
    try {
      const res = await fetch('/api/messages/conversations', {
        headers: { 'x-user-id': state.currentUser.id }
      });
      state.conversations = await res.json();
      renderConversationsList(state.conversations);
    } catch (err) {
      console.error('Error fetching conversations:', err);
    }
  }

  function renderConversationsList(list) {
    const container = document.getElementById('conversations-list-container');
    if (!container) return;

    if (list.length === 0) {
      // Show default seed users to chat with
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">
          لا توجد محادثات سابقة بعد.. اختر صديقاً من كوكب الروح للبدء! ✨
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(state.allUsers || []).slice(0, 4).map(u => `
            <div class="conversation-item" data-user-id="${u.id}">
              <div class="conv-avatar-box">
                <img src="${u.avatar}" class="${u.avatar_frame ? 'avatar-frame-' + u.avatar_frame : ''}" />
                <div class="online-dot"></div>
              </div>
              <div class="conv-info">
                <div class="conv-header">
                  <span class="conv-name">${u.name}</span>
                  <span class="conv-time">نشط الآن</span>
                </div>
                <div class="conv-last-msg">${u.soul_planet || 'كوكب الرومانسي الحالم'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      container.innerHTML = list.map(item => `
        <div class="conversation-item" data-user-id="${item.user.id}">
          <div class="conv-avatar-box">
            <img src="${item.user.avatar}" class="${item.user.avatar_frame ? 'avatar-frame-' + item.user.avatar_frame : ''}" />
            <div class="online-dot"></div>
          </div>
          <div class="conv-info">
            <div class="conv-header">
              <span class="conv-name">${item.user.name}</span>
              <span class="conv-time">${formatTime(item.lastMessage ? item.lastMessage.created_at : '')}</span>
            </div>
            <div class="conv-last-msg">
              ${item.lastMessage ? (item.lastMessage.message_type === 'voice' ? '🎙️ رسالة صوتية' : item.lastMessage.content) : 'بدء محادثة جديدة'}
            </div>
          </div>
        </div>
      `).join('');
    }

    container.querySelectorAll('.conversation-item').forEach(item => {
      item.onclick = async () => {
        const userId = item.dataset.userId;
        let partner = (state.allUsers || []).find(u => u.id === userId);
        if (!partner) {
          const conv = state.conversations.find(c => c.user && c.user.id === userId);
          partner = conv ? conv.user : { id: userId, name: 'مستخدم SoulChill', avatar: 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=user' };
        }
        openDirectChatWithUser(partner);
      };
    });
  }

  // 1-on-1 Direct Chat Window
  async function openDirectChatWithUser(partner) {
    if (!requireAuth()) return;
    state.currentChatPartner = partner;

    // Reset unread count when opening conversation
    state.unreadMessagesCount = 0;
    const navBadge = document.getElementById('nav-chat-unread-badge');
    if (navBadge) {
      navBadge.innerText = '0';
      navBadge.style.display = 'none';
    }
    const inroomDot = document.getElementById('inroom-unread-dot');
    if (inroomDot) inroomDot.style.display = 'none';

    let existing = document.getElementById('direct-chat-window-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'direct-chat-modal';
    modal.id = 'direct-chat-window-modal';
    modal.style.zIndex = '1250';

    modal.innerHTML = `
      <div class="direct-chat-container">
        ${state.activeRoom ? `
          <div style="background: rgba(139, 92, 246, 0.22); border-bottom: 1px solid rgba(139, 92, 246, 0.4); padding: 6px 14px; font-size: 11px; color: #c084fc; display: flex; align-items: center; justify-content: space-between;">
            <span>🎙️ أنت متصل حالياً بالغرفة الصوتية [${state.activeRoom.title}]</span>
            <span style="color: #10b981; font-weight: 700;">● صوت الروم مستمر بدون انقطاع</span>
          </div>
        ` : ''}

        <!-- Header -->
        <div class="direct-chat-header">
          <div class="direct-chat-partner">
            <button class="header-action-btn" id="close-chat-window-btn" style="width: 28px; height: 28px;">✕</button>
            <img src="${partner.avatar}" class="direct-chat-partner-avatar ${partner.avatar_frame ? 'avatar-frame-' + partner.avatar_frame : ''}" />
            <div class="direct-chat-partner-info">
              <span class="direct-chat-partner-name">${partner.name}</span>
              <span class="direct-chat-partner-planet">${partner.soul_planet || 'كوكب الروح 🪐'}</span>
            </div>
          </div>
          <button class="header-action-btn" id="chat-send-gift-btn" title="إرسال هدية خاصة">🎁</button>
        </div>

        <!-- Messages Stream -->
        <div class="direct-messages-stream" id="direct-chat-stream-box">
          <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 11px;">
            🔒 محادثة خاصة مشفرة. كل ما يقال هنا بين الروحين فقط.
          </div>
        </div>

        <!-- Recording Indicator Strip -->
        <div class="recording-indicator-strip" id="voice-recording-strip">
          <span style="font-size: 16px;">🔴</span>
          <span>جارِ تسجيل الرسالة الصوتية... <strong id="voice-recording-timer">00:00</strong></span>
          <button style="background: none; border: none; color: #fff; cursor: pointer; margin-right: auto;" id="cancel-voice-record-btn">إلغاء ✕</button>
        </div>

        <!-- Chat Input Bar -->
        <div class="direct-chat-input-bar">
          <button class="voice-record-btn" id="mic-record-voice-btn" title="تسجيل رسالة صوتية (اضغط للبدء)">🎙️</button>
          <div class="room-chat-input-wrapper">
            <input type="text" class="room-chat-input" id="direct-msg-input" placeholder="اكتب رسالتك لـ ${partner.name.split(' ')[0]}..." />
            <button class="room-chat-send-btn" id="direct-send-btn">➤</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-chat-window-btn').onclick = () => {
      modal.remove();
      state.currentChatPartner = null;
    };

    modal.querySelector('#chat-send-gift-btn').onclick = () => {
      openGiftStoreModal(partner.id, null, partner);
    };

    // Load History
    await loadDirectChatHistory(partner.id);

    // Send Text
    const input = modal.querySelector('#direct-msg-input');
    const sendBtn = modal.querySelector('#direct-send-btn');

    const handleSend = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await sendPrivateMessage(partner.id, 'text', text);
    };

    sendBtn.onclick = handleSend;
    input.onkeypress = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    // Voice Note Recording Toggle
    const recordBtn = modal.querySelector('#mic-record-voice-btn');
    recordBtn.onclick = () => {
      toggleVoiceNoteRecording();
    };

    const cancelRecordBtn = modal.querySelector('#cancel-voice-record-btn');
    cancelRecordBtn.onclick = () => {
      cancelVoiceNoteRecording();
    };
  }

  async function loadDirectChatHistory(otherUserId) {
    try {
      const res = await fetch(`/api/messages/history/${otherUserId}`, {
        headers: { 'x-user-id': state.currentUser.id }
      });
      const messages = await res.json();
      const stream = document.getElementById('direct-chat-stream-box');
      if (!stream) return;

      messages.forEach(msg => {
        appendDirectChatMessageUI(msg);
      });
    } catch (err) {
      console.error('Error fetching chat history:', err);
    }
  }

  function appendDirectChatMessageUI(msg) {
    const stream = document.getElementById('direct-chat-stream-box');
    if (!stream) return;

    const isSent = msg.sender_id === state.currentUser.id;
    const row = document.createElement('div');
    row.className = `msg-row ${isSent ? 'sent' : 'received'}`;

    let bodyHtml = '';
    if (msg.message_type === 'voice') {
      bodyHtml = `
        <div class="voice-note-player" data-audio-url="${msg.media_url}">
          <button class="voice-play-btn">▶</button>
          <div class="voice-waveform-preview">
            <div class="waveform-bar" style="height: 14px;"></div>
            <div class="waveform-bar" style="height: 18px;"></div>
            <div class="waveform-bar" style="height: 10px;"></div>
            <div class="waveform-bar" style="height: 16px;"></div>
            <div class="waveform-bar" style="height: 12px;"></div>
          </div>
          <span class="voice-duration">00:04</span>
        </div>
      `;
    } else if (msg.message_type === 'gift') {
      bodyHtml = `<div style="font-weight: 700; color: #fbbf24;">🎁 ${msg.content}</div>`;
    } else {
      bodyHtml = `<div>${msg.content}</div>`;
    }

    row.innerHTML = `
      <div class="msg-bubble">
        ${bodyHtml}
      </div>
    `;

    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;

    // Attach voice player event if voice note
    const playBtn = row.querySelector('.voice-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        const audioUrl = row.querySelector('.voice-note-player').dataset.audioUrl;
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audio.play();
          playBtn.innerText = '⏸';
          audio.onended = () => { playBtn.innerText = '▶'; };
        } else {
          // Play simulated note chime
          if (window.soundManager) window.soundManager.playGiftSound(false);
          showToast('🎵 تم تشغيل المقطع الصوتي');
        }
      };
    }
  }

  async function sendPrivateMessage(receiverId, messageType, content, mediaUrl = null) {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({
          receiver_id: receiverId,
          message_type: messageType,
          content,
          media_url: mediaUrl
        })
      });

      const msg = await res.json();
      appendDirectChatMessageUI(msg);
      if (window.soundManager) window.soundManager.playClick();
    } catch (err) {
      console.error('Error sending message:', err);
    }
  }

  function handleIncomingPrivateMessage(msg) {
    if (state.currentChatPartner && msg.sender_id === state.currentChatPartner.id) {
      appendDirectChatMessageUI(msg);
      if (window.soundManager) window.soundManager.playGiftSound(false);
      return;
    }

    if (window.soundManager) window.soundManager.playGiftSound(false);

    // Update unread count and show badge ONLY when message actually exists
    state.unreadMessagesCount = (state.unreadMessagesCount || 0) + 1;
    const navBadge = document.getElementById('nav-chat-unread-badge');
    if (navBadge) {
      navBadge.innerText = state.unreadMessagesCount.toString();
      navBadge.style.display = 'inline-flex';
    }

    // If inside voice room, highlight unread dot on messages button
    const dot = document.getElementById('inroom-unread-dot');
    if (dot) dot.style.display = 'block';

    // Show floating reply banner that lets user reply directly without leaving room
    showIncomingMessagePopup(msg);
  }

  function showIncomingMessagePopup(msg) {
    const existing = document.getElementById(`pm-popup-${msg.sender_id}`);
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'incoming-pm-popup-banner';
    banner.id = `pm-popup-${msg.sender_id}`;
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      right: 16px;
      max-width: 420px;
      margin: 0 auto;
      background: rgba(15, 10, 30, 0.95);
      backdrop-filter: blur(12px);
      border: 1.5px solid #8b5cf6;
      border-radius: 14px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 30px rgba(139, 92, 246, 0.4);
      z-index: 1300;
      animation: slideDownIn 0.3s ease;
      cursor: pointer;
    `;

    banner.innerHTML = `
      <img src="${msg.sender_avatar || '/avatars/avatar-1.png'}" style="width: 42px; height: 42px; border-radius: 50%; border: 1.5px solid #fbbf24; object-fit: cover;" />
      <div style="flex: 1; min-width: 0; text-align: right;">
        <div style="font-size: 13px; font-weight: 800; color: #fbbf24;">💬 رسالة خاصة جديدة من ${msg.sender_name}</div>
        <div style="font-size: 11px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${msg.content}</div>
      </div>
      <button style="background: var(--primary-gradient); border: none; color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; white-space: nowrap;" id="btn-reply-pm-${msg.sender_id}">رد 💬</button>
      <button style="background: none; border: none; color: var(--text-muted); font-size: 14px; cursor: pointer; padding: 4px;" id="btn-close-pm-${msg.sender_id}">✕</button>
    `;

    document.body.appendChild(banner);

    banner.querySelector(`#btn-reply-pm-${msg.sender_id}`).onclick = (e) => {
      e.stopPropagation();
      banner.remove();
      openDirectChatWithUser({
        id: msg.sender_id,
        name: msg.sender_name,
        avatar: msg.sender_avatar
      });
    };

    banner.querySelector(`#btn-close-pm-${msg.sender_id}`).onclick = (e) => {
      e.stopPropagation();
      banner.remove();
    };

    banner.onclick = () => {
      banner.remove();
      openDirectChatWithUser({
        id: msg.sender_id,
        name: msg.sender_name,
        avatar: msg.sender_avatar
      });
    };

    setTimeout(() => {
      if (banner.parentNode) {
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-15px)';
        banner.style.transition = 'all 0.3s ease';
        setTimeout(() => banner.remove(), 300);
      }
    }, 7000);
  }

  // Open In-Room Messages Drawer (Allows browsing conversations & replying without exiting voice room)
  async function openInRoomMessagesDrawer() {
    let existing = document.getElementById('in-room-messages-drawer-modal');
    if (existing) {
      existing.remove();
      return;
    }

    const drawer = document.createElement('div');
    drawer.className = 'soul-modal-backdrop';
    drawer.id = 'in-room-messages-drawer-modal';
    drawer.style.zIndex = '1150';

    drawer.innerHTML = `
      <div class="seat-admin-modal-box" style="max-width: 440px; max-height: 85vh; display: flex; flex-direction: column; padding: 16px; text-align: right;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
          <div style="font-size: 15px; font-weight: 800; color: #fff;">💬 الرسائل الخاصة (وأنت داخل الغرفة)</div>
          <button style="background: none; border: none; color: #fff; font-size: 18px; cursor: pointer;" id="close-inroom-drawer-btn">✕</button>
        </div>

        <div style="font-size: 11px; color: #c084fc; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 8px; padding: 8px; margin-bottom: 12px;">
          🎧 أنت متصل بالغرفة الصوتية حالياً.. يمكنك الرد والدردشة مع الأصدقاء هنا بحرية دون مغادرة الروم إطلاقاً!
        </div>

        <div id="inroom-conversations-list" style="overflow-y: auto; flex: 1; min-height: 200px; display: flex; flex-direction: column; gap: 8px;">
          <div style="text-align: center; color: var(--text-muted); padding: 20px;">جارِ تحميل المحادثات...</div>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);

    drawer.querySelector('#close-inroom-drawer-btn').onclick = () => drawer.remove();
    drawer.onclick = (e) => {
      if (e.target === drawer) drawer.remove();
    };

    // Load conversations
    try {
      const res = await fetch('/api/messages/conversations', {
        headers: { 'x-user-id': state.currentUser?.id || '' }
      });
      const data = await res.json();
      const convs = Array.isArray(data) ? data : [];
      state.conversations = convs;

      const listContainer = drawer.querySelector('#inroom-conversations-list');
      if (!convs || convs.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 12px;">
            لا توجد محادثات سابقة بعد. يمكنك بدء محادثة مع أي متواجد في الغرفة عبر النقر على صورته! 🌟
          </div>
        `;
        return;
      }

      listContainer.innerHTML = convs.map(c => {
        const lastMsg = c.lastMessage || c.last_message;
        return `
        <div class="inroom-conv-item" data-user-id="${c.user.id}" style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.04); cursor: pointer; transition: background 0.2s;">
          <img src="${c.user.avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--primary);" onerror="this.src='/avatars/avatar-1.png'" />
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 13px; font-weight: 700; color: #fff;">${c.user.name}</span>
              <span style="font-size: 10px; color: var(--text-muted);">${formatTime(lastMsg ? lastMsg.created_at : '')}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${lastMsg ? (lastMsg.message_type === 'voice' ? '🎙️ رسالة صوتية' : lastMsg.content) : 'رسالة جديدة'}
            </div>
          </div>
          <button class="inroom-reply-fast-btn" style="background: var(--primary); border: none; color: #fff; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;">رد 💬</button>
        </div>
      `;
      }).join('');

      listContainer.querySelectorAll('.inroom-conv-item').forEach(item => {
        item.onclick = () => {
          const uId = item.dataset.userId;
          const conv = state.conversations.find(c => c.user && c.user.id === uId);
          if (conv) {
            drawer.remove();
            openDirectChatWithUser(conv.user);
          }
        };
      });
    } catch (e) {
      console.error('Error loading in-room conversations:', e);
    }
  }

  // Voice Note MediaRecorder implementation
  async function toggleVoiceNoteRecording() {
    if (state.isRecordingVoiceNote) {
      stopAndSendVoiceNote();
    } else {
      startVoiceNoteRecording();
    }
  }

  async function startVoiceNoteRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      state.recordedAudioChunks = [];

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) state.recordedAudioChunks.push(e.data);
      };

      state.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(state.recordedAudioChunks, { type: 'audio/webm' });
        await uploadAndSendVoiceBlob(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };

      state.mediaRecorder.start();
      state.isRecordingVoiceNote = true;
      state.recordingSeconds = 0;

      // Update UI
      const recordBtn = document.getElementById('mic-record-voice-btn');
      const strip = document.getElementById('voice-recording-strip');
      const timer = document.getElementById('voice-recording-timer');

      if (recordBtn) recordBtn.classList.add('recording');
      if (strip) strip.classList.add('active');

      state.recordingTimerInterval = setInterval(() => {
        state.recordingSeconds++;
        if (timer) {
          const s = state.recordingSeconds;
          timer.innerText = `00:${s < 10 ? '0' : ''}${s}`;
        }
      }, 1000);

      showToast('🔴 بدأ التسجيل الصوتي.. تحدث الآن ثم اضغط مرة أخرى للإرسال');
    } catch (err) {
      console.warn('Voice recording error or permission denied:', err);
      // Fallback simulated voice note
      sendSimulatedVoiceNote();
    }
  }

  function stopAndSendVoiceNote() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    finishRecordingUI();
  }

  function cancelVoiceNoteRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.ondataavailable = null;
      state.mediaRecorder.stop();
    }
    finishRecordingUI();
    showToast('تم إلغاء التسجيل الصوتي');
  }

  function finishRecordingUI() {
    state.isRecordingVoiceNote = false;
    if (state.recordingTimerInterval) {
      clearInterval(state.recordingTimerInterval);
      state.recordingTimerInterval = null;
    }
    const recordBtn = document.getElementById('mic-record-voice-btn');
    const strip = document.getElementById('voice-recording-strip');
    if (recordBtn) recordBtn.classList.remove('recording');
    if (strip) strip.classList.remove('active');
  }

  async function uploadAndSendVoiceBlob(blob) {
    if (!state.currentChatPartner) return;

    const formData = new FormData();
    formData.append('file', blob, 'voice-note.webm');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.url) {
        await sendPrivateMessage(state.currentChatPartner.id, 'voice', 'رسالة صوتية 🎙️', data.url);
        showToast('تم إرسال الرسالة الصوتية بنجاح! 🎙️✨');
      }
    } catch (err) {
      console.error('Error uploading voice note:', err);
      sendSimulatedVoiceNote();
    }
  }

  async function sendSimulatedVoiceNote() {
    if (!state.currentChatPartner) return;
    finishRecordingUI();
    await sendPrivateMessage(state.currentChatPartner.id, 'voice', 'رسالة صوتية (مباشرة) 🎙️', null);
    showToast('تم إرسال الرسالة الصوتية بنجاح! 🎙️✨');
  }

  // ============================================
  // TAB 4: MOMENTS SOCIAL FEED
  // ============================================
  async function renderMomentsTab(container) {
    const userAvatar = state.currentUser ? state.currentUser.avatar : 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=SoulChillGuest';
    container.innerHTML = `
      <div class="moments-tab-container">
        <!-- New Moment Box -->
        <div class="new-moment-box" id="open-new-moment-modal-btn">
          <img src="${userAvatar}" style="width: 36px; height: 36px; border-radius: 9999px;" />
          <div class="new-moment-input-fake">ما الذي يخطر في روحك اليوم؟ شارك لحظاتك ✨</div>
          <span style="font-size: 20px;">📷</span>
        </div>

        <!-- Moments Feed List -->
        <div id="moments-feed-list">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            جارِ تحميل منشورات مجتمع الروح...
          </div>
        </div>
      </div>
    `;

    container.querySelector('#open-new-moment-modal-btn').onclick = () => {
      if (!requireAuth()) return;
      showCreateMomentModal();
    };

    await loadMomentsList();
  }

  async function loadMomentsList() {
    try {
      const res = await fetch('/api/moments', {
        headers: { 'x-user-id': state.currentUser ? state.currentUser.id : '' }
      });
      state.moments = await res.json();
      renderMomentsFeed();
    } catch (err) {
      console.error('Error fetching moments:', err);
    }
  }

  function renderMomentsFeed() {
    const listEl = document.getElementById('moments-feed-list');
    if (!listEl) return;

    if (state.moments.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          كن أول من يشارك لحظة في مجتمع SoulChill! 🌟
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.moments.map(m => {
      const commentsHtml = (m.comments || []).map(c => `
        <div class="comment-item">
          <span class="comment-author">${c.user_name}:</span>
          <span>${c.content}</span>
        </div>
      `).join('');

      return `
        <div class="moment-card" data-moment-id="${m.id}">
          <div class="moment-card-header">
            <img src="${m.user_avatar}" class="moment-user-avatar ${m.avatar_frame ? 'avatar-frame-' + m.avatar_frame : ''}" />
            <div class="moment-user-info">
              <div class="moment-user-name">${m.user_name}</div>
              <div class="moment-user-planet">${m.soul_planet || 'كوكب الروح 🌌'} • ${formatTime(m.created_at)}</div>
            </div>
          </div>

          <div class="moment-content-text">${m.content}</div>

          ${m.image_url ? `
            <div class="moment-image-box">
              <img src="${m.image_url}" loading="lazy" />
            </div>
          ` : ''}

          <div class="moment-actions-bar">
            <button class="moment-action-btn like-moment-btn ${m.is_liked ? 'liked' : ''}" data-moment-id="${m.id}">
              <span>${m.is_liked ? '❤️' : '🤍'}</span>
              <span class="likes-counter">${m.likes_count || 0}</span>
            </button>
            <button class="moment-action-btn" style="cursor: default;">
              <span>💬</span>
              <span>${(m.comments || []).length} تعليقات</span>
            </button>
          </div>

          <!-- Comments Section -->
          <div class="moment-comments-section">
            <div class="comments-list-box">${commentsHtml}</div>
            <div class="add-comment-row">
              <input type="text" class="add-comment-input" placeholder="اكتب تعليقاً لطيفاً..." />
              <button class="add-comment-btn" data-moment-id="${m.id}">إرسال</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach like events
    listEl.querySelectorAll('.like-moment-btn').forEach(btn => {
      btn.onclick = async () => {
        const momentId = btn.dataset.momentId;
        try {
          const res = await fetch(`/api/moments/${momentId}/like`, {
            method: 'POST',
            headers: { 'x-user-id': state.currentUser.id }
          });
          const data = await res.json();
          if (data.success) {
            btn.classList.toggle('liked', data.liked);
            const counter = btn.querySelector('.likes-counter');
            let count = parseInt(counter.innerText) || 0;
            counter.innerText = data.liked ? count + 1 : Math.max(0, count - 1);
            btn.querySelector('span').innerText = data.liked ? '❤️' : '🤍';
            if (data.liked && window.soundManager) {
              window.soundManager.playGiftSound(false);
            }
          }
        } catch (err) {
          console.error('Error liking moment:', err);
        }
      };
    });

    // Attach comment events
    listEl.querySelectorAll('.add-comment-btn').forEach(btn => {
      btn.onclick = async () => {
        const momentId = btn.dataset.momentId;
        const row = btn.parentElement;
        const input = row.querySelector('.add-comment-input');
        const text = input.value.trim();
        if (!text) return;

        try {
          const res = await fetch(`/api/moments/${momentId}/comments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': state.currentUser.id
            },
            body: JSON.stringify({ content: text })
          });
          const data = await res.json();
          if (data.success) {
            input.value = '';
            showToast('تمت إضافة تعليقك! 💬');
          }
        } catch (err) {
          console.error('Error commenting:', err);
        }
      };
    });
  }

  // Create Moment Modal
  function showCreateMomentModal() {
    if (!requireAuth()) return;
    const presetImages = [
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80'
    ];

    let selectedImage = presetImages[0];

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'create-moment-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-moment-btn">✕</button>
        <div class="modal-header-title">✨ نشر لحظة في مجتمع السول</div>

        <div class="custom-google-login-form">
          <div class="form-group-soul">
            <label>ماذا يخطر في بالك؟</label>
            <textarea id="moment-text-input" class="form-input-soul" style="min-height: 80px; resize: none;" placeholder="شارك كلمات ملهمة، أغنية أعجبتك، أو مشاعرك الليلة 🌌"></textarea>
          </div>

          <div class="form-group-soul">
            <label>اختر صورة جمالية للخلفية</label>
            <div style="display: flex; gap: 8px; margin-top: 4px;">
              ${presetImages.map((img, i) => `
                <img src="${img}" class="moment-preset-thumb ${i === 0 ? 'selected' : ''}" data-url="${img}" style="width: 60px; height: 50px; border-radius: 8px; object-fit: cover; cursor: pointer; border: 2px solid ${i === 0 ? 'var(--primary)' : 'transparent'};" />
              `).join('')}
            </div>
          </div>

          <button class="soul-submit-btn" id="submit-moment-btn" style="margin-top: 10px;">
            نشر اللحظة الآن 🚀
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-moment-btn').onclick = () => modal.remove();

    modal.querySelectorAll('.moment-preset-thumb').forEach(thumb => {
      thumb.onclick = () => {
        modal.querySelectorAll('.moment-preset-thumb').forEach(t => t.style.borderColor = 'transparent');
        thumb.style.borderColor = 'var(--primary)';
        selectedImage = thumb.dataset.url;
      };
    });

    modal.querySelector('#submit-moment-btn').onclick = async () => {
      const text = modal.querySelector('#moment-text-input').value.trim();
      if (!text) {
        showToast('يرجى كتابة نص اللحظة!');
        return;
      }

      try {
        const res = await fetch('/api/moments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({
            content: text,
            image_url: selectedImage,
            tag: 'chill'
          })
        });
        const data = await res.json();
        if (data.success) {
          modal.remove();
          showToast('تم نشر لحظتك بنجاح! ✨');
        }
      } catch (err) {
        console.error('Error creating moment:', err);
      }
    };
  }

  // ============================================
  // TAB 5: PROFILE & VIP STORE
  // ============================================
  function renderProfileTab(container) {
    const user = state.currentUser;
    if (!user) {
      container.innerHTML = `
        <div class="profile-tab-container" style="text-align: center; padding: 40px 16px;">
          <div style="font-size: 54px; margin-bottom: 12px;">🪐</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 8px;">مرحباً بك في SoulChill</div>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
            سجّل الدخول بحساب الجيميل أو Google للوصول إلى محفظتك، ألماساتك، وإطارات الأفاتار الملكية
          </p>
          <button class="soul-submit-btn" id="profile-unauth-login-btn" style="width: 100%; max-width: 300px; padding: 12px; font-size: 14px;">
            تسجيل الدخول عبر Google / Gmail 🚀
          </button>
        </div>
      `;
      const loginBtn = container.querySelector('#profile-unauth-login-btn');
      if (loginBtn) loginBtn.onclick = () => showGoogleLoginModal();
      return;
    }

    let userRoleBadgeHero = '';
    if (user.role === 'owner') userRoleBadgeHero = '<span style="background: linear-gradient(90deg, #f59e0b, #ef4444); color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; margin-right: 6px;">👑 المالك الأعلى</span>';
    else if (user.role === 'super_master') userRoleBadgeHero = '<span style="background: linear-gradient(90deg, #a855f7, #6366f1); color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; margin-right: 6px;">💎 سوبر ماستر</span>';
    else if (user.role === 'super_admin') userRoleBadgeHero = '<span style="background: linear-gradient(90deg, #f59e0b, #ef4444); color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; margin-right: 6px;">⚡ سوبر ادمن</span>';
    else if (user.role === 'admin' || user.role === 'moderator') userRoleBadgeHero = '<span style="background: linear-gradient(90deg, #3b82f6, #06b6d4); color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; margin-right: 6px;">🛡️ ادمن الدردشة</span>';

    container.innerHTML = `
      <div class="profile-tab-container">
        <!-- Hero Card -->
        <div class="profile-card-hero">
          <div class="profile-big-avatar-box" id="profile-avatar-clickable" title="انقر لتغيير صورتك الشخصية 📸">
            <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" id="profile-page-avatar" />
            <div class="profile-avatar-edit-badge" title="تغيير صورتك الشخصية">📷</div>
          </div>
          <div class="profile-hero-name">
            ${user.name}
            ${userRoleBadgeHero}
          </div>
          <div class="profile-hero-id">SoulChill ID: ${user.id}</div>
          <div class="profile-planet-pill">${user.soul_planet || 'كوكب الرومانسي الحالم 🌌'}</div>

          <!-- Stats -->
          <div class="profile-stats-row">
            <div class="profile-stat-col">
              <span class="stat-col-num">Lv.${user.level || (user.role === 'owner' ? 999 : 5)}</span>
              <span class="stat-col-label">المستوى</span>
            </div>
            <div class="profile-stat-col">
              <span class="stat-col-num">💎 ${user.wealth_level || (user.role === 'owner' ? 99 : 3)}</span>
              <span class="stat-col-label">الثروة</span>
            </div>
            <div class="profile-stat-col">
              <span class="stat-col-num">👑 ${user.charm_level || (user.role === 'owner' ? 99 : 4)}</span>
              <span class="stat-col-label">الكاريزما</span>
            </div>
          </div>
        </div>

        ${user.role === 'owner' ? `
          <!-- Supreme Owner Control Panel Card -->
          <div class="wallet-card" style="border: 1.5px solid #fbbf24; background: linear-gradient(135deg, rgba(251,191,36,0.12), rgba(139,92,246,0.18));">
            <div class="wallet-card-header">
              <span style="color: #fbbf24; font-weight: 800;">👑 لوحة تحكم مالك التطبيق (Super Admin)</span>
              <span style="background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 800;">صلاحيات مطلقة</span>
            </div>
            <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4;">
              بصفتك مالك الموقع، لديك صلاحية الإدارة والتحكم في كل الرومات، وبث إعلانات عامة لجميع المستخدمين.
            </p>
            <div class="wallet-action-btns">
              <button class="wallet-btn primary" id="btn-owner-global-broadcast" style="background: linear-gradient(90deg, #f59e0b, #ef4444);">
                <span>📢</span> إرسال إعلان عام للجميع
              </button>
              <button class="wallet-btn secondary" id="btn-owner-instant-boost" style="border-color: #fbbf24; color: #fbbf24;">
                <span>⚡</span> شحن إمبراطوري (+100k)
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Wallet Card -->
        <div class="wallet-card">
          <div class="wallet-card-header">
            <span>محفظة السول الفاخرة</span>
            <span style="font-size: 11px; color: var(--accent-gold);">رصيدك المتاح</span>
          </div>
          <div class="wallet-balances">
            <div class="wallet-balance-item">
              <span class="wallet-icon">🪙</span>
              <div>
                <div class="wallet-balance-val" id="profile-coins-val">${user.coins.toLocaleString()}</div>
                <div class="wallet-balance-name">عملات سول</div>
              </div>
            </div>
            <div class="wallet-balance-item">
              <span class="wallet-icon">💎</span>
              <div>
                <div class="wallet-balance-val" id="profile-diamonds-val">${user.diamonds.toLocaleString()}</div>
                <div class="wallet-balance-name">ألماس ملكي</div>
              </div>
            </div>
          </div>
          <div class="wallet-action-btns">
            <button class="wallet-btn primary" id="wallet-topup-btn">
              <span>⚡</span> شحن رصيد إضافي
            </button>
            <button class="wallet-btn secondary" id="wallet-checkin-btn">
              <span>🎁</span> مكافأة الحضور اليومي
            </button>
          </div>
        </div>

        <!-- User's Own Received Gifts Wall ("هداياي المستلمة") -->
        <div class="vip-store-card">
          <div class="user-received-gifts-box" data-user-id="${user.id}" id="my-profile-gifts-box">
            <div style="font-size: 11px; color: var(--text-muted); padding: 8px;">جارِ تحميل هداياك... 🎁</div>
          </div>
        </div>

        <!-- VIP Store: Avatar Frames Shelf -->
        <div class="vip-store-card">
          <div class="vip-store-title">
            <span>👑</span> إطارات الأفاتار الملكية (VIP Frames)
          </div>
          <div class="frames-shelf-grid">
            ${renderFramesStoreHtml(user.avatar_frame)}
          </div>
        </div>

        <!-- Menu Options -->
        <div class="profile-menu-list">
          <div class="profile-menu-item" id="menu-change-avatar-btn" style="border: 1px solid rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.12);">
            <div class="profile-menu-item-left">
              <span>🖼️</span>
              <span style="font-weight: 700; color: #c084fc;">تغيير صورتي الشخصية (رفع من الجهاز أو اختيار أفاتار)</span>
            </div>
            <span style="color: #c084fc;">‹</span>
          </div>
          ${canAccessAdminPanel(user) ? `
            <a href="/admin" target="_blank" class="profile-menu-item" style="border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.12); text-decoration: none; color: inherit;">
              <div class="profile-menu-item-left">
                <span>🛡️</span>
                <span style="font-weight: 700; color: #fbbf24;">لوحة إدارة الدردشة (Control Panel)</span>
              </div>
              <span style="color: #fbbf24;">‹</span>
            </a>
          ` : ''}
          <div class="profile-menu-item" id="menu-edit-profile-btn">
            <div class="profile-menu-item-left">
              <span>✏️</span>
              <span>تعديل الملف الشخصي والبيو</span>
            </div>
            <span>‹</span>
          </div>
          <div class="profile-menu-item" id="menu-take-soul-test-btn">
            <div class="profile-menu-item-left">
              <span>🪐</span>
              <span>إعادة اختبار كوكب الروح</span>
            </div>
            <span>‹</span>
          </div>
          <div class="profile-menu-item" id="menu-switch-account-btn" style="border: 1px solid rgba(192, 132, 252, 0.35); background: rgba(139, 92, 246, 0.12);">
            <div class="profile-menu-item-left">
              <span>🔄</span>
              <span style="font-weight: 700; color: #c084fc;">تبديل الحساب أو الدخول بحساب آخر</span>
            </div>
            <span>‹</span>
          </div>
          <div class="profile-menu-item danger" id="menu-logout-btn">
            <div class="profile-menu-item-left">
              <span>🚪</span>
              <span>تسجيل الخروج من الحساب الحالي</span>
            </div>
            <span>‹</span>
          </div>
        </div>
      </div>
    `;

    // Avatar change trigger
    const avatarBox = container.querySelector('#profile-avatar-clickable');
    if (avatarBox) avatarBox.onclick = () => showChangeAvatarModal();
    const menuChangeAvatarBtn = container.querySelector('#menu-change-avatar-btn');
    if (menuChangeAvatarBtn) menuChangeAvatarBtn.onclick = () => showChangeAvatarModal();

    // Wallet actions
    container.querySelector('#wallet-topup-btn').onclick = () => showTopUpModal();
    container.querySelector('#wallet-checkin-btn').onclick = () => handleDailyCheckIn();

    // Load My Received Gifts Wall ("هداياي")
    const myGiftsBox = container.querySelector('#my-profile-gifts-box');
    if (myGiftsBox && user.id) {
      loadAndRenderUserGiftsSection(user.id, myGiftsBox, true);
    }

    // Frames shelf clicks
    container.querySelectorAll('.frame-shelf-item').forEach(item => {
      item.onclick = async () => {
        const frameId = item.dataset.frameId;
        await equipAvatarFrame(frameId);
      };
    });

    // Supreme Owner Special Actions
    const broadcastBtn = container.querySelector('#btn-owner-global-broadcast');
    if (broadcastBtn) {
      broadcastBtn.onclick = () => {
        const msg = prompt('📢 اكتب رسالة الإعلان العام ليتم بثها فوراً على كل شاشات الرومات والبثوث:');
        if (msg && msg.trim()) {
          state.socket.emit('global_owner_announcement', {
            ownerId: user.id,
            message: msg.trim()
          });
          showToast('تم إرسال الإعلان العام لجميع الرومات! 📢⚡');
        }
      };
    }

    const instantBoostBtn = container.querySelector('#btn-owner-instant-boost');
    if (instantBoostBtn) {
      instantBoostBtn.onclick = async () => {
        try {
          const res = await fetch('/api/wallet/recharge', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({ coins: 100000, diamonds: 50000 })
          });
          const data = await res.json();
          if (data.success) {
            state.currentUser = data.user;
            localStorage.setItem('soulchill_user', JSON.stringify(data.user));
            updateHeaderUI();
            renderProfileTab(container);
            showToast('تم شحن 100,000 عملة و 50,000 ألماسة للمالك! 💎👑');
          }
        } catch (e) {}
      };
    }

    // Menu actions
    container.querySelector('#menu-edit-profile-btn').onclick = () => showEditProfileModal();
    container.querySelector('#menu-take-soul-test-btn').onclick = () => showSoulTestModal();
    container.querySelector('#menu-switch-account-btn').onclick = () => showGoogleLoginModal();
    container.querySelector('#menu-logout-btn').onclick = () => handleSignOut();
  }

  function renderFramesStoreHtml(currentFrame) {
    const frames = [
      { id: 'imperial_owner', name: 'عرش الإمبراطور', icon: '👑✨' },
      { id: 'galaxy_halo', name: 'هالة المجرة', icon: '🌌' },
      { id: 'cyber_neon', name: 'سايبر نيون', icon: '⚡' },
      { id: 'royal_gold', name: 'التاج الملكي', icon: '👑' },
      { id: 'fire_dragon', name: 'تنين اللهب', icon: '🔥' },
      { id: 'angel_wings', name: 'أجنحة الملاك', icon: '🪽' },
      { id: 'cosmic_ring', name: 'خاتم السول', icon: '🪐' }
    ];

    return frames.map(f => {
      const isEquipped = currentFrame === f.id;
      return `
        <div class="frame-shelf-item ${isEquipped ? 'equipped' : ''}" data-frame-id="${f.id}">
          <div style="font-size: 24px; margin-bottom: 4px;">${f.icon}</div>
          <div class="frame-shelf-name">${f.name}</div>
          <div class="frame-shelf-status">${isEquipped ? 'مفعل الآن' : 'تفعيل'}</div>
        </div>
      `;
    }).join('');
  }

  async function equipAvatarFrame(frameId) {
    if (!requireAuth()) return;
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ avatar_frame: frameId })
      });
      const data = await res.json();
      if (data.success) {
        state.currentUser = data.user;
        localStorage.setItem('soulchill_user', JSON.stringify(data.user));
        updateHeaderUI();
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
        if (window.soundManager) window.soundManager.playGiftSound(false);
        showToast('تم تفعيل إطار الأفاتار بنجاح! 👑✨');
      }
    } catch (err) {
      console.error('Error equipping frame:', err);
    }
  }

  // Daily Check-in Claim
  async function handleDailyCheckIn() {
    if (!requireAuth()) return;
    try {
      const res = await fetch('/api/users/checkin', {
        method: 'POST',
        headers: { 'x-user-id': state.currentUser.id }
      });
      const data = await res.json();
      if (data.success) {
        state.currentUser = data.user;
        localStorage.setItem('soulchill_user', JSON.stringify(data.user));
        updateHeaderUI();
        if (window.soundManager) window.soundManager.playCheer();
        showToast(data.message);
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
      } else {
        showToast(data.message);
      }
    } catch (err) {
      console.error('Checkin error:', err);
    }
  }

  // Top-up Simulated Modal
  function showTopUpModal() {
    if (!requireAuth()) return;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'topup-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-topup-btn">✕</button>
        <div class="modal-header-title">⚡ شحن محفظة SoulChill الفاخرة</div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 14px;">
          <button class="google-account-option" id="topup-opt-1" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">🪙</span>
              <div>
                <div style="font-weight: 700; color: #fff;">باقة 1,500 عملة سول</div>
                <div style="font-size: 11px; color: var(--text-secondary);">مناسبة للهدايا اليومية والشات</div>
              </div>
            </div>
            <span style="color: #fbbf24; font-weight: 800;">مجاناً للتجربة ✨</span>
          </button>

          <button class="google-account-option" id="topup-opt-2" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">💎</span>
              <div>
                <div style="font-weight: 700; color: #fff;">باقة 1,000 ألماسة ملكية</div>
                <div style="font-size: 11px; color: var(--text-secondary);">لإرسال السيارات الفارهة والصواريخ</div>
              </div>
            </div>
            <span style="color: #38bdf8; font-weight: 800;">مجاناً للتجربة ✨</span>
          </button>

          <button class="google-account-option" id="topup-opt-3" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">👑</span>
              <div>
                <div style="font-weight: 700; color: #fff;">الباقة الإمبراطورية (5,000 💎 + 10,000 🪙)</div>
                <div style="font-size: 11px; color: var(--text-secondary);">تمنحك لقب الداعم الأكبر في الرومات</div>
              </div>
            </div>
            <span style="color: #fbbf24; font-weight: 800;">VIP مجاناً ✨</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-topup-btn').onclick = () => modal.remove();

    const doRecharge = async (coins, diamonds) => {
      try {
        const res = await fetch('/api/users/recharge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ amountCoins: coins, amountDiamonds: diamonds })
        });
        const data = await res.json();
        if (data.success) {
          state.currentUser = data.user;
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          updateHeaderUI();
          if (window.soundManager) window.soundManager.playCheer();
          showToast(`تم شحن ${coins} عملة و ${diamonds} ألماسة بنجاح! 💎🪙`);
          modal.remove();
          if (state.currentTab === 'profile') {
            renderProfileTab(document.getElementById('app-main-content'));
          }
        }
      } catch (err) {
        console.error('Recharge error:', err);
      }
    };

    modal.querySelector('#topup-opt-1').onclick = () => doRecharge(1500, 0);
    modal.querySelector('#topup-opt-2').onclick = () => doRecharge(0, 1000);
    modal.querySelector('#topup-opt-3').onclick = () => doRecharge(10000, 5000);
  }

  // Edit Profile Modal
  function showEditProfileModal() {
    if (!requireAuth()) return;
    const user = state.currentUser;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'edit-profile-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-edit-profile-btn">✕</button>
        <div class="modal-header-title">✏️ تعديل الملف الشخصي</div>

        <!-- Quick Avatar Change Row in Profile Editor -->
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.06); padding: 10px 14px; border-radius: 12px; margin-top: 10px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${user.avatar}" class="google-account-avatar ${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" id="edit-profile-avatar-thumb" />
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">الصورة الشخصية</div>
              <div style="font-size: 11px; color: var(--text-secondary);">رفع من جهازك أو اختيار أفاتار</div>
            </div>
          </div>
          <button type="button" class="wallet-btn secondary" id="btn-edit-avatar-from-edit-modal" style="padding: 5px 12px; font-size: 12px;">
            <span>📷</span> تغيير الصورة
          </button>
        </div>

        <div class="custom-google-login-form">
          <div class="form-group-soul">
            <label>الاسم المستعار</label>
            <input type="text" id="edit-profile-name" class="form-input-soul" value="${user.name}" />
          </div>

          <div class="form-group-soul">
            <label>النبذة الشخصية (Bio)</label>
            <input type="text" id="edit-profile-bio" class="form-input-soul" value="${user.bio || ''}" />
          </div>

          <div class="form-group-soul">
            <label>العمر</label>
            <input type="number" id="edit-profile-age" class="form-input-soul" value="${user.age || 22}" />
          </div>

          <div class="form-group-soul">
            <label>اهتمامات الروح (Soul Tags مفصولة بفواصل)</label>
            <input type="text" id="edit-profile-tags" class="form-input-soul" value="${user.soul_tags || 'موسيقى,هدوء,سفر'}" />
          </div>

          <button class="soul-submit-btn" id="save-profile-btn" style="margin-top: 10px;">
            حفظ التعديلات 💾
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-edit-profile-btn').onclick = () => modal.remove();

    const changeAvatarBtn = modal.querySelector('#btn-edit-avatar-from-edit-modal');
    if (changeAvatarBtn) {
      changeAvatarBtn.onclick = () => {
        showChangeAvatarModal();
      };
    }

    modal.querySelector('#save-profile-btn').onclick = async () => {
      const name = modal.querySelector('#edit-profile-name').value.trim();
      const bio = modal.querySelector('#edit-profile-bio').value.trim();
      const age = parseInt(modal.querySelector('#edit-profile-age').value) || 22;
      const soul_tags = modal.querySelector('#edit-profile-tags').value.trim();

      try {
        const res = await fetch('/api/users/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ name, bio, age, soul_tags })
        });
        const data = await res.json();
        if (data.success) {
          state.currentUser = data.user;
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          updateHeaderUI();
          showToast('تم حفظ الملف الشخصي بنجاح! ✨');
          modal.remove();
          if (state.currentTab === 'profile') {
            renderProfileTab(document.getElementById('app-main-content'));
          }
        }
      } catch (err) {
        console.error('Error updating profile:', err);
      }
    };
  }

  // Sign out & Account Switching
  function handleSignOut() {
    // Clear stored active session credentials
    localStorage.removeItem('soulchill_user');
    localStorage.removeItem('soulchill_token');
    localStorage.removeItem('soulchill_user_id');
    localStorage.removeItem('soulchill_device_persistent');
    localStorage.removeItem('soulchill_auth_email');

    // Notify backend socket session
    if (state.socket) {
      state.socket.emit('user_disconnect');
    }

    // Leave any open voice room or modal
    leaveActiveVoiceRoom();
    hideModal('google-auth-modal');
    hideModal('user-edit-profile-modal');
    hideModal('gift-store-modal');

    state.currentUser = null;
    state.token = null;
    state.userSeatIndex = null;

    updateHeaderUI();
    switchTab('planet');

    showToast('تم تسجيل الخروج بنجاح. يرجى اختيار حسابك المسجل أو الدخول بجيميل جديد 🌟');

    setTimeout(() => {
      showGoogleLoginModal();
    }, 250);
  }

  // ============================================
  // LUXURY GIFTS STORE MODAL
  // ============================================
  async function loadGiftsCatalogue() {
    try {
      const res = await fetch('/api/gifts');
      state.gifts = await res.json();
    } catch (err) {
      console.error('Error loading gifts:', err);
    }
  }

  function openGiftStoreModal(receiverId = null, roomId = null, targetUser = null) {
    if (!requireAuth()) return;
    let selectedGift = state.gifts[0] || null;
    let currentReceiverId = receiverId || (targetUser && targetUser.id ? targetUser.id : null);
    let currentTargetUser = targetUser || null;

    // Build list of available recipients in the room (Host + Mic Seats + Audience + Users)
    const recipientsMap = new Map();
    const addRecipientCandidate = (u, roleTag) => {
      if (!u || !u.id) return;
      if (!recipientsMap.has(u.id)) {
        recipientsMap.set(u.id, {
          id: u.id,
          name: u.name || 'عضو الغرفة',
          avatar: u.avatar || '/avatars/avatar-1.png',
          roleTag: roleTag || '👤 عضو'
        });
      }
    };

    if (currentTargetUser && currentReceiverId) {
      addRecipientCandidate({ id: currentReceiverId, name: currentTargetUser.name, avatar: currentTargetUser.avatar }, '🎁 المستلم');
    }

    if (state.activeRoom) {
      if (state.activeRoom.host_id) {
        addRecipientCandidate({
          id: state.activeRoom.host_id,
          name: state.activeRoom.host_name || 'مضيف الغرفة',
          avatar: state.activeRoom.host_avatar || '/avatars/avatar-1.png'
        }, '👑 المضيف');
      }
      (state.activeRoom.seats || []).forEach(s => {
        if (s && s.user_id) {
          addRecipientCandidate({
            id: s.user_id,
            name: s.name,
            avatar: s.avatar
          }, s.seat_index === 0 ? '👑 المضيف' : `🎙️ مايك #${s.seat_index}`);
        }
      });
      (state.activeRoomAudience || []).forEach(v => {
        if (v && v.id) {
          const isHost = state.activeRoom && v.id === state.activeRoom.host_id;
          addRecipientCandidate({
            id: v.id,
            name: v.name,
            avatar: v.avatar
          }, isHost ? '👑 المضيف' : '👤 مستمع');
        }
      });
    }

    // Also include online users if list is small or outside a room
    (state.allUsers || []).forEach(u => {
      if (u && u.id && (!state.currentUser || u.id !== state.currentUser.id)) {
        if (recipientsMap.size < 12) {
          addRecipientCandidate(u, '🪐 صديق');
        }
      }
    });

    // Put other users before current user
    const allRecipients = Array.from(recipientsMap.values()).sort((a, b) => {
      const aIsSelf = state.currentUser && a.id === state.currentUser.id ? 1 : 0;
      const bIsSelf = state.currentUser && b.id === state.currentUser.id ? 1 : 0;
      return aIsSelf - bIsSelf;
    });

    if (currentReceiverId && !currentTargetUser) {
      currentTargetUser = recipientsMap.get(currentReceiverId) || null;
    }

    // Check if we are in a live video broadcast with an active co-host (PK)
    const hasCohostPk = state.activeRoom && state.activeRoom.room_type === 'video' && state.activeCohostUser;
    let selectedTargetTeam = 'host';
    if (hasCohostPk) {
      if (receiverId && state.activeCohostUser && receiverId === state.activeCohostUser.id) {
        selectedTargetTeam = 'challenger';
        currentReceiverId = state.activeCohostUser.id;
        currentTargetUser = { name: state.activeCohostUser.name, id: state.activeCohostUser.id, avatar: state.activeCohostUser.avatar };
      } else {
        selectedTargetTeam = 'host';
        currentReceiverId = state.activeRoom.host_id;
        currentTargetUser = { name: state.activeRoom.host_name, id: state.activeRoom.host_id, avatar: state.activeRoom.host_avatar };
      }
    }

    const existingModal = document.getElementById('gift-store-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'gift-store-modal';

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-gifts-modal-btn">✕</button>
        <div class="modal-header-title">
          🎁 متجر الهدايا الفاخرة
          <div style="font-size: 11px; color: var(--text-secondary); font-weight: 600;" id="gift-modal-target-desc">
            ${currentTargetUser ? `الإهداء إلى: 🎁 ${currentTargetUser.name}` : 'يرجى تحديد الشخص المستلم للهدية من القائمة أدناه 👇'}
          </div>
        </div>

        ${hasCohostPk ? `
          <div style="background: rgba(0,0,0,0.35); border-radius: 12px; padding: 8px 10px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.12);">
            <div style="font-size: 11px; font-weight: 800; color: #fbbf24; text-align: center; margin-bottom: 6px;">
              🎁 اختر من تريد إهداءه ودعمه في البث المباشر (تزيد نقاطه في التحدي):
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="wallet-btn ${selectedTargetTeam === 'host' ? 'primary' : 'secondary'}" id="gift-target-host-btn" style="flex: 1; padding: 7px 4px; font-size: 11px;">
                🔴 المضيف: ${state.activeRoom.host_name || 'المضيف'}
              </button>
              <button type="button" class="wallet-btn ${selectedTargetTeam === 'challenger' ? 'primary' : 'secondary'}" id="gift-target-challenger-btn" style="flex: 1; padding: 7px 4px; font-size: 11px;">
                🔵 الشريك: ${state.activeCohostUser.name}
              </button>
            </div>
          </div>
        ` : `
          <!-- Recipient Person Selector (تحديد الشخص المستلم للهدية) -->
          <div class="gift-recipient-selector-box" id="gift-recipient-selector-box">
            <div class="gift-recipient-header">
              <span>👤 حدد الشخص المستلم للهدية:</span>
              <span class="gift-selected-person-pill ${currentTargetUser ? 'has-target' : ''}" id="gift-selected-person-pill">
                ${currentTargetUser ? `✅ ${currentTargetUser.name}` : '⚠️ لم يتم التحديد'}
              </span>
            </div>
            <div class="gift-recipients-track" id="gift-recipients-track">
              ${allRecipients.map(p => `
                <div class="gift-recipient-chip ${currentReceiverId === p.id ? 'selected' : ''}" data-user-id="${p.id}" data-user-name="${p.name}" data-user-avatar="${p.avatar}">
                  <div class="gift-recipient-avatar-wrap">
                    <img src="${p.avatar}" onerror="this.src='/avatars/avatar-1.png'" />
                    <span class="gift-recipient-check">✓</span>
                  </div>
                  <div class="gift-recipient-info">
                    <div class="gift-recipient-name">${p.name}</div>
                    <div class="gift-recipient-role">${p.roleTag}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `}

        <div class="gift-shelf-grid">
          ${state.gifts.map((g, idx) => `
            <div class="gift-shelf-item ${idx === 0 ? 'selected' : ''}" data-gift-id="${g.id}">
              <div class="gift-shelf-icon">${g.icon}</div>
              <div class="gift-shelf-name">${g.name}</div>
              <div class="gift-shelf-price">${g.cost} ${g.currency === 'coins' ? '🪙' : '💎'}</div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);">
          <div style="font-size: 12px; color: var(--text-secondary);">
            رصيدك: <strong style="color: #fbbf24;">${state.currentUser.coins} 🪙</strong> | <strong style="color: #38bdf8;">${state.currentUser.diamonds} 💎</strong>
          </div>
          <button class="soul-submit-btn" id="send-gift-action-btn" style="padding: 6px 16px; font-size: 12px;">
            ${currentTargetUser ? `إرسال إلى ${currentTargetUser.name} 🎁` : 'إرسال الهدية 🎁'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-gifts-modal-btn').onclick = () => modal.remove();

    const descEl = modal.querySelector('#gift-modal-target-desc');
    const selectedPillEl = modal.querySelector('#gift-selected-person-pill');
    const sendBtnEl = modal.querySelector('#send-gift-action-btn');
    const selectorBoxEl = modal.querySelector('#gift-recipient-selector-box');

    // Recipient Chip Clicks
    modal.querySelectorAll('.gift-recipient-chip').forEach(chip => {
      chip.onclick = () => {
        modal.querySelectorAll('.gift-recipient-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        currentReceiverId = chip.dataset.userId;
        currentTargetUser = {
          id: chip.dataset.userId,
          name: chip.dataset.userName,
          avatar: chip.dataset.userAvatar
        };
        if (selectorBoxEl) selectorBoxEl.classList.remove('shake-warning');
        if (descEl) descEl.innerText = `الإهداء إلى: 🎁 ${currentTargetUser.name} (تُحفظ في هداياه)`;
        if (selectedPillEl) {
          selectedPillEl.innerText = `✅ ${currentTargetUser.name}`;
          selectedPillEl.classList.add('has-target');
        }
        if (sendBtnEl) {
          sendBtnEl.innerText = `إرسال إلى ${currentTargetUser.name} 🎁`;
        }
      };
    });

    if (hasCohostPk) {
      const targetHostBtn = modal.querySelector('#gift-target-host-btn');
      const targetChallengerBtn = modal.querySelector('#gift-target-challenger-btn');

      targetHostBtn.onclick = () => {
        selectedTargetTeam = 'host';
        targetHostBtn.className = 'wallet-btn primary';
        targetChallengerBtn.className = 'wallet-btn secondary';
        currentReceiverId = state.activeRoom.host_id;
        currentTargetUser = { name: state.activeRoom.host_name, id: state.activeRoom.host_id };
        if (descEl) descEl.innerText = `الدعم مخصص لـ: 🔴 ${state.activeRoom.host_name}`;
      };

      targetChallengerBtn.onclick = () => {
        selectedTargetTeam = 'challenger';
        targetChallengerBtn.className = 'wallet-btn primary';
        targetHostBtn.className = 'wallet-btn secondary';
        currentReceiverId = state.activeCohostUser.id;
        currentTargetUser = { name: state.activeCohostUser.name, id: state.activeCohostUser.id };
        if (descEl) descEl.innerText = `الدعم مخصص لـ: 🔵 ${state.activeCohostUser.name}`;
      };
    }

    modal.querySelectorAll('.gift-shelf-item').forEach(item => {
      item.onclick = () => {
        modal.querySelectorAll('.gift-shelf-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedGift = state.gifts.find(g => g.id === item.dataset.giftId);
      };
    });

    modal.querySelector('#send-gift-action-btn').onclick = async () => {
      if (!selectedGift) return;

      if (!currentReceiverId) {
        if (selectorBoxEl) {
          selectorBoxEl.classList.remove('shake-warning');
          void selectorBoxEl.offsetWidth;
          selectorBoxEl.classList.add('shake-warning');
        }
        showToast('⚠️ يرجى تحديد الشخص المستلم للهدية أولاً من القائمة أعلاه! 👤🎁');
        return;
      }

      try {
        const res = await fetch('/api/gifts/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({
            receiver_id: currentReceiverId,
            room_id: roomId || (state.activeRoom ? state.activeRoom.id : null),
            gift_id: selectedGift.id
          })
        });

        const data = await res.json();
        if (data.success) {
          state.currentUser = data.sender;
          localStorage.setItem('soulchill_user', JSON.stringify(data.sender));
          updateHeaderUI();

          const finalReceiver = data.receiver || currentTargetUser;

          // Trigger local animation
          if (window.giftEffectsEngine) {
            window.giftEffectsEngine.showGiftAnimation(selectedGift, state.currentUser, finalReceiver);
          }

          // Refresh receiver's gift wall if visible
          if (currentReceiverId) {
            document.querySelectorAll(`.user-received-gifts-box[data-user-id="${currentReceiverId}"]`).forEach(box => {
              loadAndRenderUserGiftsSection(currentReceiverId, box, state.currentUser && state.currentUser.id === currentReceiverId);
            });
          }

          modal.remove();
          showToast(`🎁 أرسلت ${selectedGift.name} ${selectedGift.icon} إلى ${finalReceiver?.name || 'المستلم'} وتم حفظها في هداياه! ✨`);
        } else {
          showToast(data.error || 'فشل إرسال الهدية');
        }
      } catch (err) {
        console.error('Error sending gift:', err);
      }
    };
  }

  // Helpers to persist and retrieve registered accounts on this device
  function getSavedDeviceAccounts() {
    try {
      const raw = localStorage.getItem('soulchill_saved_device_accounts');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => a && a.email && a.email.includes('@'));
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  function saveDeviceAccount(user) {
    if (!user || !user.email) return;
    try {
      let accounts = getSavedDeviceAccounts();
      // Remove any existing entry for this email (case-insensitive)
      accounts = accounts.filter(a => a.email.toLowerCase() !== user.email.toLowerCase());
      // Prepend current account to the top
      accounts.unshift({
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        avatar: user.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(user.name || user.email)}`,
        last_login: Date.now()
      });
      // Keep up to 6 registered accounts on this device
      if (accounts.length > 6) accounts = accounts.slice(0, 6);
      localStorage.setItem('soulchill_saved_device_accounts', JSON.stringify(accounts));
    } catch (e) {
      console.warn('Error saving device account:', e);
    }
  }

  // ============================================
  // REAL GMAIL AUTHENTICATION & GOOGLE MODAL
  // ============================================
  function showGoogleLoginModal() {
    let existing = document.getElementById('google-auth-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'google-auth-modal';

    // Fetch accounts that were previously authenticated on this specific device ONLY
    const savedAccounts = getSavedDeviceAccounts();

    modal.innerHTML = `
      <div class="soul-modal-content google-auth-card" style="max-width: 420px; position: relative;">
        <button class="soul-modal-close-btn" id="close-google-auth-btn" title="إغلاق">✕</button>

        <div class="google-auth-logo-row" style="margin-bottom: 8px;">
          <div class="brand-logo-icon" style="width: 40px; height: 40px; font-size: 22px;">🪐</div>
          <span style="font-size: 20px; font-weight: 800; color: #fff;">SoulChill</span>
        </div>

        <div style="font-size: 16px; font-weight: 700; color: #fff; text-align: center; margin-bottom: 4px;">
          تسجيل الدخول والتحقق عبر Gmail
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); text-align: center; margin-bottom: 18px; line-height: 1.4;">
          أدخل بريد Gmail الخاص بك وسيصلك رمز تحقق حقيقي (OTP) لتفعيل الحساب
        </p>

        <!-- STEP 1: Enter Real Gmail -->
        <div id="gmail-auth-step-1">
          <div class="form-group-soul" style="margin-bottom: 8px;">
            <label>عنوان بريد Gmail الفعلي الخاص بك:</label>
            <input type="email" id="real-gmail-input" class="form-input-soul" placeholder="username@gmail.com" />
          </div>

          <div style="display: flex; gap: 6px; margin-bottom: 12px; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted);">إكمال سريع:</span>
            <button type="button" class="quick-domain-chip" data-domain="@gmail.com" style="background: rgba(139, 92, 246, 0.2); border: 1px solid var(--border-glass); color: #c084fc; padding: 3px 10px; border-radius: 999px; font-size: 11px; cursor: pointer;">@gmail.com</button>
          </div>

          <div class="form-group-soul" style="margin-bottom: 14px;">
            <label>الاسم المستعار في الغرف (اختياري):</label>
            <input type="text" id="real-name-input" class="form-input-soul" placeholder="اسمك المستعار في الغرف الصوتية" />
          </div>

          <button class="google-official-primary-btn" id="btn-request-gmail-otp" style="margin-bottom: 6px;">
            <svg class="google-g-icon" viewBox="0 0 24 24" style="width: 22px; height: 22px;">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>إرسال رمز التحقق إلى الجيميل 📨</span>
          </button>
          <div style="font-size: 11px; color: var(--text-muted); text-align: center; margin-bottom: ${savedAccounts.length > 0 ? '16px' : '6px'};">
            🔒 إرسال فوري ومباشر عبر خادم Google SMTP الآمن
          </div>

          <!-- ONLY SHOW PREVIOUSLY REGISTERED ACCOUNTS ON THIS SPECIFIC DEVICE -->
          ${savedAccounts.length > 0 ? `
            <div style="padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">
              <div style="font-size: 11.5px; color: var(--text-secondary); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                <span>الحسابات المسجلة مسبقاً على هذا الجهاز:</span>
                <span style="font-size: 10px; color: #a855f7;">${savedAccounts.length} حساب</span>
              </div>
              <div id="google-accounts-oauth-list" style="display: flex; flex-direction: column; gap: 8px;">
                ${savedAccounts.map(acc => `
                  <div class="google-account-list-item google-account-option-choice saved-device-account-btn" data-email="${acc.email}" data-name="${acc.name}" data-avatar="${acc.avatar}" style="border-color: rgba(192, 132, 252, 0.35); background: rgba(139, 92, 246, 0.08); cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; transition: all 0.2s ease;">
                    <img src="${acc.avatar}" class="google-account-avatar-circle" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid #a855f7;" />
                    <div style="flex: 1; min-width: 0; text-align: right;">
                      <div class="google-account-user-name" style="font-weight: 700; color: #fff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${acc.name}</div>
                      <div class="google-account-user-email" style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${acc.email}</div>
                    </div>
                    <span style="color: #c084fc; font-size: 12px; font-weight: 700; white-space: nowrap; background: rgba(192, 132, 252, 0.15); padding: 4px 10px; border-radius: 999px;">دخول ➔</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- STEP 2: Enter & Verify Code Received in Inbox -->
        <div id="gmail-auth-step-2" style="display: none; text-align: center;">
          <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
            <div style="font-size: 14px; font-weight: 700; color: #10b981;">✅ تم إرسال رمز التحقق بنجاح!</div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">تفقد صندوق الوارد في Gmail: <strong id="otp-target-email-display" style="color: #fbbf24;"></strong></div>
          </div>

          <div class="form-group-soul" style="text-align: center;">
            <label style="text-align: center;">أدخل رمز التحقق السداسي (OTP) المكوّن من 6 أرقام:</label>
            <input type="text" id="otp-code-input" class="form-input-soul" maxlength="6" style="text-align: center; font-size: 24px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; background: rgba(0,0,0,0.4);" placeholder="------" />
          </div>

          <button class="soul-submit-btn" id="btn-verify-gmail-otp" style="width: 100%; margin-top: 10px; padding: 13px; font-size: 14px;">
            تأكيد وتفعيل الحساب والدخول الآن ✅
          </button>

          <div style="text-align: center; margin-top: 14px;">
            <button type="button" id="btn-back-to-step-1" style="background: none; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; text-decoration: underline;">
              ‹ تغيير البريد أو إعادة إرسال الرمز
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    const closeBtn = modal.querySelector('#close-google-auth-btn');
    if (closeBtn) closeBtn.onclick = () => modal.remove();

    const step1 = modal.querySelector('#gmail-auth-step-1');
    const step2 = modal.querySelector('#gmail-auth-step-2');
    const realGmailInput = modal.querySelector('#real-gmail-input');
    const realNameInput = modal.querySelector('#real-name-input');
    const otpCodeInput = modal.querySelector('#otp-code-input');
    const btnRequestOtp = modal.querySelector('#btn-request-gmail-otp');
    const btnVerifyOtp = modal.querySelector('#btn-verify-gmail-otp');
    const btnBackToStep1 = modal.querySelector('#btn-back-to-step-1');

    // Quick Domain Chip
    modal.querySelectorAll('.quick-domain-chip').forEach(chip => {
      chip.onclick = () => {
        const domain = chip.dataset.domain;
        const val = realGmailInput.value.trim();
        if (!val) {
          realGmailInput.value = domain;
        } else if (val.includes('@')) {
          realGmailInput.value = val.split('@')[0] + domain;
        } else {
          realGmailInput.value = val + domain;
        }
        realGmailInput.focus();
      };
    });

    // Click on a previously registered device account
    modal.querySelectorAll('.saved-device-account-btn').forEach(btn => {
      btn.onclick = async () => {
        const email = btn.dataset.email;
        const name = btn.dataset.name;
        const avatar = btn.dataset.avatar;
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        await loginWithGooglePayload({ email, name, avatar });
      };
    });

    // 2. Request Real Gmail OTP via SMTP
    let currentEmailForOtp = '';
    btnRequestOtp.onclick = async () => {
      const email = realGmailInput.value.trim();
      const name = realNameInput.value.trim();

      if (!email || !email.includes('@')) {
        showToast('يرجى إدخال عنوان Gmail صحيح!');
        realGmailInput.focus();
        return;
      }

      currentEmailForOtp = email;
      btnRequestOtp.disabled = true;
      btnRequestOtp.innerText = 'جارِ إرسال الرمز عبر خادم SMTP... ⏳';

      try {
        const res = await fetch('/api/auth/send-gmail-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name })
        });
        const data = await res.json();

        if (data.success) {
          step1.style.display = 'none';
          step2.style.display = 'block';
          modal.querySelector('#otp-target-email-display').innerText = email;
          otpCodeInput.value = '';
          otpCodeInput.focus();
          showToast(`تم إرسال رمز التحقق إلى ${email}! تفقد بريدك الوارد 📨`, 'success');
        } else {
          showToast(data.error || 'فشل إرسال رمز التحقق');
          btnRequestOtp.disabled = false;
          btnRequestOtp.innerText = 'إرسال رمز التحقق إلى الجيميل 📨';
        }
      } catch (err) {
        console.error('Error requesting OTP:', err);
        showToast('حدث خطأ أثناء الاتصال بالخادم');
        btnRequestOtp.disabled = false;
        btnRequestOtp.innerText = 'إرسال رمز التحقق إلى الجيميل 📨';
      }
    };

    // 3. Verify OTP Code & Login
    btnVerifyOtp.onclick = async () => {
      const code = otpCodeInput.value.trim();
      const name = realNameInput.value.trim();

      if (!code || code.length < 6) {
        showToast('يرجى كتابة رمز التحقق السداسي (6 أرقام)!');
        otpCodeInput.focus();
        return;
      }

      btnVerifyOtp.disabled = true;
      btnVerifyOtp.innerText = 'جارِ التحقق وتوثيق الحساب... ⏳';

      try {
        const res = await fetch('/api/auth/verify-gmail-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: currentEmailForOtp,
            code,
            name
          })
        });
        const data = await res.json();

        if (data.success && data.user) {
          state.currentUser = data.user;
          state.token = data.token;

          // Permanently persist on this device
          localStorage.setItem('soulchill_user_id', data.user.id);
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          localStorage.setItem('soulchill_token', data.token);
          localStorage.setItem('soulchill_device_persistent', 'true');
          localStorage.setItem('soulchill_auth_email', data.user.email);

          // Save account in registered device accounts list
          saveDeviceAccount(data.user);

          if (window.soundManager) window.soundManager.playCheer();
          showToast(data.message || `تم توثيق حساب الجيميل بنجاح! مرحباً بك 🪐✨`);
          onUserAuthenticated();
        } else {
          showToast(data.error || 'رمز التحقق غير صحيح أو انتهت صلاحيته');
          btnVerifyOtp.disabled = false;
          btnVerifyOtp.innerText = 'تأكيد وتفعيل الحساب والدخول الآن ✅';
        }
      } catch (err) {
        console.error('Verify OTP error:', err);
        showToast('حدث خطأ في التحقق من الرمز');
        btnVerifyOtp.disabled = false;
        btnVerifyOtp.innerText = 'تأكيد وتفعيل الحساب والدخول الآن ✅';
      }
    };

    // 4. Back to Step 1
    btnBackToStep1.onclick = () => {
      step2.style.display = 'none';
      step1.style.display = 'block';
      btnRequestOtp.disabled = false;
      btnRequestOtp.innerText = 'إرسال رمز التحقق إلى الجيميل 📨';
    };
  }

  // Official Google Payload Authentication & Device Persistence
  async function loginWithGooglePayload({ email, name, avatar }) {
    try {
      showToast('جارِ الاتصال بـ Google والمصادقة... ⏳');
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          avatar,
          google_id: `google-${email}`
        })
      });

      const data = await res.json();
      if (data.success && data.user) {
        state.currentUser = data.user;
        state.token = data.token;

        // Permanently persist on this device
        localStorage.setItem('soulchill_user_id', data.user.id);
        localStorage.setItem('soulchill_user', JSON.stringify(data.user));
        localStorage.setItem('soulchill_token', data.token);
        localStorage.setItem('soulchill_device_persistent', 'true');
        localStorage.setItem('soulchill_auth_email', data.user.email);

        // Save account in registered device accounts list
        saveDeviceAccount(data.user);

        if (window.soundManager) window.soundManager.playCheer();
        showToast(`تم ربط حساب Google بنجاح والتحقق منه على هذا الجهاز! 🪐✨`);
        onUserAuthenticated();
      } else {
        showToast(data.error || 'فشل تسجيل الدخول عبر Google');
      }
    } catch (err) {
      console.error('Google auth error:', err);
      showToast('خطأ في الاتصال بالخادم');
    }
  }

  // ============================================
  // CHANGE PROFILE AVATAR MODAL
  // ============================================
  function showChangeAvatarModal() {
    if (!requireAuth()) return;
    const user = state.currentUser;

    let existing = document.getElementById('avatar-changer-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'avatar-changer-modal';

    const avatarPresets = [
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Shadow',
      'https://api.dicebear.com/7.x/micah/svg?seed=Princess'
    ];

    let selectedFile = null;
    let selectedAvatarUrl = user.avatar;

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 440px;">
        <button class="soul-modal-close-btn" id="close-avatar-changer-btn">✕</button>
        <div class="modal-header-title">📷 تغيير الصورة الشخصية</div>

        <!-- Current / Live Preview -->
        <div style="text-align: center; margin-bottom: 14px;">
          <img id="avatar-changer-preview-img" src="${user.avatar}" class="avatar-preview-large-circle ${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">معاينة صورتك الشخصية</div>
        </div>

        <!-- 1. Upload from Device / Camera -->
        <div class="avatar-upload-dropzone" id="avatar-dropzone-btn">
          <input type="file" id="avatar-device-file-input" accept="image/*" style="display: none;" />
          <div style="font-size: 32px; margin-bottom: 6px;">📁</div>
          <div style="font-size: 13px; font-weight: 700; color: #fff;">رفع صورة من جهازك أو الكاميرا</div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">اضغط هنا لاختيار أي صورة من هاتفك أو التقاط صورة</div>
        </div>

        <!-- 2. Avatar Presets Grid -->
        <div style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px;">أو اختر أفاتار من المعرض الفاخر:</div>
        <div class="avatar-presets-grid">
          ${avatarPresets.map(url => `
            <div class="avatar-preset-item ${url === user.avatar ? 'selected' : ''}" data-url="${url}">
              <img src="${url}" />
            </div>
          `).join('')}
        </div>

        <!-- 3. Custom Image URL -->
        <div class="form-group-soul" style="margin-bottom: 14px;">
          <label>أو ضع رابط صورة مخصص (URL):</label>
          <input type="text" id="avatar-custom-url-field" class="form-input-soul" placeholder="https://..." value="${user.avatar.startsWith('http') ? user.avatar : ''}" />
        </div>

        <!-- Action Button -->
        <button class="soul-submit-btn" id="btn-confirm-avatar-save" style="width: 100%; padding: 12px; font-size: 14px;">
          حفظ وتطبيق الصورة الشخصية فوراً ✅
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-avatar-changer-btn').onclick = () => modal.remove();

    // Trigger File Input on Dropzone Click
    const fileInput = modal.querySelector('#avatar-device-file-input');
    const dropzone = modal.querySelector('#avatar-dropzone-btn');
    const previewImg = modal.querySelector('#avatar-changer-preview-img');

    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (re) => {
          previewImg.src = re.target.result;
          selectedAvatarUrl = re.target.result;
          modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
        };
        reader.readAsDataURL(file);
      }
    };

    // Preset Selection
    modal.querySelectorAll('.avatar-preset-item').forEach(item => {
      item.onclick = () => {
        modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedFile = null;
        selectedAvatarUrl = item.dataset.url;
        previewImg.src = selectedAvatarUrl;
        const urlField = modal.querySelector('#avatar-custom-url-field');
        if (urlField) urlField.value = selectedAvatarUrl;
      };
    });

    // Custom URL Input
    const customUrlField = modal.querySelector('#avatar-custom-url-field');
    customUrlField.oninput = () => {
      const val = customUrlField.value.trim();
      if (val && val.startsWith('http')) {
        selectedFile = null;
        selectedAvatarUrl = val;
        previewImg.src = val;
        modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
      }
    };

    // Save Button
    const saveBtn = modal.querySelector('#btn-confirm-avatar-save');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.innerText = 'جارِ حفظ وتحديث الصورة... ⏳';

      try {
        let finalAvatarUrl = selectedAvatarUrl;

        if (selectedFile) {
          const formData = new FormData();
          formData.append('avatar', selectedFile);

          const uploadRes = await fetch('/api/users/avatar', {
            method: 'POST',
            headers: { 'x-user-id': user.id },
            body: formData
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.user) {
            state.currentUser = uploadData.user;
            finalAvatarUrl = uploadData.avatar;
          } else {
            throw new Error(uploadData.error || 'فشل رفع الصورة');
          }
        } else {
          const updateRes = await fetch('/api/users/avatar', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({ avatar_url: finalAvatarUrl })
          });
          const updateData = await updateRes.json();
          if (updateData.success && updateData.user) {
            state.currentUser = updateData.user;
            finalAvatarUrl = updateData.avatar;
          } else {
            throw new Error(updateData.error || 'فشل تحديث الصورة');
          }
        }

        // Save persistent user in localStorage
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        localStorage.setItem('soulchill_user_id', state.currentUser.id);

        // Update DOM elements everywhere
        updateHeaderUI();
        const profileAvatar = document.getElementById('profile-page-avatar');
        if (profileAvatar) profileAvatar.src = finalAvatarUrl;

        // If in a room and seated, update seat and notify room
        if (state.activeRoomSeats) {
          state.activeRoomSeats.forEach(s => {
            if (s.user && s.user.id === user.id) {
              s.user.avatar = finalAvatarUrl;
            }
          });
          renderRoomSeatsGrid(state.activeRoomSeats);
        }

        if (state.socket) {
          state.socket.emit('user_avatar_changed', { userId: user.id, avatar: finalAvatarUrl });
        }

        modal.remove();
        showToast('تم تحديث صورتك الشخصية بنجاح! 📸✨');

        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
      } catch (err) {
        console.error('Avatar save error:', err);
        showToast(err.message || 'حدث خطأ أثناء تحديث الصورة الشخصية');
        saveBtn.disabled = false;
        saveBtn.innerText = 'حفظ وتطبيق الصورة الشخصية فوراً ✅';
      }
    };
  }

  // ============================================
  // EVENT LISTENERS & SETUP
  // ============================================
  function setupEventListeners() {
    // Bottom Nav Tabs
    document.querySelectorAll('.nav-tab-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.dataset.tab;
        if (window.soundManager) window.soundManager.playClick();
        switchTab(tab);
      });
    });

    // Top Header currency clicks (opens top-up)
    const coinsBadge = document.getElementById('header-coins-badge');
    const diamondsBadge = document.getElementById('header-diamonds-badge');
    if (coinsBadge) coinsBadge.onclick = () => showTopUpModal();
    if (diamondsBadge) diamondsBadge.onclick = () => showTopUpModal();

    // Daily bonus top button
    const dailyBonusBtn = document.getElementById('header-daily-checkin-btn');
    if (dailyBonusBtn) dailyBonusBtn.onclick = () => handleDailyCheckIn();

    // Mode Switcher (Mobile App Frame vs Fullscreen)
    const modeBtn = document.getElementById('header-mode-toggle-btn');
    if (modeBtn) {
      modeBtn.onclick = () => {
        state.isFullScreen = !state.isFullScreen;
        const container = document.getElementById('main-app-container');
        if (container) {
          container.classList.toggle('fullscreen-mode', state.isFullScreen);
        }
        modeBtn.innerText = state.isFullScreen ? '📱' : '💻';
        showToast(state.isFullScreen ? 'نمط الشاشة الكاملة 💻' : 'نمط تطبيق الهاتف 📱');
      };
    }

    // Language Toggle (العربية / English)
    const langBtn = document.getElementById('header-lang-toggle-btn');
    if (langBtn) {
      langBtn.onclick = () => {
        state.lang = state.lang === 'ar' ? 'en' : 'ar';
        document.body.classList.toggle('ltr', state.lang === 'en');
        langBtn.innerText = state.lang === 'ar' ? 'EN' : 'عربي';
        showToast(state.lang === 'ar' ? 'تم تحويل اللغة إلى العربية' : 'Language switched to English');
      };
    }

    // User Avatar in Header
    const headerAvatar = document.getElementById('header-user-avatar-btn');
    if (headerAvatar) {
      headerAvatar.onclick = () => {
        if (!state.currentUser) {
          showGoogleLoginModal();
        } else {
          switchTab('profile');
        }
      };
    }
  }

  // Helper: Toast message
  function showToast(msg) {
    let oldToast = document.querySelector('.soul-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'soul-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function showGlobalAnnouncementBanner(msg) {
    const existing = document.querySelector('.global-announcement-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'global-announcement-banner';
    banner.innerHTML = `
      <span style="font-size: 16px;">👑</span>
      <div>
        <div style="font-size: 11px; color: #fef08a;">إعلان رسمي من إدارة التطبيق العليا:</div>
        <div>${msg}</div>
      </div>
    `;
    document.body.appendChild(banner);
    if (window.soundManager) window.soundManager.playCheer();
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.5s ease';
      setTimeout(() => banner.remove(), 500);
    }, 8000);
  }

  function hideModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  window.SoulChillApp = {
    state,
    switchTab,
    showToast,
    openVoiceRoom
  };

})();
