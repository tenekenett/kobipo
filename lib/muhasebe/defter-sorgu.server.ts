import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { mizanKur, type MizanSatiri } from "@/lib/muhasebe/mizan"

/**
 * DEFTER OKUMALARI — mizan, yevmiye, kebir. Hepsi YALNIZ ONAYLI fişi okur;
 * mizanda "taslaklar dahil" anahtarı taslakları da katar (ön izleme).
 *
 * Tarih aralığı gün düzeyinde ve kapsayıcıdır: `bas` 00:00 UTC, `bit` o günün
 * 00:00 UTC'si (fiş tarihleri gün başıdır — lib/muhasebe/fis.ts → istanbulGunu/utcGunu).
 */

export type DonemSecimi = {
  bas: Date | null
  bit: Date | null
  taslakDahil?: boolean
  /**
   * Dışlanacak kapanış adımları (kapanis.ts): gelir tablosu "gelir-kapanis"
   * fişini (6 → 690), 31 Aralık bilançosu "bilanco-kapanis" fişini görmemeli —
   * yoksa ikisi de sıfır basardı.
   */
  haricKapanis?: string[]
}

const kapanisSql = (d: DonemSecimi) =>
  d.haricKapanis?.length
    ? Prisma.sql`AND NOT (v."sourceType" = 'CLOSING' AND split_part(v."sourceId", ':', 2) IN (${Prisma.join(d.haricKapanis)}))`
    : Prisma.empty

const durumSql = (taslakDahil?: boolean) =>
  taslakDahil ? Prisma.sql`v.status IN ('POSTED', 'DRAFT')` : Prisma.sql`v.status = 'POSTED'`

export async function mizan(defterId: string, d: DonemSecimi): Promise<MizanSatiri[]> {
  const bas = d.bas ?? new Date(Date.UTC(1900, 0, 1))
  const bit = d.bit ?? new Date(Date.UTC(2999, 0, 1))
  const rows = await prisma.$queryRaw<
    Array<{ kod: string; db: unknown; da: unknown; pb: unknown; pa: unknown }>
  >`
    SELECT a.code AS kod,
      SUM(CASE WHEN v.date < ${bas} AND l.side = 'DEBIT' THEN l.amount ELSE 0 END) AS db,
      SUM(CASE WHEN v.date < ${bas} AND l.side = 'CREDIT' THEN l.amount ELSE 0 END) AS da,
      SUM(CASE WHEN v.date >= ${bas} AND l.side = 'DEBIT' THEN l.amount ELSE 0 END) AS pb,
      SUM(CASE WHEN v.date >= ${bas} AND l.side = 'CREDIT' THEN l.amount ELSE 0 END) AS pa
    FROM journal_voucher_lines l
    JOIN journal_vouchers v ON v.id = l."voucherId"
    JOIN account_plans a ON a.id = l."accountId"
    WHERE v."companyId" = ${defterId}
      AND ${durumSql(d.taslakDahil)}
      AND v.date <= ${bit}
      ${kapanisSql(d)}
    GROUP BY a.code
  `
  const adlar = await prisma.accountPlan.findMany({ where: { companyId: defterId }, select: { code: true, name: true } })
  return mizanKur(
    rows.map((r) => ({
      kod: r.kod,
      devirBorc: Number(r.db ?? 0),
      devirAlacak: Number(r.da ?? 0),
      donemBorc: Number(r.pb ?? 0),
      donemAlacak: Number(r.pa ?? 0),
    })),
    new Map(adlar.map((a) => [a.code, a.name])),
  )
}

/**
 * Mizana GİRMEYEN hesapsız satırlar (yalnız taslakta olur; onaylı fişte hesap zorunlu).
 * "Taslaklar dahil" ön izlemesinde bunlar olmadan borç ≠ alacak görünür — ekran farkı
 * buradan açıklar, hata saymaz.
 */
export async function mizanHesapsiz(
  defterId: string,
  d: DonemSecimi,
): Promise<{ borc: number; alacak: number; fisSayisi: number }> {
  const bit = d.bit ?? new Date(Date.UTC(2999, 0, 1))
  const rows = await prisma.$queryRaw<Array<{ b: unknown; a: unknown; n: number }>>`
    SELECT
      SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END) AS b,
      SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END) AS a,
      COUNT(DISTINCT v.id)::int AS n
    FROM journal_voucher_lines l
    JOIN journal_vouchers v ON v.id = l."voucherId"
    WHERE v."companyId" = ${defterId}
      AND ${durumSql(d.taslakDahil)}
      AND v.date <= ${bit}
      AND l."accountId" IS NULL
      ${kapanisSql(d)}
  `
  return { borc: Number(rows[0]?.b ?? 0), alacak: Number(rows[0]?.a ?? 0), fisSayisi: Number(rows[0]?.n ?? 0) }
}

export type YevmiyeMaddesi = {
  maddeNo: number
  id: string
  voucherNo: string
  tarih: string
  tur: string
  aciklama: string | null
  kaynakTipi: string
  kaynakId: string | null
  satirlar: Array<{ kod: string; ad: string; aciklama: string | null; borc: number; alacak: number }>
}

/**
 * Yevmiye — onaylı fişler tarih sırasıyla. MADDE NO yılın tamamında tarih sırasıdır
 * (aynı gün: açılış önce, sonra fiş no); dönem süzülse de numara değişmez.
 */
export async function yevmiye(
  defterId: string,
  d: DonemSecimi,
  sayfa: { atla: number; al: number },
): Promise<{ maddeler: YevmiyeMaddesi[]; toplam: number; borc: number; alacak: number }> {
  const bas = d.bas ?? new Date(Date.UTC(1900, 0, 1))
  const bit = d.bit ?? new Date(Date.UTC(2999, 0, 1))
  const sirali = await prisma.$queryRaw<Array<{ id: string; madde: number }>>`
    WITH n AS (
      SELECT v.id, v.date,
        ROW_NUMBER() OVER (
          PARTITION BY EXTRACT(YEAR FROM v.date)
          ORDER BY v.date, CASE v.kind WHEN 'ACILIS' THEN 0 WHEN 'KAPANIS' THEN 2 ELSE 1 END, v."voucherNo"
        )::int AS madde
      FROM journal_vouchers v
      WHERE v."companyId" = ${defterId} AND v.status = 'POSTED'
    )
    SELECT id, madde FROM n WHERE date >= ${bas} AND date <= ${bit}
    ORDER BY date, madde
  `
  const sayfaIds = sirali.slice(sayfa.atla, sayfa.atla + sayfa.al)
  const maddeNo = new Map(sayfaIds.map((s) => [s.id, s.madde]))
  const [fisler, toplamlar] = await Promise.all([
    prisma.journalVoucher.findMany({
      where: { id: { in: sayfaIds.map((s) => s.id) } },
      select: {
        id: true,
        voucherNo: true,
        date: true,
        kind: true,
        description: true,
        sourceType: true,
        sourceId: true,
        lines: {
          orderBy: { order: "asc" },
          select: { side: true, amount: true, description: true, account: { select: { code: true, name: true } } },
        },
      },
    }),
    prisma.$queryRaw<Array<{ b: unknown; a: unknown }>>`
      SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END) AS b,
             SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END) AS a
      FROM journal_voucher_lines l JOIN journal_vouchers v ON v.id = l."voucherId"
      WHERE v."companyId" = ${defterId} AND v.status = 'POSTED' AND v.date >= ${bas} AND v.date <= ${bit}
    `,
  ])
  const maddeler = fisler
    .map((f) => ({
      maddeNo: maddeNo.get(f.id) ?? 0,
      id: f.id,
      voucherNo: f.voucherNo,
      tarih: f.date.toISOString().slice(0, 10),
      tur: f.kind,
      aciklama: f.description,
      kaynakTipi: f.sourceType,
      kaynakId: f.sourceId,
      satirlar: f.lines.map((l) => ({
        kod: l.account?.code ?? "—",
        ad: l.account?.name ?? "",
        aciklama: l.description,
        borc: l.side === "DEBIT" ? Number(l.amount) : 0,
        alacak: l.side === "CREDIT" ? Number(l.amount) : 0,
      })),
    }))
    .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.maddeNo - b.maddeNo)
  return {
    maddeler,
    toplam: sirali.length,
    borc: Number(toplamlar[0]?.b ?? 0),
    alacak: Number(toplamlar[0]?.a ?? 0),
  }
}

export type KebirSatiri = {
  fisId: string
  voucherNo: string
  tarih: string
  aciklama: string | null
  hesapKodu: string
  borc: number
  alacak: number
  bakiye: number
}

/**
 * Kebir — bir hesabın (ve ALT HESAPLARININ) hareketleri, yürüyen bakiyeyle.
 * Bakiye borç − alacak yürür; devir dönem başından önceki toplamdır.
 */
export async function kebir(
  defterId: string,
  hesapKodu: string,
  d: DonemSecimi,
): Promise<{ hesap: { kod: string; ad: string } | null; devir: number; satirlar: KebirSatiri[]; borc: number; alacak: number }> {
  const hesap = await prisma.accountPlan.findUnique({
    where: { companyId_code: { companyId: defterId, code: hesapKodu } },
    select: { code: true, name: true },
  })
  if (!hesap) return { hesap: null, devir: 0, satirlar: [], borc: 0, alacak: 0 }
  const bas = d.bas ?? new Date(Date.UTC(1900, 0, 1))
  const bit = d.bit ?? new Date(Date.UTC(2999, 0, 1))
  // Kapsam: hesabın kendisi + noktalı alt hesapları; sınıf/grup (1–2 hane) ise o önekle başlayan hepsi.
  const kapsam =
    hesapKodu.length < 3 && !hesapKodu.includes(".")
      ? Prisma.sql`a.code LIKE ${`${hesapKodu}%`}`
      : Prisma.sql`(a.code = ${hesapKodu} OR a.code LIKE ${`${hesapKodu}.%`})`
  const [devirRow, hareketler] = await Promise.all([
    prisma.$queryRaw<Array<{ b: unknown }>>`
      SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END) AS b
      FROM journal_voucher_lines l
      JOIN journal_vouchers v ON v.id = l."voucherId"
      JOIN account_plans a ON a.id = l."accountId"
      WHERE v."companyId" = ${defterId} AND v.status = 'POSTED' AND v.date < ${bas} AND ${kapsam}
    `,
    prisma.$queryRaw<
      Array<{ id: string; no: string; date: Date; vd: string | null; ld: string | null; kod: string; side: string; amount: unknown }>
    >`
      SELECT v.id, v."voucherNo" AS no, v.date, v.description AS vd, l.description AS ld, a.code AS kod, l.side, l.amount
      FROM journal_voucher_lines l
      JOIN journal_vouchers v ON v.id = l."voucherId"
      JOIN account_plans a ON a.id = l."accountId"
      WHERE v."companyId" = ${defterId} AND v.status = 'POSTED'
        AND v.date >= ${bas} AND v.date <= ${bit} AND ${kapsam}
      ORDER BY v.date, CASE v.kind WHEN 'ACILIS' THEN 0 WHEN 'KAPANIS' THEN 2 ELSE 1 END, v."voucherNo", l."order"
      LIMIT 5000
    `,
  ])
  const devir = Number(devirRow[0]?.b ?? 0)
  let bakiye = devir
  let borc = 0
  let alacak = 0
  const satirlar = hareketler.map((h) => {
    const tutar = Number(h.amount)
    const b = h.side === "DEBIT" ? tutar : 0
    const a = h.side === "CREDIT" ? tutar : 0
    borc += b
    alacak += a
    bakiye = Math.round((bakiye + b - a) * 100) / 100
    return {
      fisId: h.id,
      voucherNo: h.no,
      tarih: h.date.toISOString().slice(0, 10),
      aciklama: [h.vd, h.ld && h.ld !== h.vd ? h.ld : null].filter(Boolean).join(" — ") || null,
      hesapKodu: h.kod,
      borc: b,
      alacak: a,
      bakiye,
    }
  })
  return { hesap: { kod: hesap.code, ad: hesap.name }, devir, satirlar, borc, alacak }
}

/**
 * Mali tabloların iki mizanı — ekran ucu (`/api/muhasebe/mali-tablolar`) ve dışa aktarım
 * (`lib/export/datasets/muhasebe.ts`) AYNI tanımı kullanır, dosya ekrandan ayrışmasın.
 *
 * Bilanço `bit` itibarıyla bakiyedir; yıl sonu kapanış ve ertesi yıl açılış fişi birbirini tam
 * götürür, ikisi birlikte dışlanır (yalnız kapanış dışlansaydı ertesi yıla uzanan dönemde açılış
 * bakiyeleri iki kez sayılırdı). Gelir tablosu dönem hareketidir; "gelir-kapanis" (6 → 690)
 * dışlanır, yoksa sıfır basardı.
 */
export async function maliTabloMizanlari(defterId: string, d: { bas: Date; bit: Date; taslakDahil: boolean }) {
  const bilancoDonemi: DonemSecimi = { bas: null, bit: d.bit, taslakDahil: d.taslakDahil, haricKapanis: ["bilanco-kapanis", "acilis"] }
  const [bilancoMizani, donemMizani, hesapsiz] = await Promise.all([
    mizan(defterId, bilancoDonemi),
    mizan(defterId, { bas: d.bas, bit: d.bit, taslakDahil: d.taslakDahil, haricKapanis: ["gelir-kapanis"] }),
    d.taslakDahil ? mizanHesapsiz(defterId, bilancoDonemi) : null,
  ])
  return { bilancoMizani, donemMizani, hesapsiz }
}
