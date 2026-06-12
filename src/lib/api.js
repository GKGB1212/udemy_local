// Gọi companion server (FastAPI). Cùng origin khi mở qua http://localhost:8000,
// hoặc qua proxy Vite khi dev (5173). Trên GitHub Pages sẽ không có server -> health lỗi.

const BASE = '/api'

async function call(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Lỗi ${res.status}`)
  return data
}

export const api = {
  async health() {
    const res = await fetch(BASE + '/health')
    if (!res.ok) throw new Error('server down')
    return res.json()
  },
  courses: (creds) => call('/courses', creds),
  curriculum: (req) => call('/curriculum', req),
  startDownload: (req) => call('/download', req),
  async task(id) {
    const res = await fetch(BASE + '/tasks/' + id)
    if (!res.ok) throw new Error('task not found')
    return res.json()
  },
}
