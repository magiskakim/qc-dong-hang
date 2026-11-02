/**
 * QC đóng hàng – backend (Google Apps Script).
 *
 * Dán file này vào CÙNG project Apps Script đang có Pancake.gs (đặt tên file: qc-backend).
 * Mọi tên ở đây có tiền tố QC_/qc để không trùng với code Pancake hiện có.
 *
 * Thuộc tính tập lệnh (Cài đặt dự án → Thuộc tính tập lệnh):
 *   PANCAKE_API_KEY      đã có sẵn
 *   QC_BOT_TOKEN         token BotFather đưa (bắt buộc)
 *   QC_ALLOWED_TG_IDS    id Telegram của nhân viên được dùng, cách nhau bằng dấu phẩy
 *   QC_APP_URL           địa chỉ trang quét (GitHub Pages)
 *   QC_STATUS_CODE       (để trống = TẮT) mã số trạng thái Pancake khi quét đạt, vd "Chờ chuyển hàng"
 *   QC_STATUS_MARKETPLACE  "on" để đổi trạng thái cả đơn Shopee/TikTok/Lazada (mặc định tắt)
 *   QC_REPORT_CHAT_ID    (tuỳ chọn) chat Telegram nhận báo cáo mỗi đơn
 *
 * Triển khai: Triển khai → Tùy chọn triển khai mới → Ứng dụng web,
 *   Thực thi với tư cách: Tôi; Người có quyền truy cập: Bất kỳ ai.
 *   ("Bất kỳ ai" là cần thiết để Telegram gọi được; backend tự kiểm tra chữ ký Telegram.)
 */

const QC_SHEET_ID = '1QNI_nS4AwAWz4KHSxBQqyHWZkVCJQfruQUcKVX87Iys';
const QC_LOG_TAB = 'QC đóng hàng';
const QC_API_BASES = ['https://pos.pages.fm/api/v1', 'https://pos.pancake.vn/api/v1'];
const QC_MARKETPLACE_RE = /shopee|tiktok|lazada/i;

/* ======================= Web app ======================= */

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return qcJson_({ ok: false, error: 'Yêu cầu không hợp lệ' }); }
  try {
    const user = qcVerifyTelegram_(req.initData);
    if (req.action === 'order') return qcJson_({ ok: true, order: qcFindOrder_(String(req.code || '').trim()) });
    if (req.action === 'complete') return qcJson_(Object.assign({ ok: true }, qcComplete_(req, user)));
    return qcJson_({ ok: false, error: 'Không rõ thao tác' });
  } catch (err) {
    return qcJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return qcJson_({ ok: true, service: 'QC đóng hàng', time: new Date().toISOString() });
}

function qcJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= Telegram ======================= */

/** Kiểm tra initData do Telegram ký (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
function qcVerifyTelegram_(initData) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('QC_BOT_TOKEN');
  if (!token) throw new Error('Chưa cài QC_BOT_TOKEN trong Apps Script.');
  if (!initData) throw new Error('Hãy mở màn hình quét từ nút menu của bot Telegram.');

  const params = {};
  initData.split('&').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, '%20'));
  });
  const hash = params.hash; delete params.hash;
  const dcs = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
  const secret = Utilities.computeHmacSha256Signature(token, 'WebAppData');
  const sig = Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), secret);
  const hex = sig.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  if (hex !== hash) throw new Error('Chữ ký Telegram không hợp lệ.');
  if (Date.now() / 1000 - Number(params.auth_date || 0) > 86400) throw new Error('Phiên đã cũ, đóng màn hình quét rồi mở lại từ bot.');

  const user = JSON.parse(params.user || '{}');
  const allowed = (props.getProperty('QC_ALLOWED_TG_IDS') || '').split(',').map(s => s.trim()).filter(String);
  if (allowed.indexOf(String(user.id)) < 0) {
    throw new Error('Tài khoản Telegram ' + user.id + ' (' + [user.first_name, user.last_name].filter(String).join(' ') +
      ') chưa được cho phép. Gửi số ' + user.id + ' cho Kim để được thêm vào.');
  }
  return { id: user.id, name: [user.first_name, user.last_name].filter(String).join(' ') || user.username || String(user.id) };
}

function qcTelegram_(method, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('QC_BOT_TOKEN');
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  return JSON.parse(r.getContentText());
}

/* ======================= Pancake ======================= */

function qcPancake_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('PANCAKE_API_KEY');
  if (!key) throw new Error('Thiếu PANCAKE_API_KEY.');
  let base = props.getProperty('QC_API_BASE'), shop = props.getProperty('QC_SHOP_ID');
  if (!base || !shop) {
    for (const b of QC_API_BASES) {
      const r = UrlFetchApp.fetch(b + '/shops?api_key=' + encodeURIComponent(key), { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) continue;
      const j = JSON.parse(r.getContentText()); const list = j.shops || j.data || [];
      if (list.length) { base = b; shop = String(list[0].id); break; }
    }
    if (!shop) throw new Error('Không kết nối được Pancake.');
    props.setProperty('QC_API_BASE', base); props.setProperty('QC_SHOP_ID', shop);
  }
  const url = (path, q) => base + '/shops/' + shop + path + '?api_key=' + encodeURIComponent(key) + (q ? '&' + q : '');
  return {
    get(path, q) {
      const r = UrlFetchApp.fetch(url(path, q), { muteHttpExceptions: true });
      return { code: r.getResponseCode(), json: (() => { try { return JSON.parse(r.getContentText()); } catch (e) { return null; } })() };
    },
    put(path, body) {
      const r = UrlFetchApp.fetch(url(path), { method: 'put', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
      return { code: r.getResponseCode(), text: r.getContentText().slice(0, 500) };
    }
  };
}

/** Tìm đúng 1 đơn từ mã quét trên phiếu: số đơn Pancake, mã đơn sàn hoặc mã vận đơn. */
function qcFetchOrder_(code) {
  if (!code) throw new Error('Chưa có mã.');
  const pc = qcPancake_();
  if (/^\d{1,9}$/.test(code)) {
    const r = pc.get('/orders/' + code);
    const o = r.json && (r.json.data || r.json);
    if (r.code === 200 && o && o.id !== undefined) return o;
  }
  const s = pc.get('/orders', 'search=' + encodeURIComponent(code) + '&page_size=20');
  const list = (s.json && (s.json.data || s.json.orders)) || [];
  const exact = list.filter(o => String(o.id) === code || (o.partner && String(o.partner.extend_code || '') === code));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error('Có ' + exact.length + ' đơn cùng mã ' + code + '. Kiểm tra trên Pancake.');
  throw new Error('Không tìm thấy đơn có mã ' + code + ' trên Pancake.');
}

function qcShapeOrder_(o) {
  return {
    id: String(o.id),
    source: o.order_sources_name || (o.page && o.page.name) || '',
    status: o.status, statusName: o.status_name,
    tracking: (o.partner && o.partner.extend_code) || '',
    items: (o.items || []).map(it => ({
      sku: (it.variation_info && it.variation_info.display_id) || '',
      qty: Number(it.quantity) || 0,
      bonus: !!it.is_bonus_product
    })).filter(i => i.qty > 0)
  };
}

function qcFindOrder_(code) {
  const o = qcShapeOrder_(qcFetchOrder_(code));
  if ([4, 5, 6, 7].indexOf(Number(o.status)) >= 0) o.warning = 'Đơn đang ở trạng thái ' + o.statusName;
  return o;
}

/* ======================= Hoàn tất đơn ======================= */

function qcComplete_(req, user) {
  // Lấy lại đơn từ Pancake và so với số món đã quét, không tin số liệu từ điện thoại.
  const raw = qcFetchOrder_(String(req.code || req.orderId));
  const order = qcShapeOrder_(raw);
  const counted = {};
  (req.scanLog || []).forEach(s => {
    const k = s.slice(1);
    if (s[0] === '+' || s[0] === 'm') counted[k] = (counted[k] || 0) + 1;
    if (s[0] === '-') counted[k] = (counted[k] || 0) - 1;
  });
  const missing = order.items.filter(i => (counted[i.sku] || 0) < i.qty).map(i => i.sku + ' thiếu ' + (i.qty - (counted[i.sku] || 0)));
  if (missing.length) throw new Error('Số món quét chưa khớp đơn trên Pancake: ' + missing.join(', '));
  if (!req.photo1 || !req.photo2) throw new Error('Thiếu ảnh bằng chứng.');

  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const folder = qcPhotoFolder_();
    const stamp = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd-HHmmss');
    const f1 = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.photo1), 'image/jpeg', order.id + '_' + stamp + '_flatlay.jpg'));
    const f2 = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.photo2), 'image/jpeg', order.id + '_' + stamp + '_hop.jpg'));

    const statusNote = qcMaybeUpdateStatus_(raw);
    const wrong = (req.scanLog || []).filter(s => s[0] === 'x' || s[0] === '?').length;
    const manual = (req.scanLog || []).filter(s => s[0] === 'm').map(s => s.slice(1));

    const sh = qcLogSheet_();
    sh.insertRowBefore(2);
    sh.getRange(2, 1, 1, 12).setValues([[
      new Date(), user.name + ' (' + user.id + ')', String(req.code || ''), order.id, order.source,
      order.items.map(i => i.sku + ' ×' + i.qty).join(', '), manual.join(', '), wrong,
      f1.getUrl(), f2.getUrl(), statusNote, (req.scanLog || []).join(' ')
    ]]);

    const chat = PropertiesService.getScriptProperties().getProperty('QC_REPORT_CHAT_ID');
    if (chat) {
      qcTelegram_('sendMessage', { chat_id: chat, text: '✅ ' + user.name + ' đóng xong đơn ' + order.id + ' (' + order.source + ')' +
        (wrong ? '\n⚠️ ' + wrong + ' lần quét sai đã được sửa' : '') + (manual.length ? '\n✋ Xác nhận tay: ' + manual.join(', ') : '') +
        '\n📷 ' + f1.getUrl() + '\n📦 ' + f2.getUrl() });
    }
    return { statusNote };
  } finally { lock.releaseLock(); }
}

function qcMaybeUpdateStatus_(raw) {
  const props = PropertiesService.getScriptProperties();
  const code = (props.getProperty('QC_STATUS_CODE') || '').trim();
  if (!code) return 'Không đổi trạng thái (đang tắt)';
  const src = String(raw.order_sources_name || '');
  const isMarket = QC_MARKETPLACE_RE.test(src) || !!raw.marketplace_id;
  if (isMarket && props.getProperty('QC_STATUS_MARKETPLACE') !== 'on') return 'Đơn sàn: không đổi trạng thái (đang tắt)';
  const r = qcPancake_().put('/orders/' + raw.id, { status: Number(code) });
  return r.code === 200 ? 'Đã đổi trạng thái Pancake sang ' + code : 'Đổi trạng thái lỗi ' + r.code + ': ' + r.text;
}

function qcPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  let rootId = props.getProperty('QC_DRIVE_FOLDER_ID'), root;
  try { root = rootId && DriveApp.getFolderById(rootId); } catch (e) { root = null; }
  if (!root) { root = DriveApp.createFolder('QC đóng hàng - ảnh'); props.setProperty('QC_DRIVE_FOLDER_ID', root.getId()); }
  const month = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM');
  const it = root.getFoldersByName(month);
  return it.hasNext() ? it.next() : root.createFolder(month);
}

function qcLogSheet_() {
  const ss = SpreadsheetApp.openById(QC_SHEET_ID);
  let sh = ss.getSheetByName(QC_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(QC_LOG_TAB);
    sh.getRange(1, 1, 1, 12).setValues([['Thời gian', 'Nhân viên', 'Mã quét', 'Đơn Pancake', 'Nguồn', 'Món',
      'Xác nhận tay', 'Số lần quét sai', 'Ảnh flat lay', 'Ảnh hộp', 'Trạng thái Pancake', 'Nhật ký quét']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ======================= Chạy tay (Kim) ======================= */

/** Chạy 1 lần sau khi đã điền QC_BOT_TOKEN và QC_APP_URL: gắn nút "Đóng đơn" vào bot và tạo tab nhật ký. */
function qcSetup() {
  const url = PropertiesService.getScriptProperties().getProperty('QC_APP_URL');
  if (!url) throw new Error('Chưa điền QC_APP_URL.');
  const me = qcTelegram_('getMe', {});
  if (!me.ok) throw new Error('Token bot sai: ' + JSON.stringify(me));
  const r = qcTelegram_('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Đóng đơn', web_app: { url: url } } });
  qcLogSheet_();
  Logger.log('Bot @' + me.result.username + ' · gắn nút menu: ' + JSON.stringify(r));
}

/** Liệt kê các trạng thái (mã số + tên) xuất hiện trong 200 đơn gần nhất, ghi vào tab QC debug. CHỈ ĐỌC. */
function qcXemTrangThai() {
  const pc = qcPancake_(), seen = {};
  for (let page = 1; page <= 2; page++) {
    const r = pc.get('/orders', 'page_size=100&page_number=' + page);
    ((r.json && r.json.data) || []).forEach(o => {
      const k = o.status + ' · ' + o.status_name; seen[k] = (seen[k] || 0) + 1;
      (o.status_history || []).forEach(h => { const k2 = 'lịch sử: ' + h.status; seen[k2] = (seen[k2] || 0) + 1; });
    });
  }
  const ss = SpreadsheetApp.openById(QC_SHEET_ID);
  const sh = ss.getSheetByName('QC debug') || ss.insertSheet('QC debug');
  sh.clear();
  const rows = [['Trạng thái', 'Số đơn']].concat(Object.keys(seen).sort().map(k => [k, seen[k]]));
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
}
