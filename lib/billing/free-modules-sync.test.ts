/**
 * Ücretsiz modül kümesi değiştiğinde MEVCUT hesapların hizalanması.
 *
 * Buradaki risk tek yönlü değil:
 *  - açılma atlanırsa "herkese ücretsiz" dediğimiz modül eski firmalarda kapalı kalır,
 *  - kapanma fazla çalışırsa parası ödenmiş bir modül sessizce kapanır (asıl tehlike).
 * Bu yüzden testler özellikle "satın alınmış olanı kapatma" ve "değişmeyen firmaya
 * dokunma" davranışlarına bakar.
 */

import { describe, expect, it } from "vitest"
import { freeModuleDelta, planFreeModuleSync, type SyncCompanyView } from "./free-modules-sync"
import { MODULE_KEYS } from "@/lib/modules"

const allLocked = () => [...MODULE_KEYS]
const granted = (root: string, keys: string[]) => new Map([[root, new Set(keys)]])

describe("freeModuleDelta", () => {
  it("eklenen ve çıkarılan anahtarları ayırır", () => {
    const d = freeModuleDelta(["sales"], ["stock"])
    expect(d.opened).toEqual(["stock"])
    expect(d.closed).toEqual(["sales"])
  })

  it("değişiklik yoksa iki liste de boştur", () => {
    const d = freeModuleDelta(["sales"], ["sales"])
    expect(d.opened).toEqual([])
    expect(d.closed).toEqual([])
  })

  it("bağımlılığı ücretli olan anahtar hiç ücretsiz sayılmaz", () => {
    // restaurant → stock. Yalnız restaurant ücretsiz işaretlenmiş olsa da geçersiz.
    const d = freeModuleDelta([], ["restaurant"])
    expect(d.opened).toEqual([])
    expect(d.closed).toEqual([])
  })
})

describe("planFreeModuleSync — açılma", () => {
  const companies: SyncCompanyView[] = [
    { id: "kok", accountRootId: null, disabledModules: allLocked() },
    { id: "sube", accountRootId: "kok", disabledModules: allLocked() },
  ]

  it("yeni ücretsiz modül hesabın TÜM firmalarında açılır", () => {
    const updates = planFreeModuleSync(companies, new Map(), freeModuleDelta([], ["sales"]))
    expect(updates.map((u) => u.id).sort()).toEqual(["kok", "sube"])
    for (const u of updates) expect(u.disabledModules).not.toContain("sales")
  })

  it("aboneliği olmayan (kilitli) hesapta da açılır — ücretsizlik abonelikten bağımsız", () => {
    const updates = planFreeModuleSync(companies, new Map(), freeModuleDelta([], ["sales"]))
    expect(updates).toHaveLength(2)
  })

  it("zaten açıksa firma listeye girmez (gereksiz yazma yok)", () => {
    const open: SyncCompanyView[] = [
      { id: "a", accountRootId: null, disabledModules: MODULE_KEYS.filter((k) => k !== "sales") },
    ]
    expect(planFreeModuleSync(open, new Map(), freeModuleDelta([], ["sales"]))).toEqual([])
  })
})

describe("planFreeModuleSync — kapanma", () => {
  // "sales dışında hepsi kapalı" = ücretsiz küme ["sales"] iken applyEntitlements'in
  // yazacağı liste. Yani YÖNETİLEN satır: geri alınabilir.
  const companies: SyncCompanyView[] = [
    {
      id: "kok",
      accountRootId: null,
      disabledModules: MODULE_KEYS.filter((k) => k !== "sales"),
    },
  ]

  it("satın ALMAMIŞ hesapta ücretsizliği kalkan modül kapanır", () => {
    const updates = planFreeModuleSync(companies, new Map(), freeModuleDelta(["sales"], []))
    expect(updates).toHaveLength(1)
    expect(updates[0].disabledModules).toContain("sales")
  })

  it("satın ALMIŞ hesapta modül AÇIK kalır", () => {
    // Kritik: parası ödenmiş bir modülü fiyat değişikliği kapatmamalı.
    const updates = planFreeModuleSync(
      companies,
      granted("kok", ["sales"]),
      freeModuleDelta(["sales"], []),
    )
    expect(updates).toEqual([])
  })

  it("şube, KÖKÜN satın alımına bakar", () => {
    const withBranch: SyncCompanyView[] = [
      ...companies,
      { id: "sube", accountRootId: "kok", disabledModules: MODULE_KEYS.filter((k) => k !== "sales") },
    ]
    const updates = planFreeModuleSync(
      withBranch,
      granted("kok", ["sales"]),
      freeModuleDelta(["sales"], []),
    )
    expect(updates).toEqual([])
  })
})

describe("planFreeModuleSync — yönetilmeyen satırlar (canlı regresyon)", () => {
  // Modül kilidi kurulurken mevcut hesaplara bilinçli DOKUNULMADI: canlıda 32 firmanın
  // 22'si `disabledModules = []` ile duruyor (her şey açık, hiçbiri satın alınmamış).
  // "Satın almamışsan kapat" kuralı bu firmalarda, hiç ücretsiz almadıkları bir modülü
  // kapatıyordu — ölçüldüğünde 25 firma etkileniyordu.
  it("her şeyi açık gelen ESKİ hesapta ücretsizlik geri alınınca modül KAPANMAZ", () => {
    const legacy: SyncCompanyView[] = [{ id: "eski", accountRootId: null, disabledModules: [] }]
    expect(planFreeModuleSync(legacy, new Map(), freeModuleDelta(["hr"], []))).toEqual([])
  })

  it("elle düzenlenmiş (yönetilmeyen) satıra da dokunulmaz", () => {
    // Yalnız restaurant kapalı: ücretsiz küme ["hr"] iken applyEntitlements bunu yazmazdı.
    const manual: SyncCompanyView[] = [
      { id: "elle", accountRootId: null, disabledModules: ["restaurant"] },
    ]
    expect(planFreeModuleSync(manual, new Map(), freeModuleDelta(["hr"], []))).toEqual([])
  })

  it("YÖNETİLEN satırda kapanma yine çalışır (kilitli hesap ücretsiz hr almıştı)", () => {
    // Ücretsiz küme ["hr"] iken kilitli hesabın hâli: hr hariç hepsi kapalı.
    const managed: SyncCompanyView[] = [
      { id: "kilitli", accountRootId: null, disabledModules: MODULE_KEYS.filter((k) => k !== "hr") },
    ]
    const updates = planFreeModuleSync(managed, new Map(), freeModuleDelta(["hr"], []))
    expect(updates).toHaveLength(1)
    expect([...updates[0].disabledModules].sort()).toEqual([...MODULE_KEYS].sort())
  })

  it("AÇMA yönetilmeyen satırda da çalışır — ücretsizlik herkese", () => {
    const legacy: SyncCompanyView[] = [
      { id: "eski", accountRootId: null, disabledModules: ["restaurant", "hr"] },
    ]
    const updates = planFreeModuleSync(legacy, new Map(), freeModuleDelta([], ["hr"]))
    expect(updates).toHaveLength(1)
    expect(updates[0].disabledModules).toEqual(["restaurant"])
  })
})

describe("planFreeModuleSync — kapsam", () => {
  it("değişmeyen anahtarlara DOKUNMAZ", () => {
    // "finance" ne açılıyor ne kapanıyor; hesabın açık hâli korunmalı.
    const company: SyncCompanyView[] = [
      {
        id: "a",
        accountRootId: null,
        disabledModules: MODULE_KEYS.filter((k) => k !== "finance"),
      },
    ]
    const updates = planFreeModuleSync(company, new Map(), freeModuleDelta([], ["sales"]))
    expect(updates[0].disabledModules).not.toContain("finance")
    expect(updates[0].disabledModules).toContain("hr")
  })

  it("delta boşsa hiçbir firma yazılmaz", () => {
    const company: SyncCompanyView[] = [
      { id: "a", accountRootId: null, disabledModules: allLocked() },
    ]
    expect(planFreeModuleSync(company, new Map(), freeModuleDelta(["sales"], ["sales"]))).toEqual([])
  })
})
