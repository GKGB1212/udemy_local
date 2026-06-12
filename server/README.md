# Companion server — tải video Udemy ngay trong app

Server nhỏ chạy ở máy bạn, làm 2 việc:

1. Tải các bài giảng Udemy Business mà **giảng viên đã bật download** (bỏ qua DRM).
2. Phục vụ luôn app web đã build, nên mọi thứ chạy ở `http://localhost:8000`
   (không dính CORS / mixed-content).

## Cài & chạy

```bash
# 1. Build app web (ở thư mục gốc dự án)
npm install
npm run build

# 2. Cài thư viện Python & chạy server
cd server
pip install -r requirements.txt
python server.py
```

Mở **http://localhost:8000**, bấm nút **“Tải từ Udemy”** trong app.

## Token

- Mặc định server tự đọc `access_token` từ **Chrome** (đang đăng nhập Udemy).
- Nếu lỗi: mở DevTools (F12) trên trang Udemy → Application → Cookies → copy
  `access_token` → dán vào ô “Token thủ công” trong app.

## Tuỳ chỉnh (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `UDEMY_OUTPUT` | `~/Downloads/Udemy` | Thư mục lưu video |
| `UDEMY_PORT` | `8000` | Cổng server |

Ví dụ: `UDEMY_OUTPUT=~/Khoahoc python server.py`

## Dùng khi đang dev (Vite)

Chạy song song `npm run dev` (cổng 5173) và `python server.py`. Vite đã được
cấu hình proxy `/api` sang `http://localhost:8000`, nên app dev gọi API bình thường.

> Chỉ tải nội dung giảng viên cho phép tải, phục vụ học offline cá nhân.
