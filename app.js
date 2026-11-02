(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TG = window.Telegram && window.Telegram.WebApp;
  const CFG = window.QC_CONFIG || {};
  const BAR = window.QC_BARCODES || {};
  const DEMO = /[?&]demo=1/.test(location.search);
  const SKU_TO_EAN = {};
  Object.keys(BAR).forEach((e) => (SKU_TO_EAN[BAR[e].s] = e));

  const DEMO_ORDERS = {
    SPXVN06505979032B: { id: "2611014SPDVY8P", source: "Shopee (mẫu)", items: [{ sku: "SNACKGANDADIEUCONHO50GR", qty: 1 }, { sku: "NUOCHAMBO", qty: 1 }] },
    "691": { id: "691", source: "Pancake (mẫu)", items: [{ sku: "SNACKDAECH50GR", qty: 2 }, { sku: "PATEBO450GRNGUYENMIENG", qty: 1 }, { sku: "SETKHAMPHA14VI", qty: 1 }] },
  };

  // ---------- state ----------
  let order = null; // {id, code, source, items:[{sku,qty,name}]}
  let got = {}, extra = {}, manual = {}, photos = {}, scanLog = [], busy = false;

  if (TG) { try { TG.ready(); TG.expand(); } catch (e) {} }
  if (DEMO) $("demoBanner").hidden = false;

  // ---------- feedback ----------
  let ac = null;
  function beep(ok) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = ok ? 1320 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.08;
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.09 : 0.35));
    } catch (e) {}
    try {
      if (TG && TG.HapticFeedback) TG.HapticFeedback.notificationOccurred(ok ? "success" : "error");
      else if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]);
    } catch (e) {}
    const s = $("status"); s.classList.remove("flash-ok", "flash-err"); void s.offsetWidth; s.classList.add(ok ? "flash-ok" : "flash-err");
  }
  function log(t, c) {
    const d = document.createElement("div"); d.className = c || "";
    d.textContent = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "  " + t;
    $("log").prepend(d);
  }
  const nameOf = (sku) => { const e = SKU_TO_EAN[sku]; return e ? BAR[e].n : sku; };

  // ---------- api ----------
  async function api(action, payload) {
    if (!CFG.API_URL) throw new Error("Chưa cấu hình địa chỉ Apps Script (config.js).");
    const body = JSON.stringify(Object.assign({ action, initData: TG ? TG.initData : "" }, payload || {}));
    const r = await fetch(CFG.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Lỗi không rõ");
    return j;
  }

  // ---------- logic ----------
  function totals() {
    let need = 0, have = 0;
    order.items.forEach((it) => { need += it.qty; have += Math.min((got[it.sku] || 0) + (manual[it.sku] || 0), it.qty); });
    return { need, have };
  }
  const complete = () => order && totals().have === totals().need && Object.keys(extra).length === 0;

  async function openOrder(code) {
    if (busy) return; busy = true;
    $("stBig").textContent = "Đang tìm đơn…"; $("stCode").textContent = code;
    try {
      let o;
      if (DEMO) { o = DEMO_ORDERS[code]; if (!o) throw new Error("Không có đơn mẫu cho mã " + code + ". Thử SPXVN06505979032B hoặc 691."); }
      else o = (await api("order", { code })).order;
      if (!o.items || !o.items.length) throw new Error("Đơn " + o.id + " trên Pancake không có món nào. Kiểm tra lại đơn.");
      order = { id: String(o.id), code, source: o.source || "", items: o.items.map((i) => ({ sku: i.sku, qty: Number(i.qty) || 1 })) };
      got = {}; extra = {}; manual = {}; photos = {}; scanLog = [];
      clearPhotos();
      beep(true); log("Mở đơn " + order.id + " (" + order.source + ")", "o");
    } catch (e) {
      beep(false); log(e.message, "e");
    }
    busy = false; render();
  }

  function handle(raw) {
    const c = String(raw || "").trim().toUpperCase();
    if (!c || busy) return;
    if (!order) {
      if (BAR[c]) { beep(false); log("Đây là tem sản phẩm. Hãy quét mã trên phiếu trước.", "e"); return; }
      return openOrder(c);
    }
    if (c === order.code || c === order.id) { log("Phiếu đúng đơn đang đóng", "o"); return; }
    const p = BAR[c];
    if (!p) { beep(false); log("Mã không phải tem sản phẩm: " + c + ". Nếu là phiếu đơn khác, kiểm tra có lấy nhầm phiếu không.", "e"); scanLog.push("?" + c); return; }
    const it = order.items.find((i) => i.sku === p.s);
    const g = (got[p.s] || 0) + (manual[p.s] || 0);
    if (it && g < it.qty) { got[p.s] = (got[p.s] || 0) + 1; beep(true); log("✓ " + p.n + " (" + (g + 1) + "/" + it.qty + ")", "o"); scanLog.push("+" + p.s); }
    else { extra[p.s] = (extra[p.s] || 0) + 1; beep(false); log(it ? "Thừa: " + p.n + " (đơn chỉ cần " + it.qty + ")" : "Sai món: " + p.n + " không có trong đơn", "e"); scanLog.push("x" + p.s); }
    render();
  }

  // ---------- render ----------
  function render() {
    const st = $("status"); st.className = "status";
    if (!order) {
      $("stLbl").textContent = "Bước 1/3"; $("stBig").textContent = "Quét mã trên phiếu";
      $("stCode").textContent = "Đưa mã vạch trên phiếu giao hàng vào khung camera"; $("barI").style.width = "0";
      $("listWrap").hidden = true; $("photoWrap").hidden = true; $("doneBtn").disabled = true; return;
    }
    const { need, have } = totals();
    $("listWrap").hidden = false; $("stCode").textContent = "Đơn " + order.id + " · " + order.source;
    $("barI").style.width = (100 * have) / need + "%";
    if (Object.keys(extra).length) { st.classList.add("err"); $("stLbl").textContent = "Có món không đúng"; $("stBig").textContent = "Bỏ món đỏ ra khỏi đơn"; }
    else if (have < need) { $("stLbl").textContent = "Bước 2/3 · " + have + "/" + need + " món"; $("stBig").textContent = "Còn thiếu " + (need - have) + " món"; }
    else { st.classList.add("ok"); $("stLbl").textContent = "Bước 3/3"; $("stBig").textContent = "Đủ hàng. Chụp 2 ảnh rồi hoàn tất"; }

    const ul = $("items"); ul.innerHTML = "";
    order.items.forEach((it) => {
      const g = (got[it.sku] || 0) + (manual[it.sku] || 0);
      const li = document.createElement("li"); if (g >= it.qty) li.className = "done";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = nameOf(it.sku);
      const ct = document.createElement("span"); ct.className = "ct"; ct.textContent = Math.min(g, it.qty) + "/" + it.qty;
      const mi = document.createElement("button"); mi.className = "minus"; mi.textContent = "−"; mi.title = "Bớt 1 (quét nhầm 2 lần)";
      mi.disabled = g === 0;
      mi.onclick = () => { if (manual[it.sku]) manual[it.sku]--; else if (got[it.sku]) got[it.sku]--; scanLog.push("-" + it.sku); log("Bớt 1 " + nameOf(it.sku)); render(); };
      const cd = document.createElement("span"); cd.className = "code"; cd.textContent = it.sku + (SKU_TO_EAN[it.sku] ? "" : " · chưa có tem");
      li.append(nm, ct, mi, cd);
      if (!SKU_TO_EAN[it.sku] && g < it.qty) {
        const b = document.createElement("button"); b.className = "manual"; b.textContent = "Món này chưa có tem: bấm để xác nhận tay";
        b.onclick = () => { manual[it.sku] = (manual[it.sku] || 0) + 1; scanLog.push("m" + it.sku); log("Xác nhận tay: " + it.sku, "o"); beep(true); render(); };
        li.append(b);
      }
      ul.appendChild(li);
    });
    Object.keys(extra).forEach((s) => {
      const li = document.createElement("li"); li.className = "extra"; li.style.cursor = "pointer";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = "Không đúng: " + nameOf(s);
      const ct = document.createElement("span"); ct.className = "ct"; ct.textContent = "+" + extra[s];
      const sp = document.createElement("span");
      const cd = document.createElement("span"); cd.className = "code"; cd.textContent = "Đã bỏ ra thì bấm vào đây";
      li.append(nm, ct, sp, cd);
      li.onclick = () => { if (--extra[s] <= 0) delete extra[s]; log("Đã bỏ ra " + nameOf(s)); render(); };
      ul.appendChild(li);
    });
    $("photoWrap").hidden = !complete();
    $("doneBtn").disabled = !(complete() && photos.p1 && photos.p2) || busy;
  }

  // ---------- photos ----------
  function clearPhotos() { document.querySelectorAll(".ph img").forEach((i) => i.remove()); ["p1", "p2"].forEach((id) => ($(id).value = "")); }
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.72).split(",")[1]);
      };
      img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }
  ["p1", "p2"].forEach((id) =>
    $(id).addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const lab = e.target.parentElement; let img = lab.querySelector("img");
      if (!img) { img = document.createElement("img"); lab.appendChild(img); }
      img.src = URL.createObjectURL(f);
      try { photos[id] = await shrink(f); } catch (err) { log("Không đọc được ảnh, chụp lại", "e"); }
      render();
    })
  );

  // ---------- finish ----------
  $("doneBtn").onclick = async () => {
    if (!complete() || busy) return; busy = true; render();
    $("stBig").textContent = "Đang lưu…";
    try {
      let msg = "Đã lưu (chế độ thử, không gửi đi)";
      if (!DEMO) {
        const r = await api("complete", {
          orderId: order.id, code: order.code, source: order.source,
          items: order.items, manual, scanLog, photo1: photos.p1, photo2: photos.p2,
        });
        msg = "Đã lưu đơn " + order.id + (r.statusNote ? ". " + r.statusNote : "");
      }
      log(msg, "o"); beep(true);
      $("status").className = "status ok"; $("stBig").textContent = msg;
      order = null; clearPhotos(); photos = {};
      busy = false; setTimeout(render, 1800);
    } catch (e) { busy = false; beep(false); log("Chưa lưu được: " + e.message + ". Bấm Hoàn tất lại.", "e"); render(); }
  };
  $("resetBtn").onclick = () => { if (order) log("Bỏ đơn " + order.id); order = null; clearPhotos(); photos = {}; render(); };
  $("codeIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { handle(e.target.value); e.target.value = ""; } });

  // ---------- camera ----------
  let scanner = null, camOn = false, lastCode = "", lastAt = 0;
  const COOLDOWN = 2000; // cùng một mã trong 2 giây chỉ tính 1 lần
  function onDecode(text) {
    const now = Date.now();
    if (text === lastCode && now - lastAt < COOLDOWN) { lastAt = now; return; }
    lastCode = text; lastAt = now; handle(text);
  }
  async function startCam() {
    if (!window.Html5Qrcode) { $("camMsg").textContent = "Không tải được bộ quét. Dùng ô gõ mã bên dưới."; $("camBtn").hidden = true; return; }
    try {
      const F = window.Html5QrcodeSupportedFormats;
      scanner = scanner || new Html5Qrcode("cam", { formatsToSupport: [F.CODE_128, F.EAN_13, F.QR_CODE], experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
      await scanner.start({ facingMode: "environment" }, { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * 0.9), height: Math.floor(Math.min(h, w) * 0.45) }) }, onDecode, () => {});
      camOn = true; $("camMsg").textContent = "Camera đang quét"; $("camBtn").textContent = "Tắt camera";
    } catch (e) {
      camOn = false; $("camMsg").textContent = "Không mở được camera (" + (e && e.message ? e.message : e) + "). Cho phép camera hoặc dùng ô gõ mã.";
      $("camBtn").textContent = "Bật camera";
    }
  }
  async function stopCam() { try { if (scanner) await scanner.stop(); } catch (e) {} camOn = false; $("camMsg").textContent = "Camera tắt"; $("camBtn").textContent = "Bật camera"; }
  $("camBtn").onclick = () => (camOn ? stopCam() : startCam());

  render();
  startCam();
})();
