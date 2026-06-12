// Parse nội dung phụ đề (.srt hoặc .vtt) thành danh sách cue {start, end, text}.
// Tự render cue lên overlay -> chỉnh được cỡ chữ và hiển thị song ngữ.

function tsToSec(ts) {
  const m = ts.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!m) return 0
  const h = m[1] ? +m[1] : 0
  const min = +m[2]
  const s = +m[3]
  const ms = m[4] ? +m[4].padEnd(3, '0') : 0
  return h * 3600 + min * 60 + s + ms / 1000
}

function clean(t) {
  return t
    .replace(/<[^>]+>/g, '') // bỏ tag <i> <b> <c> ...
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

export function parseCues(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n\s*\n/)
  const cues = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length || lines[0].trim() === 'WEBVTT') continue

    let i = 0
    // bỏ qua dòng số thứ tự của SRT nếu có
    if (/^\d+$/.test(lines[0].trim()) && lines[1]?.includes('-->')) i = 1

    const timeLine = lines[i]
    if (!timeLine || !timeLine.includes('-->')) continue

    const [a, b] = timeLine.split('-->')
    const start = tsToSec(a)
    const end = tsToSec(b.trim().split(/\s+/)[0])
    const txt = clean(lines.slice(i + 1).join('\n'))
    if (txt) cues.push({ start, end, text: txt })
  }
  return cues
}

export function cueAt(cues, t) {
  if (!cues) return ''
  for (const c of cues) if (t >= c.start && t < c.end) return c.text
  return ''
}
