/**
 * Fatura denetimleri — plan Faz 1'de "birim test YOK" diye bırakılmıştı.
 *
 * Buradaki her vaka bir KARARI koruyor: denetim "doğru" demez, "tutarsızlık var,
 * insana sor" der. Özellikle KDV denetiminin genel iskontoyu satırlara DAĞITMASI
 * ve dip toplamın `computeInvoiceTotals`tan gelmesi (CLAUDE.md: "Fatura dip
 * toplamı YALNIZ document-totals.ts'ten") sessizce bozulabilecek kurallar.
 */

import { describe, expect, it } from "vitest"
import type { Fatura, FaturaKalem } from "./schema"
import { faturaDenetle, faturaInsanaSorulmali } from "./validate"

const BIZ = "7352344835" // Reypo — checksum geçerli
const TEDARIKCI = "3531285187" // Eren Forklift — checksum geçerli
const BUGUN = new Date("2026-09-21T10:00:00Z")

function kalem(p: Partial<FaturaKalem> = {}): FaturaKalem {
  return {
    ad: "Ürün A",
    saticiKodu: null,
    miktar: 10,
    birim: "ADET",
    birimFiyat: 10,
    iskontoTutar: null,
    kdvOrani: 20,
    kdvTutar: 20,
    satirTutar: 100,
    tevkifatOrani: null,
    ...p,
  }
}

function fatura(p: Partial<Fatura> = {}): Fatura {
  return {
    saticiUnvan: "EREN FORKLİFT",
    saticiVknTckn: TEDARIKCI,
    saticiVergiDairesi: null,
    saticiAdres: null,
    aliciUnvan: "REYPO",
    aliciVknTckn: BIZ,
    faturaNo: "EFT2026000000123",
    ettn: null,
    tarih: "2026-09-01",
    vade: null,
    senaryo: "TEMELFATURA",
    tip: "SATIS",
    paraBirimi: "TRY",
    kalemler: [kalem(), kalem({ ad: "Ürün B", miktar: 2, birimFiyat: 50 })],
    kdvKirilimi: [{ oran: 20, matrah: 200, kdv: 40 }],
    genelIskonto: null,
    kdvsizEk: null,
    matrahToplam: 200,
    kdvToplam: 40,
    tevkifatToplam: null,
    odenecek: 240,
    irsaliyeNoListesi: [],
    odemeNotu: null,
    guven: { satici: 0.95, alici: 0.95, tarih: 0.95, toplam: 0.95, kalemler: 0.95 },
    ...p,
  }
}

const bul = (f: Fatura, anahtar: string, b: Parameters<typeof faturaDenetle>[1] = { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN }) =>
  faturaDenetle(f, b).find((d) => d.anahtar === anahtar)!

describe("faturaDenetle — taraf", () => {
  it("alışta ALICI, satışta SATICI biz olmalıyız", () => {
    expect(bul(fatura(), "taraf").durum).toBe("gecti")
    // Aynı belge satış sayılırsa satıcı biz değiliz → patlar.
    expect(bul(fatura(), "taraf", { firmaVkn: BIZ, yon: "SATIS", bugun: BUGUN }).durum).toBe("patladi")
  })

  it("başka firmaya kesilmiş belge patlar, firma VKN'si yoksa ÖLÇÜLEMEZ", () => {
    expect(bul(fatura({ aliciVknTckn: "1111111114" }), "taraf").durum).toBe("patladi")
    expect(bul(fatura(), "taraf", { firmaVkn: null, yon: "ALIS", bugun: BUGUN }).durum).toBe("olcelemedi")
    expect(bul(fatura({ aliciVknTckn: null }), "taraf").durum).toBe("olcelemedi")
  })
})

describe("faturaDenetle — karşı taraf VKN/TCKN", () => {
  it("checksum tutmayan numara hane hatasını yakalar", () => {
    expect(bul(fatura(), "vkn").durum).toBe("gecti")
    expect(bul(fatura({ saticiVknTckn: "1111111111" }), "vkn").durum).toBe("patladi")
    expect(bul(fatura({ saticiVknTckn: "11111111110" }), "vkn").durum).toBe("gecti") // TCKN
    expect(bul(fatura({ saticiVknTckn: "123456789" }), "vkn").aciklama).toContain("9 hane")
    expect(bul(fatura({ saticiVknTckn: null }), "vkn").durum).toBe("olcelemedi")
  })
})

describe("faturaDenetle — satır aritmetiği", () => {
  it("miktar × fiyat − iskonto = tutar; kuruş yuvarlaması tolere edilir", () => {
    expect(bul(fatura(), "satir").durum).toBe("gecti")
    // Belge kendi içinde kuruşa yuvarlar: 3 kuruşluk sapma hata değildir.
    expect(bul(fatura({ kalemler: [kalem({ satirTutar: 100.03 })] }), "satir").durum).toBe("gecti")
    expect(bul(fatura({ kalemler: [kalem({ satirTutar: 120 })] }), "satir").aciklama).toContain("Ürün A")
  })

  it("satır iskontosu düşülür", () => {
    expect(bul(fatura({ kalemler: [kalem({ iskontoTutar: 10, satirTutar: 90 })] }), "satir").durum).toBe("gecti")
  })

  it("üçlü okunamadıysa ÖLÇÜLEMEZ — uydurma geçmez", () => {
    expect(bul(fatura({ kalemler: [kalem({ miktar: null, birimFiyat: null })] }), "satir").durum).toBe("olcelemedi")
  })
})

describe("faturaDenetle — KDV kırılımı", () => {
  it("genel iskonto satırlara matrah oranında dağıtılarak beklenen KDV kurulur", () => {
    // 200 net − 20 genel iskonto = 180 matrah → %20 KDV = 36.
    const f = fatura({ genelIskonto: 20, kdvKirilimi: [{ oran: 20, matrah: 180, kdv: 36 }], odenecek: 216 })
    expect(bul(f, "kdv").durum).toBe("gecti")
    // Dağıtım yapılmasaydı 40 beklenirdi; belgede 40 yazıyorsa artık tutarsızdır.
    const bozuk = fatura({ genelIskonto: 20, kdvKirilimi: [{ oran: 20, matrah: 200, kdv: 40 }], odenecek: 216 })
    expect(bul(bozuk, "kdv").durum).toBe("patladi")
  })

  it("birden çok oran ayrı ayrı ölçülür", () => {
    const f = fatura({
      kalemler: [kalem({ kdvOrani: 20 }), kalem({ ad: "Gıda", kdvOrani: 10, miktar: 1, birimFiyat: 100, satirTutar: 100, kdvTutar: 10 })],
      kdvKirilimi: [{ oran: 20, matrah: 100, kdv: 20 }, { oran: 10, matrah: 100, kdv: 10 }],
      odenecek: 230,
    })
    expect(bul(f, "kdv").durum).toBe("gecti")
    expect(bul(f, "kdv").aciklama).toContain("2 oranda")
  })

  it("belgede kırılım yoksa ÖLÇÜLEMEZ", () => {
    expect(bul(fatura({ kdvKirilimi: [] }), "kdv").durum).toBe("olcelemedi")
    expect(bul(fatura({ kalemler: [kalem({ kdvOrani: null })] }), "kdv").durum).toBe("olcelemedi")
  })
})

describe("faturaDenetle — dip toplam", () => {
  it("kalemlerden kurulan toplam belgeyle tutar", () => {
    expect(bul(fatura(), "toplam").durum).toBe("gecti")
  })

  it("50 kuruşun altındaki fark yuvarlamadır, üstü hatadır", () => {
    const kurus = bul(fatura({ odenecek: 240.03 }), "toplam")
    expect(kurus.durum).toBe("gecti")
    expect(kurus.aciklama).toContain("yuvarlamaya yazılır")
    expect(bul(fatura({ odenecek: 250 }), "toplam").durum).toBe("patladi")
  })

  it("KDV'siz ek (damga vergisi) ödenecek tutara eklenir", () => {
    expect(bul(fatura({ kdvsizEk: 12.5, odenecek: 252.5 }), "toplam").durum).toBe("gecti")
  })

  it("ödenecek okunamadıysa ÖLÇÜLEMEZ", () => {
    expect(bul(fatura({ odenecek: null }), "toplam").durum).toBe("olcelemedi")
  })
})

describe("faturaDenetle — karekod çaprazı", () => {
  const karekod = { belgeNo: "EFT2026000000123", tarih: "2026-09-01", odenecek: 240, saticiVkn: TEDARIKCI, aliciVkn: BIZ }

  it("karekod KAYNAK, model DENETİM aracı: sapma patlar", () => {
    const b = { firmaVkn: BIZ, yon: "ALIS" as const, bugun: BUGUN, karekod: karekod as any }
    expect(bul(fatura(), "karekod", b).durum).toBe("gecti")
    expect(bul(fatura({ odenecek: 241 }), "karekod", b).aciklama).toContain("ödenecek")
    expect(bul(fatura({ faturaNo: "EFT2026000000124" }), "karekod", b).durum).toBe("patladi")
    expect(bul(fatura({ tarih: "2026-09-02" }), "karekod", b).durum).toBe("patladi")
  })

  it("karekod yoksa denetim hiç üretilmez", () => {
    expect(faturaDenetle(fatura(), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN }).some((d) => d.anahtar === "karekod")).toBe(false)
  })
})

describe("faturaDenetle — tarih", () => {
  it("gelecek tarih ve vade < tarih patlar", () => {
    expect(bul(fatura(), "tarih").durum).toBe("gecti")
    expect(bul(fatura({ tarih: "2026-10-01" }), "tarih").aciklama).toContain("Gelecek tarih")
    expect(bul(fatura({ vade: "2026-08-25" }), "tarih").aciklama).toContain("Vade")
    expect(bul(fatura({ vade: "2026-10-01" }), "tarih").durum).toBe("gecti")
    expect(bul(fatura({ tarih: "01.09.2026" }), "tarih").durum).toBe("patladi")
    expect(bul(fatura({ tarih: null }), "tarih").durum).toBe("olcelemedi")
  })
})

describe("faturaInsanaSorulmali", () => {
  it("patlayan denetim ya da düşük güven insana sorar", () => {
    const temiz = faturaDenetle(fatura(), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN })
    expect(faturaInsanaSorulmali(temiz, fatura())).toBe(false)
    expect(faturaInsanaSorulmali(temiz, fatura({ guven: { satici: 0.95, alici: 0.95, tarih: 0.95, toplam: 0.95, kalemler: 0.6 } }))).toBe(true)
    const bozuk = faturaDenetle(fatura({ odenecek: 999 }), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN })
    expect(faturaInsanaSorulmali(bozuk, fatura())).toBe(true)
  })
})
