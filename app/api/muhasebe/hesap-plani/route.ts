import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { FisHatasi, taslaklariYenidenCoz } from "@/lib/muhasebe/onay.server"
import { altKodHatasi, hesapDuzeyi, hesapTuruKoddan, onerilenAltKod } from "@/lib/muhasebe/hesap-plani"
import { kodKarsilastir } from "@/lib/muhasebe/mizan"

export const dynamic = "force-dynamic"

/**
 * Hesap planı (plan §2.4, §2.6).
 *
 * GET    ?companyId&yaprak=1   → hesaplar (kod sırasıyla, yaprak/aktif bilgisiyle);
 *                                `yaprak=1` yalnız fişe yazılabilenler (hesap seçici)
 * POST   { companyId, ustKod, kod?, ad } → alt hesap aç (kod verilmezse sıradaki)
 * PATCH  { companyId, id, ad?, aktif? }  → ad değiştir / pasifleştir
 * DELETE ?companyId&id                   → kullanılmamış, altı olmayan alt hesabı sil
 *
 * Yeni alt hesap üst hesabı yaprak OLMAKTAN çıkarır: ona yazılmış taslak satırlar
 * yeniden çözülür (hesapsız kalır, kullanıcı alt hesabı seçer). Onaylı fiş satırı
 * olan bir hesabın altına hesap açılamaz — mizanda ana hesapta bakiye kalırdı.
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const hesaplar = await prisma.accountPlan.findMany({
    where: { companyId: defter.defterId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isActive: true,
      parentId: true,
      customerId: true,
      supplierId: true,
      employeeId: true,
      financialAccountId: true,
      _count: { select: { children: true, voucherLines: true } },
    },
  })
  const yaprakIste = sp.get("yaprak") === "1"
  const liste = hesaplar
    .map((h) => ({
      id: h.id,
      kod: h.code,
      ad: h.name,
      tur: h.type,
      duzey: hesapDuzeyi(h.code),
      aktif: h.isActive,
      yaprak: h._count.children === 0,
      kullanim: h._count.voucherLines,
      bagli: h.customerId ? "musteri" : h.supplierId ? "tedarikci" : h.employeeId ? "personel" : h.financialAccountId ? "finans" : null,
    }))
    .filter((h) => !yaprakIste || (h.yaprak && h.aktif && h.duzey >= 3))
    .sort((a, b) => kodKarsilastir(a.kod, b.kod))
  return NextResponse.json({ hesaplar: liste })
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const ustKod = String(body.ustKod ?? "").trim()
  const ad = String(body.ad ?? "").trim().slice(0, 190)
  if (!ad) throw new FisHatasi("Hesap adı girin.")
  const ust = await prisma.accountPlan.findUnique({
    where: { companyId_code: { companyId: defter.defterId, code: ustKod } },
    select: { id: true, code: true, children: { select: { code: true } } },
  })
  if (!ust) throw new FisHatasi("Üst hesap bulunamadı.")
  const kod = String(body.kod ?? "").trim() || onerilenAltKod(ust.code, ust.children.map((c) => c.code))
  const hata = altKodHatasi(ust.code, kod)
  if (hata) throw new FisHatasi(hata)
  if (ust.children.length === 0) {
    const onayli = await prisma.journalVoucherLine.count({
      where: { accountId: ust.id, voucher: { status: "POSTED" } },
    })
    if (onayli > 0) {
      throw new FisHatasi(
        `${ust.code} hesabına yazılmış ${onayli} onaylı fiş satırı var. Alt hesap açılırsa bakiye ana hesapta kalır; önce o fişleri geri alıp alt hesaba taşıyın.`,
        409,
      )
    }
  }
  const mevcut = await prisma.accountPlan.findUnique({
    where: { companyId_code: { companyId: defter.defterId, code: kod } },
    select: { id: true },
  })
  if (mevcut) throw new FisHatasi(`${kod} kodlu hesap zaten var.`, 409)
  const yeni = await prisma.accountPlan.create({
    data: {
      companyId: defter.defterId,
      code: kod,
      name: ad,
      type: hesapTuruKoddan(kod),
      level: hesapDuzeyi(kod),
      parentId: ust.id,
    },
    select: { id: true, code: true, name: true },
  })
  // Üst hesap artık yaprak değil: ona düşen taslak satırlar yeniden çözülür.
  await taslaklariYenidenCoz(defter.defterId)
  return NextResponse.json({ hesap: { id: yeni.id, kod: yeni.code, ad: yeni.name } }, { status: 201 })
})

export const PATCH = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const hesap = await prisma.accountPlan.findFirst({
    where: { id: String(body.id ?? ""), companyId: defter.defterId },
    select: { id: true, code: true },
  })
  if (!hesap) throw new FisHatasi("Hesap bulunamadı", 404)
  const data: { name?: string; isActive?: boolean } = {}
  if (typeof body.ad === "string") {
    const ad = body.ad.trim().slice(0, 190)
    if (!ad) throw new FisHatasi("Hesap adı boş olamaz.")
    data.name = ad
  }
  if (typeof body.aktif === "boolean") data.isActive = body.aktif
  if (Object.keys(data).length === 0) throw new FisHatasi("Değişiklik yok.")
  await prisma.accountPlan.update({ where: { id: hesap.id }, data })
  if (data.isActive !== undefined) await taslaklariYenidenCoz(defter.defterId)
  return NextResponse.json({ ok: true })
})

export const DELETE = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"), { yazma: true })
  const defter = kuruluDefter(ctx)
  const hesap = await prisma.accountPlan.findFirst({
    where: { id: sp.get("id") ?? "", companyId: defter.defterId },
    select: {
      id: true,
      code: true,
      customerId: true,
      supplierId: true,
      employeeId: true,
      financialAccountId: true,
      _count: { select: { children: true, voucherLines: true } },
    },
  })
  if (!hesap) throw new FisHatasi("Hesap bulunamadı", 404)
  if (!hesap.code.includes(".")) throw new FisHatasi("Tekdüzen hesapları silinmez; kullanmıyorsanız pasife alın.")
  if (hesap._count.children > 0) throw new FisHatasi("Alt hesabı olan hesap silinemez.")
  if (hesap._count.voucherLines > 0) throw new FisHatasi("Fişte kullanılmış hesap silinemez; pasife alın.")
  if (hesap.customerId || hesap.supplierId || hesap.employeeId || hesap.financialAccountId) {
    throw new FisHatasi("Bir kayda (cari / kasa / personel) bağlı alt hesap silinmez; fiş üretimi yeniden açar.")
  }
  await prisma.$transaction([
    prisma.accountMappingRule.deleteMany({ where: { accountId: hesap.id } }),
    prisma.accountPlan.delete({ where: { id: hesap.id } }),
  ])
  await taslaklariYenidenCoz(defter.defterId)
  return NextResponse.json({ ok: true })
})
