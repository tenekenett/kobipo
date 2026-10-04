import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { topluOnayla } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Toplu onay — YALNIZ "emin" taslaklar (plan §2.5). Gövde `ids` verirse onlar,
 * vermezse TÜM emin taslaklar (tek istekte en çok 500; `kalan` > 0 ise istemci tekrarlar).
 */
export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).map(String).slice(0, 500)
    : (
        await prisma.journalVoucher.findMany({
          where: { companyId: defter.defterId, status: "DRAFT", isConfident: true },
          orderBy: [{ date: "asc" }, { voucherNo: "asc" }],
          select: { id: true },
          take: 500,
        })
      ).map((f) => f.id)
  const sonuc = await topluOnayla(defter, ids, kullaniciId)
  const kalan = await prisma.journalVoucher.count({
    where: { companyId: defter.defterId, status: "DRAFT", isConfident: true },
  })
  return NextResponse.json({ ...sonuc, kalan })
})
