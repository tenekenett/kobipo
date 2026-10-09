# Müşavir programları — Zirve, Mikro, Logo, Uyumsoft, ETA, DİA, Orka (2026-10-09)

**Yöntem:** açık kaynak (üretici sayfaları, kılavuz/blog, bayi sayfaları). Hesap açılmadı, ekran
görülmedi. Luca ayrı dosyada (`LUCA.md`). Eski kılavuza dayanan maddeler tarihiyle.

## Pazarın yapısı (önce bunu okuyun)

Her büyük müşavir programı üreticisinin **mükellefe verdiği kendi ön muhasebe/e-belge ürünü**
ve ikisini bağlayan **aktarım köprüsü** var. Müşavir, mükellefin kendi üreticisinin ürününü
kullanmasını ister — aktarım tek tıktır:

| Müşavir programı | Üreticinin mükellef ürünü | Köprü |
|---|---|---|
| Luca (TÜRMOB) | Luca Koza, Luca Net, TÜRMOB e-Fatura (İŞNET) | Akıllı Entegrasyon Noktası |
| Zirve Müşavir / Zirve Nova | Zirve e-Mükellef, Zirve Ticari | Express Aktarım |
| Mikro Müşavir | **Paraşüt, Bizmu**, Mikro Run/Jump/Fly | Express Aktarım, Atlas Aktarım |
| Logo Mali Müşavir 3 | Logo İşbaşı, GO3, Tiger | İşbaşı'na müşavir daveti |
| Uyumsoft MüşavirPro / ekoSMMM | Uyumsoft e-Dönüşüm | — |

Konsolidasyon: **Mikro grubu** Paraşüt'ü ve Bizmu'yu bünyesinde tutuyor, Atlas Aktarım'ı
müşavirlere bedava veriyor ve **Ocak 2026'da DİA Yazılım'ı satın almak için başvurdu** (Webrazzi).
Kobipo bu tablonun dışında: üreticisi müşavir programı satmayan bir ön muhasebe + defter.
Müşavire ulaşmanın yolu ya bu köprülere bağlanmak (ücretli/kapalı) ya da dosya aktarımı.

## Zirve Yazılım — Zirve Müşavir

- **Genel muhasebe** + şablonla hızlı fiş girişi; sınırsız firma; masaüstü ve **Zirve Müşavir
  Bulut** (tarayıcıdan, telefon/tablet; ayrı mobil uygulama yok).
- **Fatura → fiş:** (a) **Express Aktarım** — Zirve, Mikro ve Paraşüt'ün e-Dönüşüm portalından
  giden e-Fatura/e-Arşiv ve gelen e-Faturaları indirip seçerek muhasebeleştirir; gelen e-Faturalar
  Fatura modülüne alış/gider faturası olarak da düşer. (b) **Fatura Excel modülü** — "tanım
  tablosu" ile kolon eşleme, aynı biçim tekrar kullanılır, olmayan cari için **alt hesabı otomatik
  açar**. Beklenen alanlar: Tarih, Cari Adı-Açıklama, (Evrak No), (VKN/TCKN), Matrah, KDV; dövizde
  Para Birimi + Döviz Tutarı, stoklu aktarımda Stok Kodu + Miktar.
- **Banka:** Excel/PDF ekstre içe alma; anlaşmalı bankalardan otomatik ekstre. Z raporu Excel'i
  e-Mükellef'ten.
- **Beyanname:** KDV1, KDV2, Muhtasar, damga, geçici vergi, gelir, basit usul, kurumlar (+ eski
  BA/BS); e-Beyanname paketiyle toplu gönderim. **e-Defter**, **Defter Beyan**, e-SMM.
- **Bordro:** e-işe giriş/çıkış, e-bildirge.
- **Fiyat (sayfada):** 33.100 TL lisans (tek sefer), 1 saat eğitim, 3.000 e-SMM, ilk yıl destek
  ve güncelleme. Ek bilgisayar farkı (e-Defter, e-SMM, Defter Beyan hariç).
- Zirve 2020'de müşavir ofis otomasyonu **Irgat**'ı satın aldı (mükellef paneli: belge erişimi).

## Mikro Yazılım — Mikro Müşavir

- **Çok mükellef tek sistemde, mükellef başına ek ücret yok.** Platform "Web" (yapılandırılmış
  veride); yedek Mikro Drive.
- **Belge alma:** mükellefin programından (Mikro Run/Jump/Fly, **Paraşüt**), e-Arşiv portalları,
  GİB Portal, **İnteraktif Vergi Dairesi**, Mikro'nun entegratör portalı; mükellef "Mikro Online
  Hesabım" kullanıyorsa **banka hareketleri** de.
- **Otomatik muhasebeleştirme** (e-fatura + banka) — az elle giriş.
- **Toplu tahakkuk fişleri:** KDV, Muhtasar, Geçici Vergi; kira/KDV gibi tekrarlayan kalemlerin
  otomatik mahsubu.
- Beyanname + e-Devlet akışları; **e-Defter** ve **Defter Beyan Sistemi** (işletme/basit usul)
  GİB entegre; bordro/SGK; **duran varlık + amortisman** (hazır faydalı ömür tablosu);
  **enflasyon muhasebesi** (TMS 29, SPK) + konsolide tablolar; dilekçe şablonları; mizan/gelir
  tablosu; stok; e-SMM.
- **Express Aktarım:** mükelleften müşavire fatura/e-fatura + banka hareketi "neredeyse anlık";
  **stoklu ya da fiş olarak** otomatik kayıt; cari ve stok kartlarını taşır; belge/dosya paylaşımı.
  Hedef: Mikro Müşavir, MAG (Paraşüt sayfasına göre Zirve Nova ve Zirve Müşavir de).
- e-Defter (Jump ek modül): ilk yıl ~33.450 TL (bayi listesi, tarih belirsiz).

## Logo — Logo Mali Müşavir 3

- Modüller: büro yönetimi, muhasebe (mükellef takibinden beyannameye, toplu ve tekil işlem),
  **otomatik muhasebeleştirme**, bordro, beyanname, iş takibi (takvim, hatırlatıcı, doküman,
  Excel'den toplu veri), 200+ hazır rapor şablonu; e-Defter, e-Fatura, e-Arşiv, e-SMM; **Defter Beyan
  Sistemi'ne doğrudan aktarım**. Sayfada yalnız **ON-PREMISE** kurulum.
- **GO3 muhasebeleştirme modeli** (2016–2018 kılavuzları): kartlara ve **muhasebe bağlantı
  kodlarına** bir kez hesap girilir, "öndeğer" ile faturaya atanır; fatura tek tek ya da toplu
  muhasebeleştirilir; satış faturasına **SMM mahsubu**, TFRS SMM mahsubu, reeskont düzeltme fişi.
  Excel'den veri aktarımı: Sistem İşletmeni > Araçlar.
- "Muhasebe Uzmanı" kullanıcı tipinde menü: fişler, muhasebeleştirme, muhtasar, geçici vergi,
  e-beyanname, e-defter, kebir, yevmiye.
- **Logo İşbaşı:** mükellef müşaviri hesabına davet eder (dosya aktarımı yok, aynı veriye erişim).

## Uyumsoft — MüşavirPro / ekoSMMM

Web tabanlı müşavir programı (arama sonucu; haber sayfası kaldırılmış — ayrıntı alınamadı).
Uyumsoft aynı zamanda entegratör; Luca'nın online aktarım panelinde Uyumsoft portalları var.

## ETA, DİA, Orka

- **ETA (ETA:SQL / V8-SQL):** yaygın paket program; e-belge muhasebeleştirme/e-Defter ayrıntısı
  açık kaynakta bulunamadı.
- **DİA:** bulut ERP (finans, muhasebe, stok, üretim, e-ticaret), Web Servis API, ISO 27001
  (2021). Müşavir modülü bilgisi bulunamadı. **Mikro'nun satın alma başvurusu (Ocak 2026).**
  Faturaport'un Haziran 2026 entegrasyon listesinde.
- **Orka:** Faturaport ve Rahat Aktarım listelerinde müşavir programı olarak geçiyor; ürün
  sayfası açık aramada bulunamadı.
- Diğer adı geçenler: Datasoft, Mikrokom, GMS.NET, Vega, Altos, Hattat, Muhasip, Ekohesap
  (aktarım ürünlerinin hedef listeleri).

## Kobipo için çıkarımlar

1. Müşavir programlarının ortak çekirdeği Kobipo'da VAR: otomatik muhasebeleştirme, toplu tahakkuk
   (KDV mahsubu), amortisman, SMM mahsubu, mizan/bilanço. Kobipo'da OLMAYANLAR: **e-Defter,
   beyanname gönderimi, Defter Beyan Sistemi, enflasyon muhasebesi, çok mükellefli müşavir ekranı,
   büro yönetimi**. Bunlar müşavirin işidir — Kobipo'nun hedefi müşavirin programının yerini almak
   değil, ona TEMİZ VERİ vermek olmalı (kullanıcı kararıyla netleşecek).
2. Dosya aktarımında iki ortak biçim: **fiş** (Fiş No/Tarih/Hesap/Borç/Alacak) ve **fatura listesi**
   (Tarih, Cari, Evrak No, VKN, KDV oranına göre Matrah/KDV, döviz, stok). İkisi de Luca, Zirve ve
   Mikro'da var; kolon adları programa göre değişiyor — müşavirden örnek dosya şart.
3. "Muhasebe bağlantı kodu" (Logo) = Kobipo'nun öğrenen eşleşmesi (`account_mapping_rules`); Kobipo
   bunu kartta sabit tutmak yerine onaydan öğreniyor (Aposkal ve Monorobi gibi).
4. Banka hareketi müşavirin en çok el emeği harcadığı kaynak; Kobipo'nun kasa/banka hareketleri
   (türleriyle) fişe zaten giriyor — e-belge köprülerinin taşıyamadığı değer bu.

## Kaynaklar

- Zirve: [Zirve Müşavir](https://www.zirveyazilim.net/musavir/) ·
  [Fatura Excel aktarımı](https://blog.zirveyazilim.net/zirve-masaustu-fatura-excel-aktarim) ·
  [Express Aktarım](https://blog.zirveyazilim.net/zirve-express-aktarim/) ·
  [Banka Excel aktarımı](https://blog.zirveyazilim.net/zirve-masaustunde-banka-excel-aktarim) ·
  [Genel muhasebe kılavuzu](https://blog.zirveyazilim.net/zirve-genel-muhasebe-kullanim-kilavuzu) ·
  [Irgat satın alması](https://webrazzi.com/2020/11/26/zirve-yazilim-mali-musavir-otomasyon-programi-irgati-satin-aldi/)
- Mikro: [Mikro Müşavir](https://www.mikro.com.tr/mikro-musavir/) ·
  [Express Aktarım](https://www.mikro.com.tr/express-aktarim/) ·
  [Paraşüt mali müşavir kanalı](https://www.parasut.com/mali-musavir-kanali) ·
  [Bizmu müşavir veri aktarımı](https://bizmu.com/lp-mali-musavir-kolay-veri-aktarimi/) ·
  [DİA satın alma (Webrazzi, 2026-01-06)](https://webrazzi.com/2026/01/06/mikro-yazilim-dia-yazilim-i-satin-aliyor/) ·
  [Mikro fiyat listesi (bayi)](https://www.acrbilgi.com/mikro-fiyatlari/)
- Logo: [Logo Mali Müşavir 3](https://www.logo.com.tr/en/product/logo-mali-musavir-3) ·
  [GO3 kullanım bilgileri (2016)](http://www.cka.org.tr/uploads/studies_v/5db9ab1a44ec4-kullanim-bilgileri.PDF) ·
  [GO3 muhasebe (2016)](https://www.sdmyazilim.com.tr/var/uploads/1500535411-muhasebe.pdf)
- Diğer: [Cherasoft e-Aktarım](https://www.cherasoft.com/e-aktarim-mali-musavirlere-ozel/) ·
  [Nilvera entegrasyonları](https://www.nilvera.com/entegrasyonlar)
