#!/usr/bin/env python3
"""
Companion server cho Udemy Local.

- Bọc logic tải bài giảng Udemy Business (chỉ phần giảng viên ĐÃ BẬT download)
  thành API để app React gọi.
- Đồng thời phục vụ luôn app web đã build (../dist) tại http://localhost:8000
  => mở trang ở localhost nên không dính CORS / mixed-content.

Cài đặt:
    pip install -r requirements.txt

Chạy:
    python server.py
    # rồi mở http://localhost:8000
"""

import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

OUTPUT_DIR = os.environ.get("UDEMY_OUTPUT", os.path.expanduser("~/Downloads/Udemy"))
PORT = int(os.environ.get("UDEMY_PORT", "8000"))
DIST = Path(__file__).resolve().parent.parent / "dist"

# ---------------------------------------------------------------------------
# Lõi tải (rút gọn từ udemy_download.py, bỏ phần tương tác dòng lệnh)
# ---------------------------------------------------------------------------


def get_access_token(org, manual_token=""):
    """Lấy access_token: ưu tiên token thủ công, nếu không thì đọc cookie Chrome."""
    if manual_token:
        return manual_token, None
    try:
        import browser_cookie3
    except ImportError:
        raise HTTPException(
            400,
            "Chưa nhập token và thiếu browser_cookie3. "
            "Chạy: pip install browser_cookie3, hoặc dán token thủ công.",
        )
    try:
        cj = browser_cookie3.chrome(domain_name="udemy.com")
    except Exception as e:
        raise HTTPException(400, f"Không đọc được cookie Chrome: {e}")
    tokens = {c.domain: c.value for c in cj if c.name == "access_token"}
    if not tokens:
        raise HTTPException(
            400,
            "Không thấy access_token trong Chrome. Đăng nhập Udemy rồi thử lại, "
            "hoặc dán token thủ công.",
        )
    for domain, val in tokens.items():
        if org in domain:
            return val, cj
    return next(iter(tokens.values())), cj


def make_client(org, manual_token=""):
    base = f"https://{org}.udemy.com"
    token, cj = get_access_token(org, manual_token)
    s = requests.Session()
    if cj is not None:
        s.cookies = cj
    s.headers.update(
        {
            "Authorization": f"Bearer {token}",
            "X-Udemy-Authorization": f"Bearer {token}",
            "User-Agent": "Mozilla/5.0",
            "Referer": base,
            "Accept": "application/json, text/plain, */*",
        }
    )
    return s, base


def sanitize(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name or "").strip()
    name = re.sub(r"\s+", " ", name)
    return name[:180] or "untitled"


def get_course_title(s, base, course_id):
    try:
        r = s.get(f"{base}/api-2.0/courses/{course_id}/?fields[course]=title")
        if r.ok:
            return r.json().get("title", str(course_id))
    except Exception:
        pass
    return str(course_id)


def course_id_from_url(s, base, course_url):
    slug_match = re.search(r"/course/([^/]+)", course_url)
    slug = slug_match.group(1) if slug_match else None
    pages = [course_url]
    if slug:
        pages.append(f"{base}/course/{slug}/")
    patterns = [
        r'data-clp-course-id=["\'](\d+)',
        r'"course_id"\s*:\s*(\d+)',
        r'"courseId"\s*:\s*(\d+)',
        r'courseId["\']?\s*[:=]\s*["\']?(\d+)',
    ]
    for page in pages:
        try:
            r = s.get(page, timeout=30)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        for pat in patterns:
            m = re.search(pat, r.text)
            if m:
                return int(m.group(1))
    return None


def resolve_course(s, base, course):
    """course có thể là id (số) hoặc URL. Trả về (id, title)."""
    course = str(course).strip()
    if course.isdigit():
        cid = int(course)
        return cid, get_course_title(s, base, cid)
    cid = course_id_from_url(s, base, course)
    if not cid:
        raise HTTPException(400, "Không lấy được course id từ URL. Thử dán thẳng id (số).")
    return cid, get_course_title(s, base, cid)


def fetch_curriculum(s, base, course_id):
    items = []
    url = (
        f"{base}/api-2.0/courses/{course_id}/subscriber-curriculum-items/"
        "?page_size=200"
        "&fields[lecture]=title,object_index,asset,supplementary_assets,id"
        "&fields[chapter]=title,object_index"
        "&fields[asset]=asset_type,title,download_urls,filename,captions,length,"
        "body,external_url,id"
        "&fields[caption]=file_name,locale_id,url,source,title,video_label"
    )
    while url:
        r = s.get(url)
        r.raise_for_status()
        data = r.json()
        items.extend(data["results"])
        url = data.get("next")
    return items


def build_chapters(items):
    chapters = []
    current = {"title": "Mở đầu", "lectures": []}
    for item in items:
        cls = item.get("_class")
        if cls == "chapter":
            if current["lectures"]:
                chapters.append(current)
            current = {"title": item.get("title", ""), "lectures": []}
        elif cls == "lecture":
            current["lectures"].append(item)
    if current["lectures"]:
        chapters.append(current)
    return chapters


def pick_video_url(download_urls, max_quality=None):
    videos = (download_urls or {}).get("Video") or []
    if not videos:
        return None

    def quality(v):
        try:
            return int(v.get("label", 0))
        except (TypeError, ValueError):
            return 0

    candidates = videos
    if max_quality:
        capped = [v for v in videos if quality(v) <= max_quality]
        candidates = capped or videos
    return max(candidates, key=quality).get("file")


def first_download_url(download_urls):
    """Link tải đầu tiên của một asset không phải video (file/tài liệu).
    Trả (url, key) hoặc (None, None)."""
    if not download_urls:
        return None, None
    keys = list(download_urls.keys())
    ordered = [k for k in keys if k != "Video"] + [k for k in keys if k == "Video"]
    for key in ordered:
        for item in download_urls.get(key) or []:
            f = item.get("file")
            if f:
                return f, key
    return None, None


def ext_from(*candidates):
    """Đoán đuôi file từ filename hoặc URL. '' nếu không thấy."""
    for cand in candidates:
        if not cand:
            continue
        m = re.search(r"\.([A-Za-z0-9]{1,8})(?:\?|#|$)", cand)
        if m:
            return "." + m.group(1).lower()
    return ""


def save_article(dest, title, body):
    """Lưu bài giảng dạng chữ (Article) -> file .html. Trả 'skip'/'ok'."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip"
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{title}</title></head><body>\n{body or ''}\n</body></html>"
    )
    tmp = dest + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(html)
    os.rename(tmp, dest)
    return "ok"


def ensure_lecture_detail(s, base, course_id, lec):
    """Curriculum đôi khi thiếu `body` (Article) hoặc `download_urls` của tài liệu
    đính kèm. Khi thiếu, lấy bổ sung từ trang chi tiết bài giảng."""
    lid = lec.get("id")
    if not lid:
        return lec
    asset = lec.get("asset") or {}
    need = asset.get("asset_type") == "Article" and not asset.get("body")
    if not need:
        for sup in lec.get("supplementary_assets") or []:
            if not sup.get("download_urls"):
                need = True
                break
    if not need:
        return lec
    try:
        r = s.get(
            f"{base}/api-2.0/courses/{course_id}/lectures/{lid}/"
            "?fields[lecture]=asset,supplementary_assets"
            "&fields[asset]=asset_type,title,filename,body,download_urls,"
            "external_url,captions,id"
        )
        if r.ok:
            d = r.json()
            if d.get("asset"):
                lec["asset"] = d["asset"]
            if d.get("supplementary_assets"):
                lec["supplementary_assets"] = d["supplementary_assets"]
    except Exception:
        pass
    return lec


def lang_wanted(locale, langs):
    if not langs:
        return True
    low = locale.lower()
    return any(low.startswith(x.lower()) for x in langs)


def vtt_to_srt(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues, buf = [], []
    for line in lines:
        if (
            line.strip() == "WEBVTT"
            or line.startswith("NOTE")
            or line.startswith("Kind:")
            or line.startswith("Language:")
        ):
            continue
        if "-->" in line:
            if buf:
                cues.append(buf)
            ts = re.sub(r"(\d{2}:\d{2}:\d{2})\.(\d{3})", r"\1,\2", line)
            ts = re.sub(r"\s+(align|line|position|size):\S+", "", ts).strip()
            buf = [ts]
        else:
            if line.strip() == "" and buf:
                cues.append(buf)
                buf = []
            elif line.strip() and buf:
                buf.append(line)
    if buf:
        cues.append(buf)
    out, n = [], 1
    for cue in cues:
        if not cue or "-->" not in cue[0]:
            continue
        out.append(str(n))
        out.extend(cue)
        out.append("")
        n += 1
    return "\n".join(out)


def download_captions(s, captions, dest_base, langs):
    count = 0
    for cap in captions or []:
        url = cap.get("url")
        if not url:
            continue
        locale = cap.get("locale_id") or cap.get("video_label") or "sub"
        locale = sanitize(str(locale)).replace(" ", "_")
        if not lang_wanted(locale, langs):
            continue
        dest = f"{dest_base}.{locale}.srt"
        if os.path.exists(dest):
            continue
        try:
            r = s.get(url)
            r.raise_for_status()
            content = r.text
            fname = (cap.get("file_name") or "").lower()
            srt = content if (fname.endswith(".srt") and "WEBVTT" not in content) else vtt_to_srt(content)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(srt)
            count += 1
        except Exception:
            pass
    return count


def download_file(s, url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip"
    tmp = dest + ".part"
    with s.get(url, stream=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    os.rename(tmp, dest)
    return "ok"


# ---------------------------------------------------------------------------
# Quản lý tác vụ tải (chạy nền + báo tiến độ qua polling)
# ---------------------------------------------------------------------------

TASKS = {}
TASKS_LOCK = threading.Lock()


class Task:
    def __init__(self, total):
        self.id = uuid.uuid4().hex[:12]
        self.total = total
        self.done = 0
        self.items = []  # [{name, status}]
        self.finished = False
        self.error = None
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            return {
                "id": self.id,
                "total": self.total,
                "done": self.done,
                "finished": self.finished,
                "error": self.error,
                "items": list(self.items[-200:]),
            }


def run_download(task, org, token, course, lecture_ids, langs, max_quality, parallel,
                 dl_video, dl_articles, dl_resources, dl_subtitles):
    try:
        s, base = make_client(org, token)
        course_id, course_title = resolve_course(s, base, course)
        items = fetch_curriculum(s, base, course_id)
        chapters = build_chapters(items)
        wanted = set(str(x) for x in lecture_ids) if lecture_ids else None

        course_dir = os.path.join(OUTPUT_DIR, sanitize(course_title))
        os.makedirs(course_dir, exist_ok=True)

        jobs = []
        for ci, ch in enumerate(chapters):
            ch_name = f"{ci + 1:02d} - {sanitize(ch['title'])}"
            ch_dir = os.path.join(course_dir, ch_name)
            for li, lec in enumerate(ch["lectures"], 1):
                if wanted is not None and str(lec.get("id")) not in wanted:
                    continue
                lec = ensure_lecture_detail(s, base, course_id, lec)
                asset = lec.get("asset") or {}
                atype = asset.get("asset_type")
                title = lec.get("title", "")
                file_label = f"{li:02d} - {sanitize(title)}"
                base_path = os.path.join(ch_dir, file_label)

                # --- Asset chính của bài giảng ---
                if atype == "Video" and dl_video:
                    url = pick_video_url(asset.get("download_urls"), max_quality)
                    if url:
                        jobs.append({
                            "type": "video", "url": url, "dest": base_path + ".mp4",
                            "base": base_path, "captions": asset.get("captions"),
                            "name": f"{ch_name}/{file_label}", "dir": ch_dir,
                        })
                elif atype == "Article" and dl_articles:
                    jobs.append({
                        "type": "article", "dest": base_path + ".html",
                        "title": title, "body": asset.get("body"),
                        "name": f"{ch_name}/{file_label}", "dir": ch_dir,
                    })
                elif atype in ("Audio", "E-Book", "File", "Presentation") and dl_resources:
                    url, _ = first_download_url(asset.get("download_urls"))
                    if url:
                        ext = ext_from(asset.get("filename"), url) or ".bin"
                        jobs.append({
                            "type": "file", "url": url, "dest": base_path + ext,
                            "name": f"{ch_name}/{file_label}", "dir": ch_dir,
                        })

                # --- Tài liệu đính kèm (supplementary resources) ---
                if dl_resources:
                    for ri, sup in enumerate(lec.get("supplementary_assets") or [], 1):
                        url, _ = first_download_url(sup.get("download_urls"))
                        if not url:
                            continue
                        rname = sup.get("filename") or sup.get("title") or f"resource{ri}"
                        safe = sanitize(rname)
                        if not os.path.splitext(safe)[1]:
                            safe += ext_from(sup.get("filename"), url) or ".bin"
                        res_label = f"{li:02d}.{ri} - {safe}"
                        jobs.append({
                            "type": "resource", "url": url,
                            "dest": os.path.join(ch_dir, res_label),
                            "name": f"{ch_name}/{res_label}", "dir": ch_dir,
                        })

        with task.lock:
            task.total = len(jobs)

        if not jobs:
            with task.lock:
                task.finished = True
                task.error = "Không có mục nào tải được (chưa bật download / DRM)."
            return

        def one(job):
            local = requests.Session()
            local.headers.update(s.headers)
            local.cookies = s.cookies
            os.makedirs(job["dir"], exist_ok=True)
            try:
                if job["type"] == "article":
                    status = save_article(job["dest"], job["title"], job["body"])
                    label = "đã có" if status == "skip" else "bài viết"
                elif job["type"] == "video":
                    status = download_file(local, job["url"], job["dest"])
                    label = "đã có" if status == "skip" else "xong"
                    if dl_subtitles:
                        subs = download_captions(local, job["captions"], job["base"], langs)
                        if subs:
                            label += f" +{subs} phụ đề"
                else:  # file / resource
                    status = download_file(local, job["url"], job["dest"])
                    label = "đã có" if status == "skip" else "tài liệu"
                return ("ok", job["name"], label)
            except Exception as e:
                return ("err", job["name"], str(e))

        with ThreadPoolExecutor(max_workers=parallel) as ex:
            for kind, name, label in ex.map(one, jobs):
                with task.lock:
                    task.done += 1
                    task.items.append(
                        {"name": name, "status": ("ok" if kind == "ok" else "err"), "detail": label}
                    )

        with task.lock:
            task.finished = True
    except HTTPException as e:
        with task.lock:
            task.finished = True
            task.error = e.detail
    except Exception as e:
        with task.lock:
            task.finished = True
            task.error = str(e)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

app = FastAPI(title="Udemy Local server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Creds(BaseModel):
    org: str
    token: str | None = None


class CourseReq(Creds):
    course: str


class DownloadReq(CourseReq):
    lecture_ids: list = []
    langs: list = ["en", "vi"]
    max_quality: int | None = None
    parallel: int = 4
    download_video: bool = True
    download_articles: bool = True
    download_resources: bool = True
    download_subtitles: bool = True


@app.get("/api/health")
def health():
    return {"ok": True, "output_dir": OUTPUT_DIR}


@app.post("/api/courses")
def courses(req: Creds):
    s, base = make_client(req.org, req.token)
    out, url = [], (
        f"{base}/api-2.0/users/me/subscribed-courses/"
        "?page_size=100&fields[course]=id,title,url"
    )
    try:
        while url:
            r = s.get(url)
            r.raise_for_status()
            data = r.json()
            out.extend({"id": c["id"], "title": c["title"]} for c in data["results"])
            url = data.get("next")
    except requests.HTTPError as e:
        raise HTTPException(400, f"Lỗi gọi Udemy: {e}")
    return {"courses": out}


@app.post("/api/curriculum")
def curriculum(req: CourseReq):
    s, base = make_client(req.org, req.token)
    course_id, title = resolve_course(s, base, req.course)
    items = fetch_curriculum(s, base, course_id)
    chapters = build_chapters(items)
    out = []
    for ci, ch in enumerate(chapters):
        lecs = []
        for lec in ch["lectures"]:
            asset = lec.get("asset") or {}
            atype = asset.get("asset_type")
            if atype == "Video":
                has_main = bool(pick_video_url(asset.get("download_urls")))
            elif atype == "Article":
                # body có thể chưa có trong listing; coi như tải được, lấy detail sau.
                has_main = True
            elif atype:
                has_main = bool(first_download_url(asset.get("download_urls"))[0])
            else:
                has_main = False
            resources = len(lec.get("supplementary_assets") or [])
            lecs.append(
                {
                    "id": lec.get("id"),
                    "title": lec.get("title", ""),
                    "type": atype or "?",
                    "has_main": has_main,
                    "resources": resources,
                    "downloadable": has_main or resources > 0,
                    "captions": len(asset.get("captions") or []),
                }
            )
        out.append({"index": ci + 1, "title": ch["title"], "lectures": lecs})
    return {"course_id": course_id, "title": title, "chapters": out}


@app.post("/api/download")
def start_download(req: DownloadReq):
    task = Task(total=len(req.lecture_ids))
    with TASKS_LOCK:
        TASKS[task.id] = task
    threading.Thread(
        target=run_download,
        args=(
            task,
            req.org,
            req.token,
            req.course,
            req.lecture_ids,
            req.langs,
            req.max_quality,
            req.parallel,
            req.download_video,
            req.download_articles,
            req.download_resources,
            req.download_subtitles,
        ),
        daemon=True,
    ).start()
    return {"task_id": task.id}


@app.get("/api/tasks/{task_id}")
def task_status(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(404, "Không tìm thấy tác vụ.")
    return task.snapshot()


# Phục vụ app web đã build (nếu có) — mount cuối cùng để không che /api.
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="app")


if __name__ == "__main__":
    import uvicorn

    print(f"Udemy Local server: http://localhost:{PORT}")
    print(f"Lưu video vào: {OUTPUT_DIR}")
    if not DIST.exists():
        print("[!] Chưa có ../dist — chạy `npm run build` để server phục vụ app web.")
    uvicorn.run(app, host="127.0.0.1", port=PORT)
