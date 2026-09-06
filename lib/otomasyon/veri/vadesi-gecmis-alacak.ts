/**
 * K-THS-07 · "₺X alacağınızın vadesi geçti — en uzunu N gündür bekliyor."
 *
 * ── Neden yeni bir kod, neden K-THS-04 değil ────────────────────────────────
 * Katalogdaki K-THS-04'ün tetiği "vade geçti VE hiç hatırlatma kaydı yok".
 * Hatırlatma kaydı tutan bir tablo bu üründe yok; kartı o kodla yazmak, ileride
 * hatırlatma geldiğinde AYNI kodun farklı bir soruyu ölçmesi demek olurdu ve
 * biriken geçmiş anlamsızlaşırdı (kod şeması kuralı, KATALOG §3). K-THS-04
 * yerinde duruyor; bugün ölçülebilen kısım ayrı bir kodla yazıldı.
 *
 * ── Vade nereden geliyor: TÜRETME ───────────────────────────────────────────
 * `Invoice.dueDate` canlı veride 302 satış faturasının yalnız 16'sında dolu (%5).
 * Kart buna bağlansaydı pratikte hiç çıkmazdı. `Customer.paymentDueDays` ise 348
 * müşterinin 168'inde dolu; fatura tarihine eklenince kapsam 16 → 53 faturaya
 * çıkıyor. Katalogun veri giriş kuralının birinci basamağı bu: "Ayarlar ekranına
 * konan alan, doldurulmayan alandır" — sayı, işletmenin zaten girdiği şeyden
 * türetilir. Kart hangi vadeyi kullandığını SÖYLER, sessizce varsaymaz.
 *
 * ── En kritik süzgeç: TUTAR CARİ BAKİYEDEN GELİR ────────────────────────────
 * ÖLÇÜM (2026-09-06): faturanın kendi ödeme kayıtlarına (`invoice_payments`)
 * bakan bir sürüm, gecikmiş görünen 4 müşterinin İKİSİNDE yanılıyordu — para
 * tahsil edilmiş ama tahsilat faturaya değil CARİYE işlenmişti:
 *
 *   DENTAŞ            açık fatura ₺21.600  ·  cari tahsilat ₺21.600  → ödenmiş
 *   UMUT YAŞAR KÜSMEN açık fatura  ₺8.000  ·  cari tahsilat  ₺8.000  → ödenmiş
 *   earsin sinar      5 gecikmiş fatura    ·  cari bakiye −₺78.365   → fazla ödemiş
 *
 * Yani "faturası ödenmemiş" ile "bize borcu var" aynı şey değil. Ölçü, cari
 * ekranının kullandığı bakiyenin TA KENDİSİDİR (`lib/cari/list-query.ts`):
 * fatura + fatura ödemesi + cari tahsilat/ödeme + çek/senet + açılış bakiyesi.
 * İkinci bir formül yazmak, kartın "borcu var" derken ekstrenin "kapalı" demesi
 * demek olurdu. Süzgeçten sonra 3 firmadan 2'si kalıyor ve ikisi de doğru.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { fetchCustomerList } from "@/lib/cari/list-query"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Vadesi bugün dolan fatura gecikmiş değildir. */
export const GECIKME_GUN = 1

/**
 * Bir firmadan en fazla kaç müşteri kartı çıkar.
 *
 * Kart müşteri BAŞINA üretilir — aksiyon ("bu kişiyi ara") ve karşı taraf
 * müşteriye özel. Ama pano toplam üç kart basıyor; sınır olmasaydı tek bir
 * firmanın alacak listesi bütün bütçeyi yiyip stok ve belge kartlarını
 * ekrandan düşürürdü. Kalanlar en büyük bakiyeden sonra gelir.
 */
export const MAX_MUSTERI = 2

export type GecikmisAlacak = {
  musteriId: string
  slug: string | null
  ad: string
  yetkili: string | null
  telefon: string | null
  /** Cari bakiye — ekstrenin gösterdiği tutarın aynısı. */
  bakiye: number
  faturaAdet: number
  /** En eski gecikmiş faturanın kaç gün geçtiği. */
  gecikmeGun: number
  /** Vade alandan mı okundu, müşterinin vade gününden mi türetildi? */
  vadeKaynagi: "alan" | "turetildi"
  /** Türetmede kullanılan gün sayısı (kaynak "turetildi" ise dolu). */
  vadeGunu: number | null
}

type Satir = {
  id: string
  fatura: bigint
  gecikme: unknown
  alandan: boolean
  vade_gunu: number | null
}

/**
 * Vadesi geçmiş faturası OLAN ve cari bakiyesi hâlâ borçlu olan müşteriler.
 *
 * İki adım bilinçli olarak ayrı: gecikmeyi faturalar söyler, borcu cari bakiye
 * söyler. Tek sorguda birleştirmek, yukarıdaki bakiye formülünü (yedi kaynak)
 * buraya kopyalamak olurdu.
 */
export async function vadesiGecmisAlacaklar(companyId: string): Promise<GecikmisAlacak[]> {
  // Gün sınırı SQL'de değil burada çiziliyor: `make_interval` Prisma'nın bigint
  // parametresini almıyor ve kod tabanının her yerinde gün sınırı `gunOnce` ile
  // (İstanbul takvim günü → UTC 00:00) çiziliyor. Aynı tuzak
  // `islenmemis-fatura.ts`te de not edilmiş; ikinci bir tarih ekseni açmak,
  // kartın saydığı günle raporun saydığı günü ayırırdı.
  const sinir = gunOnce(GECIKME_GUN)

  const rows = await prisma.$queryRaw<Satir[]>(Prisma.sql`
    WITH vadeli AS (
      SELECT i."customerId" AS cid,
             -- Sütun parametre değil; buradaki make_interval int alıyor ve çalışır.
             COALESCE(i."dueDate", i.date + make_interval(days => cu."paymentDueDays"::int)) AS vade,
             i."dueDate" IS NOT NULL AS alandan,
             cu."paymentDueDays" AS vade_gunu
      FROM invoices i
      JOIN customers cu ON cu.id = i."customerId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status = 'SENT'
        -- Fiş peşin satıştır, vadesi yoktur; fatura listesi de onu ayrı tutuyor.
        AND NOT i."isReceipt"
        AND cu."archivedAt" IS NULL
    )
    SELECT cid AS id,
           COUNT(*)                                              AS fatura,
           MAX(EXTRACT(EPOCH FROM (now() - vade)) / 86400)        AS gecikme,
           BOOL_OR(alandan)                                       AS alandan,
           MAX(vade_gunu)                                         AS vade_gunu
    FROM vadeli
    WHERE vade IS NOT NULL
      AND vade <= ${sinir}
    GROUP BY cid
  `)

  if (rows.length === 0) return []

  // Bakiye, cari ekranının okuduğu kaynaktan. Aday yoksa buraya hiç gelinmez.
  const liste = await fetchCustomerList({ companyId })
  const bakiyeler = new Map(liste.items.map((c) => [c.id, c]))

  const sonuc: GecikmisAlacak[] = []
  for (const r of rows) {
    const c = bakiyeler.get(r.id)
    if (!c) continue
    const bakiye = Number(c.balance)
    // Borcu kapanmış (0) ya da lehine dönmüş (eksi) müşteri alacak değildir.
    if (!(bakiye > 1)) continue

    sonuc.push({
      musteriId: r.id,
      slug: typeof c.slug === "string" && c.slug ? c.slug : null,
      ad: c.name,
      yetkili: typeof c.contactPerson === "string" ? c.contactPerson : null,
      telefon: typeof c.phone === "string" ? c.phone : null,
      bakiye,
      faturaAdet: Number(r.fatura),
      gecikmeGun: Math.floor(sayi(r.gecikme)),
      vadeKaynagi: r.alandan ? "alan" : "turetildi",
      vadeGunu: r.alandan ? null : (r.vade_gunu ?? null),
    })
  }

  // En çok parayı bekleten önce; gürültü bütçesi gereği baştan birkaçı alınır.
  sonuc.sort((a, b) => b.bakiye - a.bakiye)
  return sonuc.slice(0, MAX_MUSTERI)
}
