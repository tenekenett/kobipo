/**
 * ÖDEME DAVRANIŞI — carinin parayı fiilen kaç günde getirdiği. Saf modül.
 *
 * ── Neden var: mevcut performans skoru ÖLÜ ──────────────────────────────────
 * Yaşlandırma raporunda bir "ödeme performansı" göstergesi zaten var ve ekranda
 * basılıyor (`raporlar/cari-yaslandirma`). Ölçüsü "gecikme = ödeme günü − VADE"
 * olduğu için vadesi tanımsız belgeyi bilerek atlıyor (`if (!inv.hasDueDate)
 * continue`) — sebebi haklı: vade yokken "geç ödedi" demek, müşterinin
 * davranışını değil vade boşluğunu ölçer.
 *
 * Ama vade bu üründe pratikte yazılmıyor: ÖLÇÜM (2026-09-07, canlı) 80
 * müşterinin **2'sinde** skor çıkıyor (%3), kalan 78'i "Veri yok". Yani gösterge
 * ekranda duruyor ve hiçbir şey söylemiyor.
 *
 * ── Ölçü değişiyor: VADEYE göre değil, FATURA TARİHİNE göre ─────────────────
 * Bu modül farklı bir soruyu cevaplar ve ikisi KARIŞTIRILMAMALIDIR:
 *
 *   performansAvgDays  "sözüne göre kaç gün geç ödedi"   (vade gerektirir)
 *   gunOrtalama        "parayı kaç günde getirdi"        (vade GEREKTİRMEZ)
 *
 * 30 gün vadeyle çalışan ve tam gününde ödeyen müşteri birincide 0, ikincide 30
 * gündür. İkisi aynı alana yazılırsa "0 gün geç" ile "30 günde öder" birbirinin
 * yerine geçer ve gösterge yine yalan söyler.
 *
 * Bu ölçü, açık hesap çalışan işletmenin gerçeğine daha yakın: yazılı vade yok,
 * müşteri kendi ritmiyle ödüyor ve o ritim ölçülebiliyor.
 *
 * ── Yöntem: FIFO ────────────────────────────────────────────────────────────
 * Tahsilatlar en eski açık faturadan başlayarak mahsup edilir (açık hesabın ve
 * Türk muhasebe pratiğinin varsayılanı). Eşleşen HER LİRA bir (tahsilat tarihi −
 * fatura tarihi) çifti üretir; ortalama bu liralarla ağırlıklandırılır — büyük
 * fatura, küçük faturadan daha çok söz sahibi olur.
 *
 * ÖLÇÜM: yöntem 23 müşteride profil çıkarıyor (mevcut skorun 11 katı) ve
 * rakamlar makul — medyan 11 gün, çeyrekler 4 ve 30, hiçbir müşteride 180+ gün
 * yok. Tek negatif değer gerçek: avans veren bir müşteri.
 *
 * ── Neden "tam kapanmış fatura" şartı YOK ───────────────────────────────────
 * İlk ölçümde profil kapısı "en az 2 faturası tamamen kapanmış olsun" idi ve
 * kapsam 28'de kalıyordu; oysa kısmi ödeme de davranış bilgisidir. Kapı artık
 * EŞLEŞEN TUTARA bakıyor: parçalı ödeyen müşteri de profilini doldurur.
 */

/** Ödeme davranışı için en az bu kadar tahsilat OLAYI gerekir. */
export const EN_AZ_OLAY = 2

/** Ve en az bu kadar tutar eşleşmelidir — tek kuruşluk eşleşme davranış değildir. */
export const EN_AZ_ESLESEN_TUTAR = 10_000

export type DavranisGirdisi = {
  /** Fatura/tahsilat tarihi. */
  tarih: Date | string
  tutar: number
}

export type OdemeDavranisi = {
  /**
   * Ağırlıklı ortalama: tahsilat tarihi − fatura tarihi (gün).
   * Negatif = müşteri faturadan ÖNCE ödüyor (avans).
   */
  gunOrtalama: number
  /** Ortalamanın dayandığı eşleşmiş tutar. */
  eslesenTutar: number
  /** Kaç ayrı tahsilat olayı eşleşmeye katıldı. */
  olaySayisi: number
  /** FIFO sonrası kapanmamış tutar. */
  acikTutar: number
  /** En eski açık faturanın bugün itibarıyla yaşı (gün); açık yoksa null. */
  enEskiAcikGun: number | null
}

const GUN_MS = 86_400_000

function gunBasi(t: Date | string): number {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return Number.NaN
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Faturaları ve tahsilatları FIFO ile eşleyip ödeme davranışını çıkarır.
 *
 * Profil kurulamıyorsa `null` döner — "veri yok" ile "0 gün" ayrı şeylerdir ve
 * çağıran taraf ikisini aynı biçimde basmamalıdır.
 */
export function odemeDavranisiHesapla(
  faturalar: DavranisGirdisi[],
  tahsilatlar: DavranisGirdisi[],
  bugun: Date = new Date()
): OdemeDavranisi | null {
  const borclar = faturalar
    .map((f) => ({ t: gunBasi(f.tarih), kalan: Number(f.tutar) }))
    .filter((f) => Number.isFinite(f.t) && Number.isFinite(f.kalan) && f.kalan > 0)
    .sort((a, b) => a.t - b.t)

  const odemeler = tahsilatlar
    .map((o) => ({ t: gunBasi(o.tarih), kalan: Number(o.tutar) }))
    .filter((o) => Number.isFinite(o.t) && Number.isFinite(o.kalan) && o.kalan > 0)
    .sort((a, b) => a.t - b.t)

  if (borclar.length === 0 || odemeler.length === 0) return null

  let eslesenTutar = 0
  let agirlikliGun = 0
  let olaySayisi = 0
  let sirada = 0

  for (const odeme of odemeler) {
    let katkiVerdi = false
    while (odeme.kalan > 0.01 && sirada < borclar.length) {
      const borc = borclar[sirada]
      const pay = Math.min(odeme.kalan, borc.kalan)
      agirlikliGun += pay * Math.round((odeme.t - borc.t) / GUN_MS)
      eslesenTutar += pay
      odeme.kalan -= pay
      borc.kalan -= pay
      katkiVerdi = true
      if (borc.kalan <= 0.01) sirada++
    }
    if (katkiVerdi) olaySayisi++
    // Tahsilat arttıysa (fazla ödeme) kalanı düşer: ileride kesilecek faturaya
    // mahsup edilemez, çünkü o fatura henüz yok ve "eksi gün" üretirdi.
  }

  if (olaySayisi < EN_AZ_OLAY || eslesenTutar < EN_AZ_ESLESEN_TUTAR) return null

  const acikBorclar = borclar.slice(sirada).filter((b) => b.kalan > 0.01)
  const acikTutar = acikBorclar.reduce((t, b) => t + b.kalan, 0)

  return {
    gunOrtalama: Math.round(agirlikliGun / eslesenTutar),
    eslesenTutar: Math.round(eslesenTutar * 100) / 100,
    olaySayisi,
    acikTutar: Math.round(acikTutar * 100) / 100,
    enEskiAcikGun:
      acikBorclar.length > 0
        ? Math.round((gunBasi(bugun) - acikBorclar[0].t) / GUN_MS)
        : null,
  }
}

/**
 * Göstergede basılacak etiket.
 *
 * Eşikler `computePerformanceScore`ünkilerden AYRIDIR ve olmalıdır: orada ölçü
 * "vadeye göre gecikme" (0 gün = sözünde durdu), burada "ödeme süresi" (0 gün =
 * peşin). Aynı eşikler kullanılsaydı 30 gün vadeyle tam gününde ödeyen müşteri
 * "Riskli" görünürdü.
 */
export function davranisEtiketi(gunOrtalama: number): string {
  if (gunOrtalama <= 0) return "Peşin/avans"
  if (gunOrtalama <= 15) return "Hızlı ödüyor"
  if (gunOrtalama <= 45) return "Ortalama"
  return "Yavaş ödüyor"
}
