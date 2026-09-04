/**
 * Ham SQL duman testi — GERÇEK veritabanına bağlanır, bu yüzden VARSAYILAN OLARAK
 * ATLANIR. Çalıştırmak için firma slug'ı verin:
 *
 *   ASISTAN_SMOKE_COMPANY=reypo npx vitest run lib/asistan/veri/sorgular.smoke.test.ts
 *
 * NEDEN VAR: asistanın veri katmanı `$queryRaw` üzerine kurulu ve TypeScript ham
 * SQL'in içini GÖRMEZ. Yanlış sütun adı, CTE sırası hatası, `avgCostCte` ile
 * çakışan bir takma ad — hiçbiri derlemede yakalanmaz, ilk kullanıcı sorusunda
 * 500 olarak patlar. Bu dosya "sorgular gerçekten koşuyor mu" sorusunu cevaplar.
 *
 * DOĞRULUK ölçmez (veri firmadan firmaya değişir): koştuğunu, tipleri
 * çevirebildiğini ve sonuçların kendi içinde tutarlı olduğunu doğrular.
 * Sonuçların doğruluğu ekranla karşılaştırılarak sınanır.
 */

import { describe, expect, it, beforeAll } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { prisma } from "@/lib/db/prisma"
import { oluStoklar, kritikStoklar, zararinaSatilanlar, urunAra, satisSiralamasi } from "./urun"
import { vadesiGecenler, kaybolanMusteriler, nakitDurumu, sonTahsilatToplami } from "./cari"
import { donemKarsilastirma } from "./ozet"
import { bugunBasi, gunOnce } from "./temel"
import { sinyalleriHesapla } from "@/lib/asistan/sinyaller"

// Uzak Supabase havuzuna gidiyor: 5 sn'lik varsayılan vitest sınırı yetmiyor.
// Sınırı yükseltmek gecikmeyi gizlemez — süreler koşum çıktısında görünür.
const ZAMAN_ASIMI = 30_000

const SLUG = process.env.ASISTAN_SMOKE_COMPANY
const calistir = SLUG ? describe : describe.skip

calistir("asistan ham SQL duman testi", () => {
  let companyId: string

  beforeAll(async () => {
    const firma = await prisma.company.findFirst({
      where: { OR: [{ slug: SLUG }, { id: SLUG }] },
      select: { id: true, name: true },
    })
    if (!firma) throw new Error(`Firma bulunamadı: ${SLUG}`)
    companyId = firma.id
  }, ZAMAN_ASIMI)

  it("hareketsiz stok sorgusu koşuyor", async () => {
    const satirlar = await oluStoklar(companyId, 90, 10)
    expect(Array.isArray(satirlar)).toBe(true)
    for (const s of satirlar) {
      expect(s.miktar).toBeGreaterThan(0)
      // Maliyet bilinmiyorsa bağlı tutar da bilinmiyor — 0 DEĞİL.
      if (s.birimMaliyet == null) expect(s.bagliTutar).toBeNull()
      else expect(s.bagliTutar).toBeCloseTo(s.miktar * s.birimMaliyet, 6)
    }
  }, ZAMAN_ASIMI)

  it("kritik stok sorgusu koşuyor ve kalan gün tutarlı", async () => {
    const satirlar = await kritikStoklar(companyId, 10)
    for (const s of satirlar) {
      expect(s.miktar).toBeLessThanOrEqual(s.minSeviye)
      if (s.gunlukHiz === 0) expect(s.kalanGun).toBeNull()
    }
  }, ZAMAN_ASIMI)

  it("zararına satış sorgusu koşuyor", async () => {
    const satirlar = await zararinaSatilanlar(companyId, 90, 10)
    for (const s of satirlar) {
      expect(s.ortSatis).toBeLessThan(s.birimMaliyet)
      expect(s.birimZarar).toBeGreaterThan(0)
    }
  }, ZAMAN_ASIMI)

  it("ürün araması koşuyor", async () => {
    const bulunan = await urunAra(companyId, "a", gunOnce(30), bugunBasi(), 5)
    expect(Array.isArray(bulunan)).toBe(true)
  }, ZAMAN_ASIMI)

  it("satış sıralaması üç ölçütte de koşuyor", async () => {
    for (const olcut of ["ciro", "kar", "adet"] as const) {
      const satirlar = await satisSiralamasi(companyId, gunOnce(90), bugunBasi(), olcut, 5)
      expect(Array.isArray(satirlar)).toBe(true)
    }
  }, ZAMAN_ASIMI)

  it("vadesi geçenler iki tarafta da koşuyor", async () => {
    for (const taraf of ["musteri", "tedarikci"] as const) {
      const satirlar = await vadesiGecenler(companyId, taraf, 5)
      for (const s of satirlar) expect(s.gecikenTutar).toBeGreaterThan(0)
    }
  }, ZAMAN_ASIMI)

  it("kaybolan müşteri sorgusu koşuyor", async () => {
    const satirlar = await kaybolanMusteriler(companyId, 5)
    for (const s of satirlar) {
      expect(s.faturaSayisi).toBeGreaterThanOrEqual(3)
      expect(s.sessizGun).toBeGreaterThan(s.ortalamaAralik * 2)
    }
  }, ZAMAN_ASIMI)

  it("nakit ve tahsilat sorguları koşuyor", async () => {
    const durum = await nakitDurumu(companyId)
    expect(Array.isArray(durum.hesaplar)).toBe(true)
    expect(typeof (await sonTahsilatToplami(companyId, 30))).toBe("number")
  }, ZAMAN_ASIMI)

  it("dönem karşılaştırması koşuyor ve iki dönem eşit uzunlukta", async () => {
    const k = await donemKarsilastirma(companyId, gunOnce(30), bugunBasi())
    const uzunluk = (b: Date, s: Date) => Math.round((s.getTime() - b.getTime()) / 86_400_000)
    expect(uzunluk(k.simdi.baslangic, k.simdi.bitis)).toBe(
      uzunluk(k.onceki.baslangic, k.onceki.bitis)
    )
    expect(k.simdi.brutKar).toBeCloseTo(k.simdi.ciro - k.simdi.satilanMaliyet, 6)
  }, ZAMAN_ASIMI)

  /**
   * Panelin açılış süresi = bu fonksiyonun süresi. Sinyaller paralel koşuyor,
   * yani toplam süreyi EN YAVAŞ sinyal belirliyor (pratikte yaşlandırma).
   * Süre koşum çıktısına basılıyor: yavaşlama sessizce birikmesin.
   */
  it("tüm sinyaller birlikte koşuyor ve hiçbiri hata vermiyor", async () => {
    const t0 = Date.now()
    const sonuc = await sinyalleriHesapla({
      companyId,
      izinler: { role: "ADMIN", allowedPaths: [], writablePaths: [] },
      kapaliModuller: [],
    })
    console.log(
      `    sinyal süresi: ${Date.now() - t0}ms · ${sonuc.sinyaller.length} sinyal · ` +
        `${sonuc.sinyaller.reduce((t, s) => t + s.toplam, 0)} bulgu`
    )
    expect(sonuc.hatalar).toEqual([])
  }, ZAMAN_ASIMI)

  /**
   * Kartlardaki linkler GERÇEKTEN açılan bir sayfaya gidiyor mu?
   *
   * İlk yazımda gitmiyordu: sinyaller ürünü `/stok/urunler/{slug}`, cariyi
   * `/cari/musteri/{id}` diye linkliyordu — ikisi de menü href'i, ikisinin de
   * altında detay route'u YOK. Gerçek adresler `/stok/{slug}` ve
   * `/cari/customers|suppliers/{id}`. Tip denetimi bunu göremez (ikisi de düz
   * string), tarayıcı da yalnız kullanıcı tıklayınca söyler.
   *
   * Kontrol dosya sisteminden yapılıyor (`page-api-coverage.test.ts` deseni):
   * uydurma bir yol listesiyle karşılaştırmak, listenin kendisi eskidiğinde
   * sessizce yalan söylerdi.
   */
  it("uyarı kartlarındaki linkler var olan bir sayfaya gidiyor", async () => {
    const sonuc = await sinyalleriHesapla({
      companyId,
      izinler: { role: "ADMIN", allowedPaths: [], writablePaths: [] },
      kapaliModuller: [],
    })

    const KOK = path.resolve(process.cwd(), "app/(dashboard)")
    const sayfaVarMi = (dizin: string): boolean =>
      fs.existsSync(path.join(dizin, "page.tsx")) || fs.existsSync(path.join(dizin, "page.ts"))

    /**
     * `/stok/kahve-250g` → app/(dashboard)/stok/[id]/page.tsx bulur.
     *
     * GERİ İZLEMELİ olmak zorunda. `/cari/customers/{id}` yolunda `cari/customers`
     * klasörü GERÇEKTEN var ama içinde yalnız `new/` bulunuyor, `page.tsx` yok —
     * yani sabit dalı sonuna kadar izleyen bir çözücü "kırık" der. Next ise
     * sabit dal eşleşmeyince dinamik kardeşe (`cari/[type]/[id]`) düşer; cari
     * listesinin kendi satır linki de tam olarak bu yolu kullanıyor
     * (app/(dashboard)/cari/page.tsx). Sabit dalı denemek YETMEZ, başarısız
     * olursa dinamik dal da denenmeli.
     */
    const cozulur = (href: string): boolean => {
      const parcalar = href.split("?")[0].split("/").filter(Boolean)

      const ara = (dizin: string, kalan: string[]): boolean => {
        if (kalan.length === 0) return sayfaVarMi(dizin)
        if (!fs.existsSync(dizin)) return false

        const [parca, ...geri] = kalan
        const adaylar: string[] = []

        const sabit = path.join(dizin, parca)
        if (fs.existsSync(sabit) && fs.statSync(sabit).isDirectory()) adaylar.push(sabit)

        for (const giris of fs.readdirSync(dizin, { withFileTypes: true })) {
          if (giris.isDirectory() && giris.name.startsWith("[")) {
            adaylar.push(path.join(dizin, giris.name))
          }
        }

        return adaylar.some((aday) => ara(aday, geri))
      }

      return ara(KOK, parcalar)
    }

    /**
     * Cari detayında var olmak YETMEZ — `type` doğru olmalı.
     *
     * `/cari/[type]/[id]` her şeyi yutar: `/cari/musteri/{id}` de eşleşir, 404
     * vermez. Ama sayfa `type === "customers"` diye bakıp aksi hâlde belgeyi
     * TEDARİKÇİ sayar. Yani ilk yazımdaki hatanın sonucu kırık link değil,
     * SESSİZCE YANLIŞ KART açmaktı — müşteriyi tedarikçi ekranında göstermek.
     * Çözücü bunu göremez (yol gerçekten var), bu yüzden ayrı kural.
     */
    const cariTipiDogru = (href: string): boolean => {
      const p = href.split("?")[0].split("/").filter(Boolean)
      if (p[0] !== "cari" || p.length < 2) return true
      return p[1] === "customers" || p[1] === "suppliers" || p[1] === "ekstre"
    }

    // NEGATİF KONTROL: geri izleme eklenince çözücü fazla hoşgörülü hâle gelip
    // her yolu "geçerli" sayabilirdi — o hâlde bu test hiçbir şey korumaz.
    expect(cozulur("/stok/urunler/kahve-250g"), "eski kırık ürün linki").toBe(false)
    expect(cozulur("/stok/kahve-250g"), "gerçek ürün linki").toBe(true)
    expect(cariTipiDogru("/cari/musteri/abc123"), "eski yanlış cari tipi").toBe(false)
    expect(cariTipiDogru("/cari/customers/abc123"), "gerçek cari linki").toBe(true)

    const kirik = sonuc.sinyaller
      .flatMap((s) => s.satirlar.map((r) => ({ sinyal: s.anahtar, href: r.href })))
      .filter((r) => r.href && (!cozulur(r.href) || !cariTipiDogru(r.href)))
      .map((r) => `${r.sinyal} → ${r.href}`)

    expect(kirik, `Bu linkler yanlış sayfaya gidiyor:\n${kirik.join("\n")}`).toEqual([])
  }, ZAMAN_ASIMI)
})
