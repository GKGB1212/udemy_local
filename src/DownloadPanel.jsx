import { useEffect, useRef, useState } from 'react'
import {
  X,
  Download,
  ListVideo,
  CheckCircle2,
  XCircle,
  Loader2,
  ServerCrash,
  Video,
  FileText,
  FileAudio,
  File,
  Paperclip,
} from 'lucide-react'
import { api } from './lib/api'

const LS = 'udemy-local-dl'

// Biểu tượng + nhãn theo loại bài giảng trả về từ server.
function TypeIcon({ type, size = 14 }) {
  if (type === 'Video') return <Video size={size} />
  if (type === 'Article') return <FileText size={size} />
  if (type === 'Audio') return <FileAudio size={size} />
  return <File size={size} />
}

function loadCreds() {
  try {
    return JSON.parse(localStorage.getItem(LS)) || {}
  } catch {
    return {}
  }
}

export default function DownloadPanel({ onClose }) {
  const saved = loadCreds()
  const [serverState, setServerState] = useState('checking') // checking|up|down
  const [org, setOrg] = useState(saved.org || 'vsol')
  const [token, setToken] = useState('')
  const [course, setCourse] = useState(saved.course || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [courseList, setCourseList] = useState(null) // [{id,title}] hoặc null
  const [curriculum, setCurriculum] = useState(null) // {title, chapters}
  const [picked, setPicked] = useState(() => new Set()) // lecture ids
  const [task, setTask] = useState(null) // snapshot tiến độ
  // Loại nội dung sẽ tải. Tắt video + bật mỗi tài liệu = chỉ bổ sung resource.
  const [kinds, setKinds] = useState({
    video: true,
    articles: true,
    resources: true,
    subtitles: true,
  })
  const pollRef = useRef(0)

  useEffect(() => {
    api
      .health()
      .then(() => setServerState('up'))
      .catch(() => setServerState('down'))
  }, [])

  useEffect(() => () => clearInterval(pollRef.current), [])

  function persist() {
    localStorage.setItem(LS, JSON.stringify({ org, course }))
  }

  const creds = () => ({ org: org.trim(), token: token.trim() || null })

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const listCourses = () =>
    run(async () => {
      const { courses } = await api.courses(creds())
      setCourseList(courses)
    })

  const loadCurriculum = (c) =>
    run(async () => {
      const data = await api.curriculum({ ...creds(), course: c || course })
      setCurriculum(data)
      setCourse(String(data.course_id))
      setCourseList(null)
      // Mặc định chọn hết bài tải được.
      const all = new Set()
      data.chapters.forEach((ch) =>
        ch.lectures.forEach((l) => l.downloadable && all.add(l.id)),
      )
      setPicked(all)
      persist()
    })

  function toggleLecture(id) {
    setPicked((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleChapter(ch) {
    const ids = ch.lectures.filter((l) => l.downloadable).map((l) => l.id)
    const allOn = ids.every((id) => picked.has(id))
    setPicked((p) => {
      const n = new Set(p)
      ids.forEach((id) => (allOn ? n.delete(id) : n.add(id)))
      return n
    })
  }

  const startDownload = () =>
    run(async () => {
      const { task_id } = await api.startDownload({
        ...creds(),
        course,
        lecture_ids: [...picked],
        download_video: kinds.video,
        download_articles: kinds.articles,
        download_resources: kinds.resources,
        download_subtitles: kinds.subtitles,
      })
      pollRef.current = setInterval(async () => {
        try {
          const snap = await api.task(task_id)
          setTask(snap)
          if (snap.finished) clearInterval(pollRef.current)
        } catch {
          clearInterval(pollRef.current)
        }
      }, 1000)
    })

  const pickedCount = picked.size

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <Download size={20} /> Tải khoá học từ Udemy
          </h2>
          <button className="ic-btn sm dark" onClick={onClose} title="Đóng">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {serverState === 'down' && (
            <div className="server-down">
              <ServerCrash size={34} />
              <p>
                <b>Chưa kết nối được companion server.</b>
              </p>
              <p className="muted">
                Tính năng tải cần chạy server ở máy bạn. Mở terminal trong thư mục{' '}
                <code>server/</code> và chạy:
              </p>
              <pre>
                pip install -r requirements.txt{'\n'}
                python server.py
              </pre>
              <p className="muted">
                Rồi mở app tại <code>http://localhost:8000</code> và thử lại.
              </p>
            </div>
          )}

          {serverState !== 'down' && (
            <>
              {/* Thông tin đăng nhập */}
              {!task && (
                <div className="form-grid">
                  <label>
                    Subdomain tổ chức
                    <input
                      value={org}
                      onChange={(e) => setOrg(e.target.value)}
                      placeholder="vd: vsol (vsol.udemy.com)"
                    />
                  </label>
                  <label>
                    Token thủ công <span className="opt">(để trống = tự đọc Chrome)</span>
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="access_token (tuỳ chọn)"
                      type="password"
                    />
                  </label>
                  <label className="span2">
                    Khoá học: URL hoặc course id
                    <div className="row">
                      <input
                        value={course}
                        onChange={(e) => setCourse(e.target.value)}
                        placeholder="https://vsol.udemy.com/course/... hoặc 123456"
                      />
                      <button
                        className="btn-sm"
                        disabled={busy}
                        onClick={() => loadCurriculum()}
                      >
                        <ListVideo size={16} /> Xem bài
                      </button>
                    </div>
                  </label>
                  <button className="link span2" disabled={busy} onClick={listCourses}>
                    …hoặc liệt kê các khoá tôi đang học
                  </button>
                </div>
              )}

              {error && <div className="err-box">{error}</div>}

              {/* Danh sách khoá đang học */}
              {courseList && !task && (
                <div className="course-list">
                  {courseList.length === 0 && (
                    <div className="muted">Không có khoá nào.</div>
                  )}
                  {courseList.map((c) => (
                    <button
                      key={c.id}
                      className="course-row"
                      disabled={busy}
                      onClick={() => loadCurriculum(String(c.id))}
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}

              {/* Cây chương/bài để chọn */}
              {curriculum && !task && (
                <div className="dl-curriculum">
                  <div className="dl-course-title">{curriculum.title}</div>
                  <div className="dl-kinds">
                    <span className="muted small">Tải:</span>
                    {[
                      ['video', 'Video'],
                      ['articles', 'Bài viết'],
                      ['resources', 'Tài liệu'],
                      ['subtitles', 'Phụ đề'],
                    ].map(([k, label]) => (
                      <label key={k} className="dl-kind">
                        <input
                          type="checkbox"
                          checked={kinds[k]}
                          onChange={() =>
                            setKinds((s) => ({ ...s, [k]: !s[k] }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {curriculum.chapters.map((ch) => {
                    const dlAble = ch.lectures.filter((l) => l.downloadable)
                    const allOn =
                      dlAble.length > 0 &&
                      dlAble.every((l) => picked.has(l.id))
                    return (
                      <div key={ch.index} className="dl-chapter">
                        <label className="dl-ch-head">
                          <input
                            type="checkbox"
                            checked={allOn}
                            disabled={dlAble.length === 0}
                            onChange={() => toggleChapter(ch)}
                          />
                          <span>
                            {ch.index}. {ch.title}
                          </span>
                          <span className="muted small">
                            {dlAble.length}/{ch.lectures.length} tải được
                          </span>
                        </label>
                        {ch.lectures.map((l) => (
                          <label
                            key={l.id}
                            className={'dl-lec' + (l.downloadable ? '' : ' off')}
                          >
                            <input
                              type="checkbox"
                              checked={picked.has(l.id)}
                              disabled={!l.downloadable}
                              onChange={() => toggleLecture(l.id)}
                            />
                            <TypeIcon type={l.type} />
                            <span className="dl-lec-title">{l.title}</span>
                            <span className="dl-lec-tags">
                              {l.resources > 0 && (
                                <span className="res-tag" title="Tài liệu đính kèm">
                                  <Paperclip size={11} /> {l.resources}
                                </span>
                              )}
                              {l.captions > 0 && <span className="cc">CC</span>}
                              {!l.downloadable && (
                                <span className="muted small">không bật tải</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Tiến độ tải */}
              {task && (
                <div className="dl-progress">
                  {!task.finished ? (
                    <div className="dl-status">
                      <Loader2 size={18} className="spin" /> Đang tải {task.done}/
                      {task.total}…
                    </div>
                  ) : task.error ? (
                    <div className="dl-status err">
                      <XCircle size={18} /> {task.error}
                    </div>
                  ) : (
                    <div className="dl-status ok">
                      <CheckCircle2 size={18} /> Xong! Đã xử lý {task.done}/
                      {task.total} bài. Giờ bấm “Chọn folder khoá học” để xem.
                    </div>
                  )}
                  <div className="prog-bar big">
                    <div
                      className="prog-fill"
                      style={{
                        width:
                          (task.total ? (task.done / task.total) * 100 : 0) + '%',
                      }}
                    />
                  </div>
                  <div className="dl-log">
                    {task.items
                      .slice()
                      .reverse()
                      .map((it, i) => (
                        <div key={i} className={'dl-log-row ' + it.status}>
                          {it.status === 'ok' ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <XCircle size={14} />
                          )}
                          <span>{it.name}</span>
                          <span className="muted small">{it.detail}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {serverState !== 'down' && (
          <div className="modal-foot">
            {task ? (
              <button className="btn-sm" onClick={onClose}>
                Đóng
              </button>
            ) : (
              <>
                <span className="muted small">
                  {curriculum ? `Đã chọn ${pickedCount} bài` : ''}
                </span>
                <div className="spacer" />
                <button className="btn-sm" onClick={onClose}>
                  Huỷ
                </button>
                <button
                  className="btn-sm primary"
                  disabled={busy || !curriculum || pickedCount === 0}
                  onClick={startDownload}
                >
                  <Download size={16} /> Tải {pickedCount > 0 ? pickedCount : ''} bài
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
