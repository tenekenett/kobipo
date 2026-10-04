import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { gunParam, jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { kilitliMi } from "@/lib/muhasebe/defter.server"
import { fisSekmesiMi, komsuFisler } from "@/lib/muhasebe/fis-liste.server"
import {
  FisHatasi,
  fisGeriAl,
  fisOnayla,
  fisYenidenUret,
  onayEngeli,
  satirHesaplariniDegistir,
  taslaklariYenidenCoz,
} from "@/lib/muhasebe/onay.server"
import { acilisElleSatirlariKaydet, elleFisKaydet, elleFisSil, elleSatirlariAyikla } from "@/lib/muhasebe/manuel.server"
import { ACILIS_KAYNAGI } from "@/lib/muhasebe/acilis.server"
import { kaynakBilgisi } from "@/lib/muhasebe/kaynak-bilgisi.server"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Tek fiş — odak görünümü.
 *
 * GET    ?companyId&sekme       → fiş + satırlar + kaynak belge + sekmedeki komşular
 * PUT    { companyId, satirHesaplari: [{satirId, accountId}] }  → taslakta hesap seç
 *        { companyId, elleSatirlar: [...] }                       → açılış fişinin elle satırları
 *        { companyId, tarih, aciklama, satirlar: [...] }          → elle fişi düzenle
 * POST   { companyId, islem: "onayla" | "geri-al" | "yeniden-uret" }
 * DELETE ?companyId             → elle fişi sil (yalnız taslak)
 */
export const GET = muhasebeUcu(async (request: Request, { params }: Params) => {
  const { id } = await params
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const fis = await prisma.journalVoucher.findFirst({
    where: { id, companyId: defter.defterId },
    select: {
      id: true,
      voucherNo: true,
      date: true,
      description: true,
      kind: true,
      status: true,
      isConfident: true,
      sourceType: true,
      sourceId: true,
      sourceCompanyId: true,
      sourceChangedAt: true,
      approvedAt: true,
      approvedBy: true,
      lines: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          side: true,
          amount: true,
          role: true,
          description: true,
          suggestedCode: true,
          accountSource: true,
          learnKeys: true,
          accountId: true,
          account: { select: { id: true, code: true, name: true, isActive: true, _count: { select: { children: true } } } },
        },
      },
    },
  })
  if (!fis) throw new FisHatasi("Fiş bulunamadı", 404)
  const hamSekme = sp.get("sekme")
  const kilitli = kilitliMi(defter.ayar, fis.date)
  const [kaynak, komsu, onaylayan] = await Promise.all([
    kaynakBilgisi(fis.sourceType, fis.sourceId),
    fisSekmesiMi(hamSekme) ? komsuFisler(defter.defterId, fis.id, hamSekme) : null,
    fis.approvedBy ? prisma.user.findUnique({ where: { id: fis.approvedBy }, select: { name: true, email: true } }) : null,
  ])
  return NextResponse.json({
    fis: {
      id: fis.id,
      voucherNo: fis.voucherNo,
      tarih: fis.date.toISOString().slice(0, 10),
      aciklama: fis.description,
      tur: fis.kind,
      durum: fis.status,
      emin: fis.isConfident,
      kaynakTipi: fis.sourceType,
      kaynakId: fis.sourceId,
      degisti: fis.sourceChangedAt != null,
      onayTarihi: fis.approvedAt?.toISOString() ?? null,
      onaylayan: onaylayan ? onaylayan.name || onaylayan.email : null,
      kilitli,
      elle: fis.sourceType === "MANUAL",
      acilis: fis.sourceType === ACILIS_KAYNAGI,
    },
    satirlar: fis.lines.map((l) => ({
      id: l.id,
      taraf: l.side === "DEBIT" ? "B" : "A",
      tutar: Number(l.amount),
      rol: l.role,
      aciklama: l.description,
      oneriKodu: l.suggestedCode,
      kaynak: l.accountSource,
      ogrenir: l.learnKeys.length > 0,
      hesap: l.account
        ? {
            id: l.account.id,
            kod: l.account.code,
            ad: l.account.name,
            uygun: l.account.isActive && l.account._count.children === 0,
          }
        : null,
    })),
    kaynak: kaynak ? { ...kaynak, sirketId: fis.sourceCompanyId ?? defter.defterId } : null,
    komsu,
    engel: fis.status === "DRAFT" ? onayEngeli({ status: fis.status, kilitli, lines: fis.lines }) : null,
  })
})

export const PUT = muhasebeUcu(async (request: Request, { params }: Params) => {
  const { id } = await params
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  if (Array.isArray(body.satirHesaplari)) {
    const degisiklikler = (body.satirHesaplari as Array<Record<string, unknown>>).map((d) => ({
      satirId: String(d.satirId ?? ""),
      accountId: typeof d.accountId === "string" && d.accountId ? d.accountId : null,
    }))
    await satirHesaplariniDegistir(defter, id, degisiklikler)
  } else if (Array.isArray(body.elleSatirlar)) {
    await acilisElleSatirlariKaydet(defter, id, elleSatirlariAyikla(body.elleSatirlar))
  } else if (Array.isArray(body.satirlar)) {
    const tarih = gunParam(body.tarih, "Tarih")
    if (!tarih) throw new FisHatasi("Fiş tarihi seçin.")
    await elleFisKaydet(
      defter,
      { fisId: id, tarih, aciklama: String(body.aciklama ?? ""), satirlar: elleSatirlariAyikla(body.satirlar) },
      kullaniciId,
    )
  } else {
    throw new FisHatasi("Değişiklik yok.")
  }
  return NextResponse.json({ ok: true })
})

export const POST = muhasebeUcu(async (request: Request, { params }: Params) => {
  const { id } = await params
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  switch (body.islem) {
    case "onayla": {
      const { ogrenilen } = await fisOnayla(defter, id, kullaniciId)
      // Öğrenilen eşleşme bekleyen taslaklara hemen yayılır.
      const yayilan = ogrenilen.length ? await taslaklariYenidenCoz(defter.defterId) : 0
      return NextResponse.json({ ok: true, ogrenilen: ogrenilen.length, yayilan })
    }
    case "geri-al":
      await fisGeriAl(defter, id)
      return NextResponse.json({ ok: true })
    case "yeniden-uret":
      return NextResponse.json({ ok: true, ...(await fisYenidenUret(defter, id)) })
    default:
      throw new FisHatasi("Bilinmeyen işlem.")
  }
})

export const DELETE = muhasebeUcu(async (request: Request, { params }: Params) => {
  const { id } = await params
  const { ctx } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"), { yazma: true })
  await elleFisSil(kuruluDefter(ctx), id)
  return NextResponse.json({ ok: true })
})
