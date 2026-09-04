/**
 * Asistanın CARİ tarafındaki okumaları.
 *
 * Vadesi geçmiş alacak/borç KENDİ SORGUSUYLA hesaplanmaz: `computeCariAging`
 * çağrılır. Sebebi cari ekstresinin öğrettiği ders — ekstre kendi kovalarını
 * hesaplarken vadeyi değil belge tarihini ölçüyordu ve aynı cari için ekstre ile
 * rapor farklı "vadesi geçmiş" rakamı gösteriyordu. Asistan üçüncü bir rakam
 * üreten yer olmayacak.
 *
 * Yaşlandırma satış TASLAKLARINI da eler (kesilmemiş belge alacak değildir) —
 * bu ayıklamayı burada tekrar etmek yerine devralıyoruz.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { computeCariAging, type AgingAccount } from "@/lib/raporlar/cari-yaslandirma"
import { bugunBasi, gunFarki, gunOnce, sayi } from "./temel"
import { hatirla, type IstekOnbellegi } from "./onbellek"

/**
 * Yaşlandırmayı istek başına BİR KEZ hesaplar. Aşağıdaki üç fonksiyon da bunu
 * çağırır; önbellek verilmezse davranış eskisi gibi (her çağrı yeniden hesaplar).
 */
function yaslandirma(companyId: string, onbellek?: IstekOnbellegi) {
  return hatirla(onbellek, `yaslandirma:${companyId}`, () => computeCariAging(companyId))
}

export type VadeSatiri = {
  id: string
  ad: string
  kod: string | null
  /** Vadesi geçmiş toplam. Yaşlandırmanın kendi türettiği `overdue` alanı. */
  gecikenTutar: number
  /** En eski geciken belgenin gecikme günü — aciliyetin gerçek ölçüsü. */
  enEskiGun: number
  belgeSayisi: number
}

/**
 * Vadesi geçmiş alacaklar (taraf="musteri") veya borçlar (taraf="tedarikci").
 *
 * Sıralama TUTARA göre değil, tutar × gecikme ağırlığına göre yapılmıyor —
 * düpedüz tutara göre. Denendi: gecikme ağırlıklı sıralama 90 gün gecikmiş 300
 * TL'yi 5 gün gecikmiş 80.000 TL'nin üstüne çıkarıyor ve kullanıcı listenin
 * başındaki satırı ciddiye almayı bırakıyor. Gecikme günü ayrı sütunda durur.
 */
export async function vadesiGecenler(
  companyId: string,
  taraf: "musteri" | "tedarikci",
  limit = 15,
  onbellek?: IstekOnbellegi
): Promise<VadeSatiri[]> {
  const aging = await yaslandirma(companyId, onbellek)
  const hesaplar = taraf === "musteri" ? aging.customers.accounts : aging.suppliers.accounts

  return hesaplar
    .map((h) => {
      // Gecikme ölçüsü belgenin KENDİ alanından okunur (`overdueDays`), burada
      // vade aritmetiği tekrarlanmaz: yaşlandırma vadeyi fatura vadesi VEYA cari
      // kartındaki vade gününden türetiyor (`effectiveDueDate`) ve bunu burada
      // yeniden kurmak, vadesiz faturaları olan firmalarda iki farklı gün sayısı
      // üretirdi.
      const gecikenler = h.invoices.filter((f) => f.overdueDays > 0 && f.openAmount > 0.01)
      const enEski = gecikenler.reduce((max, f) => (f.overdueDays > max ? f.overdueDays : max), 0)
      return {
        id: h.id,
        ad: h.name,
        kod: h.code,
        gecikenTutar: h.totals.overdue,
        enEskiGun: enEski,
        belgeSayisi: gecikenler.length,
      }
    })
    .filter((r) => r.gecikenTutar > 0.01)
    .sort((a, b) => b.gecikenTutar - a.gecikenTutar)
    .slice(0, limit)
}

export type KaybolanMusteriSatiri = {
  id: string
  ad: string
  kod: string | null
  /** Son satış faturasının üzerinden geçen gün. */
  sessizGun: number
  /** Bu müşterinin ALIŞKANLIĞI: faturalar arası ortalama gün. */
  ortalamaAralik: number
  faturaSayisi: number
  /** Müşterinin toplam geçmiş cirosu — "kaybetmeye değer mi" ölçüsü. */
  toplamCiro: number
}

/**
 * Düzenli alan ama SUSAN müşteriler.
 *
 * Sabit bir gün eşiği ("90 gündür almadı") burada işe yaramaz: ayda bir alan
 * müşteri için 90 gün alarmdır, yılda bir alan için normaldir. Bu yüzden ölçü
 * müşterinin KENDİ alışkanlığı — faturalar arası ortalama aralığın 2 katından
 * fazla sessizlik.
 *
 * En az 3 fatura şartı var: iki faturadan çıkan "ortalama aralık" tek bir
 * gözlemdir, alışkanlık değil. Tek kez alıp bir daha gelmeyen müşteri de
 * kaybolmuş sayılmaz — hiç müşteri olmamıştır.
 */
export async function kaybolanMusteriler(
  companyId: string,
  limit = 15
): Promise<KaybolanMusteriSatiri[]> {
  const bugun = bugunBasi()

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      name: string
      code: string | null
      fatura_sayisi: unknown
      son_tarih: Date
      ilk_tarih: Date
      toplam_ciro: unknown
    }>
  >(Prisma.sql`
    SELECT c.id, c.name, c.code,
           COUNT(i.id) AS fatura_sayisi,
           MAX(i.date) AS son_tarih,
           MIN(i.date) AS ilk_tarih,
           SUM(i."totalAmount") AS toplam_ciro
    FROM customers c
    JOIN invoices i ON i."customerId" = c.id
    WHERE c."companyId" = ${companyId}
      AND c."archivedAt" IS NULL
      AND i."companyId" = ${companyId}
      AND i.type = 'SALES'
      AND i.status NOT IN ('CANCELLED', 'CONVERTED', 'DRAFT', 'GIB_DRAFT')
    GROUP BY c.id, c.name, c.code
    HAVING COUNT(i.id) >= 3
    ORDER BY SUM(i."totalAmount") DESC
    LIMIT 500
  `)

  return rows
    .map((r) => {
      const faturaSayisi = sayi(r.fatura_sayisi)
      const ilk = new Date(r.ilk_tarih)
      const son = new Date(r.son_tarih)
      // Aralık sayısı = fatura sayısı − 1 (n faturanın arasında n−1 boşluk var).
      const ortalamaAralik = gunFarki(son, ilk) / Math.max(faturaSayisi - 1, 1)
      return {
        id: r.id,
        ad: r.name,
        kod: r.code,
        sessizGun: gunFarki(bugun, son),
        ortalamaAralik,
        faturaSayisi,
        toplamCiro: sayi(r.toplam_ciro),
      }
    })
    .filter((r) => r.ortalamaAralik > 0 && r.sessizGun > r.ortalamaAralik * 2)
    .sort((a, b) => b.toplamCiro - a.toplamCiro)
    .slice(0, limit)
}

export type CariKarti = {
  id: string
  ad: string
  kod: string | null
  taraf: "musteri" | "tedarikci"
  /** Yaşlandırmadan gelen net bakiye (alacak + / borç +, tarafa göre). */
  bakiye: number
  gecikenTutar: number
  sonIslem: Date | null
}

/**
 * Ada göre cari arar — model cariyi adıyla soruyor, id'yi bilmiyor.
 *
 * Arama SQL'de değil bellekte: yaşlandırma zaten firmanın tüm carilerini
 * bakiyeleriyle getiriyor, ikinci bir sorgu atmak hem gereksiz hem de bakiyeyi
 * ikinci bir formülle hesaplama riski demek. Cari sayısı binleri bulan firmada
 * bile bu, tek geçişlik bir filtre.
 */
export async function cariAra(
  companyId: string,
  sorgu: string,
  limit = 8,
  onbellek?: IstekOnbellegi
): Promise<CariKarti[]> {
  const aranan = sorgu.trim().toLocaleLowerCase("tr")
  if (!aranan) return []
  const aging = await yaslandirma(companyId, onbellek)

  const eslesenler: CariKarti[] = []
  const ekle = (hesaplar: AgingAccount[], taraf: "musteri" | "tedarikci") => {
    for (const h of hesaplar) {
      const ad = h.name.toLocaleLowerCase("tr")
      const kod = (h.code ?? "").toLocaleLowerCase("tr")
      if (!ad.includes(aranan) && !kod.includes(aranan)) continue
      const sonIslem = h.invoices.reduce<Date | null>((en, f) => {
        const t = new Date(f.date)
        return en == null || t > en ? t : en
      }, null)
      eslesenler.push({
        id: h.id,
        ad: h.name,
        kod: h.code,
        taraf,
        bakiye: h.totals.total ?? 0,
        gecikenTutar: h.totals.overdue,
        sonIslem,
      })
    }
  }
  ekle(aging.customers.accounts, "musteri")
  ekle(aging.suppliers.accounts, "tedarikci")

  return eslesenler.sort((a, b) => Math.abs(b.bakiye) - Math.abs(a.bakiye)).slice(0, limit)
}

export type VadeliEvrakSatiri = {
  tur: "cek" | "senet"
  no: string
  tutar: number
  vade: Date
  kalanGun: number
  yon: "alinan" | "verilen"
  karsiTaraf: string | null
}

/**
 * Portföydeki çek/senetlerin yaklaşan vadeleri.
 *
 * `direction` NULL olabilir (sütun eklenmeden önceki kayıtlar); şemadaki kural
 * aynen uygulanır: müşteriye bağlıysa alınan, tedarikçiye bağlıysa verilen.
 * Yön olmadan uyarı yanlış yöne bakar — "3 gün sonra 40.000 TL girecek" ile
 * "3 gün sonra 40.000 TL çıkacak" arasındaki fark nakit planının kendisidir.
 */
export async function yaklasanVadeliEvrak(
  companyId: string,
  gunPenceresi = 14,
  limit = 20
): Promise<VadeliEvrakSatiri[]> {
  const bugun = bugunBasi()
  const son = new Date(bugun)
  son.setUTCDate(son.getUTCDate() + gunPenceresi)

  const [cekler, senetler] = await Promise.all([
    prisma.check.findMany({
      where: {
        companyId,
        status: "PORTFÖYDE",
        dueDate: { gte: bugun, lt: son },
      },
      select: {
        checkNo: true,
        amount: true,
        dueDate: true,
        direction: true,
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: limit,
    }),
    prisma.promissoryNote.findMany({
      where: {
        companyId,
        status: "PORTFÖYDE",
        dueDate: { gte: bugun, lt: son },
      },
      select: {
        noteNo: true,
        amount: true,
        dueDate: true,
        direction: true,
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: limit,
    }),
  ])

  const yonBul = (
    direction: string | null,
    musteri: { name: string } | null,
    tedarikci: { name: string } | null
  ): "alinan" | "verilen" => {
    if (direction === "RECEIVED") return "alinan"
    if (direction === "GIVEN") return "verilen"
    return musteri ? "alinan" : tedarikci ? "verilen" : "alinan"
  }

  const satirlar: VadeliEvrakSatiri[] = [
    ...cekler.map((c) => ({
      tur: "cek" as const,
      no: c.checkNo,
      tutar: sayi(c.amount),
      vade: c.dueDate,
      kalanGun: gunFarki(c.dueDate, bugun),
      yon: yonBul(c.direction, c.customer, c.supplier),
      karsiTaraf: c.customer?.name ?? c.supplier?.name ?? null,
    })),
    ...senetler.map((s) => ({
      tur: "senet" as const,
      no: s.noteNo,
      tutar: sayi(s.amount),
      vade: s.dueDate,
      kalanGun: gunFarki(s.dueDate, bugun),
      yon: yonBul(s.direction, s.customer, s.supplier),
      karsiTaraf: s.customer?.name ?? s.supplier?.name ?? null,
    })),
  ]

  return satirlar.sort((a, b) => a.vade.getTime() - b.vade.getTime()).slice(0, limit)
}

/** Nakit/banka bakiyelerinin toplamı ve negatife düşen hesaplar. */
export async function nakitDurumu(companyId: string) {
  const hesaplar = await prisma.financialAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, type: true, balance: true, currency: true, slug: true },
    orderBy: { balance: "asc" },
  })

  const tl = hesaplar.filter((h) => h.currency === "TRY")
  return {
    toplamTL: tl.reduce((t, h) => t + sayi(h.balance), 0),
    negatifler: hesaplar
      .filter((h) => sayi(h.balance) < 0)
      .map((h) => ({
        id: h.id,
        slug: h.slug,
        ad: h.name,
        tur: h.type,
        bakiye: sayi(h.balance),
        paraBirimi: h.currency,
      })),
    hesaplar: hesaplar.map((h) => ({
      ad: h.name,
      tur: h.type,
      bakiye: sayi(h.balance),
      paraBirimi: h.currency,
    })),
  }
}

/**
 * Son N günde satış faturalarına işlenen tahsilat toplamı.
 *
 * Alan adı `paymentDate` — `date` DEĞİL (fatura tarihinden ayrı bir eksen:
 * ödeme, faturadan aylar sonra girilebilir ve nakit sorusunun cevabı ödemenin
 * kendi tarihidir).
 */
export async function sonTahsilatToplami(companyId: string, gunSayisi = 30): Promise<number> {
  const baslangic = gunOnce(gunSayisi)
  const toplam = await prisma.invoicePayment.aggregate({
    where: { invoice: { companyId, type: "SALES" }, paymentDate: { gte: baslangic } },
    _sum: { amount: true },
  })
  return sayi(toplam._sum?.amount)
}
