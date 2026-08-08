/**
 * Modül kataloğu ve bağımlılık mantığının testleri.
 *
 * `disabledModules` bir RED listesidir: listede olmayan anahtar AÇIK sayılır. Bu yüzden
 * buradaki hatalar hep aynı yöne düşer — ücretli bir modül bedava açılır. Testler o
 * asimetriye bakar: bağımlılık tamamlama (Restoran & Kafe → Stok), kaldırma kilidi ve
 * `reconcileDisabledModules`'ın açık bir modülün gerektirdiğini kapalı bırakmaması.
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
  isAccountLocked,
  isModuleEnabled,
  modulesRequiring,
  reconcileDisabledModules,
  sanitizeDisabledModules,
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

describe("reconcileDisabledModules", () => {
  // "restaurant hariç hepsi kapalı" = Restoran açık ama gerektirdiği Stok kapalı.
  const restaurantOnly = MODULE_KEYS.filter((k) => k !== "restaurant")

  it("açık modülün gerektirdiği modül kapalı bırakılamaz", () => {
    const result = reconcileDisabledModules(restaurantOnly)
    expect(result).not.toContain("stock")
    expect(result).not.toContain("restaurant")
  })

  it("restoran kapalıyken stok kapatılabilir", () => {
    expect(sorted(reconcileDisabledModules(["stock", "restaurant"]))).toEqual([
      "restaurant",
      "stock",
    ])
  })

  it("hepsi açık -> boş liste", () => {
    expect(reconcileDisabledModules([])).toEqual([])
  })

  it("bilinmeyen anahtarı eler", () => {
    expect(reconcileDisabledModules(["yok"])).toEqual([])
  })

  it("kilitli hesap kilitli kalır", () => {
    // Yeni firma disabledModules = MODULE_KEYS ile doğar; reconcile bunu açmamalı.
    expect(sorted(reconcileDisabledModules([...MODULE_KEYS]))).toEqual(sorted(MODULE_KEYS))
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

describe("isAccountLocked", () => {
  it("yeni firmanın doğduğu hâl kilitlidir", () => {
    expect(isAccountLocked([...MODULE_KEYS])).toBe(true)
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
