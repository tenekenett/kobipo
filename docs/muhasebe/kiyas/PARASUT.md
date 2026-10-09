# Paraşüt ↔ Kobipo muhasebe kıyası (2026-10-09)

Kullanıcı planındaki adım: "A + B + D → **başka bir firmanın projesiyle kıyas** → müşavire çıkış (C)".
Önceki kıyas Aposkal'dı (2026-09-30, `docs/finansal-raporlar/MUHASEBE-DEVAM.md`); dizin `README.md`.

**Yöntem.** Kullanıcının Paraşüt deneme hesabı (firma "Materyon bilişim", 854189), Chrome'da.
Test verisi (kullanıcı izniyle, hesapta DURUYOR — hepsi `TEST Kıyas` önekli):
TL satış 1.000 + %20 → 500 TL kısmi tahsilat; USD satış 100 $ + %20, 1 Eylül (kur 48,1891) →
bugünkü kurla (49,12) 5.895,29 TL tam tahsilat; alış 500 + %20 (ödenecek); "Vergi/SGK Primi"
kaydı "KDV ödemesi" 100 TL, ödendi. GİB'e/e-postaya hiçbir şey gitmedi. Müşavir tarafı (davet
e-posta gönderir) denenmedi; Paraşüt kılavuzundan okundu.

## Özet

Paraşüt kendini açıkça **ön muhasebe** diye konumluyor: yevmiye fişi, mizan, bilanço, hesap planı
YOK. Müşavir "Mali Müşavir Ekle" ile (ad + e-posta) kullanıcı olarak davet edilir; belgeleri
kendi programına dış araçlarla çeker (kılavuzda "Atlas Aktarım"). Yani Kobipo'nun muhasebe
modülünün Paraşüt'te karşılığı yok — kıyasın değeri **sahibin gördüğü yüzde** ve **müşavire
devir biçiminde**.

**Müşavir tarafı (sonradan açık kaynaktan, `AKTARIM-VE-YZ.md`):** Paraşüt Mikro grubundadır.
Müşaviri **Atlas Aktarım** (bedava; Paraşüt/Bizmu faturaları + banka hareketleri, hesap kodunu
otomatik doldurur, Luca'ya tek tuş) ve **ExpressAktarım** (Zirve Nova/Müşavir, Mikro Müşavir)
taşır. Uygulamada görmediğimiz "muhasebe" Paraşüt'ün dışında, bu köprülerde duruyor.

Ölçülen üç doğruluk sorunu (Kobipo'da üçü de doğru çözülmüş):

1. **KDV ödemesi gider sayılıyor.** Gelir-gider raporu "vergiler HARİÇ" görünümde bile 100 TL'lik
   KDV ödemesini gidere katıyor: Ekim net 400 (doğrusu 500). Vergi/SGK kaydı türsüz (KDV mi,
   gelir vergisi mi, SGK mı ayırmıyor). Kobipo: `Transaction.purpose = KDV` kâra girmez.
2. **Kur farkı kayboluyor.** Cari ÇOK DÖVİZLİ tutuluyor ("700,00 ₺ ve 120,00 $" iki sütun);
   TL tahsilat USD faturayı dövizde kapatınca 112,60 TL'lik kur farkı hiçbir rapora girmedi
   (gelir-gider Eylül–Ekim = 1.000 + 4.818,91, fark yok). Kobipo: cari TL, fatura kuruyla; fark
   carinin bakiyesinde açık kalır (−112,60) — görünür ama kapatma yolu kullanıcıya söylenmiyor.
3. **Asistan ile rapor çelişiyor.** "Bu ay toplam kârım nedir?" → **1.200 TL** (KDV dahil satış;
   gideri ve KDV'yi düşmüyor, ~40 sn sürdü, "deneysel"). Gelir-gider aynı ay için 400 diyor.
   Kobipo asistanı rakamın "brüt kâr" olduğunu söylüyor ve maliyetsiz kalemi uyarıyor
   (`lib/asistan/veri/ozet.ts`).

## Ölçülen davranışlar

| Konu | Paraşüt (ölçüldü) | Kobipo |
|---|---|---|
| Defter (fiş, mizan, bilanço, kapanış) | yok | var — taslak fiş → onay, öğrenen hesap seçimi |
| Müşavir | "Mali Müşavir Ekle" kullanıcı türü; aktarım dış araçla | ACCOUNTANT rolü (Ekip); Mizan/Yevmiye/Kebir/mali tablolar Excel/PDF/CSV; Luca/Zirve aktarımı YOK |
| Cari döviz | çok dövizli bakiye, güncel ALIŞ kuruyla değerlenir; kur farkı yazılmaz | TL, fatura kuruyla; fark caride açık kalır |
| Tahsilat formu (dövizli fatura) | bugünkü kur + TL tutar + döviz karşılığı aynı formda | kur alanı + "kasaya X TL yazılır" notu |
| Vergi/SGK | ayrı gider türü: dönem, tutar, ödenecek/ödendi + **vade**; tür ayrımı yok | hareket türü (KDV/TAX/SGK…); tahakkuk muhasebede (360/361); **vade takibi yok** |
| Maaş | "Maaş/Prim": çalışan + tek tutar + hakediş; brüt/net/SGK yok | bordro hesabı (brüt↔net, SGK, vergi), tahakkuk fişi |
| Kasa para girişi/çıkışı | tarih + tutar + açıklama; tür/kategori yok | tür (kredi, ortak, avans…) + kategori |
| KDV raporu | aylık hesaplanan / indirilecek / net + belge dökümü | + tevkifat, beyan takvimi, "beyandan önce" listesi, muhtasar |
| Stok değeri | ürün kartındaki ALIŞ FİYATI × miktar (rapor kendisi yazıyor) | AVCO, belge tarihli; ay sonu satılan malın maliyeti |
| Fatura editörü — kâr | satırda "Alış · Kâr oranı", altta "Toplam Kâr" | yok |
| Fatura editörü — cari | "Bu müşterinin toplam 700 TL borcu bulunmaktadır" | cari özeti paneli (son hareketler) |
| Pano | tahsilat/ödeme halkaları (toplam · gecikmiş · planlanmamış), "bu ay oluşan KDV (geçen ay …)", 12 haftalık nakit akışı, sağda gün gün zaman çizelgesi | KDV durumu kartı, nakit "kaç gün yeter", yaşlandırma kartları |
| Nakit projeksiyonu | açık fatura + **vadeli Vergi/SGK/Maaş kayıtları** | açık cari + çek/senet + çalışan bakiyesi; **KDV/muhtasar/SGK/maaş yok** (`lib/raporlar/nakit-projeksiyon.ts`) |
| Banka | 14 bankayla hesap bağlama, hareketler otomatik | yok (dekont tarama var) |
| Çalışan | avans + maaş + cepten harcama defteri | aynı (avans, masraf defteri) |
| İçe/dışa aktarım | satış/ihracat faturası içe; liste Excel'i | alış/satış/ihracat içe, e-Fatura zip, Kobipo şablonu |

Küçük: gelir-gider raporunda URL `vergiler-haric=true` iken sağ üst düğme "VERGİLER DAHİL" yazıyor.

## Kobipo'ya çıkarımlar (öneri sırası)

1. **Nakit projeksiyonuna vergi, SGK ve maaş** — Paraşüt bunları kullanıcıya ELLE girdiriyor;
   Kobipo hepsini zaten hesaplıyor: KDV beyanı (`computeVatDeclaration`, 28'i), muhtasar + SGK
   (`computeMuhtasar`, 26'sı; `beyan-takvimi.ts`), ödenmemiş net maaş (`PayrollRecord.paidAmount`).
   Sahibin "ayın sonunda param yetecek mi" sorusunun eksik yarısı. Pano ve Nakit Akışı aynı
   fonksiyondan okuduğu için tek yerde girer.
2. **Kur farkını söylemek ve kapatma yolu** — dövizli faturanın tahsilatı farklı kurla kapanınca
   caride kalan farkı ekranda adıyla göster ("kur farkı: 112,60 TL lehinize") ve satışta kur farkı
   faturası taslağı / alışta bakiye kapama öner. Paraşüt farkı yutuyor; Kobipo tutuyor ama
   anlatmıyor. Muhasebede fark 646/656'ya ancak bu belgeyle girer.
3. **Fatura editöründe satır maliyeti ve kâr** — AVCO'dan (`lib/stock/cost.ts`), maliyetsiz
   kalemde "maliyet yok". Küçük iş; asistanın brüt kârıyla aynı tanım.
4. **Cari ekstrede döviz bilgisi** — TL tutarken dövizli faturanın satırında "100 $ × 48,19"
   göstermek; kullanıcı "müşteri bana 120 $ borçlu" diye düşünüyor.
5. **Müşavir daveti kısayolu** — Ekip ekranında "Mali müşavir ekle" (ACCOUNTANT + muhasebe
   sayfaları). C adımına (Luca/Zirve) zemin; küçük.
6. **Banka hesabı bağlama** — Paraşüt'ün en güçlü sahip özelliği; büyük iş ve sağlayıcı kararı
   (bkz. hafıza "altyapı seçimini önce sor").

Kobipo'nun önde olduğu yerler (konumlandırma için): tam defter, bordro, KDV'nin kâra
girmemesi, tevkifat, AVCO/ay sonu maliyet, hareket türleri, asistanın tanımlı kârı.

## Kaynaklar

- Paraşüt kılavuzu: [e-Fatura kullanırken mali müşavirle çalışmak](https://www.parasut.com/kullanim-kilavuzu/e-fatura-kullanirken-mali-musavirle-calismak),
  [Kullanıcı yetkilendirme](https://www.parasut.com/kullanim-kilavuzu/kullanici-yetkilendirme-detaylari),
  [KDV raporları](https://www.parasut.com/kullanim-kilavuzu/kdv-raporlari),
  [Nakit akışı](https://www.parasut.com/kullanim-kilavuzu/nakit-akisi-tahsilat-ve-odeme-takibi)
- Konumlandırma: [Paraşüt muhasebe programı olarak kullanılabilir mi](https://www.parasut.com/blog/parasut-muhasebe-programi-olarak-kullanilabilir-mi)
