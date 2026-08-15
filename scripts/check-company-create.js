#!/usr/bin/env node

// Firma oluşturmanın tek yolu olduğunu DOĞRULAR.
//
//   npm run check:company-create
//
// Neden: "yeni firma" birden çok kapıdan açılabiliyor (panel, firma seçici, sistem
// yönetimi) ve kural her kapıda ayrı yazıldığında biri kotayı atlıyor. Hangi kapının
// açık kaldığını elle test ederek bulmak mümkün değil — bu yüzden mekanik kontrol:
// `company.create(...)` çağrısı YALNIZCA lib/company/create-company.ts içinde olabilir.
// Yeni bir uç doğrudan Prisma ile firma yazarsa build/CI burada durur.
//
// Aynı desen: `npm run check:rls` (CLAUDE.md → "Yeni tablo → RLS açılacak").

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")

// Kuralın YAŞADIĞI yer (tek yazma noktası).
const OWNER = path.join("lib", "company", "create-company.ts")

// Taranan kaynak ağaçları. `scripts/` ve `prisma/` hariç: tohumlama/bakım araçları
// uygulama akışı değildir, kotayı ilgilendirmez ve elle çalıştırılır.
const SCAN_DIRS = ["app", "lib", "components"]
const SCAN_EXT = new Set([".ts", ".tsx"])

// `prisma.company.create(`, `tx.company.create(`, `client.company.create(` …
const CREATE_CALL = /\b[\w$]+\.company\.create(?:Many)?\s*\(/g

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const violations = []
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) continue
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file)
    if (rel === OWNER) continue
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      // Yorum satırındaki örnekler sayılmaz (bu dosyaya atıfta bulunan açıklamalar).
      const code = line.trim()
      if (code.startsWith("//") || code.startsWith("*")) return
      CREATE_CALL.lastIndex = 0
      if (CREATE_CALL.test(line)) violations.push(`${rel}:${i + 1}  ${code}`)
    })
  }
}

if (violations.length > 0) {
  console.error("\n❌ Firma oluşturma ortak modülün DIŞINDA yapılıyor:\n")
  for (const v of violations) console.error("   " + v)
  console.error(
    `\n   Firma yalnızca ${OWNER} içinden yazılır (erişim + rol + KOTA denetimi orada).` +
      "\n   Yeni uç: createCompany({ actorUserId, placement, input, grantMembership }) çağırın.\n",
  )
  process.exit(1)
}

console.log(`✅ Firma oluşturma tek yolda: ${OWNER}`)
