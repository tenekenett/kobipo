/**
 * Modül bağımlılığı ve opt-in gating testleri (Restoran & Kafe modülü).
 *
 * Çalıştırma:  node scripts/test-module-gating.mjs
 *
 * lib/modules.ts hiçbir şey import etmeyen saf bir dosya; geçici bir klasöre
 * derleyip doğrudan koşuyoruz. DB, ağ veya Next.js gerekmez.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const out = mkdtempSync(join(tmpdir(), "kobipo-modules-"))

try {
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc")
  if (!existsSync(tsc)) {
    console.error("typescript bulunamadı — önce `npm install` çalıştırın.")
    process.exit(1)
  }

  let tscOutput = ""
  try {
    execFileSync(
      process.execPath,
      [tsc, "lib/modules.ts", "--outDir", out, "--rootDir", "lib", "--module", "es2020", "--target", "es2020", "--skipLibCheck"],
      { stdio: "pipe" }
    )
  } catch (err) {
    tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`
  }

  const modPath = join(out, "modules.js")
  if (!existsSync(modPath)) {
    console.error("tsc çıktı üretemedi:\n" + tscOutput)
    process.exit(1)
  }
  writeFileSync(join(out, "package.json"), '{"type":"module"}')

  const mod = await import(pathToFileURL(modPath).href)
  const {
    MODULE_KEYS,
    DEFAULT_TRIAL_MODULE_KEYS,
    withModuleDependencies,
    modulesRequiring,
    reconcileDisabledModules,
    sanitizeDisabledModules,
  } = mod

  let pass = 0
  let fail = 0
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      pass++
      console.log(`  OK   ${label} = ${JSON.stringify(actual)}`)
    } else {
      fail++
      console.log(`  FAIL ${label}\n       beklenen: ${JSON.stringify(expected)}\n       gelen:    ${JSON.stringify(actual)}`)
    }
  }
  const sorted = (a) => [...a].sort()

  console.log("\n== Katalog ==")
  eq("restaurant katalogda", MODULE_KEYS.includes("restaurant"), true)
  eq("deneme listesi restaurant İÇERMEZ (opt-in)", DEFAULT_TRIAL_MODULE_KEYS.includes("restaurant"), false)
  eq("deneme listesi stock içerir", DEFAULT_TRIAL_MODULE_KEYS.includes("stock"), true)
  eq(
    "deneme = opt-in olmayan tüm modüller",
    sorted(DEFAULT_TRIAL_MODULE_KEYS),
    sorted(MODULE_KEYS.filter((k) => k !== "restaurant"))
  )

  console.log("\n== Bağımlılık tamamlama ==")
  eq("restaurant -> stock eklenir", sorted(withModuleDependencies(["restaurant"])), ["restaurant", "stock"])
  eq("zaten varsa tekrarlanmaz", sorted(withModuleDependencies(["restaurant", "stock"])), ["restaurant", "stock"])
  eq("bağımsız modül dokunulmaz", withModuleDependencies(["sales"]), ["sales"])
  eq("bilinmeyen anahtar elenir", withModuleDependencies(["yok"]), [])
  eq("boş giriş", withModuleDependencies([]), [])

  console.log("\n== Kaldırma kilidi ==")
  eq("restaurant seçiliyken stock kilitli", modulesRequiring("stock", ["restaurant", "stock"]), ["restaurant"])
  eq("restaurant seçili değilse stock serbest", modulesRequiring("stock", ["sales", "stock"]), [])
  eq("restaurant'ı kilitleyen yok", modulesRequiring("restaurant", ["restaurant", "stock"]), [])

  console.log("\n== disabledModules tutarlılığı ==")
  // restaurant açık (disabled'da yok) ama stock kapalı → stock açılmalı
  const inconsistent = MODULE_KEYS.filter((k) => k !== "restaurant")
  eq(
    "restaurant açıkken stock kapalı bırakılamaz",
    reconcileDisabledModules(inconsistent).includes("stock"),
    false
  )
  eq(
    "restaurant açık kalır",
    reconcileDisabledModules(inconsistent).includes("restaurant"),
    false
  )
  // restaurant kapalıyken stock kapatılabilir
  eq(
    "restaurant kapalıyken stock kapatılabilir",
    reconcileDisabledModules(["stock", "restaurant"]).sort(),
    ["restaurant", "stock"]
  )
  eq("hepsi açık -> boş liste", reconcileDisabledModules([]), [])
  eq("bilinmeyen anahtar elenir", reconcileDisabledModules(["yok"]), [])
  eq(
    "hepsi kapalı korunur",
    sorted(reconcileDisabledModules([...MODULE_KEYS])),
    sorted(MODULE_KEYS)
  )

  console.log("\n== sanitize (mevcut davranış korunuyor) ==")
  eq("geçersiz anahtar elenir", sanitizeDisabledModules(["sales", "yok"]), ["sales"])
  eq("dizi değilse boş", sanitizeDisabledModules("sales"), [])

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exit(fail === 0 ? 0 : 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
