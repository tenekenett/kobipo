# Muhasebe kıyası — dizin (2026-10-09)

Kullanıcı planı: muhasebe modülünün A/B/D eksikleri bitti → **başka ürünlerle kıyas** (bu klasör)
→ Kobipo'nun bugünkü hâliyle karşılaştırıp güncelleme → en son **müşavire çıkış** (C). Kullanıcının
kıyastan beklentisi MUHASEBE (defter, fiş, müşavir) tarafı; ön muhasebe ayrıntısı ikincil.

| Dosya | Ne | Yöntem |
|---|---|---|
| [PARASUT.md](PARASUT.md) | Paraşüt — ön muhasebe; KDV ödemesini gider sayıyor, kur farkını yutuyor, asistan kârı yanlış | deneme hesabı, test verisiyle ölçüldü |
| [FATURAPORT.md](FATURAPORT.md) | Faturaport — entegratör + ön muhasebe; Luca/Zirve biçimli KDV raporu, Luca/Zirve/Orka/Dia entegrasyonu, bedava müşavir portalı | kullanıcı hesabı (boş), ekranlar + açık kaynak |
| [LUCA.md](LUCA.md) | Luca (TÜRMOB) — müşavirlerin en yaygın programı; fiş ve fatura Excel aktarımı, AEN, API | açık kaynak (hesap açılamadı) |
| [MUSAVIR-PROGRAMLARI.md](MUSAVIR-PROGRAMLARI.md) | Zirve, Mikro Müşavir, Logo Mali Müşavir 3, Uyumsoft, ETA, DİA, Orka; üretici ekosistemleri | açık kaynak |
| [AKTARIM-VE-YZ.md](AKTARIM-VE-YZ.md) | Atlas Aktarım, ExpressAktarım, Rahat Aktarım, Mihsap, Monorobi, Yapay SMMM … | açık kaynak |
| [MEVZUAT.md](MEVZUAT.md) | e-Defter (XBRL GL, berat takvimi, saklama), yeni e-Beyan (KDV, İstanbul hariç tüm iller), DBS | açık kaynak |

Aposkal (2026-09-30): rapor Claude Docs'ta — https://claude.ai/code/artifact/5ecd9dcc-8819-4a24-b5d6-77b323fff1d4 ,
karşılaştırma https://claude.ai/code/artifact/29e3bbc4-ce25-4fdc-8b65-e9ade0ffb50f (repo özeti
`docs/finansal-raporlar/MUHASEBE-DEVAM.md`).

## Pazarın özeti (beş cümle)

1. Türkiye'de **defteri müşavir tutar**; KOBİ ürünleri (Paraşüt, Faturaport, İşbaşı, Bizmu) ön
   muhasebedir ve muhasebeyi müşavirin programına (Luca, Zirve, Mikro, Logo) **köprüyle** bırakır.
2. Her müşavir programı üreticisinin kendi mükellef ürünü + bedava köprüsü var; Mikro grubu
   (Paraşüt, Bizmu, Atlas Aktarım, DİA) en agresif konsolide olan.
3. Müşavir tarafında **öğrenen otomatik fiş** artık sıradan: Atlas'ın akıllı veri işlemesi, Monorobi,
   Mihsap, Rahat Aktarım'ın kural motoru, Logo'nun bağlantı kodları.
4. Aktarımın ortak dili iki dosya biçimi: **fiş** (Fiş No/Tarih/Hesap/Borç/Alacak) ve **fatura
   listesi** (Tarih, Cari, VKN, Evrak No, KDV oranına göre Matrah/KDV); kapalı API'ler ücretli.
5. Mevzuat müşavir işini dijitalleştiriyor: yeni **e-Beyan** (KDV, 2026-08'den İstanbul hariç her
   yerde, web servis), e-Defter takvimi; müşavir programları buna uyuyor.

## Kobipo'yla kıyasta bakılacaklar (sonraki adım)

Kullanıcı: "sonrasında Kobipo'nun şu anki hali ile kıyaslayıp güncelleriz". Kıyas şu sorulara
cevap verecek:

1. **Konum:** Kobipo müşavirin programının YERİNE mi geçecek (e-Defter, beyanname — rakip olur),
   yoksa müşavire **hesabı seçilmiş, eksiksiz fiş** mi verecek (köprü olur)? Bulgular ikincisini
   destekliyor; karar kullanıcının.
2. **Dışa aktarım:** Luca fiş aktarım dosyası (50 fiş/dosya), Zirve/Mikro karşılıkları; alt hesap
   kodlarının müşavirin planıyla eşlenmesi. Müşavirden örnek şablon + hesap planı.
3. **Ucuz kazanç:** KDV oranına bölünmüş fatura listesi (Luca/Zirve "fatura aktarım" biçimi) —
   defteri kapalı müşteriye de çalışır.
4. **Müşavir ekranı:** çok mükellefli görünüm (Kobipo'da ACCOUNTANT firma bazlı), müşavir daveti.
5. **e-belge dışı veri:** kasa/banka (türüyle), çek/senet, bordro, matbu fatura, virman, döviz —
   köprülerin taşıyamadığı, Kobipo'nun farkı.
6. **Paraşüt'ten çıkan sahip tarafı öneriler** (`PARASUT.md` sonu): nakit projeksiyonuna vergi/
   maaş, kur farkını söylemek, fatura satırında kâr, ekstrede döviz.
7. **e-Beyan'a hazır KDV dökümü** (`computeVatDeclaration` → beyanname tabloları).
