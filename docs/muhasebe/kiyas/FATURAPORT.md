# Faturaport — inceleme (2026-10-09)

**Ne:** GİB özel entegratörü + bulut ön muhasebe (faturaport.com, portal.faturaport.com). Hedef:
küçük/orta işletme; mobil uygulaması var (v3.2.2). 14 gün deneme, "10.000+ kullanıcı".
**Yöntem:** kullanıcının hesabı (firma "materyon bilişim", müşteri kodu RF6164), Chrome; veri boş,
e-belge GİB'e gidebileceği için test faturası AÇILMADI — ekranlar, formlar, rapor parametreleri ve
duyurular okundu. Müşavir portalının tanıtım sayfası bot doğrulamasına takıldı; o kısım
Faturaport'un kendi yayınlarından (aşağıda kaynaklar).

## Konum

Paraşüt'ün düzenini izleyen ön muhasebe + kendi entegratörlüğü. **Uygulama içinde muhasebe
(fiş, hesap planı, mizan, bilanço) YOK; kâr/zarar raporu bile yok.** Muhasebe tarafı iki kanalla
müşavire bırakılıyor: (1) KDV raporunun Luca/Zirve biçimli Excel'i, (2) Luca/Zirve/Orka/Dia'ya
doğrudan entegrasyon (2026-06) ve ücretsiz "Mali Müşavir Portalı".

## Menü

Anasayfa · Cariler · Taslaklar · Faturalar · Gelir & Gider · Hesaplar · Siparişler · Proforma &
Teklif · Stok · e-İrsaliye · e-SMM · e-Ticaret · Çek & Senet · Personel · Raporlar · Paketler ·
Ayarlar · Destek · Duyurular. Ayarlar: kaşe & logo, birimler, açıklamalar, IBAN, kategoriler,
kullanıcılar, firma, paket, **GİB kullanıcı bilgileri** (e-Arşiv portal şifresi), e-Fatura
tasarımları, SMS, e-Ticaret, hesap, **API**.

## Muhasebe tarafı (ağırlıklı)

### 1. Muhasebe programına aktarım — KDV raporu (RP-10)

Rapor penceresi: *"Diğer programlara aktarım için veri aktarımı formatını seçiniz."*

| Parametre | Seçenekler |
|---|---|
| Format | **Luca · Zirve · Diğer** |
| Fatura türü | Gelen · Giden · Gider Fişi |
| İptal/Ret dahil | Hayır / Evet |
| Çıktı | Ekran · Excel (+ "Gönder": e-posta) |

Ekrandaki sütunlar (Luca ve Zirve'de ekranda aynı; fark Excel'de olabilir — veri olmadığı için
Excel indirilemedi):

```
Fatura No | Fatura Tarihi | VKN/TCKN (Alıcı) | Alıcı | Fatura Para Birimi | Döviz Kuru |
Ödenecek Tutar | %0 KDV Matrah | %0 KDV | %1 KDV Matrah | KDV %1 | %10 KDV Matrah | KDV %10 |
%20 KDV Matrah | KDV %20
```

Yani aktarım **yevmiye fişi değil, fatura başına tek satır, KDV ORANINA göre matrah/KDV**. Hesap
seçimi (600/153/770, 191/391, 120/320 alt hesapları) müşavirin programında yapılıyor. Tevkifat,
ÖTV, istisna kodu sütunu ekranda görünmedi.

### 2. Doğrudan entegrasyon — Luca, Zirve, Orka, Dia (duyuru 2026-06-17)

"e-Fatura ve e-Arşiv faturalarınız … kullandığınız uyumlu muhasebe programına otomatik olarak
aktarılıyor." Ücret: **resmî muhasebe programına yıllık 1.000 TL + KDV** (programın e-belge
entegrasyon ücreti; Faturaport'a değil). Açmak için destekle iletişim; ayarlarda ekranı yok.
→ Luca/Zirve/Orka/Dia'nın e-belge çekme uçları var ve ücretli; bir entegratör onlara bağlanabiliyor.

### 3. Mali Müşavir Portalı (müşavire ÜCRETSİZ)

Faturaport'un yayınlarına göre: müşavir mükelleflerinin gelen/giden e-Fatura ve e-Arşiv
kayıtlarını tek ekranda görür, Excel'e ya da Luca/Zirve'ye toplu aktarır, toplu PDF indirir;
müşaviri mükellef davet eder. Müşavir başvurusu: hesap aç → "Mali Müşavir Başvurusu" (telefon,
e-posta, **mükellef sayısı**, vergi levhası ya da e-Birlik faaliyet belgesi) → 1 iş günü onay.
Müşavire "ücretsiz ve sınırsız e-SMM". Pazarlamada hâlâ "Ba-Bs raporları" geçiyor (Ba-Bs Eylül
2024'ten beri yok — eski metin).
→ Strateji: **müşavir dağıtım kanalıdır** — müşavire bedava portal + e-SMM, mükellef ücretli.

### 4. Kullanıcı ve rol

Kullanıcı ekleme: ad, soyad, e-posta, telefon, rol, **şifre (hesap sahibi belirliyor)**. Rol
yalnız **Kullanıcı / Yönetici**; müşavir rolü yok (müşavir ayrı portaldan).

## Ön muhasebe tarafı (özet)

- **Gelir & Gider:** gider türleri Hızlı Fiş/Fatura · Detaylı Fiş/Fatura · Maaş · Vergi · Banka
  Gideri (Paraşüt'le birebir); döviz sekmeleri ₺ $ € £; "Gider ödeme durumu" kartı.
- **Hesaplar:** Kasa · Banka · Kredi Kartı · POS; her döviz için ayrı kasa kendiliğinden açılmış
  (USD/EUR/GBP/TRY Kasa). Hesap ekstresi, tahsilat/ödeme, gün sonu raporları.
- **Personel:** maaş, avans, prim, **izin hakkı** (yıllık izin bakiye raporu RP-25/26).
- **Cari:** döviz sekmeleri (çok dövizli bakiye, Paraşüt gibi).
- **Anasayfa:** taslak / okunmayan / yazdırılmayan fatura sayaçları, fatura-gider özeti, **KDV
  panosu** (bu ay satış/alış KDV'si), cari hesap özeti, firma bilgisi eksikleri (adres, vergi
  dairesi, VKN, e-posta), kalan gün + kontör.
- **Raporlar (32):** cari borç-alacak, ekstre, hareket, liste; gider; ürün; fatura; hesap
  hareketleri; KDV (aktarım); teklif, proforma, e-ticaret sipariş; e-Arşiv / GİB e-Arşiv /
  e-Fatura gelen-giden; çek, senet; e-posta gönderim; izin; personel; vade; ödeme-tahsilat; gün
  sonu; stok hareket. **Kâr/zarar, nakit akışı, bilanço, mizan yok.**
- Yakın tarihli eklemeler: alış faturasını stoğa işleme (2026-09), iki adımlı doğrulama, e-SMM.

## Kobipo için çıkarımlar

1. **Müşavire çıkışın en ucuz biçimi = KDV oranına bölünmüş fatura Excel'i (Luca/Zirve).**
   Pazar bunu bekliyor: müşavir fişi kendi programında, kendi hesap planıyla kuruyor. Kobipo'nun
   defteri bundan İLERİDE (fiş hazır) — ama müşavirin programına girmeyen fiş müşavire bir şey
   kazandırmaz. C adımında iki çıktı düşünülmeli: (a) fatura listesi Luca/Zirve biçiminde (bugün
   yapılabilir, KDV kuralı `lib/raporlar/kdv-kural.ts`ten), (b) onaylı yevmiye fişleri Luca fiş
   aktarım biçiminde (Luca raporunda).
2. **Doğrudan entegrasyon ücretli ve program tarafında** (yıllık 1.000 TL + KDV müşavirin
   programına). Kobipo entegratör değil (Mysoft bayisi); bu yol ancak Luca/Zirve'nin bir API'si
   varsa ve Mysoft'tan bağımsız çalışıyorsa — araştırılacak (Luca raporu).
3. **Müşavir kanalı:** bedava müşavir portalı (çoklu mükellef, toplu indirme) bir dağıtım
   stratejisi. Kobipo'da ACCOUNTANT rolü firma bazlı; müşavirin birden çok mükellefi tek ekranda
   görmesi yok.
4. Kobipo'nun önde olduğu yerler: kâr/zarar, nakit akışı ve projeksiyon, bilanço, tam defter,
   bordro hesabı, KDV'de tevkifat.

## Kaynaklar

- Uygulama içi: Duyurular (2026-06-17 "Luca, Zirve, Orka, Dia Entegrasyonu Eklendi"), RP-10.
- [Mali Müşavir Portalı](https://faturaport.com/ozellikler/mali-musavir-portali) ·
  [Mükelleflerinizle Tam Entegrasyon](https://www.faturaport.com/mali-musavir-modulu) ·
  [Faturaport mali müşavirleri evrak işlemekten kurtarıyor](https://faturaport.com/blog/on-muhasebe/faturaport-mali-musavirleri-evrak-islemekten-kurtariyor) ·
  [Mali müşavir/SMMM için faydalar](https://faturaport.com/blog/on-muhasebe/mali-musavir-smmm-icin-faturaport-uygulamasinin-faydalari-nelerdir)
