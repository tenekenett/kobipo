import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Vercel Pro'da geçerli; Hobby'de fiilen 10sn'e iner. Küçük/orta veri için yeterli.
export const maxDuration = 60

// JSON.stringify BigInt'i serileştiremez; string'e çevir. (Prisma Decimal/Date
// kendi toJSON'larıyla zaten doğru serileşir.)
function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/**
 * Mantıksal veritabanı yedeği (JSON).
 *
 * Tüm Prisma modellerini gezip her tablonun verisini tek bir JSON dosyasına
 * döker; tarayıcıya indirme olarak döner. pg_dump'a (Vercel'de yok) alternatif
 * olarak VERİYİ yedekler — şema/index/trigger dahil DEĞİLDİR (onlar
 * prisma/schema.prisma + `prisma db push` ile kurulur). Büyük veride Vercel
 * süre limitine takılabilir; o durumda Supabase pg_dump yolu kullanılmalı.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const models = Prisma.dmmf.datamodel.models
    const data: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}

    for (const model of models) {
      // Prisma client delegate adı = model adının camelCase hali (Company -> company)
      const prop = model.name.charAt(0).toLowerCase() + model.name.slice(1)
      const delegate = (prisma as Record<string, any>)[prop]
      if (!delegate?.findMany) continue
      const rows: unknown[] = await delegate.findMany()
      data[model.name] = rows
      counts[model.name] = rows.length
    }

    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
    const payload = {
      meta: {
        app: "kobipo",
        kind: "logical-json-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        generatedBy: auth.user.email,
        tableCount: Object.keys(data).length,
        totalRows,
        counts,
      },
      data,
    }

    const body = JSON.stringify(payload, jsonReplacer)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="kobipo-yedek-${timestamp()}.json"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    console.error("[system-admin/backup] Yedek oluşturulamadı:", e)
    return NextResponse.json({ error: "Yedek oluşturulamadı" }, { status: 500 })
  }
}
