/**
 * Sunucu tarafı modül kapısının testleri.
 *
 * Bu harita ücretli özelliklerin tek savunması: menü gizleme ve `ModuleGuard`
 * istemcide, `/api/*` elle çağrılabilir. Yanlış yazılmış bir ön ek ya da fazla
 * geniş bir `read` listesi sessizce kapıyı açar — ekranda hiçbir şey değişmez.
 * Testler o yüzden mutlu yolu değil, kapının kaçırabileceği durumları hedefler:
 * okuma/yazma ayrımı, en uzun ön ekin kazanması ve kuralsız yolların hep geçmesi.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { MODULE_KEYS } from "./modules"
import {
  API_MODULE_RULES,
  ModuleLockedError,
  isApiPathAllowed,
  isWriteMethod,
  moduleLockedFrom,
  moduleRuleForApiPath,
  requiredModulesForApiPath,
} from "./module-access"

/** Verilen modüller AÇIK, kalan her şey kapalı — yeni firmanın hâli budur. */
const onlyOpen = (...keys: string[]) => MODULE_KEYS.filter((k) => !keys.includes(k))

const ALL_LOCKED = [...MODULE_KEYS]
const NOTHING_LOCKED: string[] = []

describe("isApiPathAllowed — okuma/yazma ayrımı", () => {
  it("ürün okuması stok kapalıyken de satış ekranına açıktır", () => {
    // Satış faturasının kalem seçicisi ürün listesini okur; stok satın alınmamış
    // olabilir. Okuma geniş, yazma dar.
    expect(isApiPathAllowed("/api/stok/products", "GET", onlyOpen("sales"))).toBe(true)
  })

  it("ürün yazması yalnız stok modülüne aittir", () => {
    expect(isApiPathAllowed("/api/stok/products", "POST", onlyOpen("sales"))).toBe(false)
    expect(isApiPathAllowed("/api/stok/products", "POST", onlyOpen("stock"))).toBe(true)
  })

  it("müşteri yazması satışa, tedarikçi yazması alışa bağlıdır", () => {
    expect(isApiPathAllowed("/api/cari/customers", "POST", onlyOpen("purchase"))).toBe(false)
    expect(isApiPathAllowed("/api/cari/customers", "POST", onlyOpen("sales"))).toBe(true)
    expect(isApiPathAllowed("/api/cari/suppliers", "POST", onlyOpen("sales"))).toBe(false)
    expect(isApiPathAllowed("/api/cari/suppliers", "POST", onlyOpen("purchase"))).toBe(true)
  })

  it("bilinmeyen metot yazma sayılır (fail closed)", () => {
    expect(isWriteMethod("GET")).toBe(false)
    expect(isWriteMethod("head")).toBe(false)
    expect(isWriteMethod("PATCH")).toBe(true)
    expect(isWriteMethod("PURGE")).toBe(true)
    expect(isApiPathAllowed("/api/stok/products", "PURGE", onlyOpen("sales"))).toBe(false)
  })
})

describe("isApiPathAllowed — modül kapsamı", () => {
  it("restoran uçları restoran modülü kapalıyken reddedilir", () => {
    expect(isApiPathAllowed("/api/restoran/adisyonlar", "GET", onlyOpen("sales", "stock"))).toBe(false)
    expect(isApiPathAllowed("/api/restoran/adisyonlar", "GET", onlyOpen("restaurant"))).toBe(true)
  })

  it("personel raporu, raporlar kapalı olsa da personel modülüyle okunur", () => {
    expect(isApiPathAllowed("/api/export/rapor-personel", "GET", onlyOpen("hr"))).toBe(true)
    expect(isApiPathAllowed("/api/raporlar/personel", "GET", onlyOpen("hr"))).toBe(true)
  })

  it("diğer raporlar personel modülüyle açılmaz", () => {
    expect(isApiPathAllowed("/api/export/rapor-satis", "GET", onlyOpen("hr"))).toBe(false)
    expect(isApiPathAllowed("/api/raporlar/bilanco", "GET", onlyOpen("hr"))).toBe(false)
  })

  it("fatura uçları satış VEYA alış açıksa geçer", () => {
    // Yön query'de taşındığı için kural ikisinden birine bakar (bilinçli boşluk,
    // bkz. docs/paket-abonelik/MODUL-KILIDI.md).
    expect(isApiPathAllowed("/api/faturalar", "POST", onlyOpen("purchase"))).toBe(true)
    expect(isApiPathAllowed("/api/faturalar", "POST", onlyOpen("stock"))).toBe(false)
  })

  it("hiçbir modülü olmayan hesapta kurala tabi her uç kapalıdır", () => {
    for (const rule of API_MODULE_RULES) {
      expect(isApiPathAllowed(rule.prefix, "GET", ALL_LOCKED)).toBe(false)
      expect(isApiPathAllowed(rule.prefix, "POST", ALL_LOCKED)).toBe(false)
    }
  })

  it("hiçbir modülü kapalı olmayan hesapta her uç açıktır", () => {
    for (const rule of API_MODULE_RULES) {
      expect(isApiPathAllowed(rule.prefix, "DELETE", NOTHING_LOCKED)).toBe(true)
    }
  })
})

describe("kuralsız yollar", () => {
  it("hesap yönetimi kilitli hesapta bile açık kalır", () => {
    // Aksi halde kilitli hesap paket satın alamaz, oturum açamaz, ayar değiştiremez.
    for (const path of [
      "/api/billing/catalog",
      "/api/billing/subscription/cancel",
      "/api/ayarlar/firma",
      "/api/companies",
      "/api/auth/session",
      "/api/e-donusum/invoices",
      "/api/kontor/balance",
      "/api/health",
    ]) {
      expect(moduleRuleForApiPath(path)).toBeNull()
      expect(isApiPathAllowed(path, "POST", ALL_LOCKED)).toBe(true)
    }
  })

  it("benzer isimli ama kural dışı ön ek eşleşmez", () => {
    // "/api/carinet" gibi bir uç eklenirse "/api/cari" kuralına DÜŞMEMELİ.
    expect(moduleRuleForApiPath("/api/carinet")).toBeNull()
    expect(moduleRuleForApiPath("/api/stoklama")).toBeNull()
  })
})

describe("en uzun ön ek kazanır", () => {
  it("/api/cari/customers kuralı /api/cari'yi ezer", () => {
    expect(moduleRuleForApiPath("/api/cari/customers")?.prefix).toBe("/api/cari/customers")
    expect(moduleRuleForApiPath("/api/cari/ekstre")?.prefix).toBe("/api/cari")
  })

  it("/api/faturalar/odemeler finans ile de okunur, /api/faturalar okunmaz", () => {
    expect(isApiPathAllowed("/api/faturalar/odemeler", "GET", onlyOpen("finance"))).toBe(true)
    expect(isApiPathAllowed("/api/faturalar", "GET", onlyOpen("finance"))).toBe(false)
  })

  it("/api/raporlar/personel kuralı /api/raporlar'ı ezer", () => {
    expect(moduleRuleForApiPath("/api/raporlar/personel")?.prefix).toBe("/api/raporlar/personel")
  })

  it("tire ile biten ön ek segment ortasında da eşleşir", () => {
    // "/api/export/rapor-satis" tek segment; startsWith olmadan hiçbir kurala düşmezdi.
    expect(moduleRuleForApiPath("/api/export/rapor-satis")?.prefix).toBe("/api/export/rapor-")
    expect(moduleRuleForApiPath("/api/export/rapor-personel")?.prefix).toBe(
      "/api/export/rapor-personel"
    )
  })
})

describe("kural haritasının bütünlüğü", () => {
  it("kuraldaki her anahtar katalogda var (yazım hatası koruması)", () => {
    // Kataloğa girmeyen bir anahtar HİÇBİR ZAMAN disabledModules'a yazılmaz, yani
    // "hep açık" demektir — kapı sessizce delinir.
    for (const rule of API_MODULE_RULES) {
      for (const key of [...rule.read, ...(rule.write ?? [])]) {
        expect(MODULE_KEYS, `bilinmeyen modül anahtarı: ${key} (${rule.prefix})`).toContain(key)
      }
    }
  })

  it("her kural /api/ ile başlar ve boş modül listesi taşımaz", () => {
    for (const rule of API_MODULE_RULES) {
      expect(rule.prefix.startsWith("/api/")).toBe(true)
      expect(rule.read.length).toBeGreaterThan(0)
      if (rule.write) expect(rule.write.length).toBeGreaterThan(0)
    }
  })

  it("aynı ön ek iki kez tanımlanmaz", () => {
    const prefixes = API_MODULE_RULES.map((r) => r.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it("yazma listesi okumadan geniş olamaz", () => {
    // Yazabilen ama okuyamayan bir modül anlamsız olurdu.
    for (const rule of API_MODULE_RULES) {
      for (const key of rule.write ?? []) {
        expect(rule.read, `${rule.prefix}: ${key} yazabiliyor ama okuyamıyor`).toContain(key)
      }
    }
  })
})

describe("dışa aktarma veri kümeleri", () => {
  // Kural tablosu ön ek bazlı; yeni bir dataset (`/api/export/yeni-sey`) hiçbir ön eke
  // düşmezse SESSİZCE kapı dışı kalır ve kapalı modülün verisi export'tan sızar. Kayıt
  // dosyasını kaynaktan okuyup her anahtarın bir kurala düştüğünü doğruluyoruz — bu
  // testin kırılması "yeni dataset'e kural yaz" demektir.
  const source = readFileSync(new URL("./export/datasets/index.ts", import.meta.url), "utf8")
  const registry = source.slice(source.indexOf("export const DATASETS"))
  const keys = [...registry.matchAll(/^ {2}"?([a-z0-9-]+)"?:/gm)].map((m) => m[1])

  it("kayıt dosyasından anahtarlar okunabildi", () => {
    // Regex kaynak biçimine bağlı; sıfır anahtar bulmak testi sessizce boşa çıkarırdı.
    expect(keys.length).toBeGreaterThanOrEqual(15)
  })

  it("her dataset bir modül kuralına düşer", () => {
    for (const key of keys) {
      const path = `/api/export/${key}`
      expect(moduleRuleForApiPath(path), `kuralsız dataset: ${path}`).not.toBeNull()
    }
  })

  it("kilitli hesapta hiçbir dataset okunamaz", () => {
    for (const key of keys) {
      expect(isApiPathAllowed(`/api/export/${key}`, "GET", ALL_LOCKED)).toBe(false)
    }
  })

  it("personel veri kümeleri hr, diğerleri reports ister", () => {
    expect(isApiPathAllowed("/api/export/personel-puantaj", "GET", onlyOpen("hr"))).toBe(true)
    expect(isApiPathAllowed("/api/export/personel-vardiya", "GET", onlyOpen("hr"))).toBe(true)
    expect(isApiPathAllowed("/api/export/personel-puantaj", "GET", onlyOpen("reports"))).toBe(false)
    expect(isApiPathAllowed("/api/export/rapor-satis", "GET", onlyOpen("reports"))).toBe(true)
  })
})

describe("requiredModulesForApiPath", () => {
  it("metoda göre okuma/yazma listesini döndürür", () => {
    expect(requiredModulesForApiPath("/api/stok/products", "GET")).toEqual([
      "stock",
      "sales",
      "purchase",
      "restaurant",
    ])
    expect(requiredModulesForApiPath("/api/stok/products", "POST")).toEqual(["stock"])
  })

  it("kuralsız yolda boş döner", () => {
    expect(requiredModulesForApiPath("/api/billing/catalog", "GET")).toEqual([])
  })
})

describe("ModuleLockedError", () => {
  it("mesajı 'Access denied' ile başlar", () => {
    // Helper'a geçmemiş route catch'leri 403'ü bu ifadeye bakarak veriyor;
    // biçim değişirse o uçlar sessizce 500'e düşer.
    expect(new ModuleLockedError(["stock"]).message).toBe(
      "Access denied: module locked (stock)"
    )
  })

  it("moduleLockedFrom hatayı tanır ve modülleri geri verir", () => {
    const error = new ModuleLockedError(["sales", "purchase"])
    expect(moduleLockedFrom(error)?.modules).toEqual(["sales", "purchase"])
  })

  it("moduleLockedFrom yalnız mesajdan da çözer", () => {
    // Hata katmanlar arasında yeniden paketlenmiş olabilir; mesaj ikinci kanal.
    const plain = new Error("Access denied: module locked (hr)")
    expect(moduleLockedFrom(plain)?.modules).toEqual(["hr"])
  })

  it("diğer erişim hatalarını modül kilidi sanmaz", () => {
    expect(moduleLockedFrom(new Error("Access denied: read-only role (VIEWER)"))).toBeNull()
    expect(moduleLockedFrom(new Error("Access denied to this company"))).toBeNull()
    expect(moduleLockedFrom(null)).toBeNull()
    expect(moduleLockedFrom(undefined)).toBeNull()
  })
})
