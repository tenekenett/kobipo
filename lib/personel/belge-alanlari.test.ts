import { describe, expect, it } from "vitest"
import {
  BELGE_ALANLARI,
  belgeAlaniBul,
  belgeMetni,
  elleDoldurulacakAlanlar,
  otomatikDegerler,
  sablonAlanlari,
  sablonDoldur,
  type BelgeKaynagi,
} from "@/lib/personel/belge-alanlari"
import { govdeDuzMetin, govdePdfIcerigi, govdeTemizle } from "@/lib/personel/belge-govde"

const kaynak = (): BelgeKaynagi => ({
  firma: {
    name: "Deneme Gıda Ltd. Şti.",
    taxNumber: "1111111114",
    taxOffice: "Pamukkale",
    address: "Merkez Mah. 1. Sok. No:2",
    city: "DENİZLİ",
    district: "MERKEZEFENDİ",
    phone: "02581112233",
    email: "info@example.com",
    branchName: "Çamlık Şubesi",
    branchNo: "2",
  },
  personel: {
    firstName: "Ayşe",
    lastName: "Işık",
    nationalId: "11111111110",
    phone: "05551112233",
    position: "Ön Muhasebe",
    department: "Muhasebe",
    hireDate: new Date("2024-03-01T00:00:00Z"),
    grossSalary: "42500.5", // Prisma Decimal JSON'a string iner
    annualLeaveDays: 14,
  },
  tarih: new Date("2026-09-15T00:00:00Z"),
})

describe("alan sözlüğü", () => {
  it("sözlükteki her alan kayıttan çözülür", () => {
    const k = kaynak()
    expect(belgeAlaniBul("Personel Ad Soyad")!.coz(k)).toBe("Ayşe Işık")
    expect(belgeAlaniBul("Firma Unvan")!.coz(k)).toBe("Deneme Gıda Ltd. Şti.")
    expect(belgeAlaniBul("Personel İşe Giriş Tarihi")!.coz(k)).toBe("01.03.2024")
    expect(belgeAlaniBul("Şube No")!.coz(k)).toBe("2")
  })

  it("adres ilçe/il ile tamamlanır", () => {
    expect(belgeAlaniBul("Firma Adres")!.coz(kaynak())).toBe(
      "Merkez Mah. 1. Sok. No:2, MERKEZEFENDİ / DENİZLİ",
    )
  })

  it("Decimal string gelse de para biçimlenir", () => {
    expect(belgeAlaniBul("Personel Brüt Maaş")!.coz(kaynak())).toBe("42.500,50 TL")
  })

  it("eksik veri '-' değil BOŞ döner", () => {
    const k = kaynak()
    k.personel!.iban = null
    expect(belgeAlaniBul("Personel IBAN")!.coz(k)).toBe("")
    expect(belgeAlaniBul("Personel Net Maaş")!.coz(k)).toBe("")
  })

  it("arama Türkçe duyarsızdır", () => {
    expect(belgeAlaniBul("personel ad soyad")?.ad).toBe("Personel Ad Soyad")
    expect(belgeAlaniBul("FIRMA UNVAN")?.ad).toBe("Firma Unvan")
    expect(belgeAlaniBul("  Şube Adı  ")?.ad).toBe("Şube Adı")
  })

  it("her tanımın çözücüsü vardır (personelsiz de patlamaz)", () => {
    const bos: BelgeKaynagi = { firma: { name: "X" }, personel: null }
    for (const alan of BELGE_ALANLARI) {
      expect(() => alan.coz(bos)).not.toThrow()
      expect(typeof alan.coz(bos)).toBe("string")
    }
  })
})

describe("şablon alanları", () => {
  it("sözlükte olmayan ad ELLE alan olur, olan olmaz", () => {
    const alanlar = sablonAlanlari("<p>{Personel Ad Soyad} / {Fesih Gerekçesi}</p>")
    expect(alanlar.map((a) => a.kaynak)).toEqual(["PERSONEL", "ELLE"])
  })

  it("aynı alan iki kez geçse tek kutu doğurur", () => {
    const alanlar = elleDoldurulacakAlanlar("<p>{Tarih} ... {TARİH} ... {tarih}</p>")
    expect(alanlar).toHaveLength(1)
    expect(alanlar[0].ad).toBe("Tarih") // ekranda ilk yazılışı görünür
  })

  it("elle alanın tipi adından tahmin edilir", () => {
    const alanlar = elleDoldurulacakAlanlar("<p>{Fesih Tarihi} {Avans Tutarı} {İzin Gün Sayısı} {Mazeret}</p>")
    expect(alanlar.map((a) => a.tip)).toEqual(["TARIH", "PARA", "SAYI", "METIN"])
  })

  it("dönem sözcüğü para sözcüğünü ezer", () => {
    // "Maaş Ayı" adında "maaş" geçtiği için PARA sanılıyordu: ay adı için kuruş
    // basamaklı sayı kutusu çiziliyordu.
    const alanlar = elleDoldurulacakAlanlar("<p>{Maaş Ayı} {Maaş Yılı} {Ödeme Dönemi} {Avans Tutarı}</p>")
    expect(alanlar.map((a) => `${a.ad}:${a.tip}`)).toEqual([
      "Maaş Ayı:METIN",
      "Maaş Yılı:METIN",
      "Ödeme Dönemi:METIN",
      "Avans Tutarı:PARA",
    ])
  })

  it("CSS/script parçası alan sanılmaz", () => {
    // İç içe süslü parantez reddedilir; `{ color: red }` tek satırda kalsa bile
    // ad uzunluğu ve satır sonu kuralı onu eler.
    expect(elleDoldurulacakAlanlar("<p>style { color: red;\n }</p>").map((a) => a.ad)).toEqual([])
  })

  it("yalnız gövdede geçen alanlar çözülür", () => {
    const degerler = otomatikDegerler("<p>{Firma Unvan}</p>", kaynak())
    expect(Object.keys(degerler)).toEqual(["Firma Unvan"])
  })
})

describe("doldurma", () => {
  it("bulunamayan alan BOŞ bırakılır, süslü parantez kalmaz", () => {
    expect(sablonDoldur("<p>A {Yok} B</p>", {})).toBe("<p>A  B</p>")
  })

  it("elle girilen değer otomatik değeri ezer", () => {
    const metin = belgeMetni("<p>{Personel Ad Soyad}</p>", kaynak(), {
      "Personel Ad Soyad": "Düzeltilmiş Ad",
    })
    expect(metin).toBe("<p>Düzeltilmiş Ad</p>")
  })

  it("baştan sona: sözlük + elle alan birlikte dolar", () => {
    const govde = "<p>{Personel Ad Soyad} adlı personelin iş akdi {Fesih Tarihi} tarihinde feshedilmiştir.</p>"
    expect(belgeMetni(govde, kaynak(), { "Fesih Tarihi": "15.09.2026" })).toBe(
      "<p>Ayşe Işık adlı personelin iş akdi 15.09.2026 tarihinde feshedilmiştir.</p>",
    )
  })
})

describe("gövde temizleme", () => {
  it("script içeriğiyle birlikte atılır", () => {
    expect(govdeTemizle("<p>A</p><script>alert(1)</script><p>B</p>")).toBe("<p>A</p><p>B</p>")
  })

  it("öznitelikler tamamen düşer", () => {
    expect(govdeTemizle('<p class="x" onclick="evil()">A</p>')).toBe("<p>A</p>")
  })

  it("izinsiz etiket düşer ama metni kalır", () => {
    expect(govdeTemizle("<div>A <span>B</span></div>")).toBe("A B")
  })

  it("kapatılmamış etiket kapatılır, fazladan kapatma yok sayılır", () => {
    expect(govdeTemizle("<p>A")).toBe("<p>A</p>")
    expect(govdeTemizle("A</p></strong>")).toBe("A")
  })

  it("metindeki < > kaçışlanır (önizleme HTML üretmez)", () => {
    expect(govdeTemizle("<p>a &lt; b</p>")).toBe("<p>a &lt; b</p>")
  })

  it("düz metin boşsa gövde boş sayılır", () => {
    expect(govdeDuzMetin("<p></p><ul><li></li></ul>")).toBe("")
  })
})

describe("gövde → PDF", () => {
  it("paragraf, kalın metin ve liste üretir", () => {
    const icerik = govdePdfIcerigi("<p>Merhaba <strong>dünya</strong></p><ul><li>bir</li><li>iki</li></ul>")
    expect(icerik).toHaveLength(2)
    expect(JSON.stringify(icerik[0])).toContain('"bold":true')
    expect((icerik[1] as { ul: unknown[] }).ul).toHaveLength(2)
  })

  it("imza ve antet gövdeden GELMEZ (yalnız metin döner)", () => {
    const icerik = govdePdfIcerigi("<p>A</p>")
    expect(JSON.stringify(icerik)).not.toContain("table")
  })

  it("bozuk işaretlemede boş dönmez", () => {
    expect(govdePdfIcerigi("<p>A<strong>B</p>").length).toBeGreaterThan(0)
  })
})

describe("şablon anahtarı", () => {
  it("Türkçe büyük İ anahtarı bölmez", async () => {
    const { sablonAnahtarTabani } = await import("@/lib/personel/belge-sablonlari.server")
    // lib/slug.ts'teki slugify burada "yillik-i-zin-talep-formu" üretiyor:
    // "İ".toLowerCase() = "i" + U+0307 ve birleşen nokta tireye dönüşüyor.
    expect(sablonAnahtarTabani("Yıllık İzin Talep Formu")).toBe("yillik-izin-talep-formu")
    expect(sablonAnahtarTabani("İstifa Dilekçesi")).toBe("istifa-dilekcesi")
    expect(sablonAnahtarTabani("İş Sözleşmesi Fesih Bildirimi")).toBe("is-sozlesmesi-fesih-bildirimi")
  })

  it("boş başlıkta bile anahtar üretir", async () => {
    const { sablonAnahtarTabani } = await import("@/lib/personel/belge-sablonlari.server")
    expect(sablonAnahtarTabani("   ")).toBe("sablon")
    expect(sablonAnahtarTabani("!!!")).toBe("sablon")
  })
})
