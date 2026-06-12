import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { scanFiles } from './lib/fs'
import { parseCues, cueAt } from './lib/srt'

const LS_KEY = 'udemy-local-progress'
const LS_FONT = 'udemy-local-fontsize'
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {}
  } catch {
    return {}
  }
}

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export default function App() {
  const [courses, setCourses] = useState([])
  const [courseIdx, setCourseIdx] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState(loadProgress)
  const [videoUrl, setVideoUrl] = useState(null)
  const [tracks, setTracks] = useState([]) // [{ label, cues }]

  // Phụ đề: chọn theo nhãn ngôn ngữ để giữ nguyên khi chuyển bài.
  const [sub1, setSub1] = useState('') // nhãn phụ đề chính ('' = tắt)
  const [sub2, setSub2] = useState('') // nhãn phụ đề phụ (song ngữ)
  const [cur1, setCur1] = useState('')
  const [cur2, setCur2] = useState('')
  const [fontSize, setFontSize] = useState(
    () => +localStorage.getItem(LS_FONT) || 24,
  )

  // Trạng thái trình phát (controls tự dựng để phụ đề hiển thị cả khi toàn màn hình).
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [isFull, setIsFull] = useState(false)
  const [showCtrl, setShowCtrl] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const videoRef = useRef(null)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const saveRef = useRef(0)
  const hideRef = useRef(0)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [courses.length])

  useEffect(() => {
    localStorage.setItem(LS_FONT, String(fontSize))
  }, [fontSize])

  const course = courses[courseIdx]
  const flat = useMemo(
    () => (course ? course.chapters.flatMap((ch) => ch.lectures) : []),
    [course],
  )
  const activeLecture = useMemo(
    () => flat.find((l) => l.id === activeId) || null,
    [flat, activeId],
  )
  const activeIndex = flat.findIndex((l) => l.id === activeId)
  const labels = tracks.map((t) => t.label)

  function persist(updater) {
    setProgress((p) => {
      const np = updater(p)
      localStorage.setItem(LS_KEY, JSON.stringify(np))
      return np
    })
  }

  function onPick(e) {
    const files = e.target.files
    if (!files || !files.length) return
    const data = scanFiles(files)
    if (!data.length) {
      alert('Không tìm thấy video trong folder. Kiểm tra lại cấu trúc thư mục.')
      return
    }
    setCourses(data)
    setCourseIdx(0)
    setQuery('')
    setActiveId(data[0]?.chapters[0]?.lectures[0]?.id || null)
  }

  function selectCourse(i) {
    setCourseIdx(i)
    setActiveId(courses[i]?.chapters[0]?.lectures[0]?.id || null)
  }

  // Nạp video + parse phụ đề khi đổi bài.
  useEffect(() => {
    let url = null
    let cancelled = false
    async function load() {
      setCur1('')
      setCur2('')
      if (!activeLecture) {
        setVideoUrl(null)
        setTracks([])
        return
      }
      url = URL.createObjectURL(activeLecture.file)
      const tr = []
      for (const s of activeLecture.subs) {
        tr.push({ label: s.label, cues: parseCues(await s.file.text()) })
      }
      if (cancelled) return
      setVideoUrl(url)
      setTracks(tr)
    }
    load()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [activeLecture])

  // Khi danh sách phụ đề đổi: đảm bảo lựa chọn còn hợp lệ, mặc định bật cái đầu.
  useEffect(() => {
    const has = (x) => x && labels.includes(x)
    setSub1((prev) => (has(prev) ? prev : labels[0] || ''))
    setSub2((prev) => (has(prev) ? prev : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  function cueText(label, t) {
    const tr = tracks.find((x) => x.label === label)
    return tr ? cueAt(tr.cues, t) : ''
  }

  function onLoadedMeta() {
    const v = videoRef.current
    if (!v || !activeLecture) return
    setDuration(v.duration || 0)
    v.playbackRate = rate
    v.volume = volume
    v.muted = muted
    const saved = progress[activeLecture.id]
    if (saved?.time && saved.time < v.duration - 5) v.currentTime = saved.time
  }

  function onTime() {
    const v = videoRef.current
    if (!v || !activeLecture) return
    const t = v.currentTime
    setCurTime(t)
    setCur1(sub1 ? cueText(sub1, t) : '')
    setCur2(sub2 ? cueText(sub2, t) : '')

    const now = Date.now()
    if (now - saveRef.current > 3000) {
      saveRef.current = now
      persist((p) => ({
        ...p,
        [activeLecture.id]: { ...p[activeLecture.id], time: t },
      }))
    }
  }

  function setWatched(id, watched) {
    persist((p) => ({ ...p, [id]: { ...p[id], watched } }))
  }

  function onEnded() {
    if (activeLecture) setWatched(activeLecture.id, true)
    if (activeIndex >= 0 && activeIndex < flat.length - 1)
      setActiveId(flat[activeIndex + 1].id)
  }

  const goPrev = () => activeIndex > 0 && setActiveId(flat[activeIndex - 1].id)
  const goNext = () =>
    activeIndex >= 0 &&
    activeIndex < flat.length - 1 &&
    setActiveId(flat[activeIndex + 1].id)

  // ---------- Điều khiển trình phát ----------
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }, [])

  function seek(t) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(t, v.duration || 0))
    setCurTime(v.currentTime)
  }

  function nudge(delta) {
    const v = videoRef.current
    if (v) seek(v.currentTime + delta)
  }

  function changeVolume(val) {
    const v = videoRef.current
    setVolume(val)
    setMuted(val === 0)
    if (v) {
      v.volume = val
      v.muted = val === 0
    }
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    const nm = !v.muted
    v.muted = nm
    setMuted(nm)
  }

  function changeRate(r) {
    const v = videoRef.current
    setRate(r)
    if (v) v.playbackRate = r
  }

  const toggleFull = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }, [])

  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Tự ẩn thanh điều khiển khi đang phát.
  const wakeControls = useCallback(() => {
    setShowCtrl(true)
    clearTimeout(hideRef.current)
    if (videoRef.current && !videoRef.current.paused) {
      hideRef.current = setTimeout(() => setShowCtrl(false), 2800)
    }
  }, [])

  useEffect(() => {
    if (!playing) setShowCtrl(true)
  }, [playing])

  // Phím tắt.
  useEffect(() => {
    function onKey(e) {
      if (!activeLecture) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          nudge(-5)
          break
        case 'ArrowRight':
          nudge(5)
          break
        case 'ArrowUp':
          e.preventDefault()
          changeVolume(Math.min(1, volume + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          changeVolume(Math.max(0, volume - 0.05))
          break
        case 'f':
          toggleFull()
          break
        case 'm':
          toggleMute()
          break
        default:
      }
      wakeControls()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLecture, volume, togglePlay, toggleFull, wakeControls])

  const visibleChapters = useMemo(() => {
    if (!course) return []
    if (!query.trim()) return course.chapters
    const q = query.toLowerCase()
    return course.chapters
      .map((ch) => ({
        ...ch,
        lectures: ch.lectures.filter((l) => l.title.toLowerCase().includes(q)),
      }))
      .filter((ch) => ch.lectures.length)
  }, [course, query])

  const watchedCount = flat.filter((l) => progress[l.id]?.watched).length
  const pct = duration ? (curTime / duration) * 100 : 0
  // Phụ đề phóng to khi toàn màn hình để dễ đọc trên màn lớn.
  const subPx = Math.round(fontSize * (isFull ? 1.7 : 1))

  if (!courses.length) {
    return (
      <div className="landing">
        <div className="landing-card">
          <div className="landing-logo">🎓</div>
          <h1>Udemy Local</h1>
          <p>Xem các khoá học đã tải về máy, ngay trong trình duyệt — kèm phụ đề song ngữ.</p>
          <button className="btn" onClick={() => inputRef.current?.click()}>
            Chọn folder khoá học…
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
          <p className="hint">
            Cấu trúc: <code>Khoá học / NN - Chương / NN - Bài giảng.mp4</code>{' '}
            (kèm <code>.srt</code>)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={'app' + (sidebarOpen ? '' : ' collapsed')}>
      <aside className="sidebar">
        <div className="side-head">
          <select
            className="course-select"
            value={courseIdx}
            onChange={(e) => selectCourse(+e.target.value)}
          >
            {courses.map((c, i) => (
              <option key={i} value={i}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="search-wrap">
            <span className="search-ic">🔎</span>
            <input
              className="search"
              placeholder="Tìm bài giảng…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="progress-line">
            <div className="prog-meta">
              <div className="prog-bar">
                <div
                  className="prog-fill"
                  style={{ width: (flat.length ? (watchedCount / flat.length) * 100 : 0) + '%' }}
                />
              </div>
              <span>
                Đã xem {watchedCount}/{flat.length}
              </span>
            </div>
            <button className="link" onClick={() => inputRef.current?.click()}>
              Đổi folder
            </button>
          </div>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
        </div>

        <div className="tree">
          {visibleChapters.map((ch) => (
            <div key={ch.raw} className="chapter">
              <div className="chapter-title">{ch.name}</div>
              {ch.lectures.map((l) => {
                const pr = progress[l.id]
                return (
                  <div
                    key={l.id}
                    className={
                      'lecture' +
                      (l.id === activeId ? ' active' : '') +
                      (pr?.watched ? ' done' : '')
                    }
                    onClick={() => setActiveId(l.id)}
                  >
                    <input
                      type="checkbox"
                      checked={!!pr?.watched}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setWatched(l.id, e.target.checked)}
                    />
                    <span className="lec-title">{l.title}</span>
                    {l.subs.length > 0 && <span className="cc">CC</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      <main className="player">
        {activeLecture ? (
          <>
            <div
              ref={wrapRef}
              className={
                'video-wrap' +
                (isFull ? ' fullscreen' : '') +
                (showCtrl || !playing ? ' show-ctrl' : ' hide-ctrl')
              }
              onMouseMove={wakeControls}
              onClick={(e) => {
                // Click vào vùng video (không phải nút) -> play/pause
                if (e.target === e.currentTarget || e.target.tagName === 'VIDEO')
                  togglePlay()
              }}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget || e.target.tagName === 'VIDEO')
                  toggleFull()
              }}
            >
              <video
                key={activeLecture.id}
                ref={videoRef}
                src={videoUrl || undefined}
                autoPlay
                onLoadedMetadata={onLoadedMeta}
                onTimeUpdate={onTime}
                onPlay={() => {
                  setPlaying(true)
                  wakeControls()
                }}
                onPause={() => setPlaying(false)}
                onEnded={onEnded}
                onDurationChange={(e) => setDuration(e.target.duration || 0)}
              />

              {(cur1 || cur2) && (
                <div
                  className="subs"
                  style={{
                    fontSize: subPx + 'px',
                    bottom: showCtrl || !playing ? '90px' : '36px',
                  }}
                >
                  {cur1 && <div className="sub-line primary">{cur1}</div>}
                  {cur2 && <div className="sub-line secondary">{cur2}</div>}
                </div>
              )}

              {/* Nút play lớn khi đang tạm dừng */}
              {!playing && (
                <button
                  className="big-play"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePlay()
                  }}
                  aria-label="Phát"
                >
                  ▶
                </button>
              )}

              {/* Thanh điều khiển tự dựng */}
              <div className="controls" onClick={(e) => e.stopPropagation()}>
                <input
                  className="seek"
                  type="range"
                  min={0}
                  max={duration || 0}
                  step="0.1"
                  value={curTime}
                  style={{
                    background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,.25) ${pct}%)`,
                  }}
                  onChange={(e) => seek(+e.target.value)}
                />
                <div className="ctrl-row">
                  <button className="ic-btn" onClick={togglePlay} title="Phát/Dừng (Space)">
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button className="ic-btn" onClick={() => nudge(-5)} title="Lùi 5s (←)">
                    ⏪
                  </button>
                  <button className="ic-btn" onClick={() => nudge(5)} title="Tới 5s (→)">
                    ⏩
                  </button>

                  <div className="vol">
                    <button className="ic-btn" onClick={toggleMute} title="Tắt tiếng (M)">
                      {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
                    </button>
                    <input
                      className="vol-range"
                      type="range"
                      min={0}
                      max={1}
                      step="0.01"
                      value={muted ? 0 : volume}
                      onChange={(e) => changeVolume(+e.target.value)}
                    />
                  </div>

                  <span className="time">
                    {fmt(curTime)} / {fmt(duration)}
                  </span>

                  <div className="spacer" />

                  {/* Phụ đề chính */}
                  {tracks.length > 0 && (
                    <>
                      <label className="ctrl-sel" title="Phụ đề chính">
                        <span className="sel-ic">CC</span>
                        <select value={sub1} onChange={(e) => setSub1(e.target.value)}>
                          <option value="">Tắt</option>
                          {labels.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ctrl-sel" title="Phụ đề song ngữ">
                        <span className="sel-ic">文</span>
                        <select value={sub2} onChange={(e) => setSub2(e.target.value)}>
                          <option value="">Tắt</option>
                          {labels.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="font-ctrl" title="Cỡ chữ phụ đề">
                        <button
                          className="ic-btn sm"
                          onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                        >
                          A−
                        </button>
                        <span className="font-val">{fontSize}</span>
                        <button
                          className="ic-btn sm"
                          onClick={() => setFontSize((s) => Math.min(64, s + 2))}
                        >
                          A+
                        </button>
                      </div>
                    </>
                  )}

                  <label className="ctrl-sel" title="Tốc độ phát">
                    <span className="sel-ic">⚡</span>
                    <select value={rate} onChange={(e) => changeRate(+e.target.value)}>
                      {SPEEDS.map((s) => (
                        <option key={s} value={s}>
                          {s}×
                        </option>
                      ))}
                    </select>
                  </label>

                  <button className="ic-btn" onClick={toggleFull} title="Toàn màn hình (F)">
                    {isFull ? '🗗' : '⛶'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bar">
              <button
                className="btn-sm"
                onClick={() => setSidebarOpen((s) => !s)}
                title="Ẩn/hiện danh sách bài"
              >
                ☰
              </button>
              <button
                className="btn-sm"
                onClick={goPrev}
                disabled={activeIndex <= 0}
              >
                ← Bài trước
              </button>
              <h2 className="now" title={activeLecture.title}>
                {activeLecture.title}
              </h2>
              <div className="spacer" />
              <button
                className="btn-sm primary"
                onClick={goNext}
                disabled={activeIndex >= flat.length - 1}
              >
                Bài tiếp →
              </button>
            </div>
          </>
        ) : (
          <div className="empty">Chọn một bài giảng để xem</div>
        )}
      </main>
    </div>
  )
}
