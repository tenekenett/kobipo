/**
 * Kısıtlı çalışan izinlerinin (sayfa kapısı) testleri.
 *
 * İki yönlü risk var ve testler ikisini de hedefliyor:
 *  - FAZLA GENİŞ kural → kısıt sessizce delinir, ekranda hiçbir şey değişmez.
 *  - FAZLA DAR kural → izinli çalışanın ekranı çalışmaz hâle gelir (uç 403 döner).
 *
 * Bu yüzden mutlu yolun yanında "kısıtsız kullanıcı hiç etkilenmiyor mu" ve
 * "kasiyer kendi ekranını gerçekten kullanabiliyor mu" da doğrulanıyor.
 */

import { describe, expect, it } from "vitest"
import {
  ACCOUNT_ADMIN_PAGES,
  ALWAYS_AVAILABLE_PAGES,
  E_DONUSUM_PAGES,
  NAV_PAGES,
  assignablePages,
  filterAvailablePages,
  isPageAvailable,
  missingModuleLabels,
  moduleKeyForPath,
  pagesForRole,
} from "./nav/pages"
import { ROLE_TEMPLATES } from "./nav/role-templates"
import {
  ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED,
  PAGE_API_RULES,
  PageForbiddenError,
  canAccessRoute,
  canEditPage,
  canViewPage,
  editablePages,
  isApiPathAllowedForUser,
  isReadOnlyMembership,
  isReadOnlyRole,
  isRestrictedMembership,
  landingPathFor,
  navHrefsForPath,
  pageForbiddenFrom,
  pageRuleForApiPath,
  requiredPagesForApiPath,
  sanitizePagePermissions,
  visiblePages,
  type PagePermissions,
} from "./page-access"
import { ModuleLockedError, moduleLockedFrom } from "./module-access"

/** Kısıtsız üyelik — bugünkü tüm kullanıcıların hâli. */
const unrestricted = (role: string): PagePermissions => ({
  role,
  allowedPaths: [],
  writablePaths: [],
})

/** Kısıtlı üyelik. writable verilmezse tüm izinli sayfalar salt-okunur olur. */
const restricted = (role: string, allowed: string[], writable: string[] = []): PagePermissions => ({
  role,
  allowedPaths: allowed,
  writablePaths: writable,
})

describe("kısıtsız üyelik — davranış değişmez", () => {
  // Bu blok özelliğin en önemli güvencesi: mevcut müşterilerin hiçbiri kısıt taşımıyor
  // ve kapı açıldığında hiçbirinin ekranı değişmemeli.
  it("boş allowedPaths kısıt yok demektir", () => {
    expect(isRestrictedMembership(unrestricted("SALES"))).toBe(false)
    expect(isRestrictedMembership(restricted("SALES", ["/cari/musteri"]))).toBe(true)
  })

  it("her kuraldaki her uç kısıtsız kullanıcıya okuma ve yazma için açıktır", () => {
    for (const role of ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]) {
      for (const rule of PAGE_API_RULES) {
        expect(
          isApiPathAllowedForUser(rule.prefix, "GET", unrestricted(role)),
          `${role} okuyamadı: ${rule.prefix}`
        ).toBe(true)
        expect(
          isApiPathAllowedForUser(rule.prefix, "POST", unrestricted(role)),
          `${role} yazamadı: ${rule.prefix}`
        ).toBe(true)
      }
    }
  })

  it("kısıtsız kullanıcı her panel route'unu açabilir", () => {
    for (const path of ["/personel/maas", "/finans/kanallar", "/restoran/satis", "/ayarlar/ekip"]) {
      expect(canAccessRoute(unrestricted("SALES"), path)).toBe(true)
    }
  })

  it("rol matrisi kısıtsızlara henüz uygulanmıyor (kademelendirme bilinçli)", () => {
    // Bu sabit true olduğunda yukarıdaki iki test kırılır — kırılması DOĞRUDUR ve
    // "artık rol matrisi de zorlanıyor" demektir. Testleri o zaman güncelleyin.
    expect(ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED).toBe(false)
  })
})

describe("efektif izin = rol ∩ allowedPaths", () => {
  it("izin listesi rolün görmediği sayfayı AÇMAZ", () => {
    // SALES rolünde /personel/maas yok; listeye yazılsa bile görünmez.
    // Kişisel sayfalar (profil/destek) kısıttan bağımsız her zaman eklenir.
    const perms = restricted("SALES", ["/cari/musteri", "/personel/maas"])
    expect(visiblePages(perms).filter((h) => !ALWAYS_AVAILABLE_PAGES.includes(h))).toEqual([
      "/cari/musteri",
    ])
    expect(canViewPage(perms, "/personel/maas")).toBe(false)
  })

  it("izin listesi rolün gördüklerini daraltır", () => {
    const perms = restricted("SALES", ["/cari/musteri"])
    expect(canViewPage(perms, "/cari/musteri")).toBe(true)
    // SALES normalde bunları görürdü:
    expect(pagesForRole("SALES")).toContain("/satis/fatura")
    expect(canViewPage(perms, "/satis/fatura")).toBe(false)
  })

  it("kısıt yokken rolün tüm sayfaları görünür", () => {
    expect(visiblePages(unrestricted("SALES"))).toEqual(pagesForRole("SALES"))
  })
})

describe("modül süzgeci — kapalı modülün sayfası teklif edilmez", () => {
  // GERÇEK ŞİKÂYET: "Harici olarak modüller gizlense de gözüküyor."
  // Sebep: `assignablePages`/`pagesForRole` `disabledModules`'ü hiç okumuyordu, yani
  // izin seçicileri satın alınmamış modüllerin sayfalarını da listeliyordu.
  const closed = { disabledModules: ["restaurant", "hr"] }

  it("kapalı modülün sayfaları atanabilir listesinden düşer", () => {
    const all = assignablePages()
    const filtered = assignablePages(closed)
    expect(all).toContain("/restoran/masalar")
    expect(filtered).not.toContain("/restoran/masalar")
    expect(filtered).not.toContain("/personel/maas")
    // Açık modüller ve modülsüz sayfalar dokunulmadan kalır.
    expect(filtered).toContain("/cari/musteri")
    expect(filtered).toContain("/ayarlar/profil")
  })

  it("rol matrisi de aynı süzgeçten geçer", () => {
    expect(pagesForRole("ADMIN")).toContain("/personel")
    expect(pagesForRole("ADMIN", closed)).not.toContain("/personel")
  })

  it("süzgeç verilmezse hiçbir şey elenmez", () => {
    expect(assignablePages(undefined)).toEqual(assignablePages())
  })

  it("e-Dönüşüm ayrı eksendir: modül değil firma bayrağı", () => {
    // Bu sayfaların modül anahtarı YOK; eskiden hiçbir süzgeçten geçmedikleri için
    // e-Dönüşüm kapalıyken de menüde/seçicide duruyorlardı.
    for (const href of E_DONUSUM_PAGES) {
      expect(moduleKeyForPath(href)).toBeNull()
      expect(isPageAvailable(href, { isEDonusumEnabled: false })).toBe(false)
      expect(isPageAvailable(href, { isEDonusumEnabled: true })).toBe(true)
    }
    // Kontör düz link (STANDALONE); grup süzgecinden geçmediği için ayrıca sayılı.
    expect(E_DONUSUM_PAGES).toContain("/e-donusum/kontor")
  })

  it("kalıbın kapalı modülleri isimleriyle bildirilir", () => {
    // Kart yalnız "4 yerine 0 sayfa" derse kullanıcı neyi satın alacağını bilemez;
    // etiket satın alma ekranındakiyle aynı olmalı.
    const kasiyer = ROLE_TEMPLATES.find((t) => t.key === "kasiyer")!
    expect(filterAvailablePages(kasiyer.allowedPaths, closed)).toEqual([])
    expect(missingModuleLabels(kasiyer.allowedPaths, closed)).toEqual(["Restoran & Kafe"])
  })

  it("kısmen kapalı kalıpta yalnız eksik modül raporlanır", () => {
    // Vardiya Sorumlusu restoran sayfaları + tek bir personel (izin) sayfası taşır;
    // yalnız Personel kapalıyken kalıp kullanılabilir kalır ama daralır.
    const sef = ROLE_TEMPLATES.find((t) => t.key === "kasiyer-sef")!
    const onlyHrClosed = { disabledModules: ["hr"] }
    const usable = filterAvailablePages(sef.allowedPaths, onlyHrClosed)
    expect(usable.length).toBe(sef.allowedPaths.length - 1)
    expect(missingModuleLabels(sef.allowedPaths, onlyHrClosed)).toEqual(["Personel"])
    // Restoran da kapanınca hiç sayfa kalmaz: kart kilitlenmeli.
    expect(filterAvailablePages(sef.allowedPaths, closed)).toEqual([])
    expect(missingModuleLabels(sef.allowedPaths, closed)).toEqual(["Restoran & Kafe", "Personel"])
  })

  it("süzgeç yokken kalıp eksiksiz ve şikâyetsizdir", () => {
    for (const t of ROLE_TEMPLATES) {
      expect(filterAvailablePages(t.allowedPaths, undefined)).toEqual(t.allowedPaths)
      expect(missingModuleLabels(t.allowedPaths, undefined)).toEqual([])
    }
  })

  it("landingPathFor kapalı modülün sayfasına düşürmez", () => {
    // Kısıtlı çalışanın tek izinli sayfası kapalı bir modüldeyse açılışta kilit
    // ekranına atılır ve gidecek yeri kalmaz.
    const perms = restricted("ADMIN", ["/restoran/masalar"], ["/restoran/masalar"])
    expect(landingPathFor(perms)).toBe("/restoran/masalar")
    expect(landingPathFor(perms, closed)).toBe("/ayarlar/profil")
  })
})

describe("salt-okunurluk — VIEWER ve tümü-okunur özel rol", () => {
  // GERÇEK ŞİKÂYET: "Görüntüleyici olması işlem yapmasını engellemiyor."
  // Sebep: VIEWER kısıtsız sayılıyordu, `editablePages` de kısıtsıza "hepsi yazılabilir"
  // diyordu. Arayüz bu yüzden ona da Kaydet/Sil çiziyordu.
  it("VIEWER kısıtsız olsa bile hiçbir sayfada yazamaz", () => {
    const perms = unrestricted("VIEWER")
    expect(isRestrictedMembership(perms)).toBe(false)
    expect(visiblePages(perms).length).toBeGreaterThan(0)
    expect(editablePages(perms)).toEqual([])
    expect(isReadOnlyRole(perms)).toBe(true)
    expect(isReadOnlyMembership(perms)).toBe(true)
  })

  it("VIEWER gördüğü sayfada bile düzenleyemez", () => {
    const perms = unrestricted("VIEWER")
    const seen = visiblePages(perms)[0]
    expect(canViewPage(perms, seen)).toBe(true)
    expect(canEditPage(perms, seen)).toBe(false)
  })

  it("kısıtlı VIEWER'a writablePaths verilse de yazamaz", () => {
    // Yetki dağıtan ekranın yanlışlıkla yazma işaretlemesi VIEWER'ı yazar hâle
    // getirmemeli: enum rol tavandır, liste yalnız daraltır.
    const perms = restricted("VIEWER", ["/raporlar/satis"], ["/raporlar/satis"])
    expect(editablePages(perms)).toEqual([])
    expect(isApiPathAllowedForUser("/api/raporlar/satis", "POST", perms)).toBe(false)
  })

  it("yazma izni olmayan özel rol salt-okunur üyeliktir", () => {
    // Enum'u CUSTOM olduğu için `ensureCompanyWrite`'ın VIEWER kontrolüne takılmıyordu;
    // `isReadOnlyMembership` ikisini tek cevapta topluyor.
    const gozlemci: PagePermissions = {
      role: "CUSTOM",
      allowedPaths: ["/cari/musteri", "/stok/urunler"],
      writablePaths: [],
      custom: true,
    }
    expect(isReadOnlyRole(gozlemci)).toBe(false)
    expect(isReadOnlyMembership(gozlemci)).toBe(true)
    expect(canViewPage(gozlemci, "/cari/musteri")).toBe(true)
    expect(canEditPage(gozlemci, "/cari/musteri")).toBe(false)
  })

  it("tek sayfada yazabilen özel rol salt-okunur DEĞİLDİR", () => {
    const perms: PagePermissions = {
      role: "CUSTOM",
      allowedPaths: ["/cari/musteri", "/stok/urunler"],
      writablePaths: ["/stok/urunler"],
      custom: true,
    }
    expect(isReadOnlyMembership(perms)).toBe(false)
  })

  it("VIEWER kendi profilini ve destek sayfasını düzenleyebilir", () => {
    // Aksi halde salt-okunur uyarısı kişisel sayfalarda da çıkar ve kullanıcı kendi
    // şifresini değiştiremeyeceğini sanır.
    const perms = unrestricted("VIEWER")
    for (const href of ALWAYS_AVAILABLE_PAGES) {
      expect(canEditPage(perms, href)).toBe(true)
    }
    // Kişisel istisna "iş" kümesini kirletmemeli:
    expect(isReadOnlyMembership(perms)).toBe(true)
  })

  it("yazabilen enum roller salt-okunur sayılmaz", () => {
    // Regresyon bekçisi: kapıyı VIEWER'a daraltırken normal rollerin yazması kapanmasın.
    for (const role of ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "STOCK", "SALES"]) {
      expect(isReadOnlyMembership(unrestricted(role))).toBe(false)
    }
  })
})

describe("görüntüle / düzenle ayrımı", () => {
  it("writablePaths'te olmayan izinli sayfa salt-okunurdur", () => {
    const perms = restricted("SALES", ["/cari/musteri"], [])
    expect(canViewPage(perms, "/cari/musteri")).toBe(true)
    expect(canEditPage(perms, "/cari/musteri")).toBe(false)
    expect(isApiPathAllowedForUser("/api/cari/customers", "GET", perms)).toBe(true)
    expect(isApiPathAllowedForUser("/api/cari/customers", "POST", perms)).toBe(false)
    expect(isApiPathAllowedForUser("/api/cari/customers", "DELETE", perms)).toBe(false)
  })

  it("writablePaths verilince aynı sayfa yazılabilir olur", () => {
    const perms = restricted("SALES", ["/cari/musteri"], ["/cari/musteri"])
    expect(isApiPathAllowedForUser("/api/cari/customers", "POST", perms)).toBe(true)
  })

  it("yazma izni görünmeyen sayfaya verilemez", () => {
    // writablePaths ⊆ visiblePages; listeye yazmak tek başına yetmez.
    const perms = restricted("SALES", ["/cari/musteri"], ["/satis/fatura"])
    expect(editablePages(perms)).toEqual([])
    expect(isApiPathAllowedForUser("/api/faturalar", "POST", perms)).toBe(false)
  })

  it("bilinmeyen metot yazma sayılır (fail closed)", () => {
    const perms = restricted("SALES", ["/cari/musteri"], [])
    expect(isApiPathAllowedForUser("/api/cari/customers", "PURGE", perms)).toBe(false)
  })
})

describe("kısıtlı çalışan senaryoları", () => {
  it("'satıştan yalnız müşteriler' izni bordroyu açmaz", () => {
    // Planın çıkış noktası olan senaryo. Bugün bu kullanıcı /api/personel/payroll'u
    // okuyabiliyordu (menüde yoktu ama uç açıktı).
    const perms = restricted("SALES", ["/cari/musteri"], ["/cari/musteri"])
    expect(isApiPathAllowedForUser("/api/personel/payroll", "GET", perms)).toBe(false)
    expect(isApiPathAllowedForUser("/api/personel/employees", "GET", perms)).toBe(false)
    expect(canAccessRoute(perms, "/personel/maas")).toBe(false)
  })

  it("kasiyer kendi satış ekranını gerçekten kullanabilir", () => {
    // FAZLA DAR kural koruması: bu uçlardan biri kapanırsa kahveci satış ekranı
    // çalışmaz. Liste, sayfanın import grafiğinden çıkarıldı.
    const kasiyer = restricted("SALES", ["/restoran/satis"], ["/restoran/satis"])
    for (const path of [
      "/api/restoran/adisyonlar",
      "/api/restoran/masalar",
      "/api/restoran/recipes",
      "/api/restoran/urun-secenekleri",
      "/api/restoran/ikram",
      "/api/restoran/kontrol-listesi/gun",
      "/api/stok/products",
      "/api/depolar",
      "/api/depolar/stok",
      "/api/cari/customers",
      "/api/finans/accounts",
      "/api/fis-tasarim",
      "/api/personel/employees",
    ]) {
      expect(isApiPathAllowedForUser(path, "GET", kasiyer), `okuyamadı: ${path}`).toBe(true)
    }
    // Adisyon açmak/kapamak yazma işidir.
    expect(isApiPathAllowedForUser("/api/restoran/adisyonlar", "POST", kasiyer)).toBe(true)
    // Ama menüyü/reçeteyi değiştiremez.
    expect(isApiPathAllowedForUser("/api/restoran/recipes", "POST", kasiyer)).toBe(false)
    expect(isApiPathAllowedForUser("/api/stok/products", "POST", kasiyer)).toBe(false)
  })

  it("kasiyer kontrol listesine tik atabilir ama listeyi kuramaz", () => {
    // Kural: maddeleri KURAN ekran /restoran/kontrol-listesi, TİK ATAN ekran satış.
    const kasiyer = restricted("SALES", ["/restoran/satis"], ["/restoran/satis"])
    expect(isApiPathAllowedForUser("/api/restoran/kontrol-listesi/gun", "POST", kasiyer)).toBe(true)
    expect(canAccessRoute(kasiyer, "/restoran/kontrol-listesi")).toBe(false)
  })

  it("vardiya girsin ama maaşları görmesin", () => {
    const perms = restricted("ADMIN", ["/personel/vardiya"], ["/personel/vardiya"])
    expect(isApiPathAllowedForUser("/api/personel/shifts", "POST", perms)).toBe(true)
    expect(isApiPathAllowedForUser("/api/personel/employees", "GET", perms)).toBe(true)
    expect(isApiPathAllowedForUser("/api/personel/payroll", "GET", perms)).toBe(false)
    expect(isApiPathAllowedForUser("/api/personel/documents", "GET", perms)).toBe(false)
  })

  it("rapor izni ham belge listesini açmaz", () => {
    // Rapor ekranlarının kendi uçları var; "yalnız Satış Raporları" izni verilen biri
    // fatura listesini okuyamamalı. (Demo kurulumunda yakalanan fazla-yetki.)
    const raporcu = restricted("SALES", ["/raporlar/satis"])
    expect(isApiPathAllowedForUser("/api/faturalar", "GET", raporcu)).toBe(false)
    expect(isApiPathAllowedForUser("/api/raporlar/satis-ozet", "GET", raporcu)).toBe(true)
  })

  it("satış raporu izni mali tabloları açmaz", () => {
    // Bilanço/kâr-zarar menüsüz sayfalar; genel /api/raporlar kuralına düşünce
    // herhangi bir rapor izni onları da açıyordu.
    const raporcu = restricted("SALES", ["/raporlar/satis"])
    expect(isApiPathAllowedForUser("/api/raporlar/kar-zarar", "GET", raporcu)).toBe(false)
    expect(isApiPathAllowedForUser("/api/raporlar/bilanco", "GET", raporcu)).toBe(false)
    const mali = restricted("ACCOUNTANT", ["/raporlar/nakit-banka"])
    expect(isApiPathAllowedForUser("/api/raporlar/kar-zarar", "GET", mali)).toBe(true)
  })

  it("kuralsız uçta OKUMA serbest kalır", () => {
    // Oturum, kur, katalog: panelde hangi ekranın açık olduğundan bağımsız okunur.
    const perms = restricted("SALES", ["/cari/musteri"])
    for (const path of ["/api/auth/session", "/api/billing/catalog", "/api/kur"]) {
      expect(pageRuleForApiPath(path)).toBeNull()
      expect(isApiPathAllowedForUser(path, "GET", perms)).toBe(true)
    }
  })

  it("kuralsız uçta YAZMA reddedilir", () => {
    // En büyük delik buydu: haritada karşılığı olmayan her uç kısıtlı çalışana sonuna
    // kadar açıktı. Asimetri bilinçli — unutulmuş bir okuma kuralı ekranı kırar,
    // unutulmuş bir yazma kuralı kısıtın kendisini anlamsız kılar.
    const perms = restricted("SALES", ["/cari/musteri"], ["/cari/musteri"])
    for (const path of ["/api/muhasebe/fisler", "/api/muhasebe/hesap-plani", "/api/kur"]) {
      expect(pageRuleForApiPath(path)).toBeNull()
      expect(isApiPathAllowedForUser(path, "GET", perms)).toBe(true)
      expect(isApiPathAllowedForUser(path, "POST", perms)).toBe(false)
      expect(isApiPathAllowedForUser(path, "DELETE", perms)).toBe(false)
    }
  })

  it("kişisel uçlar (bildirim, destek) kısıt ne olursa olsun yazılabilir", () => {
    // Bildirimi okundu işaretlemek ya da destek talebi açmak ekran yetkisi değildir;
    // kuralsız-uç varsayılanı deny'a döndüğü için bunlar AÇIKÇA kural olmak zorunda.
    const perms = restricted("SALES", ["/cari/musteri"], [])
    for (const path of ["/api/notifications", "/api/support/tickets", "/api/support/tickets/42/messages"]) {
      expect(pageRuleForApiPath(path)?.personal).toBe(true)
      expect(isApiPathAllowedForUser(path, "POST", perms)).toBe(true)
      expect(isApiPathAllowedForUser(path, "PATCH", perms)).toBe(true)
    }
    // Salt-okunur üyelikte bile: VIEWER da bildirimini okundu işaretleyebilmeli.
    expect(isApiPathAllowedForUser("/api/notifications", "PATCH", unrestricted("VIEWER"))).toBe(true)
  })
})

describe("yazma daraltması — gören yazamaz", () => {
  // Bu blok Bulgu 3 / Delik C'nin karşılığı: 52 kuralda `writePages` yoktu, yani
  // `writePages ?? pages` devreye giriyor ve ucu GÖREBİLEN herkes YAZABİLİYORDU.
  const w = (role: string, page: string) => restricted(role, [page], [page])

  it("rapor ekranı hiçbir rapor ucuna yazamaz", () => {
    const raporcu = w("ACCOUNTANT", "/raporlar/stok")
    expect(isApiPathAllowedForUser("/api/raporlar", "GET", raporcu)).toBe(true)
    expect(isApiPathAllowedForUser("/api/raporlar", "POST", raporcu)).toBe(false)
    // Ve stok raporu artık stok HAREKETİ giremez.
    expect(isApiPathAllowedForUser("/api/stok/movements", "GET", raporcu)).toBe(true)
    expect(isApiPathAllowedForUser("/api/stok/movements", "POST", raporcu)).toBe(false)
  })

  it("export salt okumadır", () => {
    const perms = w("ACCOUNTANT", "/raporlar/satis")
    expect(isApiPathAllowedForUser("/api/export/rapor-satis", "GET", perms)).toBe(true)
    expect(isApiPathAllowedForUser("/api/export/rapor-satis", "POST", perms)).toBe(false)
  })

  it("cari raporu cari kaydı silemez", () => {
    const perms = w("ACCOUNTANT", "/raporlar/cari")
    expect(isApiPathAllowedForUser("/api/cari/ekstre", "GET", perms)).toBe(true)
    expect(isApiPathAllowedForUser("/api/cari", "DELETE", perms)).toBe(false)
  })

  it("restoran raporu adisyona yazamaz ama kasiyer yazar", () => {
    const raporcu = w("ADMIN", "/restoran/raporlar")
    expect(isApiPathAllowedForUser("/api/restoran/adisyonlar", "GET", raporcu)).toBe(true)
    expect(isApiPathAllowedForUser("/api/restoran/adisyonlar", "POST", raporcu)).toBe(false)

    const kasiyer = w("ADMIN", "/restoran/satis")
    expect(isApiPathAllowedForUser("/api/restoran/adisyonlar", "POST", kasiyer)).toBe(true)
    expect(isApiPathAllowedForUser("/api/restoran/ikram", "POST", kasiyer)).toBe(true)
  })

  it("depo listesi transfer oluşturamaz, transfer ekranı oluşturur", () => {
    expect(isApiPathAllowedForUser("/api/depolar/transfer", "POST", w("STOCK", "/depolar"))).toBe(false)
    expect(isApiPathAllowedForUser("/api/depolar/transfer", "POST", w("STOCK", "/stok/transfer"))).toBe(true)
  })

  it("finans: kasa devri kanal ekranına, mutabakat eşleşmesi mutabakat ekranına ait", () => {
    expect(isApiPathAllowedForUser("/api/kasa", "POST", w("ACCOUNTANT", "/finans/kanallar"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/kasa", "POST", w("ACCOUNTANT", "/finans/hareketler"))).toBe(false)
    expect(isApiPathAllowedForUser("/api/banka", "POST", w("ACCOUNTANT", "/finans/mutabakat"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/banka", "POST", w("ACCOUNTANT", "/finans/kanallar"))).toBe(false)
  })

  it("puantajcı bordro yazamaz (jenerik personel ucu da dahil)", () => {
    // Rol ADMIN: puantaj ACCOUNTANT matrisinde YOK, tavan onu zaten elerdi ve test
    // daralttığımız şeyi değil rol matrisini ölçerdi.
    const puantaj = w("ADMIN", "/personel/puantaj")
    expect(isApiPathAllowedForUser("/api/personel/payroll", "GET", puantaj)).toBe(true)
    expect(isApiPathAllowedForUser("/api/personel/payroll", "POST", puantaj)).toBe(false)
    expect(isApiPathAllowedForUser("/api/personel", "POST", puantaj)).toBe(false)
  })

  it("meşru yazma yolları açık kalır (regresyon bekçisi)", () => {
    // Daraltmanın bedeli çalışan bir ekranı kırmak olmamalı.
    expect(isApiPathAllowedForUser("/api/faturalar/odemeler", "POST", w("SALES", "/satis/fatura"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/siparis", "POST", w("SALES", "/satis/siparis"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/teklif", "PUT", w("SALES", "/teklif"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/import", "POST", w("ADMIN", "/ayarlar/veri-aktarim"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/attachments", "POST", w("SALES", "/satis/fatura"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/e-donusum/inbox", "POST", w("ACCOUNTANT", "/alis/gelen-e-faturalar"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/kontor/orders", "POST", w("ADMIN", "/e-donusum/kontor"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/personel/holidays", "POST", w("ADMIN", "/personel/vardiya"))).toBe(true)
    expect(isApiPathAllowedForUser("/api/e-donusum/onboarding", "POST", w("ADMIN", "/ayarlar/e-donusum"))).toBe(true)
  })
})

describe("paylaşımlı uçlar (bir uç, çok ekran)", () => {
  it("müşteri listesini fatura ve çek ekranları da okuyabilir", () => {
    for (const page of ["/satis/fatura", "/cek-senet/cek", "/restoran/satis"]) {
      const perms = restricted("ADMIN", [page])
      expect(
        isApiPathAllowedForUser("/api/cari/customers", "GET", perms),
        `${page} müşteri listesini okuyamadı`
      ).toBe(true)
    }
  })

  it("ama müşteri YAZMA yalnız müşteri sayfasına bağlıdır", () => {
    const faturaci = restricted("ADMIN", ["/satis/fatura"], ["/satis/fatura"])
    expect(isApiPathAllowedForUser("/api/cari/customers", "POST", faturaci)).toBe(false)
    const cariCi = restricted("ADMIN", ["/cari/musteri"], ["/cari/musteri"])
    expect(isApiPathAllowedForUser("/api/cari/customers", "POST", cariCi)).toBe(true)
  })

  it("ürün okuması geniş, ürün yazması stok ekranına aittir", () => {
    const satisci = restricted("ADMIN", ["/satis/fatura"], ["/satis/fatura"])
    expect(isApiPathAllowedForUser("/api/stok/products", "GET", satisci)).toBe(true)
    expect(isApiPathAllowedForUser("/api/stok/products", "POST", satisci)).toBe(false)
    const stokcu = restricted("ADMIN", ["/stok/urunler"], ["/stok/urunler"])
    expect(isApiPathAllowedForUser("/api/stok/products", "POST", stokcu)).toBe(true)
  })
})

describe("en uzun ön ek kazanır", () => {
  it("/api/cari/customers kuralı /api/cari'yi ezer", () => {
    expect(pageRuleForApiPath("/api/cari/customers")?.prefix).toBe("/api/cari/customers")
    expect(pageRuleForApiPath("/api/cari/ekstre")?.prefix).toBe("/api/cari/ekstre")
    expect(pageRuleForApiPath("/api/cari/detay")?.prefix).toBe("/api/cari")
  })

  it("/api/personel/payroll kuralı /api/personel'i ezer", () => {
    expect(pageRuleForApiPath("/api/personel/payroll")?.prefix).toBe("/api/personel/payroll")
    expect(pageRuleForApiPath("/api/personel/payroll/bulk")?.prefix).toBe("/api/personel/payroll")
  })

  it("tire ile biten ön ek segment ortasında da eşleşir", () => {
    expect(pageRuleForApiPath("/api/export/rapor-satis")?.prefix).toBe("/api/export/rapor-")
    expect(pageRuleForApiPath("/api/export/rapor-personel")?.prefix).toBe("/api/export/rapor-personel")
  })

  it("benzer isimli ama kural dışı ön ek eşleşmez", () => {
    expect(pageRuleForApiPath("/api/carinet")).toBeNull()
    expect(pageRuleForApiPath("/api/personeller")).toBeNull()
  })
})

describe("navHrefsForPath — gerçek route → menü öğesi", () => {
  it("cari ağacını segmentten çözer", () => {
    expect(navHrefsForPath("/cari/customers/new")).toEqual(["/cari/musteri"])
    expect(navHrefsForPath("/cari/suppliers/abc/edit")).toEqual(["/cari/tedarikci"])
  })

  it("cari liste sayfasını ?tab= ile çözer", () => {
    expect(navHrefsForPath("/cari", new URLSearchParams("tab=suppliers"))).toEqual(["/cari/tedarikci"])
    expect(navHrefsForPath("/cari", new URLSearchParams())).toEqual(["/cari/musteri"])
  })

  it("menüsüz landing'leri sahibine bağlar", () => {
    expect(navHrefsForPath("/stok")).toEqual(["/stok/urunler"])
    expect(navHrefsForPath("/stok/abc")).toEqual(["/stok/urunler"])
    expect(navHrefsForPath("/depolar/transfer")).toEqual(["/stok/transfer"])
    expect(navHrefsForPath("/banka/mutabakat")).toEqual(["/finans/mutabakat"])
    expect(navHrefsForPath("/restoran/gun-sonu")).toEqual(["/restoran/raporlar"])
    expect(navHrefsForPath("/stok/receteler")).toEqual(["/restoran/menu"])
  })

  it("yönü belirsiz belge sayfalarında iki sahip döner", () => {
    // Fatura önizlemesi satışın da alışın da olabilir; "herhangi biri izinliyse geçer".
    expect(navHrefsForPath("/faturalar/123/onizleme")).toEqual(["/satis/fatura", "/alis/fatura"])
    expect(navHrefsForPath("/fisler/9")).toEqual(["/satis/fisler", "/alis/fisler"])
  })

  it("alt yolda EN SPESİFİK menü öğesi kazanır", () => {
    // /personel hem kendisi hem /personel/ik'nin ön eki; detay sayfası /personel'e,
    // İK sayfası kendine düşmeli.
    expect(navHrefsForPath("/personel/123")).toEqual(["/personel"])
    expect(navHrefsForPath("/personel/ik")).toEqual(["/personel/ik"])
    expect(navHrefsForPath("/personel/maas")).toEqual(["/personel/maas"])
  })

  it("sahibi olmayan route kapıya tabi değildir", () => {
    // Menüsüz muhasebe/rapor ekranları — bilinçli boşluk.
    expect(navHrefsForPath("/muhasebe/kebir")).toEqual([])
    expect(canAccessRoute(restricted("ADMIN", ["/cari/musteri"]), "/muhasebe/kebir")).toBe(true)
  })

  it("adisyon detayı masa/adisyon ekranlarına ait", () => {
    expect(navHrefsForPath("/restoran/adisyon/42")).toContain("/restoran/adisyonlar")
    const garson = restricted("SALES", ["/restoran/masalar"])
    expect(canAccessRoute(garson, "/restoran/adisyon/42")).toBe(true)
  })
})

describe("kural haritasının bütünlüğü", () => {
  const NAV_HREFS = new Set(NAV_PAGES.map((p) => p.href))

  it("kuraldaki her sayfa menüde tanımlı (yazım hatası koruması)", () => {
    // Menüde olmayan bir href HİÇBİR ZAMAN allowedPaths'e yazılmaz, yani o kural
    // satırı ölüdür — uç sessizce erişilemez olur.
    for (const rule of PAGE_API_RULES) {
      for (const href of [...rule.pages, ...(rule.writePages ?? [])]) {
        expect(NAV_HREFS, `bilinmeyen sayfa: ${href} (${rule.prefix})`).toContain(href)
      }
    }
  })

  it("yazma listesi okumadan geniş olamaz", () => {
    for (const rule of PAGE_API_RULES) {
      for (const href of rule.writePages ?? []) {
        expect(rule.pages, `${rule.prefix}: ${href} yazabiliyor ama okuyamıyor`).toContain(href)
      }
    }
  })

  it("her kural /api/ ile başlar ve boş OKUMA listesi taşımaz", () => {
    for (const rule of PAGE_API_RULES) {
      expect(rule.prefix.startsWith("/api/")).toBe(true)
      expect(rule.pages.length, `boş kural: ${rule.prefix}`).toBeGreaterThan(0)
    }
    // `writePages: []` KASITLIDIR ve "bu uca kimse yazamaz" demektir (rapor/export
    // uçları, jenerik ön ekler). Eskiden boş liste bir hata sayılıyordu; artık
    // salt-okuma sözleşmesinin ifade biçimi.
  })

  it("her kural yazma sözleşmesini AÇIKÇA taşır", () => {
    // `writePages ?? pages` yedeği sessiz bir genişletmeydi: kurala okuma amacıyla
    // eklenen bir rapor ekranı o uca yazma da kazanıyordu. Yeni kural eklerken
    // yazma sahibini düşünmek zorunlu olsun diye alan artık zorunlu sayılıyor.
    for (const rule of PAGE_API_RULES) {
      if (rule.personal) continue
      expect(rule.writePages, `${rule.prefix}: writePages yazılmamış`).toBeDefined()
    }
  })

  it("aynı ön ek iki kez tanımlanmaz", () => {
    const prefixes = PAGE_API_RULES.map((r) => r.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it("modül kapısı olan hassas uçların sayfa kuralı da vardır", () => {
    // Modül kapısı firmayı, sayfa kapısı kullanıcıyı korur. Para/özlük verisi taşıyan
    // bir uç yalnızca modül kapısına bırakılırsa kısıtlı çalışan onu okuyabilir.
    for (const path of [
      "/api/personel/payroll",
      "/api/personel/documents",
      "/api/finans/transactions",
      "/api/cek-senet",
      "/api/faturalar",
      "/api/raporlar/kar-zarar",
    ]) {
      expect(pageRuleForApiPath(path), `sayfa kuralı yok: ${path}`).not.toBeNull()
    }
  })

  it("requiredPagesForApiPath metoda göre listeyi döndürür", () => {
    expect(requiredPagesForApiPath("/api/cari/customers", "POST")).toEqual(["/cari/musteri"])
    expect(requiredPagesForApiPath("/api/cari/customers", "GET")).toContain("/satis/fatura")
    expect(requiredPagesForApiPath("/api/billing/catalog", "GET")).toEqual([])
  })
})

describe("sanitizePagePermissions — kaydetme", () => {
  it("rolde olmayan sayfayı yazmaz (arayüz atlansa bile)", () => {
    const result = sanitizePagePermissions("SALES", ["/cari/musteri", "/personel/maas"], [])
    expect(result.allowedPaths).toEqual(["/cari/musteri"])
  })

  it("bilinmeyen href'i ve tekrarları eler", () => {
    const result = sanitizePagePermissions("SALES", ["/cari/musteri", "/cari/musteri", "/yok"], [])
    expect(result.allowedPaths).toEqual(["/cari/musteri"])
  })

  it("yazma listesini görüntüleme listesine kırpar", () => {
    const result = sanitizePagePermissions("SALES", ["/cari/musteri"], ["/cari/musteri", "/teklif"])
    expect(result.writablePaths).toEqual(["/cari/musteri"])
  })

  it("boş seçim kısıt yok olarak saklanır", () => {
    expect(sanitizePagePermissions("SALES", [], ["/cari/musteri"])).toEqual({
      allowedPaths: [],
      writablePaths: [],
    })
  })

  it("tam yetki seçimi kısıt yok'a çevrilir", () => {
    // Aksi halde üyelik dondurulmuş bir listeye kilitlenir ve panele sonradan eklenen
    // her sayfa ondan sessizce gizlenirdi.
    const all = pagesForRole("SALES")
    expect(sanitizePagePermissions("SALES", all, all)).toEqual({
      allowedPaths: [],
      writablePaths: [],
    })
  })

  it("hepsi seçili ama salt-okunursa kısıt KORUNUR", () => {
    // "Her şeyi görsün, hiçbir şeye dokunmasın" geçerli bir kısıttır.
    const all = pagesForRole("SALES")
    const result = sanitizePagePermissions("SALES", all, [])
    expect(result.allowedPaths).toEqual(all)
    expect(result.writablePaths).toEqual([])
  })
})

describe("özel roller (firma tanımlı)", () => {
  const custom = (allowed: string[], writable: string[] = []): PagePermissions => ({
    role: "CUSTOM",
    allowedPaths: allowed,
    writablePaths: writable,
    custom: true,
  })

  it("custom bayrağı düşse bile enum CUSTOM tek başına yeterlidir", () => {
    // GERÇEK HATA (11 Ağu): istemci provider'ı bayrağı taşımıyordu. Tavan
    // pagesForRole("CUSTOM") ile hesaplanıyor, o da BOŞ küme olduğu için özel rollü
    // kullanıcı profili dahil HER sayfada "yetkiniz yok" görüyordu.
    expect(pagesForRole("CUSTOM")).toEqual([])

    const bayraksiz: PagePermissions = {
      role: "CUSTOM",
      allowedPaths: ["/cari/musteri"],
      writablePaths: [],
      // custom: true YOK — kasıtlı
    }
    expect(visiblePages(bayraksiz)).toContain("/cari/musteri")
    expect(canViewPage(bayraksiz, "/ayarlar/profil")).toBe(true)
    expect(canAccessRoute(bayraksiz, "/cari")).toBe(true)
    expect(isApiPathAllowedForUser("/api/cari/customers", "GET", bayraksiz)).toBe(true)
    // Sınır yine de korunur:
    expect(canAccessRoute(bayraksiz, "/ayarlar/roller")).toBe(false)
  })

  it("özel rollü kullanıcı kendi profiline her zaman erişir", () => {
    // Kişisel sayfalar seçilmemiş olsa bile açık olmalı.
    for (const perms of [
      custom(["/satis/fatura"]),
      { role: "CUSTOM", allowedPaths: ["/satis/fatura"], writablePaths: [] } as PagePermissions,
    ]) {
      expect(canAccessRoute(perms, "/ayarlar/profil")).toBe(true)
      expect(canAccessRoute(perms, "/ayarlar/destek")).toBe(true)
    }
  })

  it("tavan enum matrisi DEĞİL, yönetim dışı tüm sayfalardır", () => {
    // Hazır rollerin göremediği bir kombinasyon özel rolde mümkün olmalı — özelliğin
    // varlık sebebi bu. SALES /personel/izin'i göremez; özel rol görebilir.
    const rol = custom(["/cari/musteri", "/personel/izin"])
    expect(canViewPage(rol, "/cari/musteri")).toBe(true)
    expect(canViewPage(rol, "/personel/izin")).toBe(true)
    expect(pagesForRole("SALES")).not.toContain("/personel/izin")
  })

  it("hesap yönetimi sayfaları özel role VERİLEMEZ", () => {
    // Ayrıcalık yükseltme sınırı: verilebilseydi rol sahibi kendi rolünü düzenleyip
    // yetkisini sınırsıza çıkarırdı. Kaydetmede de, okumada da elenmeli.
    for (const href of ACCOUNT_ADMIN_PAGES) {
      expect(assignablePages(), `${href} atanabilir görünüyor`).not.toContain(href)
      expect(canViewPage(custom([href, "/cari/musteri"]), href)).toBe(false)
      expect(
        sanitizePagePermissions("CUSTOM", [href, "/cari/musteri"], [], { custom: true }).allowedPaths
      ).toEqual(["/cari/musteri"])
    }
  })

  it("yetki dağıtan uçlar özel role kapalıdır", () => {
    // Ayrıcalık yükseltmenin ikinci kilidi: rol/üyelik yazma uçları, atanamayan
    // sayfalara bağlı olduğu için özel rolde hiçbir zaman açılmaz.
    const rol = custom(assignablePages())
    expect(isApiPathAllowedForUser("/api/company/roles", "POST", rol)).toBe(false)
    expect(isApiPathAllowedForUser("/api/company/users", "POST", rol)).toBe(false)
    expect(isApiPathAllowedForUser("/api/company/invitations", "POST", rol)).toBe(false)
  })

  it("özel rol her zaman kısıtlıdır — geniş liste bile kapıyı açmaz", () => {
    const rol = custom(["/cari/musteri"])
    expect(isRestrictedMembership(rol)).toBe(true)
    expect(isApiPathAllowedForUser("/api/personel/payroll", "GET", rol)).toBe(false)
  })

  it("kişisel sayfalar seçilmese de her zaman açıktır", () => {
    // Kimse kendi profiline ve destek talebine kapatılamamalı.
    const rol = custom(["/restoran/satis"])
    expect(canViewPage(rol, "/ayarlar/profil")).toBe(true)
    expect(canViewPage(rol, "/ayarlar/destek")).toBe(true)
  })

  it("panoya yetkili özel rol, VIEWER panosuna değil kök panoya düşer", () => {
    // Rol panoları (/dashboard/viewer, /dashboard/sales…) belirli enum rollerin
    // widget'larını basıyor; özel role hiçbiri uymaz.
    expect(landingPathFor(custom(["/dashboard", "/cari/musteri"]))).toBe("/dashboard")
  })

  it("açılış sayfası kişisel sayfa değil, operasyonel sayfadır", () => {
    // Profil her zaman izinli olduğu için listenin başına düşebiliyordu; kullanıcı
    // girişte profil ekranını görüp "yetkim yok" sanırdı.
    expect(landingPathFor(custom(["/restoran/satis"]))).toBe("/restoran/satis")
  })

  it("tam liste seçilse bile kısıt korunur (hazır rolün aksine)", () => {
    // Hazır rolde "hepsi" = kısıtsız; özel rolde liste boşaltılırsa rol YETKİSİZ olur.
    const all = assignablePages()
    const saved = sanitizePagePermissions("CUSTOM", all, all, { custom: true })
    expect(saved.allowedPaths.length).toBe(all.length)
    expect(saved.writablePaths.length).toBe(all.length)
  })

  it("yazma yetkisi özel rolde de görünürlükle sınırlı", () => {
    const rol = custom(["/cari/musteri"], ["/cari/musteri", "/stok/urunler"])
    expect(editablePages(rol)).toEqual(["/cari/musteri"])
    expect(isApiPathAllowedForUser("/api/stok/products", "POST", rol)).toBe(false)
  })
})

describe("landingPathFor — açılış sayfası", () => {
  it("kısıtsız kullanıcı rolünün panosuna düşer", () => {
    expect(landingPathFor(unrestricted("SALES"))).toBe("/dashboard/sales")
    expect(landingPathFor(unrestricted("ADMIN"))).toBe("/dashboard/admin")
  })

  it("panoya izni olan kısıtlı kullanıcı da panoya düşer", () => {
    expect(landingPathFor(restricted("SALES", ["/dashboard", "/cari/musteri"]))).toBe("/dashboard/sales")
  })

  it("panoya izni olmayan kısıtlı kullanıcı ilk izinli sayfasına düşer", () => {
    // Pano ciro/kâr rakamı basıyor; "yalnız müşterileri görsün" denen kişi oraya düşmemeli.
    expect(landingPathFor(restricted("SALES", ["/cari/musteri"]))).toBe("/cari/musteri")
  })

  it("hiç izinli sayfa kalmamışsa profile düşer", () => {
    // Rol daraldığında (ör. ADMIN → SALES) izin listesi geçersiz kalabilir.
    expect(landingPathFor(restricted("SALES", ["/personel/maas"]))).toBe("/ayarlar/profil")
  })
})

describe("PageForbiddenError", () => {
  it("mesajı 'Access denied' ile başlar", () => {
    // Helper'a geçmemiş route catch'leri 403'ü bu ifadeye bakarak veriyor;
    // biçim değişirse o uçlar sessizce 500'e düşer.
    expect(new PageForbiddenError(["/personel/maas"]).message).toBe(
      "Access denied: page not permitted (/personel/maas)"
    )
  })

  it("pageForbiddenFrom hatayı tanır ve sayfaları geri verir", () => {
    const error = new PageForbiddenError(["/cari/musteri", "/satis/fatura"])
    expect(pageForbiddenFrom(error)?.pages).toEqual(["/cari/musteri", "/satis/fatura"])
    expect(pageForbiddenFrom(new Error("Access denied: page not permitted (/personel)"))?.pages).toEqual([
      "/personel",
    ])
  })

  it("iki kapının hataları birbirine karışmaz", () => {
    // Arayüz modül kilidinde "satın al", sayfa kilidinde "yöneticine başvur" gösterir.
    expect(pageForbiddenFrom(new ModuleLockedError(["hr"]))).toBeNull()
    expect(moduleLockedFrom(new PageForbiddenError(["/personel/maas"]))).toBeNull()
    expect(pageForbiddenFrom(new Error("Access denied to this company"))).toBeNull()
    expect(pageForbiddenFrom(null)).toBeNull()
  })
})
