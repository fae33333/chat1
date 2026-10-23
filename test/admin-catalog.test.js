const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/js/admin-catalog.js'), 'utf8');

test('لوحة الأصناف الموحّدة موجودة والقائمة لا تكرّر الأقسام', () => {
  assert.match(html, /id="tab-catalog"/);
  assert.match(html, /js\/admin-catalog\.js/);
  assert.match(html, /switchAdminTab\('catalog'\)/);
  assert.match(html, /'entry-templates': 'entry'/);
  assert.match(html, /'gifts-catalog': 'gifts'/);
  assert.doesNotMatch(html, /switchAdminTab\('entry-templates'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('avatar-frames'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('room-cards'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('store-items'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('room-bgs'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('gifts-catalog'\)/);
  assert.doesNotMatch(html, /switchAdminTab\('room-emojis'\)/);
  ['cat-kind', 'cat-name', 'cat-price', 'cat-image', 'cat-board', 'cat-chips', 'catalog-editor'].forEach(id => {
    assert.ok(html.includes(`id="${id}"`), id);
  });
  assert.match(html, /css\/admin-look\.css/);
  assert.match(html, /class="look-page cat-studio"/);
  assert.match(html, /id="cat-legend-list"/);
  assert.match(html, /class="side-group"/);
  assert.match(html, /باقات الذهب والدفع/);
  assert.match(html, /الهدايا والإيموجي/);
});

test('ملف الأصناف يمرّ فحص الصياغة ويغطي كل الأقسام', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'public/js/admin-catalog.js')], { stdio: 'pipe' });
  ['entry', 'frames', 'rooms', 'idcard', 'bubble', 'chatbubble', 'mic', 'bgs', 'gifts', 'emojis'].forEach(id => {
    assert.ok(js.includes(`id: '${id}'`), id);
  });
  assert.match(js, /\/api\/admin\/entry-templates/);
  assert.match(js, /\/api\/admin\/store-items/);
  assert.match(js, /\/api\/admin\/gifts/);
  assert.match(js, /\/api\/admin\/room-emojis/);
  assert.match(js, /duration_days/);
  assert.match(js, /burst_enabled/);
});
