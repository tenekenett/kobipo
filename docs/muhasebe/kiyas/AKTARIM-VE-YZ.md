# Aktarım köprüleri ve yapay zekâ muhasebe ürünleri (2026-10-09)

Müşavir programı ile mükellefin verisi arasında duran ürünler. **Kobipo'nun muhasebe motoruna
(belge → öğrenen taslak fiş → onay) en yakın rakipler bunlar** — ama müşavir tarafında
çalışıyorlar, mükellef tarafında değil. Yöntem: açık kaynak (üretici sayfaları); oranlar ve
kullanıcı sayıları üretici iddiası.

## 1. Üretici köprüleri (bedava, kendi ekosistemine bağlı)

### Atlas Aktarım (Paraşüt / Mikro grubu) — atlasaktarim.com
- Müşavire **ücretsiz** bulut "veri aktarım, ofis ve mükellef takip programı"; sınırsız kullanıcı.
- Kaynak: **Paraşüt, Bizmu, e-Portal**, banka (mükellef bankasını Paraşüt'e bağlar).
- **Luca'ya tek tuşla** (aylık/parçalı, bilanço ve işletme defteri; banka hareketi yalnız bilanço
  defterlide); Zirve Müşavir/Nova ve Mikro Müşavir'e Excel/XML.
- "Akıllı Veri İşleme": Paraşüt mükellefinde **hesap kodlarını otomatik doldurur**; banka için
  "Hesap Eşleştirme Sihirbazı" → yeni hareketlere kod atanır → "Muhasebeleştir" → Luca.
- Resmileşen fatura anında düşer; Excel/XML dışa aktarım; toplu PDF.
- Dijital ofis: personel davet, mükellef–personel ataması, yetki, iş takibi. Mükellef müşaviri
  Paraşüt'ten davet eder (Firma Bilgileri > Mali Müşavir Davet Et).
- "%80 süre, %99 hata azalması" — Eylül 2020 araştırmasına atıf (iddia).

### ExpressAktarım (Mikro / Paraşüt)
Paraşüt, Bizmu ve e-Portal belgelerini **Zirve Nova, Zirve Müşavir, Mikro Müşavir**'e; toplu
düzenleme, hesap kodunu tek tek girmeden fiş; cari ve stok kartı aktarımı (Mikro Müşavir).

### Faturaport → Luca/Zirve/Orka/Dia (2026-06)
e-belgeler müşavirin programına otomatik; ücret programa yıllık 1.000 TL + KDV. Ayrıca KDV
raporunun Luca/Zirve biçimli Excel'i (`FATURAPORT.md`).

## 2. Bağımsız aktarım ürünleri (müşaviriye satılır)

### Rahat Aktarım — rahataktarim.com
- e-Fatura, e-Arşiv, **gider fişi (YZ OCR, ~2 sn)**, **banka ekstresi**, **yazarkasa Z raporu
  (Hugin, Ingenico)** → genel muhasebe programı.
- **55+ özel entegratör** (Digital Planet, NES, Nilvera, EDM, Kolaysoft, Uyumsoft, Foriba, Sovos,
  QNB, GİB Portal …).
- Hedef: **Luca Koza ve standart (XML + API)**, Zirve, Logo Go3/Tiger (Excel), Mikro, Datasoft,
  Orka, Vega, Zirve Nova, Altos.
- Cari eşleme **VKN/TCKN** ("%99,8" iddia), eşleşmeyene yeni cari kartı; banka açıklamasına göre
  **kural motoru**; müşavir kuralları firmalar arası kopyalar. WhatsApp hattından belge alma.
- Fiyat: yıllık **bilanço paketi** (10/20/30/50/100+; tüm bilançoları alan ofiste işletme defteri ve
  serbest meslek bedava) ya da **kontör** (1 fatura / 1 banka satırı = 1 kontör, süresiz).

### Cherasoft e-Aktarım
Belgeleri Luca, Zirve, Datasoft, Mikrokom'a online ya da dosyayla aktarır (müşavire özel).

## 3. Yapay zekâ muhasebe ürünleri

### Mihsap — mihsap.com (en büyüğü)
- **"500 milyon+ evrak", "10.000+ müşavir, 200.000+ işletme"** (iddia). 2026'da müşavire yeni YZ
  ürünleri duyurdu (fatura/fiş/dekont/ekstre işleme, verilerle doğal dilde sohbet).
- Belge: e-fatura, fiş, banka ekstresi, dekont; PDF/Excel/görsel; sürükle-bırak ya da entegrasyon.
  YZ sınıflandırır ve **muhasebe kaydına çevirir** ("%98 tanıma", "sürekli makine öğrenmesi").
- Muhasebe programına tek tık; entegratör listesinde **Mysoft** dahil (Türk Fatura, Türkkep,
  Sovos, Uyumsoft, Nilvera, Kolaysoft, EDM, e-Arşiv Portal); ürün sayfasında Logo, Mikro, Netsis,
  Zirve, ETA. Logo İşbaşı'na özel alt alan (isbasi.mihsap.com).
- **Roller: müşavir · personel · mükellef**; müşavir ve işletme aynı veride eşzamanlı; tüm
  mükellefler tek panel; canlı panolar; 7/24 YZ asistanı.
- Fiyat: müşavire sınırsız kullanıcı/mükellef, ödeme **işlenen belge başına** (rakam yok), 3 gün
  deneme. Güvenlik: TLS 1.3, AES-256, alan düzeyi şifreleme, OWASP ASVS L2, KVKK/GDPR.

### Monorobi (yeni adı nop.com.tr — site hata veriyor)
"Robotik otonom genel muhasebe robotu": gelen e-faturayı analiz edip **hesaplara otomatik fiş
önerir, kullanıcı düzeltmelerinden öğrenir**; LUCA, Zirve, Orka, GMS.NET uyumlu. Kobipo/Aposkal
motorunun müşavir tarafındaki karşılığı.

### Yapay SMMM — yapaysmmm.com
Fatura ve fiş okuma robotu: yığın belgeden tutar, KDV, cari çıkarıp "muhasebe kaydına hazır
tablo".

### YZ Muhasebe — yzmuhasebe.com
"Tamamen ücretsiz" YZ destekli ön muhasebe: fatura/dekont/fiş yükle → otomatik kayıt.

## Kobipo için çıkarımlar

1. **Kobipo'nun motoru yeni değil, YERİ yeni.** Öğrenen otomatik fiş müşavir tarafında Monorobi,
   Mihsap, Atlas'ın "akıllı veri işleme"si ve Logo'nun bağlantı kodlarıyla zaten var. Kobipo'nun
   farkı: fişi **belgenin sahibinin yanında**, belgeyle aynı veritabanında üretmesi — kasa/banka
   türü, çek durumu, bordro, matbu fatura, virman, döviz kuru gibi e-belge köprülerinin GÖRMEDİĞİ
   bilgiyle. Satış dili bu olmalı: "müşavirin programına giren eksiksiz ve hesabı seçilmiş fiş".
2. **Mysoft zaten aktarım ürünlerinin kaynak listesinde** (Mihsap, Luca online panel). Kobipo'nun
   e-belgeleri müşavire Kobipo olmadan da ulaşabiliyor; değer e-belge DIŞI kayıtlarda.
3. Pazarın fiyat birimi: **bilanço (mükellef) başına yıllık** ya da **belge başına kontör**.
   Müşavire bedava + mükellef ücretli (Paraşüt/Atlas, Faturaport) ikinci model.
4. Banka ekstresi ve Z raporu içe alma her aktarım ürününde var; Kobipo'da Z raporu ÖKC mutabakatı
   var (`lib/okc/`), banka ekstresi içe alma yok (dekont tarama var).
5. Müşavir tarafının ortak ekranı: **tüm mükellefler tek panel + rol: müşavir/personel/mükellef**.
   Kobipo'da ACCOUNTANT firma bazlı rol; çok firmalı müşavir görünümü yok.

## Kaynaklar

- [Atlas Aktarım](https://atlasaktarim.com) · [Paraşüt mali müşavir kanalı](https://www.parasut.com/mali-musavir-kanali) ·
  [Mikro Express Aktarım](https://www.mikro.com.tr/express-aktarim/)
- [Rahat Aktarım](https://rahataktarim.com/) · [Cherasoft e-Aktarım](https://www.cherasoft.com/e-aktarim-mali-musavirlere-ozel/)
- [Mihsap](https://mihsap.com/) · [Mihsap İşbaşı](https://isbasi.mihsap.com/) ·
  [Mihsap YZ hamlesi (FintekWins)](https://www.fintekwins.com/mihsap-mali-musavirler-icin-yapay-zeka-hizmetlerini-genisletiyor/) ·
  [Monorobi](https://monorobi.com/) · [Yapay SMMM](https://yapaysmmm.com/) · [YZ Muhasebe](https://yzmuhasebe.com/)
- [Türkiye YZ girişimleri (Para Dergi, 2026-01)](https://www.paradergi.com.tr/teknoloji/2026/01/23/turkiyedeki-yapay-zeka-girisimleri-457ye-yukseldi)
