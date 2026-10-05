# Rol taraması — 2026-10-05 18:26 UTC

## Özet (elle yazıldı — aşağısı aracın son tam koşusunun ham çıktısıdır)

Tetikleyen: kısıtlı bir çalışanın fatura editörü firma kartını okuyamadı, faturayı MANUAL
kaydetti (b384fc8). Aynı sınıftan başka kopukluk var mı diye Reypo'da 20 profil (6 hazır rol,
3 kısıtlı üyelik, 7 şablon, firmanın 4 kendi rolü) tarandı; statik tarama
(`rol-statik.ts`) ve elle Chrome testi (Kasiyer satışı, Satış Temsilcisi siparişi,
Vardiya Sorumlusu çalışma düzeni, kısıtlı yöneticinin e-Arşiv taslağı) eşlik etti.

Bulunup düzeltilenler:

- **Kasiyer/Garson kalıpları satış tamamlayamıyordu:** Kahveci Satış ve adisyon fişi
  `POST /api/e-donusum/invoices` + tahsilatı `/api/faturalar/odemeler` ile yazıyor; iki
  kuralın yazma listesinde restoran sayfaları yoktu.
- **`ROUTE_OWNERS` alt menüleri yutuyordu:** "/stok", "/finans", "/cek-senet" ön ekleri
  Etiket/Hizmet/Transfer, Kanallar/Mutabakat'ı ana sayfaya bağlıyordu (yalnız Etiket
  verilen rol sayfayı açamıyor, yalnız Ürün Listesi verilen rol Etiket'i açabiliyordu —
  firmanın "argon kaynakcısı" rolünde görüldü). `navHrefsForPath` artık en uzun eşleşme.
- Fatura editörü yalnız Satış Faturası'na bağlıydı (alış yetkilisi geri atılıyordu);
  Menü → ürün açma, Çek/Senet → hesap listesi, alış faturası → irsaliye, Ekip → rol listesi,
  raporlar → tanım listesi (ilk koşuda 26 ret, 6 `PAGE_FORBIDDEN`) kurallara eklendi.
- Takvimdeki "çalışma düzeni" penceresi genel personel ucuna (maaş/IBAN) yazıyordu →
  dar uç `PUT /api/personel/employees/[id]/calisma-duzeni`.
- `PUT /api/companies/[id]` sabit rol listesiyle özel rolü reddediyordu → karar sayfa kapısında.
- Başka sayfanın ucunu çağıran düğmeler gizlendi (`WriteAction api=…`, `useCanCallApi`):
  Bordro/İzin/Zimmet/Belge, Tahsilat Ekle, Fatura oluştur, fiş→fatura, puantaj aktarımı,
  kontrol listesi, rol tanımlama, ürün/tedarikçi açma; ortak listeler okuyamadığını istemez.
- İlk çizimde firma seçimi boş olduğu için yetki kancaları bir an "izinli" diyordu.
- Önizleme, gönderilmiş e-faturada açılışta durum sorgusu (POST) atıyordu; salt okunur
  rol her açılışta görünmez 403 alırdı. Bu koşudan SONRA düzeltildi ve `--sayfa=onizleme`
  ile ölçüldü: sorgu yalnız sunucunun kabul ettiği 9 profilde atılıyor, ret 0.

Son tam koşu (aşağıda): sayfa kapısı reddi **0**, `PAGE_FORBIDDEN` **0**, yasak sayfa
açılması / izinli sayfadan atılma **0**, satır farkı yok. Kalanlar tasarım gereği ya da
hız: cari görünürlüğü 403'ü (atanmamış cari, CLAUDE.md "Cari görünürlüğü"), dev
sunucusunda yavaş cari kartı / önizleme / teklif (zaman aşımı).

Bilerek açık bırakılanlar: `/api/e-donusum/invoices` yön ayırmaz (satış yetkilisi alış
faturasını görüntüleyebilir; restoran tezgâhı yetkisi Hızlı Satış'taki gibi bu uca yazar);
`/api/companies` PUT alan ayırmaz (E-Dönüşüm Ayarları ve Seri No kimlik alanlarını da
yazabilir — kullanıcı onayıyla).


Firma: **Reypo Medya Ajansı** (`cmojuwru30002my8i42blsjch`) · 20 profil · 666 sayfa açılışı · araç: `scripts/uctan-uca/rol-taramasi.ts`

## Profiller

- `admin` — Yönetici (kısıtsız): 82 sayfa, 2 bulgu
- `branch-manager` — Şube Müdürü (kısıtsız): 80 sayfa, 1 bulgu
- `accountant` — Muhasebeci (kısıtsız): 66 sayfa, 0 bulgu
- `stock` — Stokçu (kısıtsız): 18 sayfa, 0 bulgu
- `sales` — Satış (kısıtsız): 34 sayfa, 3 bulgu
- `viewer` — Görüntüleyici (kısıtsız): 14 sayfa, 0 bulgu
- `kisitli-satis-edonusum` — Kısıtlı Yönetici — Satış/Stok/Finans/E-Dönüşüm, Kontör salt okunur: 38 sayfa, 1 bulgu
- `kisitli-tek-fatura` — Kısıtlı Yönetici — yalnız Satış Faturası: 11 sayfa, 3 bulgu
- `kisitli-salt-okunur` — Kısıtlı Yönetici — her sayfa salt okunur: 82 sayfa, 2 bulgu
- `sablon-kasiyer` — Şablon: Kasiyer: 9 sayfa, 0 bulgu
- `sablon-garson` — Şablon: Garson: 8 sayfa, 0 bulgu
- `sablon-kasiyer-sef` — Şablon: Vardiya Sorumlusu: 12 sayfa, 0 bulgu
- `sablon-depo` — Şablon: Depo Sorumlusu: 14 sayfa, 0 bulgu
- `sablon-satis-temsilcisi` — Şablon: Satış Temsilcisi: 20 sayfa, 3 bulgu
- `sablon-muhasebe-asistani` — Şablon: Muhasebe Asistanı: 22 sayfa, 6 bulgu
- `sablon-gozlemci` — Şablon: Gözlemci: 11 sayfa, 0 bulgu
- `mevcut-argon-kaynakcisi` — Firmanın rolü: argon kaynakcısı: 30 sayfa, 3 bulgu
- `mevcut-gozlemci` — Firmanın rolü: Gözlemci: 73 sayfa, 6 bulgu
- `mevcut-muhasebe-asistani` — Firmanın rolü: Muhasebe Asistanı: 22 sayfa, 6 bulgu
- `mevcut-satis-temsilcisi` — Firmanın rolü: Satış Temsilcisi: 20 sayfa, 3 bulgu

## Bulgular

### beklenen-cari-gorunurlugu (30)

- /cari/customers/cmu9x954d00089p0cnvvnh8vt — 403 GET /api/cari/customers/:id [CARI_FORBIDDEN] — Bu cari size atanmamış. Yalnızca yetkili çalışanı siz olan carileri görebilirsiniz; atamayı yönetici ya da muhasebeci, cari kartının Diğer sekmesinden yapar. · **sales, sablon-satis-temsilcisi, sablon-muhasebe-asistani, mevcut-argon-kaynakcisi, mevcut-muhasebe-asistani, mevcut-satis-temsilcisi, mevcut-gozlemci**
- /cari/suppliers/cmupy92od0009bxm92sl7gvnq — 403 GET /api/cari/suppliers/:id [CARI_FORBIDDEN] — Bu cari size atanmamış. Yalnızca yetkili çalışanı siz olan carileri görebilirsiniz; atamayı yönetici ya da muhasebeci, cari kartının Diğer sekmesinden yapar. · **sablon-muhasebe-asistani, mevcut-muhasebe-asistani, mevcut-gozlemci**

### zaman-asimi (8)

- /faturalar/cmulg4a1s000112k041nqz6uj/onizleme — ağ susmadı; bekleyen: GET /api/e-donusum/invoices/sat-2026-0214?companyId=cmojuwru30002my8i42blsjch, GET /api/e-donusum/invoices/sat-2026-0214?companyId=reypo, GET /api/attachments?companyId=reypo&entityType=invoice&entityId=sat-2026-0214 · **kisitli-tek-fatura**
- /teklif/cmubfm1d8000814chnjuox2k2 — ağ susmadı; bekleyen: GET /api/teklif/tkf-2026-000024?companyId=reypo, GET /api/cari/customers?companyId=reypo, GET /api/stok/products?companyId=reypo, GET /api/companies/reypo · **branch-manager**
- /faturalar/cmupya3pt0026bxm9kd3lm0hz/onizleme — ağ susmadı; bekleyen: GET /api/attachments?companyId=cmojuwru30002my8i42blsjch&entityType=invoice&entityId=sat-2026-0214, GET /api/e-donusum/invoices/tst-alis-014?companyId=cmojuwru30002my8i42blsjch, GET /api/attachments?companyId=reypo&entityType=invoice&entityId=tst-alis-014 · **kisitli-tek-fatura**
- /cari/customers/cmu9x954d00089p0cnvvnh8vt — ağ susmadı; bekleyen: GET /api/cari/customers/mysoft-dijital-donusum-a-s?companyId=cmojuwru30002my8i42blsjch · **admin, kisitli-satis-edonusum**
- /cari/suppliers/cmupy92od0009bxm92sl7gvnq — ağ susmadı; bekleyen: — · **admin**
- /cari/customers/cmu9x954d00089p0cnvvnh8vt — ağ susmadı; bekleyen: — · **kisitli-salt-okunur**
- /cari/suppliers/cmupy92od0009bxm92sl7gvnq — ağ susmadı; bekleyen: GET /api/cari/suppliers/test-lezzet-gida-toptan-silinecek?companyId=cmojuwru30002my8i42blsjch · **kisitli-salt-okunur**

### askida-istek (1)

- /e-donusum/cmubfmaey000g14chdzjmrkxz/duzenle — GET /api/attachments?companyId=cmojuwru30002my8i42blsjch&entityType=invoice&entityId=tst-alis-014 · **kisitli-tek-fatura**

## Açılışta kesilen yazma istekleri (26)

- /faturalar/cmulg4a1s000112k041nqz6uj/onizleme → POST /api/e-donusum/invoices/:id/check-status · sales, accountant, branch-manager, kisitli-tek-fatura, admin, kisitli-satis-edonusum, sablon-satis-temsilcisi, sablon-muhasebe-asistani, mevcut-argon-kaynakcisi, mevcut-muhasebe-asistani, kisitli-salt-okunur, mevcut-satis-temsilcisi, mevcut-gozlemci

## Sayfa kapısı günlüğü (PAGE_FORBIDDEN, 0)


## Güvenlik: satır sayısı farkı

Fark yok — tarama firmaya veri yazmadı.

Temizlik: 20 kullanıcı, 7 rol, 0 günlük satırı silindi
