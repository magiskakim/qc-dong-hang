# QC đóng hàng · Pawrents Choice

Màn hình quét đóng đơn chạy trong Telegram (Mini App). Nhân viên quét mã trên phiếu giao hàng, quét tem mã vạch từng món, app báo thiếu/sai/thừa ngay. Đủ hàng thì chụp 2 ảnh bằng chứng và bấm Hoàn tất. Ảnh lưu vào Google Drive, mỗi đơn ghi một dòng vào tab **QC đóng hàng** trong file quản lý.

## Thành phần

| Phần | Ở đâu | Việc |
|---|---|---|
| `index.html`, `app.js`, `config.js` | GitHub Pages (repo này) | Giao diện quét, camera |
| `sku-map.js`, `ma-vach-sku.tsv` | repo này | Mã vạch nội bộ (EAN-13, đầu 200) ↔ SKU Pancake |
| `apps-script/qc-backend.gs` | Apps Script của Kim (cùng project với Pancake.gs) | Kiểm tra chữ ký Telegram, tra đơn Pancake, lưu ảnh, ghi nhật ký, đổi trạng thái (mặc định tắt) |

Repo không chứa key hay dữ liệu khách. API key Pancake và token bot nằm trong Thuộc tính tập lệnh của Apps Script.

## Mã phiếu được hỗ trợ

- Phiếu Shopee SPX: mã vạch/QR chứa **mã vận đơn**, tra theo `partner.extend_code`.
- Phiếu Pancake: mã vạch chứa **số đơn Pancake**, lấy theo id.
- Gõ tay mã đơn sàn cũng được.

## Quy tắc mã vạch

Mỗi SKU một số cố định `200` + 9 chữ số thứ tự + 1 chữ số kiểm tra. **Không đánh số lại.** SKU mới thì nối tiếp số lớn nhất trong `sku-map.js`.

## Thử không cần Telegram

Mở trang với `?demo=1`: dùng đơn mẫu (gõ `691` hoặc `SPXVN06505979032B`), không gọi Pancake, không lưu gì.
