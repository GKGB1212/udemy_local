import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Gauge,
  Captions,
  Type,
  FileText,
  Search,
  ChevronDown,
  Check,
  GraduationCap,
  PanelRight,
  PanelRightOpen,
  FolderInput,
  CirclePlay,
  X,
  Sun,
  Moon,
  Download,
  BookMarked,
  Paperclip,
  FileAudio,
  File as FileIcon,
  ExternalLink,
  Copy,
} from 'lucide-react'
import DownloadPanel from './DownloadPanel'
import VocabPanel from './VocabPanel'
import { scanFiles } from './lib/fs'
import { parseCues, cueAt, cueIndexAt } from './lib/srt'

const LS_KEY = 'udemy-local-progress'
const LS_FONT = 'udemy-local-fontsize'
const LS_THEME = 'udemy-local-theme'
const LS_VOCAB = 'udemy-local-vocab'

function loadVocab() {
  try {
    return JSON.parse(localStorage.getItem(LS_VOCAB)) || {}
  } catch {
    return {}
  }
}

// Tách câu phụ đề thành từ bấm được: hover -> dừng, click -> lưu.
function WordSub({ text, onHover, onWord, isSaved }) {
  const parts = text.split(/(\s+)/)
  return parts.map((p, i) => {
    if (p === '' || /^\s+$/.test(p)) return p
    const core = p.replace(/^[^\p{L}'’-]+|[^\p{L}'’-]+$/gu, '')
    if (!core) return p
    const key = core.toLowerCase()
    return (
      <span
        key={i}
        className={'word' + (isSaved(key) ? ' saved' : '')}
        onMouseEnter={onHover}
        onClick={(e) => {
          e.stopPropagation()
          onWord(core, key)
        }}
      >
        {p}
      </span>
    )
  })
}
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]

function ThemeToggle({ theme, setTheme, dark }) {
  return (
    <div className={'theme-toggle' + (dark ? ' on-dark' : '')}>
      <button
        className={theme === 'light' ? 'on' : ''}
        onClick={() => setTheme('light')}
        title="Giao diện sáng"
      >
        <Sun size={14} /> Sáng
      </button>
      <button
        className={theme === 'dark' ? 'on' : ''}
        onClick={() => setTheme('dark')}
        title="Giao diện tối"
      >
        <Moon size={14} /> Tối
      </button>
    </div>
  )
}

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

// Phút làm tròn kiểu Udemy ("4min").
function mins(s) {
  if (!s || !isFinite(s)) return null
  return Math.max(1, Math.round(s / 60)) + 'min'
}

// Danh sách tài liệu đính kèm: mở để xem hoặc tải xuống (dùng object URL).
function ResourceList({ items }) {
  if (!items.length)
    return <div className="doc-empty">Không có tài liệu đính kèm.</div>
  return (
    <div className="res-list">
      {items.map((r, i) => (
        <div key={i} className="res-item">
          <Paperclip size={16} />
          <span className="res-name" title={r.name}>
            {r.name}
          </span>
          <a className="res-act" href={r.url} target="_blank" rel="noreferrer" title="Mở">
            <ExternalLink size={15} />
          </a>
          <a className="res-act" href={r.url} download={r.name} title="Tải xuống">
            <Download size={15} />
          </a>
        </div>
      ))}
    </div>
  )
}

// Khu hiển thị bài giảng KHÔNG phải video: bài viết, audio, file, hoặc chỉ tài liệu.
function DocStage({ lecture, mediaUrl, articleHtml, resources }) {
  const t = lecture.type
  return (
    <div className="doc-stage">
      <div className="doc-card">
        {t === 'article' && (
          <iframe
            className="article-frame"
            title={lecture.title}
            srcDoc={articleHtml}
          />
        )}
        {t === 'audio' && (
          <div className="doc-media">
            <FileAudio size={46} strokeWidth={1.3} />
            <h3>{lecture.title}</h3>
            <audio controls src={mediaUrl || undefined} className="doc-audio" />
          </div>
        )}
        {t === 'file' && (
          <div className="doc-media">
            <FileIcon size={46} strokeWidth={1.3} />
            <h3>{lecture.title}</h3>
            <p className="muted">
              Loại tài liệu này không xem trực tiếp trong trình phát.
            </p>
            <div className="doc-actions">
              <a
                className="btn-sm"
                href={mediaUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} /> Mở
              </a>
              <a
                className="btn-sm primary"
                href={mediaUrl || undefined}
                download={lecture.raw}
              >
                <Download size={16} /> Tải xuống
              </a>
            </div>
          </div>
        )}
        {t === 'resources' && (
          <div className="doc-media">
            <Paperclip size={46} strokeWidth={1.3} />
            <h3>{lecture.title}</h3>
            <p className="muted">Bài này chỉ có tài liệu đính kèm.</p>
          </div>
        )}
      </div>
      <div className="doc-resources">
        <div className="doc-res-head">
          <Paperclip size={15} /> Tài liệu đính kèm
        </div>
        <ResourceList items={resources} />
      </div>
    </div>
  )
}

export default function App() {
  const [courses, setCourses] = useState([])
  const [courseIdx, setCourseIdx] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState(loadProgress)
  const [videoUrl, setVideoUrl] = useState(null) // object URL của asset chính
  const [tracks, setTracks] = useState([]) // [{ label, cues }]
  const [articleHtml, setArticleHtml] = useState('') // nội dung bài viết (.html)
  const [resourceUrls, setResourceUrls] = useState([]) // [{ name, url }]

  // Phụ đề: chọn theo nhãn ngôn ngữ để giữ nguyên khi chuyển bài.
  const [sub1, setSub1] = useState('') // nhãn phụ đề chính ('' = tắt)
  const [sub2, setSub2] = useState('') // nhãn phụ đề phụ (song ngữ)
  const [cur1, setCur1] = useState('')
  const [cur2, setCur2] = useState('')
  const [fontSize, setFontSize] = useState(
    () => +localStorage.getItem(LS_FONT) || 24,
  )
  const [theme, setTheme] = useState(
    () => localStorage.getItem(LS_THEME) || 'light',
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
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptCopied, setTranscriptCopied] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [collapsed, setCollapsed] = useState({}) // chapterRaw -> true nếu gập
  const [showDownload, setShowDownload] = useState(false)
  const [vocab, setVocab] = useState(loadVocab)
  const [showVocab, setShowVocab] = useState(false)
  const [toast, setToast] = useState('')

  const videoRef = useRef(null)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const saveRef = useRef(0)
  const hideRef = useRef(0)
  const activeRowRef = useRef(null)
  const pausedByHoverRef = useRef(false)
  const toastRef = useRef(0)

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(LS_THEME, theme)
  }, [theme])

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
      alert('Không tìm thấy bài giảng trong folder. Kiểm tra lại cấu trúc thư mục.')
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

  // Nạp asset chính (video/audio/file/bài viết) + phụ đề + tài liệu khi đổi bài.
  useEffect(() => {
    const urls = [] // object URL cần thu hồi khi rời bài
    let cancelled = false
    async function load() {
      setCur1('')
      setCur2('')
      setArticleHtml('')
      setResourcesOpen(false)
      if (!activeLecture) {
        setVideoUrl(null)
        setTracks([])
        setResourceUrls([])
        return
      }
      // Tạo object URL trước (đồng bộ) để cleanup luôn thu hồi được.
      const mediaUrl = activeLecture.file
        ? URL.createObjectURL(activeLecture.file)
        : null
      if (mediaUrl) urls.push(mediaUrl)
      const rs = (activeLecture.resources || []).map((r) => {
        const u = URL.createObjectURL(r.file)
        urls.push(u)
        return { name: r.name, url: u }
      })
      setVideoUrl(mediaUrl)
      setResourceUrls(rs)

      const tr = []
      for (const s of activeLecture.subs) {
        tr.push({ label: s.label, cues: parseCues(await s.file.text()) })
      }
      let html = ''
      if (activeLecture.type === 'article' && activeLecture.file) {
        html = await activeLecture.file.text()
      }
      if (cancelled) return
      setTracks(tr)
      setArticleHtml(html)
    }
    load()
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [activeLecture])

  // Mở rộng chương chứa bài đang xem (giống Udemy).
  useEffect(() => {
    if (!activeLecture || !course) return
    const ch = course.chapters.find((c) =>
      c.lectures.some((l) => l.id === activeLecture.id),
    )
    if (ch) setCollapsed((c) => ({ ...c, [ch.raw]: false }))
  }, [activeLecture, course])

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

  // Track dùng cho transcript: ưu tiên phụ đề chính, nếu tắt thì lấy track đầu.
  const transcriptTrack = useMemo(
    () => tracks.find((t) => t.label === sub1) || tracks[0] || null,
    [tracks, sub1],
  )
  const activeCue = transcriptTrack
    ? cueIndexAt(transcriptTrack.cues, curTime)
    : -1

  // Copy toàn bộ transcript (chỉ lấy phần text) vào clipboard.
  const copyTranscript = useCallback(async () => {
    if (!transcriptTrack || !transcriptTrack.cues.length) return
    const text = transcriptTrack.cues.map((c) => c.text).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback nếu clipboard API không khả dụng.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setTranscriptCopied(true)
    setTimeout(() => setTranscriptCopied(false), 1500)
  }, [transcriptTrack])

  function onLoadedMeta() {
    const v = videoRef.current
    if (!v || !activeLecture) return
    setDuration(v.duration || 0)
    v.playbackRate = rate
    v.volume = volume
    v.muted = muted
    // Lưu thời lượng để hiển thị "Xmin" trong danh sách bài.
    if (v.duration && isFinite(v.duration))
      persist((p) => ({
        ...p,
        [activeLecture.id]: { ...p[activeLecture.id], dur: v.duration },
      }))
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

  // ---------- Lưu từ vựng từ phụ đề ----------
  function flashToast(msg) {
    setToast(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 1600)
  }

  // Di chuột vào 1 từ -> tạm dừng để kịp đọc/lưu.
  function pauseForHover() {
    const v = videoRef.current
    if (v && !v.paused) {
      v.pause()
      pausedByHoverRef.current = true
    }
  }
  // Rời khỏi vùng phụ đề -> phát tiếp nếu chính ta đã tự dừng.
  function resumeAfterHover() {
    if (pausedByHoverRef.current) {
      pausedByHoverRef.current = false
      videoRef.current?.play()
    }
  }

  function saveWord(word, key) {
    const sentence = cur1
    setVocab((prev) => {
      const ex = prev[key]
      const np = {
        ...prev,
        [key]: {
          key,
          word: ex?.word || word,
          count: (ex?.count || 0) + 1,
          sentence,
          lecture: activeLecture?.title || '',
          time: curTime,
          addedAt: ex?.addedAt || Date.now(),
          updatedAt: Date.now(),
        },
      }
      localStorage.setItem(LS_VOCAB, JSON.stringify(np))
      return np
    })
    flashToast(`Đã lưu “${word}”`)
  }

  function removeWord(key) {
    setVocab((prev) => {
      const np = { ...prev }
      delete np[key]
      localStorage.setItem(LS_VOCAB, JSON.stringify(np))
      return np
    })
  }

  function clearVocab() {
    if (!confirm('Xoá toàn bộ từ đã lưu?')) return
    setVocab({})
    localStorage.removeItem(LS_VOCAB)
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

  // Auto-scroll transcript tới dòng đang phát.
  useEffect(() => {
    if (transcriptOpen && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeCue, transcriptOpen])

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
  const vocabCount = Object.keys(vocab).length
  const pct = duration ? (curTime / duration) * 100 : 0
  // Phụ đề phóng to khi toàn màn hình để dễ đọc trên màn lớn.
  const subPx = Math.round(fontSize * (isFull ? 1.7 : 1))
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  let globalNo = 0 // số thứ tự bài liên tục trong khoá (giống "18. ...")

  if (!courses.length) {
    return (
      <div className="landing">
        <div className="landing-card">
          <div className="landing-logo">
            <GraduationCap size={52} strokeWidth={1.5} />
          </div>
          <h1>Udemy Local</h1>
          <p>
            Xem các khoá học đã tải về máy, ngay trong trình duyệt — kèm phụ đề
            song ngữ &amp; transcript.
          </p>
          <button className="btn" onClick={() => inputRef.current?.click()}>
            <FolderInput size={18} /> Chọn folder khoá học…
          </button>
          <button
            className="btn ghost"
            onClick={() => setShowDownload(true)}
          >
            <Download size={18} /> Tải khoá học từ Udemy
          </button>
          {vocabCount > 0 && (
            <button className="btn ghost" onClick={() => setShowVocab(true)}>
              <BookMarked size={18} /> Từ vựng đã lưu ({vocabCount})
            </button>
          )}
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
          <p className="hint">
            Cấu trúc: <code>Khoá học / NN - Chương / NN - Bài giảng.mp4</code>{' '}
            (kèm <code>.srt</code>)
          </p>
          <ThemeToggle theme={theme} setTheme={setTheme} dark />
        </div>
        {showDownload && <DownloadPanel onClose={() => setShowDownload(false)} />}
        {showVocab && (
          <VocabPanel
            vocab={vocab}
            onRemove={removeWord}
            onClear={clearVocab}
            onClose={() => setShowVocab(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className={'app' + (sidebarOpen ? '' : ' collapsed')}>
      <main className="player">
        {activeLecture ? (
          <>
            {activeLecture.type === 'video' ? (
            <div
              ref={wrapRef}
              className={
                'video-wrap' +
                (isFull ? ' fullscreen' : '') +
                (showCtrl || !playing ? ' show-ctrl' : ' hide-ctrl')
              }
              onMouseMove={wakeControls}
              onClick={(e) => {
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
                    bottom: showCtrl || !playing ? '92px' : '36px',
                    right: transcriptOpen && !isFull ? '380px' : undefined,
                    width: transcriptOpen && !isFull ? 'auto' : '92%',
                    left: transcriptOpen && !isFull ? '24px' : '50%',
                    transform:
                      transcriptOpen && !isFull ? 'none' : 'translateX(-50%)',
                  }}
                >
                  {cur1 && (
                    <div
                      className="sub-line primary"
                      onMouseLeave={resumeAfterHover}
                    >
                      <WordSub
                        text={cur1}
                        onHover={pauseForHover}
                        onWord={saveWord}
                        isSaved={(k) => !!vocab[k]}
                      />
                    </div>
                  )}
                  {cur2 && <div className="sub-line secondary">{cur2}</div>}
                </div>
              )}

              {toast && <div className="word-toast">{toast}</div>}

              {!playing && (
                <button
                  className="big-play"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePlay()
                  }}
                  aria-label="Phát"
                >
                  <Play size={34} fill="currentColor" />
                </button>
              )}

              {/* Panel transcript (overlay phải, hiển thị cả khi toàn màn hình) */}
              {transcriptOpen && (
                <div className="transcript" onClick={(e) => e.stopPropagation()}>
                  <div className="transcript-head">
                    <span>
                      <FileText size={16} /> Transcript
                      {transcriptTrack ? ` · ${transcriptTrack.label}` : ''}
                    </span>
                    <div className="transcript-head-actions">
                      <button
                        className="ic-btn sm"
                        onClick={copyTranscript}
                        disabled={!transcriptTrack || !transcriptTrack.cues.length}
                        title="Copy toàn bộ transcript"
                      >
                        {transcriptCopied ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                      <button
                        className="ic-btn sm"
                        onClick={() => setTranscriptOpen(false)}
                        title="Đóng"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="transcript-body">
                    {!transcriptTrack || !transcriptTrack.cues.length ? (
                      <div className="transcript-empty">
                        Bài này chưa có phụ đề.
                      </div>
                    ) : (
                      transcriptTrack.cues.map((c, i) => (
                        <div
                          key={i}
                          ref={i === activeCue ? activeRowRef : null}
                          className={
                            'tr-line' + (i === activeCue ? ' active' : '')
                          }
                          onClick={() => seek(c.start)}
                        >
                          <span className="tr-time">{fmt(c.start)}</span>
                          <span className="tr-text">{c.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
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
                    {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                  </button>
                  <button className="ic-btn" onClick={() => nudge(-5)} title="Lùi 5s (←)">
                    <Rewind size={19} />
                  </button>
                  <button className="ic-btn" onClick={() => nudge(5)} title="Tới 5s (→)">
                    <FastForward size={19} />
                  </button>

                  <div className="vol">
                    <button className="ic-btn" onClick={toggleMute} title="Tắt tiếng (M)">
                      <VolIcon size={19} />
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

                  {tracks.length > 0 && (
                    <>
                      <label className="ctrl-sel" title="Phụ đề chính">
                        <Captions size={16} />
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
                        <span className="sel-ic-text">文</span>
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
                        <Type size={14} />
                        <button
                          className="ic-btn sm"
                          onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                        >
                          −
                        </button>
                        <span className="font-val">{fontSize}</span>
                        <button
                          className="ic-btn sm"
                          onClick={() => setFontSize((s) => Math.min(64, s + 2))}
                        >
                          +
                        </button>
                      </div>
                    </>
                  )}

                  <label className="ctrl-sel" title="Tốc độ phát">
                    <Gauge size={16} />
                    <select value={rate} onChange={(e) => changeRate(+e.target.value)}>
                      {SPEEDS.map((s) => (
                        <option key={s} value={s}>
                          {s}×
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className={'ic-btn' + (transcriptOpen ? ' on' : '')}
                    onClick={() => setTranscriptOpen((v) => !v)}
                    title="Transcript"
                  >
                    <FileText size={19} />
                  </button>

                  <button className="ic-btn" onClick={toggleFull} title="Toàn màn hình (F)">
                    {isFull ? <Minimize size={19} /> : <Maximize size={19} />}
                  </button>
                </div>
              </div>
            </div>
            ) : (
              <DocStage
                lecture={activeLecture}
                mediaUrl={videoUrl}
                articleHtml={articleHtml}
                resources={resourceUrls}
              />
            )}

            <div className="bar">
              <button
                className="btn-sm icon"
                onClick={() => setSidebarOpen((s) => !s)}
                title="Ẩn/hiện nội dung khoá học"
              >
                {sidebarOpen ? <PanelRightOpen size={18} /> : <PanelRight size={18} />}
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
                className="btn-sm icon"
                onClick={() => setShowVocab(true)}
                title="Từ vựng đã lưu"
              >
                <BookMarked size={17} /> Từ vựng
                {vocabCount > 0 && <span className="badge">{vocabCount}</span>}
              </button>
              {activeLecture.type === 'video' && resourceUrls.length > 0 && (
                <button
                  className={'btn-sm icon' + (resourcesOpen ? ' on' : '')}
                  onClick={() => setResourcesOpen((v) => !v)}
                  title="Tài liệu đính kèm"
                >
                  <Paperclip size={17} /> Tài liệu
                  <span className="badge">{resourceUrls.length}</span>
                </button>
              )}
              <button
                className={'btn-sm icon' + (transcriptOpen ? ' on' : '')}
                onClick={() => setTranscriptOpen((v) => !v)}
                title="Transcript"
              >
                <FileText size={17} /> Transcript
              </button>
              <button
                className="btn-sm primary"
                onClick={goNext}
                disabled={activeIndex >= flat.length - 1}
              >
                Bài tiếp →
              </button>
            </div>

            {activeLecture.type === 'video' &&
              resourcesOpen &&
              resourceUrls.length > 0 && (
                <div className="res-strip">
                  <div className="doc-res-head">
                    <Paperclip size={15} /> Tài liệu đính kèm
                    <button
                      className="ic-btn sm"
                      onClick={() => setResourcesOpen(false)}
                      title="Đóng"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <ResourceList items={resourceUrls} />
                </div>
              )}
          </>
        ) : (
          <div className="empty">Chọn một bài giảng để xem</div>
        )}
      </main>

      <aside className="sidebar">
        <div className="side-head">
          <div className="side-title">
            <span>Nội dung khoá học</span>
            <div className="side-title-actions">
              <ThemeToggle theme={theme} setTheme={setTheme} />
              <button
                className="ic-btn sm dark"
                onClick={() => setSidebarOpen(false)}
                title="Ẩn"
              >
                <X size={18} />
              </button>
            </div>
          </div>
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
            <Search size={15} className="search-ic" />
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
                  style={{
                    width:
                      (flat.length ? (watchedCount / flat.length) * 100 : 0) +
                      '%',
                  }}
                />
              </div>
              <span>
                Hoàn thành {watchedCount}/{flat.length} bài
              </span>
            </div>
            <button className="link" onClick={() => setShowDownload(true)}>
              <Download size={14} /> Tải thêm
            </button>
            <button className="link" onClick={() => inputRef.current?.click()}>
              <FolderInput size={14} /> Đổi
            </button>
          </div>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
        </div>

        <div className="tree">
          {visibleChapters.map((ch, ci) => {
            const total = ch.lectures.length
            const done = ch.lectures.filter((l) => progress[l.id]?.watched).length
            const chDur = ch.lectures.reduce(
              (a, l) => a + (progress[l.id]?.dur || 0),
              0,
            )
            const isCol = !!collapsed[ch.raw] && !query.trim()
            return (
              <div key={ch.raw} className="chapter">
                <button
                  className="chapter-title"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [ch.raw]: !c[ch.raw] }))
                  }
                >
                  <div className="ch-info">
                    <div className="ch-name">
                      Phần {ci + 1}: {ch.name}
                    </div>
                    <div className="ch-sub">
                      {done}/{total} | {chDur ? mins(chDur) : `${total} bài`}
                    </div>
                  </div>
                  <ChevronDown
                    size={18}
                    className={'ch-chevron' + (isCol ? ' rot' : '')}
                  />
                </button>
                {!isCol &&
                  ch.lectures.map((l) => {
                    globalNo += 1
                    const pr = progress[l.id]
                    const active = l.id === activeId
                    return (
                      <div
                        key={l.id}
                        className={
                          'lecture' +
                          (active ? ' active' : '') +
                          (pr?.watched ? ' done' : '')
                        }
                        onClick={() => setActiveId(l.id)}
                      >
                        <button
                          className={'lec-check' + (pr?.watched ? ' on' : '')}
                          onClick={(e) => {
                            e.stopPropagation()
                            setWatched(l.id, !pr?.watched)
                          }}
                          title={pr?.watched ? 'Đã xem' : 'Đánh dấu đã xem'}
                        >
                          {pr?.watched && <Check size={13} strokeWidth={3} />}
                        </button>
                        <div className="lec-body">
                          <div className="lec-title">
                            {globalNo}. {l.title}
                          </div>
                          <div className="lec-meta">
                            {l.type === 'article' ? (
                              <>
                                <FileText size={13} /> Bài viết
                              </>
                            ) : l.type === 'audio' ? (
                              <>
                                <FileAudio size={13} /> Audio
                              </>
                            ) : l.type === 'file' || l.type === 'resources' ? (
                              <>
                                <FileIcon size={13} /> Tài liệu
                              </>
                            ) : (
                              <>
                                <CirclePlay size={13} />
                                {pr?.dur ? mins(pr.dur) : 'video'}
                              </>
                            )}
                            {l.subs.length > 0 && <span className="cc">CC</span>}
                            {l.resources.length > 0 && (
                              <span className="res-count" title="Tài liệu đính kèm">
                                <Paperclip size={11} /> {l.resources.length}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
      </aside>

      {showDownload && <DownloadPanel onClose={() => setShowDownload(false)} />}
      {showVocab && (
        <VocabPanel
          vocab={vocab}
          onRemove={removeWord}
          onClear={clearVocab}
          onClose={() => setShowVocab(false)}
        />
      )}
    </div>
  )
}
