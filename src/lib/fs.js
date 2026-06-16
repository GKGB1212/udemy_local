// Quét FileList từ <input webkitdirectory> rồi dựng cây Khoá -> Chương -> Bài giảng.
// Cấu trúc kỳ vọng (do udemy_download.py / companion server tạo):
//   <Khoá học>/<NN - Chương>/<NN - Bài giảng>.mp4          (video)
//   <Khoá học>/<NN - Chương>/<NN - Bài giảng>.html         (bài viết / Article)
//   <Khoá học>/<NN - Chương>/<NN - Bài giảng>.mp3|pdf|...  (asset không phải video)
//   phụ đề:    <NN - Bài giảng>.<locale>.srt               (cùng thư mục, cùng tên gốc)
//   tài liệu:  <NN.k - tên file>                            (resource đính kèm của bài NN)

const VIDEO = /\.(mp4|m4v|webm|mkv|mov)$/i
const AUDIO = /\.(mp3|m4a|wav|aac|ogg|flac)$/i
const ARTICLE = /\.html?$/i
const SUB = /\.(srt|vtt)$/i
// Tài liệu đính kèm: tên bắt đầu bằng "NN.k -" (vd "01.2 - slides.pdf").
const RESOURCE = /^\s*\d+\.\d+\s*[-.)]/

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '')
}

// Số thứ tự bài ở đầu tên file ("01 - ...", "01.2 - ..." -> 1).
function leadingIndex(name) {
  const m = name.match(/^\s*(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

// Bỏ tiền tố số thứ tự kiểu "01 - ", "02. ", "3) " cho đẹp khi hiển thị.
function prettify(name) {
  return name.replace(/^\s*\d+\s*[-.)]+\s*/, '').trim() || name
}

// Bỏ tiền tố tài liệu "NN.k - " cho đẹp.
function prettifyRes(name) {
  return name.replace(/^\s*\d+\.\d+\s*[-.)]+\s*/, '').trim() || name
}

// Loại bài giảng dựa trên đuôi file.
function lectureType(fileName) {
  if (VIDEO.test(fileName)) return 'video'
  if (ARTICLE.test(fileName)) return 'article'
  if (AUDIO.test(fileName)) return 'audio'
  return 'file'
}

// So sánh tự nhiên để "2" đứng trước "10".
function nat(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function scanFiles(fileList) {
  const files = Array.from(fileList)

  // Gom mọi file theo thư mục (chương). Mỗi thư mục xử lý độc lập.
  const byDir = new Map() // dir -> { files: [], parts }
  for (const f of files) {
    const parts = f.webkitRelativePath.split('/')
    const dir = parts.slice(0, -1).join('/')
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(f)
  }

  const courseMap = new Map() // courseRaw -> Map(chapterRaw -> lectures[])

  for (const [dir, dirFiles] of byDir) {
    const parts = dir.split('/')
    const chapterRaw = parts[parts.length - 1] || 'Chương 1'
    const courseRaw = parts[parts.length - 2] || 'Khoá học'

    const subs = dirFiles.filter((f) => SUB.test(f.name))
    const resources = dirFiles.filter(
      (f) => RESOURCE.test(f.name) && !SUB.test(f.name),
    )
    const mains = dirFiles.filter(
      (f) => !SUB.test(f.name) && !RESOURCE.test(f.name),
    )

    // index bài -> đối tượng lecture, để gắn tài liệu đính kèm theo số thứ tự.
    const byIndex = new Map()
    const lectures = []

    for (const f of mains) {
      const base = stripExt(f.name)
      const idx = leadingIndex(f.name)

      // Phụ đề khớp theo tên gốc: "<base>.srt" hoặc "<base>.<locale>.srt".
      const lecSubs = []
      for (const s of subs) {
        const sb = stripExt(s.name)
        if (sb === base) lecSubs.push({ label: 'Phụ đề', file: s })
        else if (sb.startsWith(base + '.'))
          lecSubs.push({ label: sb.slice(base.length + 1), file: s })
      }
      lecSubs.sort((a, b) => nat(a.label, b.label))

      const lec = {
        id: f.webkitRelativePath,
        title: prettify(base),
        raw: f.name,
        type: lectureType(f.name),
        file: f,
        subs: lecSubs,
        resources: [],
      }
      lectures.push(lec)
      if (idx != null && !byIndex.has(idx)) byIndex.set(idx, lec)
    }

    // Gắn tài liệu đính kèm vào bài cùng số thứ tự; nếu không có bài tương ứng
    // (vd chỉ tải mỗi tài liệu) -> tạo một mục "Tài liệu" riêng cho số đó.
    for (const r of resources) {
      const idx = leadingIndex(r.name)
      let lec = idx != null ? byIndex.get(idx) : null
      if (!lec) {
        lec = {
          id: `${dir}/__res_${idx ?? r.name}`,
          title: 'Tài liệu',
          raw: idx != null ? String(idx).padStart(3, '0') : r.name,
          type: 'resources',
          file: null,
          subs: [],
          resources: [],
        }
        lectures.push(lec)
        if (idx != null) byIndex.set(idx, lec)
      }
      lec.resources.push({ name: prettifyRes(r.name), file: r })
    }

    if (!lectures.length) continue
    for (const lec of lectures) lec.resources.sort((a, b) => nat(a.name, b.name))

    if (!courseMap.has(courseRaw)) courseMap.set(courseRaw, new Map())
    const chMap = courseMap.get(courseRaw)
    if (!chMap.has(chapterRaw)) chMap.set(chapterRaw, [])
    chMap.get(chapterRaw).push(...lectures)
  }

  const courses = []
  for (const [courseRaw, chMap] of courseMap) {
    const chapters = []
    for (const [chapterRaw, lectures] of chMap) {
      lectures.sort((a, b) => nat(a.raw, b.raw))
      chapters.push({ name: prettify(chapterRaw), raw: chapterRaw, lectures })
    }
    chapters.sort((a, b) => nat(a.raw, b.raw))
    courses.push({ name: prettify(courseRaw), raw: courseRaw, chapters })
  }
  courses.sort((a, b) => nat(a.raw, b.raw))
  return courses
}
