# Luca (TÜRMOB) — inceleme (2026-10-09)

**Yöntem:** hesap açılamadı — yalnız açık kaynak: Luca'nın destek bilgi bankası
(lucayazilim.freshdesk.com), luca.com.tr ürün sayfaları, üçüncü taraf aktarım ürünleri. Ekran
görülmedi; aşağıdaki her madde kaynağıyla. Doğrulanmamış iddia "(iddia)" diye işaretli.

## Konum

TÜRMOB'un (meslek birliği) müşavir programı; Türkiye'de müşavirlerin **en yaygın** kullandığı
program (Denizli'de 30 müşavirlik bir yüksek lisans çalışmasında en çok tercih edilen; meslek
yazılarında "birlik desteğiyle en uygun fiyatlı"). Ürün ailesi:

| Ürün | Kime | Not |
|---|---|---|
| **Luca Mali Müşavir Paketi** | müşavir | genel muhasebe, beyanname, e-Defter, bordro, işletme defteri |
| **Luca Koza** | KOBİ (ticari/kurumsal) | ön muhasebe + ticari; **Rest API paketi** var |
| **Luca Net** (KOBİ paketi) | KOBİ | web servisle "diğer programlardan veri aktarımı (ÜCRETLİ)" |
| TÜRMOB e-Fatura / e-Entegratör | mükellef | resmî entegratör İŞNET (NetteFatura) |
| e-Defter + saklama | müşavir/mükellef | defterler TÜRMOB sunucularında saklanır |

## Belge → fiş yolları (Kobipo'nun müşavire çıkışı için ASIL bölüm)

### 1. Excel Veri Aktarımı = hazır FİŞ aktarımı
`Muhasebe > Fiş İşlemleri > Excel Veri Aktarımı` → "Şablon indir" → doldur → yükle → önizle →
"Fiş Kes".
- **Zorunlu:** Fiş No, Fiş Tarihi, Hesap Kodu, Borç, Alacak. Satır düzeyinde ayrıca Evrak No,
  Evrak Tarihi, Miktar (satır düzenleme penceresi); fiş düzeyinde Fiş Açıklaması, Fiş Tipi
  (Mahsup / Açılış / Kapanış), Fiş Kodu, **Belge Türü**.
- **Gruplama:** aynı Fiş No + Fiş Tarihi = aynı fiş.
- **Sınır:** tek yüklemede en çok **50 fiş**; mahsup fişi en çok **400 satır** (açılış/kapanış
  sınırsız).
- **Hesap kodu Luca'da VAR OLMALI** ("hesap kodu bulunamadı"); yoksa F10 ile açılır. → Kobipo'nun
  alt hesapları (120.01.0001 …) müşavirin planında yoksa aktarım takılır. Ya müşavirin planına
  eşleme, ya alt hesapsız (ana hesap + açıklama) aktarım gerekir.
- Tam sütun listesi kaynakta yok — şablon dosyası Luca içinden iniyor. **Müşavirden bir şablon
  dosyası istenmeli** (plan da bunu söylüyordu).

### 2. Excel Fatura Aktarımı = fatura listesinden kurallarla fiş
Excel/CSV fatura listesi + kullanıcı tanımlı kurallar → fiş.
- Sınırlar: 400 satır, 15 sütun, sütun başına 15 kural, 20 şablon. Formülde ondalık nokta.
- Sütun türleri: Evrak Tarihi, Evrak No, Açıklama, Tutar (TOPLAM, MATRAH8, KDV8, MATRAH18,
  KDV18 …).
- **Hesap belirleme:** sabit kod (153.003, 191.108.18), sezgisel (sütun adı ↔ alt hesap adı),
  dosyadaki sütundan, önceki sütunun hesabı, **VKN/TCKN ile cari alt hesap eşleşmesi**.
- Alış/satış (Ba/Bs işlem türü alanı — Ba-Bs kalktı, alan duruyor), stoklu aktarım, "Hesapları
  Belirle" → "Hatasız ve dengeli satırları seç" → "Fiş Kes" (her evrak ayrı fiş seçeneği, hesap
  birleştirme, nakit için kasa kodu).
- **Faturaport'un "Luca formatlı KDV raporu" bu yola girer** (fatura başına tek satır, KDV
  oranına göre matrah/KDV — bkz. `FATURAPORT.md`).

### 3. Akıllı Entegrasyon Noktası (AEN) = e-belgeyi doğrudan çekip muhasebeleştirme
`Muhasebe Modülü > Akıllı Entegrasyon Noktası > İşnet Alış/Satış Faturaları Entegrasyon` →
"İşnet'ten Getir" (NetteFatura erişim bilgisiyle) → muhasebeleştirme parametreleri → **tanımlı
hesap kodlarıyla otomatik** → taslak fiş (hesaplar değiştirilebilir) → "Muhasebe Fişi Kes".
Muhasebe iptali, toplu seçim, XML/HTML/JPG indirme var. AEN ayrıca "entegre yazılımlardan veriyi
alıp **beyannameleri otomatik doldurur**". QR ile e-Arşiv/e-SMM okutma ("QR ile Fatura Yükle":
VKN'ye göre alış/satışa düşer).
- Öğrenme var mı, hesap kuralları nasıl tanımlanıyor — makalede yok.
- **Mysoft:** üçüncü taraf yazılarına göre Luca'nın "Online Veri Aktarımı" panelinde desteklenen
  portallar arasında Mysoft ve Uyumsoft var (resmî AEN listesi bulunamadı). → Kobipo'nun Mysoft'tan
  geçen e-belgeleri müşavirin Luca'sına zaten ulaşabilir; Kobipo'nun Luca'ya katkısı e-belge DIŞI
  veride (kasa/banka, çek/senet, bordro, matbu fatura, fiş, virman) ve hesap seçiminde.

### 4. Üçüncü taraf aktarım ürünleri (Luca'ya en çok bağlanan)
Atlas Aktarım (Paraşüt → Luca, banka hareketi dahil, ücretsiz), Rahat Aktarım (55+ entegratör →
Luca Koza/standart, XML ve API), Cherasoft e-Aktarım, Monorobi/nop (otomatik fiş → Luca), Mihsap.
Ayrıntı `AKTARIM-VE-YZ.md`.

## API

- **Luca Koza Rest API paketi** — "diğer uygulamalarla senkron çalışma"; Tofaş/Ford Otosan/Toyota
  fatura entegrasyonları bu pakette.
- Sipariş formunda **"Web Servis API Uygulaması — 1 firma için yıllık kullanım bedeli"**.
- Luca Net: "Web Servis Aktarımı API Hizmeti ile diğer programlardan veri aktarımı (ücretli)".
- Fiş (yevmiye) yazan bir uç, kimlik doğrulama ve şema **kamuya açık değil**; Luca'dan istenmeli.
  Rapitek'in "OAuth2, 2 haftalık salt okunur test" anlatımı satıcı iddiası.
- Faturaport'un Haziran 2026 Luca/Zirve/Orka/Dia entegrasyonu: muhasebe programına **yıllık
  1.000 TL + KDV** (programa ödenir) — yani program tarafında ücretli bir "e-belge entegrasyonu"
  kapısı var.

## Diğer

- **e-Defter:** Luca içinde hazırlama, imzalama, berat; TÜRMOB sunucularında saklama. Şikâyet
  sitelerinde e-Defter gönderim hatası ve destek hattı şikâyetleri var (genelleştirilemez).
- **Beyanname:** Luca içinden; yeni e-Beyan (KDV) web servis protokolüne uyum gerekiyor
  (bkz. `MEVZUAT.md`).
- **Fiyat:** kamuya açık liste bulunamadı; meslek yazısında 100 e-Defter için "özel programla
  200.000 TL'ye varan fark" (görüş, tarihsiz). Koza ticari paket belgesinde 2.360 / 975 TL
  kalemleri görünüyor (kapsamı doğrulanmadı).
- Geçiş: Logo'dan Luca'ya "Luca Asistan" ile hesap planı + fiş aktarımı.

## Kobipo için çıkarımlar

1. **İlk C çıktısı = Luca Excel fiş aktarım dosyası** (onaylı yevmiye fişleri; Fiş No/Tarih/Hesap
   Kodu/Borç/Alacak + Evrak No/Tarih/Açıklama, Belge Türü). 50 fiş / dosya sınırı → dosya bölünür
   ya da Fiş Kodu ile gruplanır; mahsup 400 satır sınırı Kobipo'nun fişlerinde aşılmaz.
2. **Hesap planı uyumu en büyük risk:** Kobipo'nun alt hesapları müşavirin Luca'sında yok.
   Seçenekler: (a) aktarımda "ana hesap + cari adı/VKN açıklamada", (b) müşavirin hesap kodunu
   Kobipo'daki alt hesaba EŞLE (Kobipo'da alt hesap kodu müşavirinkiyle aynı tutulur), (c) önce
   hesap planı aktarımı. Karar müşavirle — pilotun ilk sorusu.
3. İkinci çıktı (ucuz, bugün yapılabilir): **fatura listesi Luca "Excel Fatura Aktarımı" biçiminde**
   (Faturaport'un yaptığı) — Kobipo'nun defteri kapalı olan müşteriler için de çalışır.
4. API yolu ücretli ve kapalı; dosya yolu yeterince yaygın. Önce dosya.
5. Müşavirden istenecek: Luca fiş aktarım şablonu (boş + dolu örnek), kullandığı hesap planı.

## Kaynaklar

- Luca destek: [Excel Veri Aktarımı](https://lucayazilim.freshdesk.com/support/solutions/articles/67000267580-01-02-09-excel-veri-aktar-m-) ·
  [Excel Fatura Aktarımı](https://lucayazilim.freshdesk.com/support/solutions/articles/67000271379-01-02-11-excel-fatura-aktar-m-) ·
  [İŞNET alış/satış muhasebeleştirme](https://lucayazilim.freshdesk.com/support/solutions/articles/67000726662-i%CC%87%C5%9Fnet-al-%C5%9F-sat-%C5%9F-faturalar-entegrasyon-ve-muhasebele%C5%9Ftirme-i%CC%87%C5%9Flemleri) ·
  [AEN kontrol paneli](https://lucayazilim.freshdesk.com/support/solutions/articles/67000686860-ak-ll-entegrasyon-noktas-kontrol-paneli-analiz-) ·
  [e-Belge kare kod](https://lucayazilim.freshdesk.com/support/solutions/articles/67000728967-e-belge-kare-kod-luca-mali-m%C3%BC%C5%9Favir-yaz-l-m-entegrasyonu) ·
  [Logo'dan veri aktarımı](https://lucayazilim.freshdesk.com/support/solutions/articles/67000689613-logo-program-ndan-veri-aktar-m-i%C5%9Flemi) ·
  [e-Defter rehberi](https://lucayazilim.freshdesk.com/support/solutions/articles/67000753388-e-defter-uygulamalar-kapsaml-rehber)
- luca.com.tr: [Luca Koza](https://www.luca.com.tr/Sayfa/ozellikler/93) ·
  [Luca Net KOBİ](https://luca.com.tr/Sayfa/ozellikler/94) ·
  [Koza fiyat belgesi](https://www.luca.com.tr/Upload//NBwosWgB/SK65/67c1m0GaS6B9Wec.pdf)
- Diğer: [Mysoft → Luca aktarımı (Korkmaz Digital)](https://korkmazdigital.com/mysoft-e-faturalarinizi-luca-veri-aktarimi-yapin/) ·
  [Rapitek Luca entegrasyonu](https://rapitek.com/luca-entegrasyonu/) ·
  [Denizli müşavir program tercihi (PAÜ)](https://gcris.pau.edu.tr/bitstream/11499/50963/1/Melek%20T%c3%9cRKER%20YL%20Proje.pdf) ·
  [Program fiyat farkı (muhasebetr)](https://www.muhasebetr.com/yazarlarimiz/mehmetcevatkerem/030/)
