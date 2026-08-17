import zlib from "node:zlib"

/**
 * Üretilmiş bir PDF'ten metin parçalarını (konum + genişlik + metin) çıkarır.
 *
 * Amaç: "kayma" hatalarını göz kontrolü yerine TESTLE yakalamak. Genişlik,
 * görüntüleyicinin kullandığı kaynaktan hesaplanır — gömülü fontun `/W` glif
 * genişlik tablosu — yani tahmin değil, belgenin kendi metriği. Böylece bir
 * metnin sayfa/kutu sınırını aşıp aşmadığı kesin olarak ölçülebilir.
 *
 * Kapsam bilinçli olarak dar: react-pdf ve jsPDF'in ürettiği düz metin
 * operatörleri (Tf, Tm, Td, TD, T-yıldız, TL, Tj, TJ) ve Identity-H CID
 * fontları. Döndürülen koordinatlar PDF birimi olan pt cinsindendir
 * (A4 = 595.28 × 841.89).
 *
 * ÖLÇÜM SINIRI — bilinçli: `x` ve `width` güvenilir (grafik matrisinin yatay
 * bileşeni izlenir), `y` ise YALNIZ normal akıştaki bloklar için güvenilir.
 * react-pdf `position:absolute` ve kenarlıklı blokları iç içe `q/Q` + ters
 * çevirme matrisleriyle konumlandırıyor; bu durumda dikey değer sapıyor
 * (ör. sayfa altlığı 842pt'lik sayfada 5147pt olarak ölçülüyor). Bu yüzden
 * testler YATAY eksende assert eder — "kayma" pratikte yatay taşmadır.
 * Dikey doğrulama gerekirse @react-pdf/layout'un kutu ağacı kullanılmalı.
 */

export type TextRun = {
  /** 0'dan başlayan sayfa sırası — çakışma kontrolü sayfaları karıştırmasın. */
  page: number
  /**
   * Metin döndürülmüş mü (filigran/damga)? Yatay taşma matematiği bunlara
   * uygulanmaz: çapraz "TASLAK" filigranı tasarım gereği sayfayı kaplar ve
   * içeriğin ARKASINDA durur.
   */
  rotated: boolean
  /** Sol kenar (pt). */
  x: number
  /** Taban çizgisi, sayfa altından (pt). */
  y: number
  /** Metnin çizim genişliği (pt). */
  width: number
  fontSize: number
  text: string
}

type FontInfo = { toUnicode: Map<number, string>; widths: Map<number, number>; dw: number }

/** 2B afin matris: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
/** PDF sırası: `m` SONRA `n` uygulanır (cm/Tm birleştirmesi böyle çalışır). */
function mul(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    e: m.e * n.a + m.f * n.c + n.e,
    f: m.e * n.b + m.f * n.d + n.f,
  }
}

const PT_PER_MM = 72 / 25.4
export const ptToMm = (v: number) => v / PT_PER_MM
export const mmToPt = (v: number) => v * PT_PER_MM

function parseObjects(raw: string): Map<string, string> {
  const objs = new Map<string, string>()
  const re = /(\d+) 0 obj([\s\S]*?)endobj/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) objs.set(m[1], m[2])
  return objs
}

function streamOf(body: string): string | null {
  const i = body.indexOf("stream")
  if (i === -1) return null
  let s = i + 6
  if (body.charCodeAt(s) === 13) s++
  if (body.charCodeAt(s) === 10) s++
  const e = body.indexOf("endstream", s)
  const data = Buffer.from(body.slice(s, e), "latin1")
  try {
    return zlib.inflateSync(data).toString("latin1")
  } catch {
    return data.toString("latin1")
  }
}

function parseCMap(txt: string): Map<number, string> {
  const map = new Map<number, string>()
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g
  let m: RegExpExecArray | null
  while ((m = bfchar.exec(txt))) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    let p: RegExpExecArray | null
    while ((p = pairRe.exec(m[1]))) {
      map.set(parseInt(p[1], 16), String.fromCharCode(parseInt(p[2].slice(0, 4), 16)))
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g
  while ((m = bfrange.exec(txt))) {
    // İKİ biçim var ve react-pdf DİZİ biçimini kullanıyor:
    //   <lo> <hi> <dst>                → art arda eşleme
    //   <lo> <hi> [<d0> <d1> …]        → her CID'e ayrı hedef
    // Yalnız üçlü biçim desteklenince dizi biçiminde ilk hedef `dst` sanılıp
    // tüm harfler kayıyordu ("Reypo" → "fghij").
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g
    let t: RegExpExecArray | null
    while ((t = entryRe.exec(m[1]))) {
      const lo = parseInt(t[1], 16)
      const hi = parseInt(t[2], 16)
      if (t[3].startsWith("[")) {
        const dsts = t[3].match(/<([0-9a-fA-F]+)>/g) || []
        dsts.forEach((d, i) => {
          const hex = d.slice(1, -1)
          const code = parseInt(hex.slice(0, 4), 16)
          if (lo + i <= hi) map.set(lo + i, String.fromCharCode(code))
        })
      } else {
        const dst = parseInt(t[3].slice(1, -1).slice(0, 4), 16)
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(dst + (c - lo)))
      }
    }
  }
  return map
}

/** `/W [ 3 [317] 20 [636 636] ]` → cid→genişlik (1000 birim em). */
function parseW(body: string): Map<number, number> {
  const widths = new Map<number, number>()
  const wStart = body.indexOf("/W")
  if (wStart === -1) return widths
  const open = body.indexOf("[", wStart)
  if (open === -1) return widths
  let depth = 0
  let end = open
  for (let i = open; i < body.length; i++) {
    if (body[i] === "[") depth++
    else if (body[i] === "]") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const inner = body.slice(open + 1, end)
  const entryRe = /(\d+)\s*\[([\d\s.]+)\]/g
  let e: RegExpExecArray | null
  while ((e = entryRe.exec(inner))) {
    const start = parseInt(e[1], 10)
    e[2]
      .trim()
      .split(/\s+/)
      .forEach((v, i) => widths.set(start + i, parseFloat(v)))
  }
  // `cidFirst cidLast width` biçimi.
  const rangeRe = /(\d+)\s+(\d+)\s+([\d.]+)(?=\s|$)/g
  let r: RegExpExecArray | null
  while ((r = rangeRe.exec(inner))) {
    const lo = parseInt(r[1], 10)
    const hi = parseInt(r[2], 10)
    const w = parseFloat(r[3])
    if (hi - lo > 65535) continue
    for (let c = lo; c <= hi; c++) if (!widths.has(c)) widths.set(c, w)
  }
  return widths
}

function buildFonts(objs: Map<string, string>): Map<string, FontInfo> {
  const byObj = new Map<string, FontInfo>()
  for (const [num, body] of objs) {
    if (!/\/Type\s*\/Font/.test(body) || !/\/Subtype\s*\/Type0/.test(body)) continue
    const tu = body.match(/\/ToUnicode\s+(\d+) 0 R/)
    const desc = body.match(/\/DescendantFonts\s*\[?\s*(\d+) 0 R/)
    const toUnicode = tu ? parseCMap(streamOf(objs.get(tu[1]) || "") || "") : new Map<number, string>()
    let widths = new Map<number, number>()
    let dw = 1000
    if (desc) {
      const d = objs.get(desc[1]) || ""
      widths = parseW(d)
      const dwm = d.match(/\/DW\s+([\d.]+)/)
      if (dwm) dw = parseFloat(dwm[1])
    }
    byObj.set(num, { toUnicode, widths, dw })
  }
  return byObj
}

/** `<< … >>` sözlüğünü konumdan başlayarak dengeli biçimde çıkarır. */
function dictAt(body: string, from: number): string | null {
  const open = body.indexOf("<<", from)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < body.length - 1; i++) {
    if (body[i] === "<" && body[i + 1] === "<") {
      depth++
      i++
    } else if (body[i] === ">" && body[i + 1] === ">") {
      depth--
      i++
      if (depth === 0) return body.slice(open, i + 1)
    }
  }
  return null
}

/** `/Key` değerini döner: satır içi sözlük ya da `n 0 R` referansının gövdesi. */
function resolveEntry(objs: Map<string, string>, dict: string, key: string): string | null {
  const at = dict.indexOf(`/${key}`)
  if (at === -1) return null
  const ref = dict.slice(at).match(new RegExp(`^\\/${key}\\s+(\\d+) 0 R`))
  if (ref) return objs.get(ref[1]) ?? null
  return dictAt(dict, at)
}

/**
 * Sayfaları gezip her sayfanın içerik akışını ve KENDİ font kaynak eşlemesini
 * (`/Resources /Font << /F1 5 0 R >>`) çıkarır.
 *
 * Önce eşleme tüm dosyadan regex ile toplanıyordu; birden fazla font olduğunda
 * `/F1` yanlış nesneye bağlanıp metin başka bir fontun CMap'iyle çözülüyor,
 * çıktı anlamsız harflere dönüşüyordu (ve genişlikler de yanlış oluyordu).
 */
function pagesOf(objs: Map<string, string>, fonts: Map<string, FontInfo>) {
  const pages: Array<{ content: string; resources: Map<string, FontInfo> }> = []
  for (const body of objs.values()) {
    if (!/\/Type\s*\/Page[^s]/.test(body)) continue

    const resDict = resolveEntry(objs, body, "Resources") || ""
    const fontDict = resDict ? resolveEntry(objs, resDict, "Font") || "" : ""
    const resources = new Map<string, FontInfo>()
    const pairRe = /\/([A-Za-z0-9+._-]+)\s+(\d+) 0 R/g
    let p: RegExpExecArray | null
    while ((p = pairRe.exec(fontDict))) {
      const f = fonts.get(p[2])
      if (f) resources.set(p[1], f)
    }

    const contentRefs: string[] = []
    const single = body.match(/\/Contents\s+(\d+) 0 R/)
    if (single) contentRefs.push(single[1])
    const arr = body.match(/\/Contents\s*\[([^\]]*)\]/)
    if (arr) for (const r of arr[1].match(/(\d+) 0 R/g) || []) contentRefs.push(r.split(" ")[0])

    for (const ref of contentRefs) {
      const stream = streamOf(objs.get(ref) || "")
      if (stream) pages.push({ content: stream, resources })
    }
  }
  return pages
}

/**
 * İçerik akışını DOĞRUSAL tarar (regex yok).
 *
 * Tek bir büyük regex ile denenmişti; gömülü font akışları (MB'larca ikili veri)
 * alternatifli `+` grubunda katastrofik backtracking'e yol açıp testi sonsuza
 * kilitliyordu. Elle tokenizer hem doğrusal hem de PDF dilbilgisine daha yakın.
 */
type Token = { t: "num"; v: number } | { t: "name"; v: string } | { t: "hex"; v: string } | { t: "op"; v: string } | { t: "arr-open" } | { t: "arr-close" }

function* tokenize(s: string): Generator<Token> {
  let i = 0
  const isWs = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0"
  while (i < s.length) {
    const c = s[i]
    if (isWs(c)) {
      i++
    } else if (c === "<") {
      const end = s.indexOf(">", i)
      if (end === -1) break
      yield { t: "hex", v: s.slice(i + 1, end) }
      i = end + 1
    } else if (c === "(") {
      // Değişmez dize: react-pdf/jsPDF Identity-H'de kullanmıyor, atlanır.
      let depth = 1
      i++
      while (i < s.length && depth > 0) {
        if (s[i] === "\\") i++
        else if (s[i] === "(") depth++
        else if (s[i] === ")") depth--
        i++
      }
      yield { t: "hex", v: "" }
    } else if (c === "[") {
      yield { t: "arr-open" }
      i++
    } else if (c === "]") {
      yield { t: "arr-close" }
      i++
    } else if (c === "/") {
      let j = i + 1
      while (j < s.length && /[A-Za-z0-9+.\-_]/.test(s[j])) j++
      yield { t: "name", v: s.slice(i + 1, j) }
      i = j
    } else if (/[-+.\d]/.test(c)) {
      let j = i
      while (j < s.length && /[-+.\d]/.test(s[j])) j++
      const v = parseFloat(s.slice(i, j))
      yield { t: "num", v: Number.isFinite(v) ? v : 0 }
      i = j
    } else if (/[A-Za-z'"*]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9'"*]/.test(s[j])) j++
      yield { t: "op", v: s.slice(i, j) }
      i = j
    } else {
      i++
    }
  }
}

export function extractTextRuns(pdf: Buffer): TextRun[] {
  const raw = pdf.toString("latin1")
  const objs = parseObjects(raw)
  const fonts = buildFonts(objs)

  const runs: TextRun[] = []
  let pageIndex = -1
  for (const { content, resources } of pagesOf(objs, fonts)) {
    pageIndex++
    let font: FontInfo | undefined
    let size = 0
    // Metin matrisi (Tm) ve satır başı; react-pdf bunları sabit tutar.
    let tm: Matrix = IDENTITY
    let lineTm: Matrix = IDENTITY
    let leading = 0
    // Grafik durumu: react-pdf her metin bloğunu `cm` ile konumlandırıp `q/Q` ile
    // yığına alır — konum BURADAN gelir, Tm'den değil.
    let ctm: Matrix = IDENTITY
    const stack: Matrix[] = []
    let operands: Array<number | string> = []
    let arrayItems: Array<number | string> | null = null
    let lastArray: Array<number | string> | null = null

    const showText = (items: Array<number | string>) => {
      // Glif glif ilerlenir: metin + her glifin ilerleme genişliği.
      const glyphs: Array<{ ch: string; w: number }> = []
      for (const it of items) {
        if (typeof it === "number") {
          // TJ kerning: 1000'lik em cinsinden kaydırma.
          glyphs.push({ ch: "", w: -(it / 1000) * size })
          continue
        }
        for (let i = 0; i + 4 <= it.length; i += 4) {
          const cid = parseInt(it.slice(i, i + 4), 16)
          if (!Number.isFinite(cid)) continue
          glyphs.push({
            ch: font?.toUnicode.get(cid) ?? "",
            w: ((font?.widths.get(cid) ?? font?.dw ?? 1000) / 1000) * size,
          })
        }
      }
      const advance = glyphs.reduce((s, g) => s + g.w, 0)
      // SONDAKİ boşluklar mürekkep basmaz: satır sonundaki boşluk kutuyu aşmış
      // gibi görünüp yanlış taşma alarmı üretiyordu. Ölçüm mürekkeple biter.
      let ink = advance
      for (let i = glyphs.length - 1; i >= 0; i--) {
        if (glyphs[i].ch === "" || /\s/.test(glyphs[i].ch)) ink -= glyphs[i].w
        else break
      }
      const text = glyphs.map((g) => g.ch).join("")
      const m = mul(tm, ctm)
      const scale = Math.hypot(m.a, m.b) || 1
      const rotated = Math.abs(m.b) > 0.01 || Math.abs(m.c) > 0.01
      // size === 0 → o blokta Tf görülmemiş demektir; ölçülemeyen parçayı alma
      // (bozuk/kısmi akışlardan gelen artık parçalar buradan eleniyor).
      if (text.trim() && size > 0) {
        runs.push({ page: pageIndex, rotated, x: m.e, y: m.f, width: ink * scale, fontSize: size, text })
      }
      // Metin göstermek imleci sağa kaydırır (aynı BT içinde ikinci Tj için).
      tm = mul({ a: 1, b: 0, c: 0, d: 1, e: advance, f: 0 }, tm)
    }

    for (const tk of tokenize(content)) {
      if (tk.t === "arr-open") {
        arrayItems = []
        continue
      }
      if (tk.t === "arr-close") {
        // Dizi KAPANIR, içerik bir sonraki TJ için saklanır. Kapanışta
        // sıfırlanmazsa PDFKit'in sık yazdığı `[] 0 d` (boş çizgi deseni) diziyi
        // açık bırakıyor; ardından gelen Tm/Tf sayıları operand yerine diziye
        // düşüyor ve o bloğun ilk metni konumsuz/fontsuz kalıyordu.
        lastArray = arrayItems
        arrayItems = null
        continue
      }
      if (tk.t === "num") {
        if (arrayItems) arrayItems.push(tk.v)
        else operands.push(tk.v)
        continue
      }
      if (tk.t === "hex") {
        if (arrayItems) arrayItems.push(tk.v)
        else operands.push(tk.v)
        continue
      }
      if (tk.t === "name") {
        operands.push(`/${tk.v}`)
        continue
      }
      // Operatör
      const nums = operands.filter((o): o is number => typeof o === "number")
      switch (tk.v) {
        case "q":
          stack.push(ctm)
          break
        case "Q":
          ctm = stack.pop() ?? IDENTITY
          break
        case "cm":
          if (nums.length >= 6) {
            const [a, b, c, d, e, f] = nums.slice(-6)
            ctm = mul({ a, b, c, d, e, f }, ctm)
          }
          break
        case "BT":
          tm = IDENTITY
          lineTm = IDENTITY
          break
        case "Tf": {
          const name = operands.find((o) => typeof o === "string" && o.startsWith("/")) as string | undefined
          if (name) font = resources.get(name.slice(1)) || font
          if (nums.length) size = nums[nums.length - 1]
          break
        }
        case "TL":
          if (nums.length) leading = nums[nums.length - 1]
          break
        case "Td":
        case "TD":
          if (nums.length >= 2) {
            const tx = nums[nums.length - 2]
            const ty = nums[nums.length - 1]
            if (tk.v === "TD") leading = -ty
            lineTm = mul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, lineTm)
            tm = lineTm
          }
          break
        case "Tm":
          if (nums.length >= 6) {
            const [a, b, c, d, e, f] = nums.slice(-6)
            lineTm = { a, b, c, d, e, f }
            tm = lineTm
          }
          break
        case "T*":
          lineTm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, lineTm)
          tm = lineTm
          break
        case "Tj":
        case "'": {
          if (tk.v === "'") {
            lineTm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, lineTm)
            tm = lineTm
          }
          const str = [...operands].reverse().find((o) => typeof o === "string" && !o.startsWith("/"))
          if (typeof str === "string") showText([str])
          break
        }
        case "TJ":
          if (lastArray) showText(lastArray)
          break
        default:
          break
      }
      if (tk.v === "TJ") lastArray = null
      operands = []
    }
  }
  return runs
}

/** Sağ/sol kenarı aşan parçalar (pt cinsinden sınırlarla). */
export function findOverflows(
  runs: TextRun[],
  opts: { pageWidth?: number; marginLeft: number; marginRight: number; tolerance?: number },
) {
  const pageWidth = opts.pageWidth ?? 595.28
  const tol = opts.tolerance ?? 1
  const right = pageWidth - opts.marginRight
  return runs.filter((r) => r.x < opts.marginLeft - tol || r.x + r.width > right + tol)
}
