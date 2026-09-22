# Apsiyon incelemesi

> 2026-09-22'de yapıldı. **Arayüz tıklanmadı**: yardım merkezi (destek.apsiyon.com) ve ürün giriş istiyor.
> Kaynak Apsiyon'un resmî eğitim kanalı ([YouTube @apsiyonegitim](https://www.youtube.com/@apsiyonegitim), 218 video).
> Uzun webinarlarda eğitmen ekranı paylaşıp menü menü tıklayarak anlatıyor. 73 videonun Türkçe otomatik
> altyazısı indirilip okundu. Videolar 2020–2025 arası; eski videolarda bazı menü adları farklı
> ("Aidat İşlemleri" ile "Borçlandırma ve Tahsilat" gibi). Ürün sayfaları da okundu.
> Ham metinler repo dışında: `C:\Users\user\kobipo\arastirma\apsiyon\`.

## 0. Özet

Apsiyon, apartman, site, rezidans, AVM ve iş merkezi yönetimi için bulut yazılımı. Sitesine göre 25.517 site/apartman, 1,73 milyon konut ve 4,2 milyon kullanıcı. Rakibi Siyonet'i 2017'de satın aldı.

Ürün ailesi:
- **Apsiyon:** ana ürün.
- **Apsis:** küçük apartmanlar için.
- **AVM yönetimi.**
- Geçiş kontrol sistemleri, uzaktan sayaç okuma, sigorta (Sigortayeri), "Apsiyon Life" asistans paketleri.
- Yapay zekâ ürünleri: **ADA** (sakinlerin WhatsApp botu), **ASYA** (yöneticiye mevzuat asistanı), **Veri Stüdyosu** (beta).

Temel mantık:
- Her şey **Finans'tan** girilir. Muhasebe fişleri tek yönlü ve otomatik oluşur; muhasebeden elle girilen kayıt finansa geçmez.
- Sistem şunların üstüne kurulu: blok/daire/kişi (malik–kiracı) ilişkisi, evrak kategorisi, toplu/otomatik/Excel borçlandırma, banka hareketini evrağa dönüştürme ve ödeme koduyla eşleştirme.

## 1. Menü yapısı (Blue/Black arayüz)

- **Sol menü:** Özet · Site · Finans · Sayaç İşlemleri · Teknik · Güvenlik · Muhasebe · Raporlar (Analizler dahil) · Tanımlar · İletişim · Web Sitesi · ADA.
- **Ayarlar:** sol alttaki çark.
- **Sağ üst:** bildirimler (örn. "bekleyen 9 banka hareketiniz var"), Veri Stüdyosu, ASYA.
- **Menü sayfalarındaki iki buton:** yeşil X Excel'e çıktı alır, mavi X içeri aktarım yapar. İkisi de kişi bazında yetkiyle açılıp kapanır.
- **Özet ekranı:** "Efsane yöneticinin kurulum sihirbazı" (5 adım: veri aktarımı, banka entegrasyonu, kredi kartı, SMS, davetiye) · kasalar (devir, giren, çıkan, kalan; tıklayınca kasa ekstresi) · gelir/gider dağılımı pasta grafiği · aidat tahsilat durumu (tahakkuk ile tahsil edilen) · son eklenen gelir/gider evrakları · ödenecek faturalar · yapılacak işler (hatırlatıcı) · iş takibi · stok · duyurular · banka hesapları. Bölümler filtre butonundan açılıp kapanır ve sürüklenip sıralanır. Gece modu var.

## 2. Temel kavramlar ve tanımlar (Tanımlar menüsü)

- **Hiyerarşi:** Ada → Blok (blok kodu, sabit aidat) → Daire. Bağımsız bölümün adı değiştirilebilir, örneğin AVM'de "Dükkân".
- **Daire:** daire tipi (3+1, stüdyo…), daire grubu (denize bakan, asansörden muaf…), arsa payı, net/brüt m², kişi sayısı, sabit aidat. Tip, grup ve bloğa da sabit aidat tanımlanabilir.
- **Kişi kaydı:** ad soyad, e-posta (2 tane), telefonlar, adres, iletişim dili, fotoğraf, ilgilisi (emlakçı, eş…), öğrenim, meslek, evcil hayvan, kimlik bilgileri, araçlar, iletişim geçmişi (gönderilen e-posta, SMS, WhatsApp, posta; iletildi/okundu tarihleri).
- **Kişi–daire bağı:** kişi daireye malik ya da kiracı olarak, giriş tarihi ve hisse payıyla eklenir. Çıkışta borç varsa sistem sorar: kişiye transfer mi, tahsil et mi, olduğu gibi çıkar mı? Eski malik ve kiracılar "geçmiş kayıtları göster" ile görülür.
- **Gider tanımı.** Aidat dışı borçlandırma türü de buradan gelir; örneğin demirbaş borcu bir gider tanımıyla yazılır ama raporlarda gelir tarafına geçer. Alanları:
  - dağıtım şekli: eşit, arsa payı, brüt/net m², kişi sayısı, grup/tip/blok/daire çarpanı (örn. A blok %50, B blok %50, blok içinde eşit);
  - kimden: "varsa kiracı yoksa malik" ya da "sadece malik";
  - gider grubu ve muhasebe kodu;
  - "raporlara dahil değil" seçeneği (denetim raporuna her durumda girer).
- **Gelir tanımı:** aidat, faiz/fon geliri, tesis rezervasyon geliri gibi.
- **Evrak kategorileri** (aidat, doğalgaz, demirbaş…). Tahsilat kategori bazında kapanır. Kategori seçilmezse para önce en eski borcu kapatır. Kategorisiz kayıtlar "Genel"e düşer.
- **Genel hesaplar:** tam karşılığı olmayan kalemler (ödenecek SGK gibi), yalnız virmanda kullanılır.
- **Kasa ve banka tanımı:** nakit ya da banka kasası. Bankada IBAN, TCMB şube kodu (web sitesinde görsel için) ve **hesap unvanı** tutulur. Hesap unvanı kart tahsilatının aktarımı için kritik: bazı bankalar ilk 4 ya da 7 karakterin tutmasını istiyor, tutmazsa para bankada kalıyor.
- **Cari (firma):** unvan, vergi no, e-posta, yetkililer, IBAN. **Banka eşleştirme kodu:** açıklamasında bu kod geçen hareket bu cariye eşlenir; "evrakı otomatik oluştur" seçilirse onay beklemeden işlenir. Seçili carilere toplu mutabakat e-postası ve toplu cari ekstresi gönderilebilir.

## 3. Borçlandırma

**Toplu borçlandırma** (Finans → Borçlandırma ve Tahsilat → Toplu Borçlandırma). Alanlar:
- **Evrak tarihi:** ileri tarih verilirse sakin o tarihe kadar borcu görmez, yönetici görür.
- **Aidat dönemi:** bazı raporlar döneme, bazıları evrak tarihine bakıyor; ikisi aynı ay olmalı.
- **Son ödeme tarihi.**
- **Gecikme tazminatı:** başlama tarihi (genelde son ödemeden bir gün sonra); oran (varsayılan %5, KMK md. 20); **aylık** (bir gün geçse bile tam ay tazminatı) ya da **günlük** (aylık tazminat ÷ 30, her gün); tazminat hesap tarihi (tazminat tarihinden, son ödeme tarihinden ya da evrak tarihinden itibaren). Tazminat kalan ana para üzerinden hesaplanır.
- **Kim borçlandırılsın:** "varsa kiracı yoksa malik" ya da "sadece malik". Normalde ayın 1'inde dairede kim oturuyorsa o. "Evrak tarihine göre…" seçenekleri evrak tarihinde oturanı alır.
- **Boş daireler hariç.**
- **Borçlandırma türü:** aidat ya da bir gider tanımı.
- **Yeni evrak oluştur:** kapalıysa aynı parametreli farklı türler tek makbuzda satır olur.
- **Kategori.**
- **Dağılım şekli:**
  - her daireye eşit;
  - bloğa, tipe ya da gruba göre;
  - dairelere göre: her dairenin kendi aidatı. Toplu düzenleme var: "+500 TL", "%17,5 artır", "hepsini 5.000'e eşitle";
  - işletme projesine (bütçeye) göre;
  - net/brüt m² ya da arsa payı başına birim fiyat.
- **Açıklama:** boş bırakılırsa dönem açıklamasını sistem yazar.

**Otomatik borçlandırma:** her ay aynı gün ve saatte çalışır; bitiş tarihi ve hafta sonuna denk gelirse kaydırma var. "Kayıttaki değerleri kullan" seçilirse daire aidatı güncellenince yeni tutarla devam eder; böylece yıllarca tek bir tanım yeter. Geçmiş tarihe çalışmaz.

**Excel ile borç yükleme:**
- Daire listesi indirilir, Gider1–5 tutar ve açıklama sütunları doldurulur (örn. sayaç firmasının gönderdiği tutarlar).
- Sütunlar eşleştirilir ve eşleştirme **şablon** olarak kaydedilir; sonraki ay tekrar kullanılır.
- "Başlangıç ve bitiş tarihine göre" seçilirse ay içinde el değiştiren dairede gün bazlı paylaştırma yapılır.

**Bireysel borçlandırma:** kişinin finansal durum ekranından.

**Geri alma:** Ayarlar → İşlem Geçmişi. Son 30 gün toplu ya da seçerek geri alınır; örneğin toplu borçlandırmanın tamamı ya da bazı kişileri. Borç makbuzunda "gecikme tazminatı ve icra takibi" bölümünden tek kişinin tazminatı kapatılabilir.

## 4. Kişilere göre finansal durum ekranı (en çok kullanılan ekran)

- **Görüntüleme:** kişi başı bakiye, kategori kırılımları, yalnız gecikenler, son 1/3/6 ay filtresi. En yeni hareketler üstte.
- **İşlem sabitleme:** bir tahsilatın hangi borçları kapattığı gösterilir.
- **Tahsilat:** tahsil et (tek kategori), detaylı tahsil et (birden çok kategori), tahsil et ve yazdır.
- **Gönderim:** SMS, e-posta, hesap ekstresini e-postayla gönder, borçsuzluk belgesi.
- **Toplu seçim:** filtreyle ("B-" yazınca B blok gibi) kişiler seçilir, hepsine hesap ekstresi ya da detaylı borç listesi e-postayla gider.
- **Fazla bakiyeyi aktar:** bir kategoride fazla ödemesi olup başka kategoride borçlu görünen kişinin parasını tek tıkla virmanlar. Ayrı bir ekranda bu durumdaki herkes listelenir ve tek tuşla toplu virman yapılır. En sık şikâyetin ("parayı ödedim ama borçlu görünüyorum") çözümü.
- **Ödeme skoru (1–5):** son 6 ayın tahsilatına bakar. Site skoru ile kişi skoru ayrı; Türkiye ve il ortalamasıyla karşılaştırma; popüler ödeme günü ve tahsilat kanalı oranları. Raporlar → Analizler.
- **Liste araçları:** kolon seçimi, satır numarası, "arasında" filtresi (min–max tutar), seçilenlerin dip toplamı.

## 5. Tahsilat kanalları

- **Kredi kartı (iyzico altyapısı).** Komisyonu sakin öder; oran paranın hesaba geçme süresine göre değişir:

  | Hesaba geçiş | Komisyon |
  |---|---|
  | 1 iş günü | %4,99 |
  | 7 iş günü | %3,99 |
  | 15 iş günü | %2,99 |
  | 39 iş günü | %0 |

  Kart saklama ve otomatik ödeme talimatı var. Kart kullanımı kapatılabilir.
- **Ödeme kodu:** her sakin ve daireye özel bir kod. Havale açıklamasına yazılırsa ödeme kendiliğinden eşleşir. Kodların raporu alınır, "ödeme kodu bildirimi" şablonuyla sakinlere gönderilir.
- **Toplu tahsilat:** seçilen dönem için birden çok kişiye tek seferde.

## 6. Banka hareketleri (Finans → Banka Hareketleri)

- **Kaynak:** entegrasyon (sitesine göre tüm bankalar) ya da Excel (tarih, açıklama, tutar sütunları; sürükle-bırak). Excel, entegrasyonun kurulduğu süre boyunca ya da entegrasyonsuz kasalar için kullanılıyor.
- **Otomatik eşleşme:** açıklamada ad-soyad, TCKN, telefon ya da ödeme kodu geçerse kişiyle eşlenir. Soyadı "Demirbaş" olan biri "demirbaş ödemesi" açıklamasıyla yanlış eşlenebiliyor.
- **Her hareket onaylanırken evrağa dönüştürülür:**
  - aidat tahsilatı (kişi ve kategori seçilir; kategoriye göre dağıtım varsayılanı ayarlanabilir);
  - ödeme makbuzu (gider + cari). **"Fatura oluştur" işaretlenirse aynı tutarda gider faturası ekranı açılır**; otomatik ödeme talimatıyla çekilen faturalar için;
  - gider fişi (masraf, EFT ücreti);
  - gelir fişi (faiz, fon);
  - tahsilat makbuzu (cariden gelen);
  - kasa transfer fişi;
  - aidat iadesi;
  - maaş ödemesi (personel modülü varsa).
- **Tutarı bölme:** "Kalan 725 TL için kayıt oluştur" ile tek hareket birden çok kişiye ya da evrağa bölünür.
- **Otomatik onay seviyeleri** (Ayarlar → Parametreler → Online Banka):

  | Seviye | Neye göre eşleşince onaylar |
  |---|---|
  | Kapalı | Hiç onaylamaz |
  | Düşük | Ad-soyad (eğitmen önermiyor: bir sitede aynı isimde 9 kişi görmüş) |
  | Orta | TCKN, telefon |
  | Yüksek | Yalnız ödeme kodu |

- **Hareket filtresi:** yalnız aidat, aidat ve eksi hareketler, yalnız gelen ya da hepsi.
- **En sık hata:** iki entegre banka arasındaki transferde iki bacak da onaylanıyor ve kayıt mükerrer oluyor. Doğrusu: birini silmek, diğerini kasa transferi olarak onaylamak. Artı hareketi onaylarken paranın çıktığı kasa, eksi hareketi onaylarken girdiği kasa seçilir.
- **En sık destek konusu:** Apsiyon'daki kasa bakiyesi bankadakiyle tutmuyor. Tek çözüm iki ekstreyi satır satır karşılaştırmak; "her gün ya da haftada bir mutabık olun".

## 7. Gider, gelir ve cari evrakları (Finans → Gider / Gelir)

- **Gider faturası:**
  - **Açık** (vadeli): ödeme planı eklenir, özet ekranda "ödenecek faturalar"a düşer; ödemesi sonra ödeme makbuzuyla girilir.
  - **Kapalı** (ödenmiş): çıkış kasası seçilir; ayrıca ödeme makbuzu **girilmez**, yoksa kayıt mükerrer olur.
  - Eğitmenin uyarısı: açık faturayı sonradan kapalıya çevirip tarih değiştirmek yıl sonu raporlarını bozar.
- **Ödeme makbuzu, gider fişi (masraf), tekrarlanan gider** (her ay aynı gün; Finans → Tekrarlanan Gider'den kapatılır).
- Gelir tarafı giderin aynası: gelir faturası, tahsilat makbuzu, gelir fişi (faiz, fon).
- **Çıktı ve gönderim:** A5 tek kopya ya da A4 iki kopya makbuz; ek dosya; "rapor gönder" ile cariye e-posta; toplu yazdırma.
- **Açılış fişleri** (başka sistemden geçişte): cari, kasa, gelir ve gider açılış fişi; devir bakiye girişi (gecikme tazminatı ve icra ayarlarıyla).
- **Hesaplar arası virman:** kişiden kişiye, kategoriden kategoriye. "Bakiyeli virman kaydedilmesin" ayarı borç ile alacağı tutmayan virmanı engeller.

## 8. İşletme projesi (bütçe)

- Finans → İşletme Projesi → yeni proje (ad, yıl, başlangıç ayı). Gider ve gelir satırları yıllık tutarla girilir, 12 aya bölünür; aylar tek tek de değiştirilebilir (örn. havuz yalnız yaz ayları). Excel'den aktarılabilir.
- **Dağılım raporu:** her dairenin aidatının kalem kalem nereye gittiği ("kapıcıya 14,87 TL, muhasebeye 3,62 TL"). **"Dağılım raporunu gönder"** ile her sakine kendi payı e-postayla gider.
- **Planlanan–gerçekleşen raporu:** kalem ve ay bazında sapma yüzdesi.
- Toplu borçlandırmada "işletme projesine göre dağıt" seçeneği.
- Yıl içinde aidat zammı olursa yeni bütçe açılır ya da 6 aylık iki bütçe kullanılır.

## 9. İcra

- Raporlar → Dökümler → İhtarname: vadesi geçmiş ya da icradaki evraklar, asgari borç ve gün filtresiyle.
- **İcraya verme:** makbuz bazında, icra tarihi ve dosya no ile. İcra tarihinden sonra tazminat durur.
- Çok makbuz için aidat makbuzları listesinde **toplu güncelle** kullanılır.
- **Kısmen ödenmiş borç** doğrudan icraya verilemez; aynı kişiye alacak/borç virmanı açılıp borç satırı "icra takibinde" işaretlenir.
- İcradan gelen para, tahsil et ekranında "icra takibi" işaretiyle kaydedilir.
- Varsayılan icra kategorisi ayarlanır; o kategoride virman yapılırsa kayıt kendiliğinden icra takibine girer.

## 10. Sayaç (Sayaç İşlemleri menüsü)

- **Yapı:** ana sayaç ve daire sayaçları. Daire sayaçları otomatik oluşturulabilir ya da Excel'den aktarılabilir. İlgili gider tanımının dağıtım şekli "daire sayaçlarına göre" olmalı ve ana sayaca bağlanmalı.
- **Üç yöntem:**
  1. **Fatura üzerinden:** faturanın bir yüzdesi ortak alan olarak m²'ye göre, kalanı tüketime göre.
  2. **Birim fiyat üzerinden.**
  3. **Yakıt ve sıcak su:** ısı yönetmeliğine uygun. Üç kalorimetre sayacı (doğalgaz, sıcak su, soğuk su), su çıkış sıcaklığı ve yakıt sabiti girilir. Daire başına **gider paylaşım belgesi** üretilir.
- İlk ve son okuma değerleri elle, Excel'den ya da mobil uygulamada gözle okumayla girilir.
- Tüketim farkı paylaştırması, okuma bedeli, ara dönem borçlandırması, sayaç raporları var.
- Uzaktan okuma entegrasyonu ile borçlandırmayı Apsiyon kendisi yapıyor.

## 11. Personel ve bordro (ayrı ücretli modül)

- **Personel kartı:** SGK meslek kodu, net/brüt ücret, engellilik indirimi, yol, yemek ve yakacak yardımı, huzur hakkı, AGİ/BES, IBAN, muhasebe kodu (335).
- **Personel hesap tanımları:** brüt ücret gideri, SGK işveren payı gideri, ödenecek SGK carisi gibi. Eksik kalırsa kayıtlar 999'a düşer.
- **Puantaj:** tek tek ya da toplu. Fazla mesai, resmi tatil, izinler, yemek günü girilir; kümülatif gelir vergisi matrahıyla bordro hesaplanır. İlk kayıtta önceki matrah istenir.
- **Kesinleştirme:** tahakkuk virmanı ve muhasebe fişi oluşur.
- **Maaş ödeme talimatı:** bankaya verilecek çıktı. Maaş ödemesi banka hareketinden de onaylanabilir.
- **Raporlar:** bordro çizelgesi, personel ekstresi. Parametreler: mesai çarpanları, yemek ve ulaşım tipi, 3 günden kısa rapor ücreti.
- Eğitmenin notu: muhasebecinin bordrosuyla tutmaması genelde girdilerin (gün, mesai çarpanı) farklı olmasından.

## 12. Raporlar

- **Listeler:**
  - borç makbuzları (tazminat tarihine göre; ödenen ana para ve tazminat ayrı);
  - cari hesap listesi;
  - **dönemsel bakiye listesi** (devir, dönem içi borç, iade, tahsilat, virman, bakiye; muhasebede 120'ye eşit);
  - **detaylı borç listesi** (dönem bittikten sonra yapılan tahsilatı da düşerek gösterir; "Ekim 2024 aidatından kimin borcu kaldı" sorusu için);
  - tahsilat makbuzları (ana para, tazminat, kasa).
- **Sık karıştırılan fark:** borç makbuzu raporundaki "tahsil edilen" o dönemin borçlarından tahsil edileni gösterir; tahsilat makbuzu raporu o tarihte yapılan tüm tahsilatları. Bu yüzden ikisi tutmaz. Özet ekrandaki aidat grafiği için de aynısı geçerli.
- **Ekstreler:** kasa, cari, sakin hesap, personel, online banka.
- **Dökümler:**
  - özet gelir-gider (tahakkuk ya da ödeme esaslı);
  - gelir-gider raporu (kalem detayı);
  - **denetim raporu** (hepsinin tek raporda toplamı: gelir, gider, kasa, kişiler, cariler, genel hesaplar, personel);
  - işletme defteri (noter onaylı sayfalara A4 basılır);
  - işletme projesi dağılımı, planlanan–gerçekleşen, ihtarname.
- **İletişim raporları:** hazirun listesi (genel kurul imza ve vekâlet), anket, banka ödeme kodları, SMS/e-posta/WhatsApp durum.
- **Grafikler ve Analizler** (ödeme skorları).

## 13. Muhasebe modülü (ayrı ücretli)

- Entegrasyonu yalnız destek ekibi açıyor. Geçmiş fişlerin güncellenmesi de destekten isteniyor.
- **Tek düzen hesap planı tek tuşla kuruluyor:** kişiler 120, kasa 100, banka 102, kredi kartı 108, cari 320, personel 335, gelir 600, gider 740/770, kodsuz kayıtlar 999.
- "Basit kullanım" seçilirse yeni tanımların kodu kendiliğinden verilir. "Muhasebe kodu zorunlu" ayarı var.
- Finans açılış kayıtları yalnızca muhasebedeki açılış fişiyle muhasebeleşir; bu fiş parametrelerdeki başlangıç dönemine yazılır.
- **Mizan**, açılış tarihinden alınır; ara dönem mizan alınamaz. "Ödenmemiş borçlara ait geçici tazminatlar hesaplansın" seçilmezse finans ile tutmaz.
- **Kontrol eşitlikleri:**
  - hazır değerler = özet ekrandaki kasa toplamı;
  - 120 = dönemsel bakiye listesi;
  - 320 = cari hesap listesi;
  - 600/740 = özet gelir-gider.
- **Dönem kapanışı:** yansıtma hesapları (740→741, 770→771) ve sonuç hesapları (741→622, 771→632) seçilir. Beş fiş oluşur (yansıtma, gelirlerin kapatılması, net kâr/zarar, kapanış, açılış) ve evrak kilit tarihi kendiliğinden konur. Geri almak için bu beş fiş silinir.

## 14. İletişim menüsü

- **Kanallar:**
  - e-posta: ücretsiz; ek dosya ve HTML (kaynak editörü) destekli;
  - SMS: Corvass entegrasyonu, bakiye satın alınır; karakter sınırı fiyatı etkiler; davetiye SMS'leri ücretsiz (başlık ayarı kapalıysa);
  - mobil bildirim: yalnız uygulamaya bağlanmış kişilere;
  - **WhatsApp:** yöneticinin kendi telefonu WhatsApp Web gibi QR ile bağlanıyor. Business hesapla çalışmıyor; toplu gönderimde spam şikâyetiyle numara kapatılabiliyor; ileri tarihli gönderim yok;
  - **sesli mesaj:** Bulutfon santraliyle, insan sesiyle arama;
  - **posta dökümü:** ihtarnamelere PTT barkodu basılıyor, teslim durumu PTT servisinden sorgulanıyor;
  - **e-bildiri:** sakin uygulamayı açınca çıkan duyuru;
  - telefon rehberi.
- **Hedefleme:**
  - gruplar: kiracılar, malikler, borçlular, alacaklılar, cariler, personel, rehber, oturanlar…;
  - filtreler: blok, kat, daire tipi/grubu, iletişim dili, icra durumu, cinsiyet;
  - borç alt/üst sınırı, yalnız gecikenler, gecikme günü;
  - ileri tarihli gönderim ve bekleyen bildirimler.
- **Akıllı etiketler:** {adı soyadı}, daire, kategorili bakiye, **kişiye özel ödeme linki**, site adı. Hazır şablonlar (bakiye bildirimi, bilgi güncelleme formu, ödeme kodu…) ve kendi şablonları (ek dosyalı).
- **Çok dil:** ayarlardan diller açılıyor (sitesine göre 8 dil); kişinin iletişim diline göre şablonun o dildeki metni gidiyor.
- **"ADA ile içerik oluştur":** istek yazılır, ton (samimi/normal/resmî) ve uzunluk seçilir, metin etiketlerle birlikte üretilip açık dillere çevrilir.
- **Otomatik bildirimler:** örneğin son ödeme gününden X gün önce, en az Y TL borcu olana, saat 06.30'da bakiye e-postası. Doğum günü, iş takibi durumu ve rezervasyon bildirimleri de var.
- **Bilgi güncelleme formu:** sakine e-postayla link gider; güncellenen alanlar Site → Onay Bekleyen Kişi Güncellemeleri ekranında alan alan onaylanır.

## 15. Web sitesi ve sakin tarafı

- **Web sitesi:**
  - alt alan adı (`siteadi.apsiyon.com`, talep ve onay ile);
  - başlık, sosyal medya;
  - fotoğraf galerisi (vitrin);
  - duyurular (tip, tarih aralığı, kime: malik/kiracı/blok/daire tipi, herkese açık, görsel; yeni duyuruda otomatik bildirim);
  - anketler (tek/çok seçenek, yorum, sonuçları gizle, rapor);
  - **siteye özel sayfalar** (hiyerarşik, örn. Genel Kurul → 2024/2025 kararları, ekli);
  - hakkımızda, iletişim, tema (renk, logo, raporlara logo, e-postaya amblem, **raporlara kaşe-imza PNG**).
- **Web sitesi erişim hakları (şeffaflık ayarı):** yönetici sakinin göreceği her bölümü tek tek açıp kapatır. Anket, duyuru, rezervasyon, havuz değerleri, iş talebi, yönetim kadrosu, banka bilgileri, ziyaretçi, kargo, kişisel finansal durum, bireysel raporlar (ekstre, gider paylaşım belgesi, tüketim), site raporları (borç listesi, gelir-gider, işletme projesi, kasa durumu…) bunlara dahil.
- **Sakin mobil uygulaması (iOS, Android, Huawei):** aidat görme ve kartla ödeme, ekstre ve makbuz, iş talebi (mesajlaşma, iş bitince memnuniyet anketi), ziyaretçi, kargo, duyuru, anket, rezervasyon, havuz değerleri, ilan panosu, telefon rehberi.
- **Kullanıcı istatistikleri:** "sisteme bağlanan kişi / GSM'i olan kişi" oranı. Eğitmen: bağlantı oranı arttıkça yönetim ofisinin işi azalıyor.
- **Denetlenebilir kiracılar:** açılırsa malik, kiracısının borcunu görebiliyor.
- **Yönetici mobil uygulaması:** finansal durum, banka hareketi onayı, tahsilat, kişi kartları, rezervasyon onayı, iş ve bakım emirleri, tur kontrol.

## 16. Yapay zekâ ürünleri

- **ADA (sakinler için WhatsApp botu):**
  - Asansöre asılan QR posterle açılıyor; uygulama gerekmiyor, yalnız sisteme bağlı olmak yetiyor.
  - Yapabildikleri: bakiye, hesap ekstresi (PDF), IBAN ("havale yapacağım ama nereye" gibi serbest sorulara), kart ödeme linki, sesli mesajla iş talebi açma.
  - Site e-postasına gelen soruları da yanıtlıyor. İstanbul'da İBB/İSKİ kesinti bildirimleri pilot olarak.
  - Yönetim panelinde konuşmalar, geri bildirim, kredi bakiyesi, günlük mesaj limiti ve ses kaydı süresi ayarı var.
  - Kredi usulü: başlangıçta ücretsiz kredi verildi.
- **Sesli arama:** Bulutfon üzerinden, yazılan metin insan sesiyle okunarak sakinler aranıyor; toplu ve etiketli.
- **ASYA:** yöneticilere mevzuat soruları için WhatsApp asistanı. Bir hukukçu eğitmenin bilgisiyle "dijitalleştirilmiş".
- **Veri Stüdyosu (beta):** doğal dille çok tablolu sorgu ("B bloktaki maliklerin telefonları, aidatları ve %78,5 artırılmış hali") → Excel. Yaklaşık 4,5 saniyede cevap.

## 17. Diğer modüller

- **Tesis-rezervasyon:**
  - Tesis tipi, çalışıyor, onay gerekli, TC zorunlu, misafir (TC zorunlu, azami sayı), kapasite, m², sözleşme onayı.
  - Haftalık çalışma saatleri; saatlik ya da günlük; bloklu kullanım (yalnız tam saat katları); en az/en fazla süre; günlük/aylık/aktif limit; iptal süresi; temizlik arası.
  - **Ücretli tesis:** kartla ödeme ya da aidata yansıtma; **belli tutarın üstünde borcu olan rezervasyon yapamaz.**
  - Kartlı/QR geçişle entegre: rezervasyon saatindeyse kapı açılır.
- **İş takibi:** sakin uygulamadan ya da yönetici telefonla gelen talebi girer. Kanban panosu (beklemede, inceleniyor, cevap bekleniyor…), personele atama, randevu tarihi, fotoğraf, mesajlaşma, bitince otomatik memnuniyet anketi. 5 otomatik bildirim tipi.
- **Bakım-onarım:** marka, kontrol listesi (talimat, malzeme, zorunlu kontroller), cihaz grubu, periyodik bakım planı, cihaz (konum, durum, sorumlu), bakım emri, arıza kaydı, NFC/QR zorunluluğu.
- **Tur kontrol:** kontrol noktaları NFC ya da QR ile tanımlanır; kontrol listeleri; rota (sıra, süre, "yalnız yeni fotoğraf"); personel turu yönetici mobil uygulamasından yapar; tamamlanmayan tur için sebep; internetsiz çalışır; rapor.
- **GKS (geçiş kontrol ekranı):** plaka tanıma ve kartlı geçiş. Otopark doluluğu, canlı giriş-çıkış fotoğrafları, **daire başına araç limiti**, tanımsız araç → ziyaretçi, yasaklı araç (süreli), bariyer ve turnike açma, ziyaretçi kaydı, raporlar.
- **Satın alma** (kurumsal ekran):
  - Onay grupları (sıralı yetkililer), ürün grupları, ürünler, tedarikçiler (e-posta şart).
  - Akış: site talep açar (normal ya da sözleşmeli alım; teknik şartname) → site içi ön onay → merkezde sıralı onay → tedarikçilere e-postayla teklif isteği → teklif onayı → teslim formu → fatura. Sözleşmeli alımda fatura her ay kendiliğinden oluşuyor.
- **Diğerleri:** stok, demirbaş, toplantılar, ajanda ve yapılacak işler, sözleşmeler, havuz değerleri (pH, klor; sakin uygulamasında görünüyor), sigorta.

## 18. Kurumsal ekran (yönetim firmaları için)

Birden çok siteyi yöneten firma için konsolide panel:
- **Özet:** proje ve daire sayısı; onay bekleyen kişiler, rezervasyonlar ve iş takipleri; ajanda.
- **Finans:** banka hareketlerini proje içine girmeden onaylama; kasa durumu (tüm projeler, tarih aralıklı); ödenecek faturalar.
- **Satın alma** talepleri ve durum raporu.
- **İletişim:** seçilen projelere toplu e-posta, SMS, mobil bildirim, duyuru ve anket.
- **Raporlar:** konsolide cari bakiye, ödenmemiş borç makbuzları, silinen kayıtlar.
- **Yetkilendirme:** yetkiyi kişiden kişiye kopyalama; işten ayrılana tüm projelerde yetkiyi toplu bitirme; kurumsal erişim; yetki grubunu projeden projeye kopyalama.
- **Tanımları aktar:** kasa, cari, gelir/gider tanımları ve otomatik bildirimleri bir siteden diğerine seçerek kopyalama.

## 19. Yetki ve ayarlar

- **Yetki grupları:**
  - Menü ve alt menü bazında **4 seviye:** tam yetki, sadece okuma, okuma ve yeni kayıt (ilk kaydı girer, değiştiremez), yetkisiz (menüyü hiç görmez).
  - Özel izinler: özet sayfadaki finansal bilgiler, sakin bakiyeleri, TCKN, iletişim bilgileri, ek dosyalar, **gizli evraklar** (örn. maaş tahakkuku "kaydı gizle" ile saklanır), personel detayları.
  - **IP kısıtı:** izinli ve yasaklı IP listeleri.
- **Yetkili ekleme:** personel kaydı → bağlantılı kullanıcı → e-posta daveti ve yetki grubu seçimi. **Yetki "dönem sonu" tarihiyle bitirilir.** Kişi bazında "Excel çıktısı alabilir" ve "aktarım yapabilir" ayarları var.
- **Ayarlar:**
  - site detayları: ad, kısa ad, toplam arsa payı, ada/parsel;
  - **destek ekibi erişimi:** kapalı / açık + kişisel veri maskeli / açık;
  - iletişim bilgileri (sakinin göreceği telefon ve e-posta);
  - resmî kayıt bilgileri (bordro başlığı);
  - **işlem geçmişi:** 30 gün geri alma, indirilen dosyaların kaydı, kim ne zaman ne yaptı.
- **Parametreler:**
  - başlangıç dönemi;
  - bağımsız bölüm adı;
  - denetlenebilir kiracılar;
  - "çıkış vermeden yeni malik/kiracı eklenemesin";
  - pasif kişi ve carileri listele;
  - kişisel verileri maskele (KVKK);
  - "kolay kullanım" (kapatılırsa tanımlara kod alanı açılır);
  - varsayılan kasa;
  - **evrak kilit tarihi** (öncesi değiştirilemez ve silinemez);
  - **eksi bakiye uyarısı**;
  - bakiyeli virman engeli;
  - muhasebe kodu zorunlu;
  - varsayılan aidat parametreleri;
  - **borç kapama şekli** (ana para ve tazminattan eşit mi, önce tazminat mı; kullanım başladıktan sonra değiştirilmemeli);
  - online banka ayarları;
  - personel parametreleri;
  - SMS servis bilgileri;
  - iletişim ayarları (duyurular site adıyla, iletişim dilleri);
  - **zorunlu alanlar** (TCKN, vergi no, e-posta, cep telefonu);
  - **özel alanlar** (kişi, daire ve araç için 6 metin + 6 onay kutusu).
- **Rapor ayarları:** rapor üst/alt yazısı (örn. IBAN), sayfa, para ve tarih formatı, **çıktı tasarım aracı** (makbuzda neyin nerede görüneceği sürükle-bırak; termal yazıcı; çift/üç nüsha).
- **Evrak ayarları:** kategori kullanımı ve zorunluluğu, gider/gelir seçimi zorunlu (eğitmen "herkeste açık olmalı" diyor), varsayılan icra kategorisi, ödeme planı uyarısı, makbuzda kalan bakiye, otomatik seri no, makbuzlarda tazminat ayarını gizle.
- **Diğer:** internet hız testi, tema (gece modu), animasyonları kapatma.

## 20. Paketler ve fiyat

- Eski paketler **Kurumsal/Prestij**, yeni arayüzlü paketler **Blue/Black**. Blue/Black ile gelenler: iki sütunlu özet, Teknik/Güvenlik/Sayaç ayrı menüler, analizler, ücretsiz WhatsApp gönderimi, fazla ödeme virmanı, detaylı işlem geçmişi (alan bazlı geri alma), sürükle-bırak Excel, banka hareketini bölme, yan panelde rapor, dağılım raporu gönderimi.
- **Fiyat listesi yayınlanmıyor.** Basında eski bir "daire başı 1 TL'den başlıyor" haberi var.
- Ayrı ücretlenenler: SMS kontörü, ADA ve sesli arama kredisi, modüller (muhasebe, personel, icra, satın alma…), birebir eğitim (egitim.apsiyon.com).
- **Apsiyon Akademi:** C sınıfı uzman belgesi (25 soru, 70 puan, mülakat, iki yıl geçerli kart), 18UY0354-6 Tesis Yöneticisi Seviye 6 mesleki yeterlilik sınavı, Apsiyon Uzman Kulübü, kariyer.

## 21. Kobipo'ya dersler

**Alınacaklar:**
- İşlem geçmişinden toplu geri alma: toplu borçlandırmanın tamamını ya da bazı kişileri geri almak.
- Banka hareketini tek ekranda evrağa dönüştürme; tutarı bölme ve "fatura oluştur" kısayolu.
- Kişiye özel ödeme kodu ve akıllı etiketli toplu mesaj (kişiye özel ödeme linki dahil).
- "Fazla bakiyeyi aktar": müşteri şikâyetlerinin bir numaralı kaynağını tek tıkla çözüyor.
- Evrak kilit tarihi ile kapanmış dönemi koruma.
- Tek tuşla hesap planı ve finans–muhasebe kontrol eşitlikleri.
- Excel yüklemede eşleştirme şablonunu kaydetme.
- Kurumsal ekran: çoklu site tek panel, tanım ve yetki kopyalama.

**Apsiyon'da eksik ya da zayıf olanlar (Kobipo'nun fırsatı):**
- **Ödemeye otomatik taslak fatura + onay yok.** Apsiyon fatura kesmiyor; Kobipo'nun e-arşivi hazır.
- Muhasebe ayrı ve pahalı; entegrasyonu destek ekibi açıyor; geçmiş fişleri destek güncelliyor.
- **Kullanıcıya bırakılan fazla serbestlik hataya açık.** Eğitmen kendisi söylüyor: gider seçimi zorunlu değil, bakiyeli virman kaydedilebiliyor, kapalı faturaya ayrıca ödeme girilebiliyor, iki bankalı transferde mükerrer kayıt oluşuyor. Kobipo'da bunları varsayılan olarak engelleyen kurallar ("sessiz hataya tolerans yok") fark yaratır.
- Destek konularının başında kasa–banka mutabakatı geliyor. Otomatik mutabakat ve fark bulucu değerli olur.
- Borç makbuzu ile tahsilat makbuzu raporları neden tutmuyor, kullanıcı anlamıyor. Raporların neyi ölçtüğünü ekranda açıkça yazmak gerekiyor.
- Arayüz karmaşık; kullanıcılar Excel'e dönüyor. Sade menü ve yalnız ihtiyaç olan modülü göstermek, Kobipo'nun temel vaadi.
