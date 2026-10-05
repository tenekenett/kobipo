// Yetki günlüğünün KAPSAM nöbetçisi.
//
// Üyelik (`userCompany`) ya da özel rol (`companyRole`) yazan her yol günlüğe de yazmalı.
// 2026-10-05'e kadar Ekip Yönetimi'nin izin değişikliği hiçbir yere yazılmıyordu ve
// kısıtlanan bir çalışanın sorunu ancak kestiği faturalardan geriye doğru tahminle
// çözülebildi. Yeni bir yazma yolu (yeni bir uç, toplu işlem) günlüğü unutursa geçmişte
// yine delik açılır; bu test onu yakalar. Kapsam `app/` ve `lib/` — `scripts/` geliştirme
// araçlarıdır, canlı yetki değiştirmez.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const ROOTS = ["app", "lib"].map((dir) => path.resolve(process.cwd(), dir))

const WRITE_RE = /\.(userCompany|companyRole)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
const LOG_RE = /\b(withMembershipLog|logMembershipChange|logRoleChange)\b/

/** Günlüğe yazmadan üyelik/rol değiştirebilen dosyalar ve gerekçeleri. Boş kalmalı. */
const EXEMPT: Record<string, string> = {}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe("yetki günlüğü — kapsam nöbetçisi", () => {
  const files = ROOTS.flatMap((root) => walk(root))
  const writers = files.filter((file) => WRITE_RE.test(fs.readFileSync(file, "utf8")))

  it("tarama gerçekten yazan yolları buluyor", () => {
    // Boşa düşen tarama aşağıdaki testi boş küme üzerinde "geçirirdi".
    expect(writers.length).toBeGreaterThan(5)
  })

  it("üyelik/rol yazan her dosya günlüğe de yazar", () => {
    const missing = writers
      .map((file) => path.relative(process.cwd(), file).replace(/\\/g, "/"))
      .filter((rel) => !(rel in EXEMPT))
      .filter((rel) => !LOG_RE.test(fs.readFileSync(path.resolve(process.cwd(), rel), "utf8")))
    expect(
      missing,
      "Şu dosyalar üyelik ya da özel rol yazıyor ama yetki günlüğüne yazmıyor — yazmayı\n" +
        "`withMembershipLog` ile sarın ya da `logRoleChange` çağırın (lib/audit/permission-log.server.ts):\n" +
        missing.join("\n")
    ).toEqual([])
  })
})
