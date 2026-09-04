/**
 * Modül kataloğu ve bağımlılık mantığının testleri.
 *
 * `disabledModules` bir RED listesidir: listede olmayan anahtar AÇIK sayılır. Bu yüzden
 * buradaki hatalar hep aynı yöne düşer — ücretli bir modül bedava açılır. Testler o
 * asimetriye bakar: bağımlılık tamamlama (Restoran & Kafe → Stok), kaldırma kilidi ve
 * `applySuppression`ın kapatılan modülün bağımlılarını da kapatması.
 *
 * Geçmişi: bu blok `scripts/test-module-gating.mjs` içinde elle yazılmış bir tsc+import
 * harness'ıydı; repoya vitest girince buraya taşındı. Deneme (TRIAL) modüllerine dair
 * testler silindi — modül artık yalnız satın almayla açılıyor, `DEFAULT_TRIAL_MODULE_KEYS`
 * diye bir sabit kalmadı (bkz. docs/paket-abonelik/MODUL-KILIDI.md).
 */

import { describe, expect, it } from "vitest"
import {
  MANAGEABLE_MODULES,
  MODULE_GROUP_TO_KEY,
  MODULE_KEYS,
  defaultDisabledModules,
  isAccountLocked,
  applySuppression,
  isModuleEnabled,
  planCompanyModuleUpdate,
  modulesRequiring,
  sanitizeDisabledModules,
  sanitizeFreeModules,
  sanitizeSuppressedModules,
  withModuleDependencies,
} from "./modules"

const sorted = (keys: string[]) => [...keys].sort()

describe("katalog", () => {
  it("anahtarlar benzersizdir", () => {
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length)
  })

  it("her modülün nav grubu karşılığı vardır", () => {
    for (const module of MANAGEABLE_MODULES) {
      expect(MODULE_GROUP_TO_KEY[module.group]).toBe(module.key)
    }
  })

  it("bağımlılıklar katalogdaki bir anahtarı gösterir", () => {
    for (const module of MANAGEABLE_MODULES) {
      for (const dep of module.requires ?? []) {
        expect(MODULE_KEYS, `${module.key} -> ${dep}`).toContain(dep)
      }
    }
  })
})

describe("withModuleDependencies", () => {
  it("restoran seçilince stok da eklenir", () => {
    // Reçetenin tek işi stok düşürmek; Stok kapalıyken Restoran anlamsız.
    expect(sorted(withModuleDependencies(["restaurant"]))).toEqual(["restaurant", "stock"])
  })

  it("zaten seçili bağımlılık tekrarlanmaz", () => {
    expect(sorted(withModuleDependencies(["restaurant", "stock"]))).toEqual([
      "restaurant",
      "stock",
    ])
  })

  it("bağımsız modüle dokunmaz", () => {
    expect(withModuleDependencies(["sales"])).toEqual(["sales"])
  })

  it("bilinmeyen anahtarı eler", () => {
    expect(withModuleDependencies(["yok"])).toEqual([])
    expect(withModuleDependencies([])).toEqual([])
  })
})

describe("modulesRequiring", () => {
  it("restoran seçiliyken stok kaldırılamaz", () => {
    expect(modulesRequiring("stock", ["restaurant", "stock"])).toEqual(["restaurant"])
  })

  it("restoran seçili değilse stok serbesttir", () => {
    expect(modulesRequiring("stock", ["sales", "stock"])).toEqual([])
  })

  it("restoranı kilitleyen modül yoktur", () => {
    expect(modulesRequiring("restaurant", ["restaurant", "stock"])).toEqual([])
  })
})

describe("applySuppression", () => {
  const allOpen = [...MODULE_KEYS]

  it("kapatılan modülün BAĞIMLISI da kapanır", () => {
    // Sistem yöneticisi Stok'u kapatıyor: reçetesi stok düşen Restoran açık kalamaz.
    // Ters yön (`withModuleDependencies`) burada uygulansaydı Stok geri açılır ve
    // kapatma isteği sessizce yutulurdu — panelde yaşanan hata buydu.
    const result = applySuppression(allOpen, ["stock"])
    expect(result).not.toContain("stock")
    expect(result).not.toContain("restaurant")
    expect(result).toContain("sales")
  })

  it("bağımlısı olmayan modül tek başına kapanır", () => {
    expect(applySuppression(allOpen, ["hr"])).toEqual(MODULE_KEYS.filter((k) => k !== "hr"))
  })

  it("kapatma yoksa küme değişmez", () => {
    expect(applySuppression(allOpen, [])).toEqual(MODULE_KEYS)
  })

  it("bilinmeyen anahtarı eler", () => {
    expect(applySuppression(allOpen, ["yok"])).toEqual(MODULE_KEYS)
    expect(applySuppression(["yok", "sales"], [])).toEqual(["sales"])
  })
})

describe("sanitizeSuppressedModules", () => {
  it("yalnız ÜCRETSİZ modüller elle kapatılabilir", () => {
    // Ücretli modülü kapatmanın yolu satın alma yetkisini kaldırmaktır; buraya yazılsaydı
    // abonelik onu faturalamaya devam eder, iki ayrı kapatma kanalı doğardı.
    expect(sanitizeSuppressedModules(["sales", "restaurant"], ["sales", "stock"])).toEqual([
      "sales",
    ])
  })

  it("ücretsiz küme boşsa hiçbir şey kapatılamaz", () => {
    expect(sanitizeSuppressedModules(["sales"], [])).toEqual([])
  })
})

describe("sanitizeDisabledModules", () => {
  it("geçersiz anahtarı eler", () => {
    expect(sanitizeDisabledModules(["sales", "yok"])).toEqual(["sales"])
  })

  it("tekrarları teke indirir", () => {
    expect(sanitizeDisabledModules(["sales", "sales"])).toEqual(["sales"])
  })

  it("dizi olmayan girdide boş döner", () => {
    expect(sanitizeDisabledModules("sales")).toEqual([])
    expect(sanitizeDisabledModules(null)).toEqual([])
  })
})

describe("sanitizeFreeModules", () => {
  it("bilinmeyen anahtarı eler", () => {
    expect(sanitizeFreeModules(["sales", "yok"])).toEqual(["sales"])
  })

  it("gereksinimi ücretsiz olmayan modülü DÜŞÜRÜR", () => {
    // Restoran & Kafe → Stok. Stok ücretli kalırken restoranı ücretsiz saymak,
    // `withModuleDependencies` üzerinden stoğu da bedavaya açardı.
    expect(sanitizeFreeModules(["restaurant"])).toEqual([])
  })

  it("gereksinimi de ücretsizse kalır", () => {
    expect(sorted(sanitizeFreeModules(["restaurant", "stock"]))).toEqual(["restaurant", "stock"])
  })

  it("dizi olmayan girdide boş döner", () => {
    expect(sanitizeFreeModules(null)).toEqual([])
  })
})

describe("defaultDisabledModules", () => {
  it("ücretsiz küme boşken TÜM modüller kapalı doğar", () => {
    expect(sorted(defaultDisabledModules([]))).toEqual(sorted(MODULE_KEYS))
  })

  it("ücretsiz modüller açık doğar", () => {
    const disabled = defaultDisabledModules(["sales", "stock"])
    expect(disabled).not.toContain("sales")
    expect(disabled).not.toContain("stock")
    expect(disabled).toContain("finance")
  })
})

describe("isAccountLocked", () => {
  it("yeni firmanın doğduğu hâl kilitlidir", () => {
    expect(isAccountLocked([...MODULE_KEYS])).toBe(true)
  })

  it("yalnız ÜCRETSİZ modülü açık olan hesap hâlâ kilitlidir", () => {
    // Kritik: ücretsiz modül ölçüye girseydi hiçbir hesap kilitli sayılmaz, satın alma
    // ekranı (LockedAccount) hiç görünmezdi.
    const disabled = defaultDisabledModules(["sales"])
    expect(isAccountLocked(disabled, ["sales"])).toBe(true)
  })

  it("ücretli bir modül açıldığında kilit kalkar", () => {
    const disabled = defaultDisabledModules(["sales"]).filter((k) => k !== "finance")
    expect(isAccountLocked(disabled, ["sales"])).toBe(false)
  })

  it("ücretsiz küme verilmezse ücretsizler kilidi düşürür (geriye dönük davranış)", () => {
    const disabled = defaultDisabledModules(["sales"])
    expect(isAccountLocked(disabled)).toBe(false)
  })

  it("tek modül bile açıksa kilitli sayılmaz", () => {
    expect(isAccountLocked(MODULE_KEYS.filter((k) => k !== "sales"))).toBe(false)
  })

  it("boş/eksik liste kilitli DEĞİLDİR (red listesi)", () => {
    // Eski hesaplar boş listeyle duruyor = hepsi açık; onlara satın alma ekranı basılmaz.
    expect(isAccountLocked([])).toBe(false)
    expect(isAccountLocked(null)).toBe(false)
    expect(isAccountLocked(undefined)).toBe(false)
  })
})

describe("isModuleEnabled", () => {
  it("listede olmayan anahtar AÇIK sayılır (red listesi)", () => {
    expect(isModuleEnabled([], "sales")).toBe(true)
    expect(isModuleEnabled(null, "sales")).toBe(true)
    expect(isModuleEnabled(["sales"], "sales")).toBe(false)
  })
})

describe("planCompanyModuleUpdate", () => {
  // Canlı durum: yedi modülün altısı ücretsiz, yalnız restaurant ücretli.
  const FREE = ["sales", "purchase", "stock", "finance", "reports", "hr"]

  it("ÜCRETSİZ kapatma yetkiyi düşürmez, kalıcı kapatmaya yazılır", () => {
    const { suppressed, granted } = planCompanyModuleUpdate(["hr"], FREE)
    expect(suppressed).toEqual(["hr"])
    // Yetki hesabındır: hr yine "verilmiş" görünür, firmada kapatılması ayrı kanaldan.
    expect(granted).toContain("hr")
    expect(granted).toContain("restaurant")
  })

  it("ÜCRETLİ kapatma satın alma yetkisinden düşer", () => {
    const { suppressed, granted } = planCompanyModuleUpdate(["restaurant"], FREE)
    expect(suppressed).toEqual([])
    expect(granted).not.toContain("restaurant")
    expect(granted).toContain("stock")
  })

  it("ücretsiz Stok kapatmak, ÖDENMİŞ Restoran'ın yetkisini iptal etmez", () => {
    // Asıl tuzak bu: kapatma firma bazında, yetki hesap bazında. Bağımlılık zinciri
    // hesaba işleseydi tek şubede Stok'u kapatmak hesabın ödediği modülü iptal ederdi.
    const { suppressed, granted } = planCompanyModuleUpdate(["stock"], FREE)
    expect(suppressed).toEqual(["stock"])
    expect(granted).toContain("restaurant")
    expect(granted).toContain("stock")
  })

  it("ücretli Stok kapatılırsa Restoran da yetkiden düşer", () => {
    // Stok ücretliyken kapatma yetki kanalından gider; Restoran onsuz çalışamaz.
    const { suppressed, granted } = planCompanyModuleUpdate(["stock"], ["sales"])
    expect(suppressed).toEqual([])
    expect(granted).not.toContain("stock")
    expect(granted).not.toContain("restaurant")
  })

  it("hiçbir şey kapatılmadıysa tüm modüller verilir", () => {
    expect(planCompanyModuleUpdate([], FREE)).toEqual({ suppressed: [], granted: MODULE_KEYS })
  })

  it("bilinmeyen anahtar elenir", () => {
    expect(planCompanyModuleUpdate(["yok"], FREE).granted).toEqual(MODULE_KEYS)
  })
})
