import { useMemo, useState } from 'react'
import { X, BookMarked, Trash2, Copy, Download, Search } from 'lucide-react'

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  s = Math.floor(s)
  const m = Math.floor(s / 60)
  const sec = String(s % 60).padStart(2, '0')
  return `${m}:${sec}`
}

// Tô đậm từ đang lưu trong câu ngữ cảnh.
function highlight(sentence, word) {
  if (!sentence) return null
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = sentence.split(re)
  return parts.map((p, i) =>
    re.test(p) && p.toLowerCase() === word.toLowerCase() ? (
      <mark key={i}>{p}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

export default function VocabPanel({ vocab, onRemove, onClear, onClose }) {
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const arr = Object.values(vocab).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    )
    if (!q.trim()) return arr
    const s = q.toLowerCase()
    return arr.filter(
      (it) =>
        it.word.toLowerCase().includes(s) ||
        (it.sentence || '').toLowerCase().includes(s),
    )
  }, [vocab, q])

  const total = Object.keys(vocab).length

  function exportTxt() {
    const lines = Object.values(vocab)
      .sort((a, b) => a.word.localeCompare(b.word))
      .map((it) => `${it.word}\t${it.sentence || ''}\t(${it.lecture || ''})`)
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tu-vung.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyAll() {
    const text = Object.values(vocab)
      .map((it) => it.word)
      .join(', ')
    navigator.clipboard?.writeText(text)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal vocab-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <BookMarked size={20} /> Từ vựng đã lưu
            <span className="vocab-count">{total}</span>
          </h2>
          <button className="ic-btn sm dark" onClick={onClose} title="Đóng">
            <X size={20} />
          </button>
        </div>

        <div className="vocab-toolbar">
          <div className="search-wrap grow">
            <Search size={15} className="search-ic" />
            <input
              className="search"
              placeholder="Tìm từ hoặc câu…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn-sm" onClick={copyAll} disabled={!total}>
            <Copy size={15} /> Copy
          </button>
          <button className="btn-sm" onClick={exportTxt} disabled={!total}>
            <Download size={15} /> Xuất .txt
          </button>
        </div>

        <div className="modal-body">
          {total === 0 ? (
            <div className="vocab-empty">
              <BookMarked size={34} />
              <p>Chưa lưu từ nào.</p>
              <p className="muted">
                Khi xem video, di chuột vào một từ trong phụ đề (video tự dừng)
                rồi bấm vào từ đó để lưu.
              </p>
            </div>
          ) : list.length === 0 ? (
            <div className="vocab-empty">
              <p className="muted">Không tìm thấy từ khớp “{q}”.</p>
            </div>
          ) : (
            <div className="vocab-list">
              {list.map((it) => (
                <div key={it.key} className="vocab-row">
                  <div className="vocab-main">
                    <div className="vocab-word">
                      {it.word}
                      {it.count > 1 && (
                        <span className="vocab-times">×{it.count}</span>
                      )}
                    </div>
                    {it.sentence && (
                      <div className="vocab-sentence">
                        {highlight(it.sentence, it.word)}
                      </div>
                    )}
                    <div className="vocab-meta">
                      {it.lecture}
                      {it.time != null && ` · ${fmt(it.time)}`}
                    </div>
                  </div>
                  <button
                    className="ic-btn sm dark"
                    onClick={() => onRemove(it.key)}
                    title="Xoá"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="modal-foot">
            <button className="link danger" onClick={onClear}>
              <Trash2 size={14} /> Xoá tất cả
            </button>
            <div className="spacer" />
            <button className="btn-sm" onClick={onClose}>
              Đóng
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
