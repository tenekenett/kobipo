import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/** Vercel / Supabase bağlantısı için teşhis: şifre göstermez. Üretimde gerekirse route'u kaldırın veya koruyun. */
function parseDatabaseUrl(url: string | undefined) {
  if (!url) {
    return { defined: false as const }
  }
  try {
    const normalized = url.replace(/^postgresql:/i, "http:")
    const u = new URL(normalized)
    return {
      defined: true as const,
      host: u.hostname,
      port: u.port || "(default)",
      hasPgbouncer: u.searchParams.get("pgbouncer") === "true",
      hasSslMode: u.searchParams.has("sslmode"),
    }
  } catch {
    return { defined: true as const, parseError: "Invalid DATABASE_URL format" }
  }
}

export async function GET() {
  const parsed = parseDatabaseUrl(process.env.DATABASE_URL)

  try {
    await prisma.$queryRaw`SELECT 1 AS ok`
    return NextResponse.json({ status: "ok", databaseUrl: parsed })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        status: "error",
        databaseUrl: parsed,
        prismaMessage: message.slice(0, 500),
      },
      { status: 503 }
    )
  }
}
