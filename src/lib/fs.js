// Quét FileList từ <input webkitdirectory> rồi dựng cây Khoá -> Chương -> Bài giảng.
// Cấu trúc kỳ vọng (do udemy_download.py tạo):
//   <Khoá học>/<NN - Chương>/<NN - Bài giảng>.mp4
//   phụ đề: <NN - Bài giảng>.<locale>.srt  (cùng thư mục, cùng tên gốc)

const VIDEO = /\.(mp4|m4v|webm|mkv|mov)$/i
const SUB = /\.(srt|vtt)$/i

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '')
}

// Bỏ tiền tố số thứ tự kiểu "01 - ", "02. ", "3) " cho đẹp khi hiển thị.
function prettify(name) {
  return name.replace(/^\s*\d+\s*[-.)]+\s*/, '').trim() || name
}

// So sánh tự nhiên để "2" đứng trước "10".
function nat(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function scanFiles(fileList) {
  const files = Array.from(fileList)
  const videos = files.filter((f) => VIDEO.test(f.name))
  const subs = files.filter((f) => SUB.test(f.name))

  // Gom phụ đề theo thư mục để match nhanh.
  const subsByDir = new Map()
  for (const s of subs) {
    const dir = s.webkitRelativePath.split('/').slice(0, -1).join('/')
    if (!subsByDir.has(dir)) subsByDir.set(dir, [])
    subsByDir.get(dir).push(s)
  }

  const courseMap = new Map() // courseRaw -> Map(chapterRaw -> lectures[])

  for (const v of videos) {
    const parts = v.webkitRelativePath.split('/')
    const fileName = parts[parts.length - 1]
    const chapterRaw = parts[parts.length - 2] || 'Chương 1'
    const courseRaw = parts[parts.length - 3] || 'Khoá học'
    const dir = parts.slice(0, -1).join('/')
    const base = stripExt(fileName)

    const candidates = subsByDir.get(dir) || []
    const lecSubs = []
    for (const s of candidates) {
      const sb = stripExt(s.name)
      if (sb === base) lecSubs.push({ label: 'Phụ đề', file: s })
      else if (sb.startsWith(base + '.'))
        lecSubs.push({ label: sb.slice(base.length + 1), file: s })
    }
    lecSubs.sort((a, b) => nat(a.label, b.label))

    if (!courseMap.has(courseRaw)) courseMap.set(courseRaw, new Map())
    const chMap = courseMap.get(courseRaw)
    if (!chMap.has(chapterRaw)) chMap.set(chapterRaw, [])
    chMap.get(chapterRaw).push({
      id: v.webkitRelativePath,
      title: prettify(stripExt(fileName)),
      raw: fileName,
      file: v,
      subs: lecSubs,
    })
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
