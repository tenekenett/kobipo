/**
 * "Yetkisi olmayan sayfanın verisini YAN KAPIDAN yazma" nöbetçisi.
 *
 * Kullanıcının bildirdiği hata: izin ekranında "Müşteri" yazması kapatıldığı hâlde
 * çalışan müşteri EKLEYEBİLİYOR ve SİLEBİLİYORDU. Sebep `/api/cari/customers`
 * kuralında değildi — o doğruydu — iki yan kapıdaydı:
 *
 *  1. Tedarikçi ucu "Aynı zamanda Müşteri" ikizini yazıyor (doğuruyor/siliyor) ama
 *     kapıdan `/cari/tedarikci` yazmasıyla geçiyordu.
 *  2. Veri aktarım ucu cari satırlarını yazıyor ama kapıdan `/ayarlar/veri-aktarim`
 *     yazmasıyla geçiyordu — ve o sayfa SALES rolünün varsayılan matrisinde var,
 *     yani kapı pratikte hiç kapanmıyordu.
 *
 * Testler yazmanın HANGİ SAYFAYA sorulduğunu doğrular; karar `PAGE_API_RULES`tan
 * türediği için sayfa adları elle eşleştirilmez, kural tablosuna sorulur.
 */

import { describe, expect, it } from "vitest"
import {
  cariMirrorApiPath,
  importTargetApiPath,
  isApiPathAllowedForUser,
  requiredPagesForApiPath,
  type PagePermissions,
} from "../page-access"
import { pagesForRole } from "../nav/pages"

/** Rolün tüm sayfaları izinli; `readOnly` verilenler SALT-OKUNUR. */
const withReadOnly = (role: string, readOnly: string[]): PagePermissions => {
  const all = pagesForRole(role)
  for (const href of readOnly) {
    // Nöbetçinin nöbetçisi: rol o sayfayı hiç görmüyorsa test sessizce anlamsızlaşır.
    expect(all, `${role} rolü ${href} sayfasını görmüyor`).toContain(href)
  }
  return {
    role,
    allowedPaths: all,
    writablePaths: all.filter((href) => !readOnly.includes(href)),
  }
}

const fullAccess = (role: string): PagePermissions => withReadOnly(role, [])

describe("ikiz cari kartı — yetki KARŞI sayfadan sorulur", () => {
  it("ikiz müşteri yazması /cari/musteri'ye bağlıdır", () => {
    expect(requiredPagesForApiPath(cariMirrorApiPath("customer"), "POST")).toEqual([
      "/cari/musteri",
    ])
  })

  it("ikiz tedarikçi yazması /cari/tedarikci'ye bağlıdır", () => {
    expect(requiredPagesForApiPath(cariMirrorApiPath("supplier"), "POST")).toEqual([
      "/cari/tedarikci",
    ])
  })

  it("müşteri salt-okunurken ikiz müşteri kartı AÇILAMAZ", () => {
    // Muhasebeci iki cari ekranını da görür; yalnız "Müşteri" salt-okunur yapıldı.
    const p = withReadOnly("ACCOUNTANT", ["/cari/musteri"])
    // Tedarikçi kartını yazabiliyor…
    expect(isApiPathAllowedForUser("/api/cari/suppliers", "POST", p)).toBe(true)
    // …ama ikiz müşteri kartı o yetkiyle doğamaz. Hatanın ta kendisi buydu.
    expect(isApiPathAllowedForUser(cariMirrorApiPath("customer"), "POST", p)).toBe(false)
  })

  it("tedarikçi salt-okunurken ikiz tedarikçi kartı AÇILAMAZ (ayna yön)", () => {
    const p = withReadOnly("ACCOUNTANT", ["/cari/tedarikci"])
    expect(isApiPathAllowedForUser("/api/cari/customers", "POST", p)).toBe(true)
    expect(isApiPathAllowedForUser(cariMirrorApiPath("supplier"), "POST", p)).toBe(false)
  })

  it("iki sayfa da yazılabilirken ikiz kart açılabilir (kapı fazla dar değil)", () => {
    const p = fullAccess("ACCOUNTANT")
    expect(isApiPathAllowedForUser(cariMirrorApiPath("customer"), "POST", p)).toBe(true)
    expect(isApiPathAllowedForUser(cariMirrorApiPath("supplier"), "POST", p)).toBe(true)
  })
})

describe("veri aktarımı — yetki HEDEF sayfadan sorulur", () => {
  it("her aktarım modülü hedef ucuna eşlenir", () => {
    expect(importTargetApiPath("customers")).toBe("/api/cari/customers")
    expect(importTargetApiPath("suppliers")).toBe("/api/cari/suppliers")
    expect(importTargetApiPath("products")).toBe("/api/stok/products")
    expect(importTargetApiPath("invoices")).toBe("/api/faturalar")
    expect(importTargetApiPath("invoices-ubl")).toBe("/api/faturalar")
  })

  it("bilinmeyen modül bu EK koşula tabi değildir", () => {
    // Uç yine `/ayarlar/veri-aktarim` yazması istiyor; null "ek koşul yok" demektir,
    // "serbest" demek değil.
    expect(importTargetApiPath("bilinmeyen")).toBeNull()
  })

  it("aktarım ekranı yetkisi müşteri EKLEME hakkı vermez", () => {
    const p = withReadOnly("SALES", ["/cari/musteri"])
    // Veri aktarım ekranı SALES matrisinde ve yazılabilir…
    expect(p.writablePaths).toContain("/ayarlar/veri-aktarim")
    expect(isApiPathAllowedForUser("/api/import", "POST", p)).toBe(true)
    // …ama müşteri satırı yazmaya yetmez.
    expect(isApiPathAllowedForUser(importTargetApiPath("customers")!, "POST", p)).toBe(false)
  })

  it("hedef sayfa yetkisi varsa aktarım geçer", () => {
    const p = fullAccess("ADMIN")
    for (const module of ["customers", "suppliers", "products", "invoices", "invoices-ubl"]) {
      expect(
        isApiPathAllowedForUser(importTargetApiPath(module)!, "POST", p),
        `aktarım kapandı: ${module}`
      ).toBe(true)
    }
  })
})
