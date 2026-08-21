/**
 * Hazır rol kalıplarının testleri.
 *
 * Katalog artık veritabanında (`role_templates`) ve panelden düzenleniyor; koddaki
 * `DEFAULT_ROLE_TEMPLATES` iki role indi: migrasyonun TOHUMLADIĞI ilk yedi kalıbın
 * kod içindeki karşılığı ve tablo yokken devreye giren yedek. İki liste ayrışırsa
 * hiçbir ekran şikâyet etmez — tohumlanmış kurulum bir şey, tohumlanmamış kurulum
 * başka bir şey gösterir. Aşağıdaki test o sessiz ayrışmayı yakalar.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_ROLE_TEMPLATES, toRoleTemplate } from "./role-templates"
import { ACCOUNT_ADMIN_PAGES, assignablePages, navPage } from "./pages"

const SEED_SQL = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20260821000001_role_templates.sql"),
  "utf-8"
)

/** `ARRAY['a','b']` → ["a","b"]. `ARRAY[]::TEXT[]` boş dizidir. */
function parseSqlArray(literal: string): string[] {
  return Array.from(literal.matchAll(/'([^']*)'/g)).map((m) => m[1])
}

/** Tohum dosyasındaki bir kalıbın adı ve iki sayfa listesi. */
function seededTemplate(key: string) {
  const start = SEED_SQL.indexOf(`'${key}',`)
  expect(start, `tohumda '${key}' yok`).toBeGreaterThan(-1)
  // Kayıt bir sonraki satır-içi id'ye ('rtpl_…) ya da INSERT'in sonuna kadar sürer.
  const rest = SEED_SQL.slice(start)
  const end = rest.indexOf("('rtpl_", 1)
  const block = end === -1 ? rest.slice(0, rest.indexOf("ON CONFLICT")) : rest.slice(0, end)
  const arrays = block.match(/ARRAY\[[^\]]*\]/g) ?? []
  const name = block.match(/^'[^']*',\s*'([^']*)'/)?.[1]
  return {
    name,
    allowedPaths: parseSqlArray(arrays[0] ?? ""),
    writablePaths: parseSqlArray(arrays[1] ?? ""),
  }
}

describe("hazır rol kalıpları", () => {
  it("koddaki yedek ile migrasyonun tohumu birebir aynıdır", () => {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const seeded = seededTemplate(template.key)
      expect(seeded.name, `${template.key} adı`).toBe(template.name)
      expect(seeded.allowedPaths, `${template.key} sayfaları`).toEqual(template.allowedPaths)
      expect(seeded.writablePaths, `${template.key} yazma`).toEqual(template.writablePaths)
    }
  })

  it("tohum, kodda olmayan bir kalıp içermez", () => {
    const seededKeys = Array.from(SEED_SQL.matchAll(/\('rtpl_[a-z_]+', '([a-z-]+)'/g)).map(
      (m) => m[1]
    )
    expect(seededKeys.sort()).toEqual(DEFAULT_ROLE_TEMPLATES.map((t) => t.key).sort())
  })

  it("kalıpların sayfaları gerçek ve atanabilir", () => {
    // Bilinmeyen href sunucuda sessizce elenir: kalıp "8 sayfa" der, rol 6 sayfayla
    // doğar. Hesap yönetimi ekranları ise hiçbir kalıba giremez (ayrıcalık yükseltme).
    const assignable = new Set(assignablePages())
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      for (const href of template.allowedPaths) {
        expect(navPage(href), `${template.key}: bilinmeyen sayfa ${href}`).toBeTruthy()
        expect(assignable.has(href), `${template.key}: atanamaz sayfa ${href}`).toBe(true)
        expect(ACCOUNT_ADMIN_PAGES).not.toContain(href)
      }
      // Yazma listesi görüntüleme listesinin alt kümesi olmak zorunda.
      for (const href of template.writablePaths) {
        expect(template.allowedPaths, `${template.key}: ${href} görüntülemede yok`).toContain(href)
      }
    }
  })

  it("toRoleTemplate DB satırının eksik/null alanlarını doldurur", () => {
    // Kartlar `description` için metin, listeler için dizi bekliyor; DB ikisini de
    // null bırakabilir (açıklamasız kalıp geçerlidir).
    expect(
      toRoleTemplate({ id: "x", key: "kurye", name: "Kurye", description: null })
    ).toEqual({
      id: "x",
      key: "kurye",
      name: "Kurye",
      description: "",
      allowedPaths: [],
      writablePaths: [],
      sortOrder: 0,
      isActive: true,
    })
  })
})
