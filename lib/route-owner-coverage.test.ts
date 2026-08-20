// Panel sayfalarının SAHİPLİK nöbetçisi.
//
// Sayfa kapısı (`canAccessRoute`) bir yolu ancak `navHrefsForPath` ona bir menü sahibi
// bulabilirse denetler; sahibi olmayan yol HERKESE açıktır. Bu bilinçli bir varsayılan
// (yanlış eşleme çalışan bir ekranı kırar) ama SESSİZ bir varsayılandı: panele eklenen
// yeni bir sayfa kimseye sormadan bu boşluğa düşüyordu.
//
// Buradaki değişmez şudur: her panel sayfası ya bir sahibe çözülür ya da aşağıda
// GEREKÇESİYLE anılır. Yeni sayfa ekleyen, iki şıktan birini seçmek zorunda kalır.
//
// Not: sahipsiz olmak "veri açık" demek DEĞİL — aşağıdaki her satırda verinin nasıl
// korunduğu yazılı. Ekran kabuğu çizilir, veri ucu reddeder.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { navHrefsForPath } from "./page-access"

const ROOT = process.cwd()
const DASHBOARD = path.resolve(ROOT, "app/(dashboard)")

/** Sahibi olmayan panel yolları ve NEDEN öyle oldukları. */
const UNOWNED_ROUTES: Record<string, string> = {
  "/ayarlar/audit":
    "Sistem günlüğü ekranı; verisi `/api/system-admin/logs` ve o uç süper admin ister.",
  "/companies/new":
    "Firma kurma akışı — menüye bağlanamaz, ilk firmasını açan kullanıcının henüz üyeliği yoktur. Denetim `lib/company/create-company.ts` içinde (erişim + rol + kota).",
  "/companies/onboarding": "Kurulum sihirbazı; aynı gerekçe (bkz. /companies/new).",
  "/companies/onboarding/complete": "Kurulum sihirbazının son adımı.",
  "/e-donusum":
    "e-Fatura listesi. `/e-donusum` ön ekini sahiplendirmek `/e-donusum/seri-no` ve `/e-donusum/sablon` menü sayfalarını da yutardı (ön ek eşleşmesi). Verisi `/api/e-donusum/invoices` kuralına tabi.",
  "/e-donusum/[id]": "e-Fatura detayı; aynı ön ek çakışması, aynı uç kuralı.",
  "/e-donusum/[id]/duzenle": "e-Fatura düzenleme; aynı ön ek çakışması, aynı uç kuralı.",
  "/raporlar":
    "Rapor dizini. `/raporlar` ön eki tüm rapor MENÜ sayfalarını yutardı; sayfa yalnız link listeler, veri çekmez.",
  "/raporlar/finansal": "Mali tablo link listesi — veri çekmez, tıklanan ekranın kendi kapısı var.",
  "/raporlar/musteri": "Tek satırlık yönlendirme (redirect); hedefin kapısı geçerli.",
  "/raporlar/satis-alis": "Satış/alış rapor link listesi — veri çekmez.",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === "page.tsx") out.push(full)
  }
  return out
}

/** Dosya yolundan route: grup klasörleri `(x)` düşer, dinamik segment örneklenir. */
function routeOf(file: string): string {
  const rel = path.relative(DASHBOARD, path.dirname(file))
  const segments = rel
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
  return "/" + segments.join("/")
}

const routes = walk(DASHBOARD).map(routeOf)

describe("panel sayfalarının sahibi", () => {
  it("her sayfa ya sahibine çözülür ya listede gerekçesiyle anılır", () => {
    const unclassified: string[] = []
    for (const route of routes) {
      if (route === "/") continue
      const sample = route.replace(/\[[^\]]+\]/g, "ornek")
      if (navHrefsForPath(sample, null).length > 0) continue
      if (route in UNOWNED_ROUTES) continue
      unclassified.push(route)
    }
    expect(
      unclassified,
      "Şu sayfaların kapısı YOK: menüde karşılıkları varsa NAV_PAGES'e, alt yolsalar " +
        `ROUTE_OWNERS'a bağlayın; gerçekten bağlanamıyorsa UNOWNED_ROUTES'a gerekçesiyle yazın:\n${unclassified.join("\n")}`,
    ).toEqual([])
  })

  it("listedeki gerekçeler bayatlamaz — sayfa silinince satır da silinir", () => {
    const stale = Object.keys(UNOWNED_ROUTES).filter((r) => !routes.includes(r))
    expect(stale, `UNOWNED_ROUTES'ta artık var olmayan sayfa:\n${stale.join("\n")}`).toEqual([])
  })

  it("sahiplenen yollar gerçekten sahiplenilmiş durur", () => {
    // Regresyon: bu üçü 2026-08-20'de sahipsizlikten çıkarıldı.
    expect(navHrefsForPath("/muhasebe/yevmiye", null)).toEqual(["/muhasebe/yevmiye"])
    expect(navHrefsForPath("/raporlar/bilanco", null)).toEqual([
      "/raporlar/nakit-banka",
      "/raporlar/vergi",
    ])
    expect(navHrefsForPath("/raporlar/kar-zarar", null)).toEqual([
      "/raporlar/nakit-banka",
      "/raporlar/vergi",
    ])
  })
})
