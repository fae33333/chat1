/* لوحة الإدارة ← التحكم الكامل بالإشعارات (PWA / Web Push / VAPID / SQLite) */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => {
    try { if (typeof state !== 'undefined' && state && state.token) return state.token; } catch (e) {}
    try { return sessionStorage.getItem('soulchill_admin_token') || ''; } catch (e) { return ''; }
  };
  async function api(url, method, body) {
    const res = await fetch(url, { method: method || 'GET', headers: Object.assign({ 'x-admin-token': token() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const ctype = String(res.headers.get('content-type') || '');
    if (!/json/i.test(ctype) && res.status !== 401) {
      throw new Error('السيرفر لا يحتوي مسارات الإشعارات (' + url + '). انسخ push.js و server.js المحدّثين ثم أعد تشغيل السيرفر (node server.js).');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('انتهت جلسة الإدارة، سجّل الدخول من جديد');
    if (!res.ok || data.success === false) throw new Error(data.error || 'تعذر تنفيذ الطلب');
    return data;
  }
  const toast = (m, t) => { try { showToast(m, t || 'success'); } catch (e) { console.log(m); } };
  const fail = (e) => { try { showAdminNotice(e.message || String(e)); } catch (x) { alert(e.message || e); } };
  const fmt = (d) => d ? String(d).replace('T', ' ').slice(0, 16) : '—';
  function device(ua) {
    ua = String(ua || '');
    const os = /iPhone|iPad/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'جهاز';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return os + (br ? ' · ' + br : '');
  }

  async function loadPush() {
    try {
      const s = await api('/api/admin/push/status');
      $('push-enabled').checked = !!s.enabled;
      const ev = s.events || {};
      ['follow', 'message', 'room_invite'].forEach((k) => { const c = $('push-evt-' + k); if (c) c.checked = ev[k] !== false; });
      if ($('push-only-offline')) $('push-only-offline').checked = s.onlyOffline !== false;
      $('push-subject').value = s.subject || '';
      $('push-pubkey').value = s.publicKey || '';
      $('push-total').textContent = s.total;
      $('push-users').textContent = s.users;
      $('push-week').textContent = s.week;
      $('push-warn').hidden = s.webPushInstalled !== false;
      if (s.webPushError) $('push-warn').textContent = '⚠️ تعذر تحميل web-push: ' + s.webPushError + ' — نفّذ npm install ثم أعد تشغيل السيرفر.';
      $('push-log').innerHTML = (s.log || []).map((l) => `<tr><td>${esc(fmt(l.created_at))}</td><td>${esc(l.title)}</td><td>${esc(l.target)}</td><td>✅ ${l.sent} · ⚠️ ${l.failed} · 🧹 ${l.removed}</td></tr>`).join('') || '<tr><td colspan="4" style="opacity:.6">لا توجد إرساليات بعد</td></tr>';
      await loadSubs();
    } catch (e) { fail(e); }
  }

  async function loadSubs() {
    const q = ($('push-search').value || '').trim();
    const d = await api('/api/admin/push/subscriptions?q=' + encodeURIComponent(q));
    $('push-subs').innerHTML = (d.subscriptions || []).map((r) => `<tr>
      <td>${esc(r.user_name || r.user_id || 'زائر')}</td><td>${esc(device(r.user_agent))}</td><td>${esc(fmt(r.created_at))}</td><td>${esc(fmt(r.last_ok_at))}</td>
      <td><button type="button" class="btn-action" data-push-test="${r.id}">تجربة</button> <button type="button" class="btn-action danger" data-push-del="${r.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="5" style="opacity:.6">لا توجد أجهزة مشتركة</td></tr>';
  }

  function composeBody(extra) {
    return Object.assign({
      title: $('push-title').value.trim(),
      body: $('push-body').value.trim(),
      url: $('push-url').value.trim(),
      image: $('push-image').value.trim(),
      ttlSeconds: parseInt($('push-ttl').value, 10) || 86400
    }, extra || {});
  }

  async function sendPush() {
    const target = $('push-target').value;
    const body = composeBody({ target, userIds: $('push-userids').value });
    if (!body.title || !body.body) return fail(new Error('العنوان والنص مطلوبان'));
    const ok = target === 'all' && typeof uiConfirm === 'function' ? await uiConfirm('سيصل هذا الإشعار لكل الأجهزة المشتركة. متابعة؟', { icon: '🔔', okText: 'إرسال' }) : true;
    if (!ok) return;
    const btn = $('push-send'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'جارٍ الإرسال…';
    try {
      const r = await api('/api/admin/push/send', 'POST', body);
      toast(`تم الإرسال: ${r.sent} نجح، ${r.failed} فشل، ${r.removed} جهاز منتهٍ حُذف`, r.failed && !r.sent ? 'info' : 'success');
      if (r.failed && r.errors && r.errors.length) fail(new Error('سبب الفشل: ' + r.errors.join(' | ')));
      await loadPush();
    } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = old; }
  }

  async function onClick(e) {
    const t = e.target.closest('[data-push-test],[data-push-del],[data-push-act]');
    if (!t) return;
    try {
      if (t.dataset.pushTest) {
        const b = composeBody({ target: 'subscription', subscriptionId: t.dataset.pushTest });
        if (!b.title) b.title = 'تجربة إشعار';
        if (!b.body) b.body = 'هذه رسالة تجريبية من لوحة الإدارة 🔔';
        const r = await api('/api/admin/push/send', 'POST', b);
        toast(r.sent ? 'وصل الإشعار للجهاز' : 'تعذر الوصول للجهاز', r.sent ? 'success' : 'info');
        if (!r.sent && r.errors && r.errors.length) fail(new Error('سبب الفشل: ' + r.errors.join(' | ')));
        loadPush();
      } else if (t.dataset.pushDel) {
        await api('/api/admin/push/subscriptions/' + encodeURIComponent(t.dataset.pushDel), 'DELETE');
        toast('تم حذف الجهاز', 'info'); loadPush();
      } else if (t.dataset.pushAct === 'copy') {
        try { await navigator.clipboard.writeText($('push-pubkey').value); toast('تم نسخ المفتاح العام'); } catch (x) { $('push-pubkey').select(); }
      } else if (t.dataset.pushAct === 'save') {
        await api('/api/admin/push/settings', 'PUT', {
          enabled: $('push-enabled').checked, subject: $('push-subject').value.trim(),
          events: { follow: $('push-evt-follow').checked, message: $('push-evt-message').checked, room_invite: $('push-evt-room_invite').checked },
          onlyOffline: $('push-only-offline').checked
        });
        toast('تم حفظ الإعدادات'); loadPush();
      } else if (t.dataset.pushAct === 'regen') {
        const ok = typeof uiConfirm === 'function' ? await uiConfirm('توليد مفاتيح VAPID جديدة يلغي كل الاشتراكات الحالية، وعلى المستخدمين تفعيل الإشعارات من جديد. متابعة؟', { icon: '🔑', danger: true, okText: 'توليد' }) : true;
        if (!ok) return;
        const r = await api('/api/admin/push/regenerate-keys', 'POST', {});
        toast(`تم توليد مفاتيح جديدة (حُذف ${r.cleared} اشتراك)`); loadPush();
      } else if (t.dataset.pushAct === 'refresh') loadPush();
    } catch (err) { fail(err); }
  }

  function init() {
    if (!$('tab-push') || $('tab-push').dataset.bound) return;
    $('tab-push').dataset.bound = '1';
    $('tab-push').addEventListener('click', onClick);
    $('push-send').addEventListener('click', sendPush);
    $('push-target').addEventListener('change', () => { $('push-userids-wrap').hidden = $('push-target').value !== 'users'; });
    let tm; $('push-search').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => loadSubs().catch(fail), 300); });
  }
  window.loadPushTab = function () { init(); loadPush(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
