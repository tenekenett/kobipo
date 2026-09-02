// "Görsün ama değiştirmesin" iznin ARAYÜZ nöbetçisi — jest tarafı.
//
// `WriteAction` bir `<Button>` sarar; salt-okunur sayfada düğme çizilmez. Ama
// bazı ekranların yazma yolu düğme DEĞİL: krokide masayı sürüklemek, vardiya
// ızgarasında bar çizmek, masa satırına dokunup adisyon açmak. Oralarda karar
// koda girer (`useWriteGuard`) ya da ekran hiç kurulmaz (`WriteOnlyScreen`).
//
// Bu dosya o kararların yerinde durduğunu mekanik olarak korur. `page-api-coverage`
// ile aynı fikir: sunucu kapısı zaten reddediyor, buradaki değişmez ARAYÜZÜN
// kullanıcıya yalan söylememesi — şerit "değiştiremezsiniz" derken jestin sessizce
// çalışıyor görünmemesi.
//
// Dosya sistemini okur: jest yüzeyi elle tutulan bir listeye sığmaz, yeni bir
// sürüklenebilir ekran eklendiğinde burası kırılıp sınıflandırma ister.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { ACCOUNT_ADMIN_PAGES, ALWAYS_AVAILABLE_PAGES, NAV_PAGES } from "./nav/pages"

const ROOT = process.cwd()
const SCAN_DIRS = ["app/(dashboard)", "components"]

/** Jest yüzeyi: bir öğe imleçle taşınıyor/çiziliyorsa bu izler kalır. */
const GESTURE_RE = /onPointerDown|onDragStart|draggable=|onDrop=/
/** Kapının izleri — hangi biçimde kullanıldığı ekrana göre değişir. */
const GUARD_RE = /useWriteGuard|WriteAction|WriteOnlyScreen/

/**
 * Sürüklemeli her yüzey ve kapısının NEREDE olduğu.
 *
 * Değer = kapıyı taşıyan dosya. `null` ise o jest sunucuya hiçbir şey yazmaz
 * (yalnız yerel durum) — kapı gerekmez, sebebi yanında yazılıdır.
 */
const GESTURE_SURFACES: Record<string, string | null> = {
  // Masayı/krokiyi taşımak PATCH gönderir; kapı ekranda: düzenleme kipi
  // salt-okunurda hiç açılmaz, masa dokunuşu da orada süzülür.
  "components/restoran/floor-plan-canvas.tsx": "components/restoran/floor-plan-screen.tsx",
  // Bar çizmek/taşımak POST-PATCH gönderir; kapı sayfanın yazma fonksiyonlarında.
  "components/personel/vardiya-timeline.tsx": "app/(dashboard)/personel/vardiya/page.tsx",
  // Etiket tuvali YEREL: tasarım sunucuya ancak "Kaydet" ile gider, o düğme
  // `WriteAction` ile sarılı (label-designer-screen.tsx).
  "components/stok/label-designer/designer-canvas.tsx": null,
  "components/stok/label-designer/element-preview.tsx": null,
  // Görsel kırpma penceresi: sonuç, açan ekranın kendi kaydetme akışına gider.
  "components/stok/image-crop-dialog.tsx": null,
  // Fiş fotoğrafını sürükleyip bırakmak modele çağrı yapar, yani PARA HARCAR.
  // Kapı ekranın kendisinde: useWriteGuard hem sürüklemeyi hem seçmeyi süzer.
  "components/alis/fis-tarama-screen.tsx": "components/alis/fis-tarama-screen.tsx",
}

/**
 * Yazma yolu DOKUNUŞ olan ekranlar: satıra/kartona dokunmak kayıt açar. Regex
 * bunları ayırt edemez (her ekranda `onClick` var), o yüzden adıyla anılırlar.
 */
const TAP_WRITE_SCREENS = [
  "components/restoran/table-list-screen.tsx", // masa satırı → adisyon açar
  "components/restoran/floor-plan-screen.tsx", // masaya dokunmak → adisyon açar
]

/**
 * Yalnız yazmak için var olan tezgâh ekranları: salt-okunurda düğme gizlemek
 * kullanılamaz bir tezgâh bırakırdı, ekran hiç kurulmaz.
 */
const WRITE_ONLY_PAGES = [
  "app/(dashboard)/satis/hizli/page.tsx",
  "app/(dashboard)/alis/hizli/page.tsx",
  "app/(dashboard)/restoran/satis/page.tsx",
]


/**
 * Menü sayfası → ekranı GERÇEKTEN taşıyan dosya.
 *
 * İki menü öğesi tek ekranı paylaşabiliyor (`?tab=` ya da `ROUTE_OWNERS` ile);
 * o durumda kapı ortak dosyadadır ve sayfa klasöründe aramak yanlış sonuç verir.
 */
const SCREEN_OF_PAGE: Record<string, string> = {
  "/cari/musteri": "app/(dashboard)/cari/page.tsx",
  "/cari/tedarikci": "app/(dashboard)/cari/page.tsx",
  "/stok/urunler": "app/(dashboard)/stok/page.tsx",
  "/stok/hizmetler": "app/(dashboard)/stok/page.tsx",
  "/stok/transfer": "app/(dashboard)/depolar/transfer/page.tsx",
  "/finans/mutabakat": "app/(dashboard)/banka/mutabakat/page.tsx",
  "/satis/fatura": "components/faturalar/faturalar-listing.tsx",
  "/alis/fatura": "components/faturalar/faturalar-listing.tsx",
}

/**
 * Kapı ARANMAYAN sayfalar ve gerekçeleri.
 *
 * - Hesap yönetimi (`ACCOUNT_ADMIN_PAGES`): özel role zaten verilemez, kısıtlı
 *   üyelik oraya hiç giremez; salt-okunur hâli yoktur.
 * - Kişisel sayfalar (`ALWAYS_AVAILABLE_PAGES`): herkes kendi profilini/destek
 *   kaydını düzenler, sayfa izniyle ilgisi yok.
 * - `/ayarlar/sube-bilgileri` okuma ekranıdır; tek düğmesi `/ayarlar/firma`ya
 *   GİDER, orada kendi kapısı var.
 */
const GUARD_NOT_REQUIRED = [
  ...ACCOUNT_ADMIN_PAGES,
  ...ALWAYS_AVAILABLE_PAGES,
  "/ayarlar/sube-bilgileri",
]

/** Sayfanın kaynağı + bir seviye içe aktardığı yerel bileşenler. */
function screenSource(rel: string): string | null {
  const abs = path.resolve(ROOT, rel)
  if (!fs.existsSync(abs)) return null
  let src = fs.readFileSync(abs, "utf8")
  for (const m of src.matchAll(/from "@\/(components\/[^"]+)"/g)) {
    const f = path.resolve(ROOT, m[1] + ".tsx")
    if (fs.existsSync(f)) src += fs.readFileSync(f, "utf8")
  }
  return src
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith(".tsx")) out.push(full)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => walk(path.resolve(ROOT, d))).map((f) =>
  path.relative(ROOT, f).split(path.sep).join("/"),
)

const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), "utf8")

describe("arayüz yazma kapısı", () => {
  it("sürüklenebilir her yüzey sınıflandırılmıştır", () => {
    const found = files.filter((f) => GESTURE_RE.test(read(f)))
    const unclassified = found.filter((f) => !(f in GESTURE_SURFACES))
    expect(
      unclassified,
      `Şu ekranlar jestle çalışıyor ama kapısı bilinmiyor. Sunucuya yazıyorsa ` +
        `kapıyı ekle (useWriteGuard), yazmıyorsa GESTURE_SURFACES'a sebebiyle koy:\n` +
        unclassified.join("\n"),
    ).toEqual([])
  })

  it("jest kapıları yerinde durur", () => {
    const missing = Object.entries(GESTURE_SURFACES)
      .filter(([, owner]) => owner !== null)
      .filter(([, owner]) => !GUARD_RE.test(read(owner!)))
      .map(([surface, owner]) => `${surface} → ${owner}`)
    expect(missing, `Kapıyı taşıması gereken dosyada kapı yok:\n${missing.join("\n")}`).toEqual([])
  })

  it("dokunuşla yazan ekranlarda kapı vardır", () => {
    const missing = TAP_WRITE_SCREENS.filter((f) => !GUARD_RE.test(read(f)))
    expect(missing, `Dokunuş kapısı düşmüş:\n${missing.join("\n")}`).toEqual([])
  })


  // Bu, elle yapılan "hangi sayfa sarılmadı" taramasının kalıcı hâli. 19-20 Ağustos'ta
  // iki ayrı geçişte 24 sayfa sarıldı ama 10 sayfa gözden kaçtı; kaçtığı ancak üçüncü
  // bir elle ölçümde görüldü. Ölçüm artık burada duruyor.
  it("yazan her menü sayfasında kapı vardır", () => {
    const missing: string[] = []
    for (const page of NAV_PAGES) {
      if (GUARD_NOT_REQUIRED.includes(page.href)) continue
      const rel = SCREEN_OF_PAGE[page.href] ?? `app/(dashboard)${page.href}/page.tsx`
      const src = screenSource(rel)
      if (src === null) {
        missing.push(`${page.href} → ${rel} YOK (ekranı SCREEN_OF_PAGE'e yazın)`)
        continue
      }
      const writes = /method: ?"(POST|PUT|PATCH|DELETE)"/.test(src)
      if (writes && !GUARD_RE.test(src)) missing.push(`${page.href} → ${rel}`)
    }
    expect(
      missing,
      `Şu sayfalar yazma yapıyor ama salt-okunur yetkide düğmeleri gizlemiyor:\n${missing.join("\n")}`,
    ).toEqual([])
  })


  it("tezgâh ekranları salt-okunurda hiç kurulmaz", () => {
    const missing = WRITE_ONLY_PAGES.filter((f) => !/WriteOnlyScreen/.test(read(f)))
    expect(missing, `WriteOnlyScreen sarması düşmüş:\n${missing.join("\n")}`).toEqual([])
  })
})
