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
    const rawUser = decodeURIComponent(u.username || "")
    /** Pooler: `postgres.<project-ref>` gerekir; yalnız `postgres` → Tenant or user not found */
    const poolerUserKind =
      /^postgres\.[^.@]+$/i.test(rawUser) ? ("tenant" as const) :
      /^postgres$/i.test(rawUser) ? ("bare_postgres" as const) :
      ("other" as const)
    return {
      defined: true as const,
      host: u.hostname,
      port: u.port || "(default)",
      hasPgbouncer: u.searchParams.get("pgbouncer") === "true",
      hasSslMode: u.searchParams.has("sslmode"),
      poolerUserKind,
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
    const host =
      parsed && "host" in parsed && typeof parsed.host === "string" ? parsed.host : ""
    const cantReach = message.includes("Can't reach database server")
    const tenantError = message.includes("Tenant or user not found")
    const useDbHost = /^db\.[^.]+\.supabase\.co$/i.test(host)
    const onSharedPooler = host.includes("pooler.supabase.com")
    const userKind =
      parsed && "poolerUserKind" in parsed ? parsed.poolerUserKind : undefined

    const hintTenant =
      tenantError || (onSharedPooler && userKind === "bare_postgres")
        ? "Paylaşımlı pooler'da kullanıcı adı `postgres` değil, `postgres.<project-ref>` olmalı (ör. postgres.ueftuxhtdfckhureqccy). Supabase Dashboard → Connect → Transaction URI'yi baştan kopyalayın; şifrede özel karakter varsa URI'de encode edilmiş olmalı."
        : undefined
    const hintReach =
      cantReach && useDbHost
        ? "Supabase Connect → Transaction URI genelde aws-0-<region>.pooler.supabase.com:6543 + kullanıcı postgres.<project-ref> kullanır. db.<ref>.supabase.co:6543 Vercel'den yine erişilemeyebilir; paneldeki URI'yi aynen kopyalayın."
        : cantReach
          ? "Supabase proje ayakta mı kontrol edin; Connect → Transaction veya Session pooler URI'yi kullanın. Gerekirse ?connect_timeout=30 ekleyin."
          : undefined
    const hint = hintTenant ?? hintReach
    return NextResponse.json(
      {
        status: "error",
        databaseUrl: parsed,
        prismaMessage: message.slice(0, 500),
        ...(hint ? { hint } : {}),
      },
      { status: 503 }
    )
  }
}
