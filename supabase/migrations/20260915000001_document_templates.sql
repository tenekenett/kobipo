-- İK BELGE ŞABLONLARI — Kobipo kataloğu + firmanın kendi şablonları.
--
-- NEDEN: personel modülünde belge üretimi bugüne kadar KODDA gömülüydü
-- (lib/pdf/personel-pdf.ts → bordro, izin talep, zimmet teslim). Üçü de doğru ve
-- antetli basılıyor ama sayısı sabit: müşteri "bizim ikale metnimiz farklı" ya da
-- "işten ayrılma görüşme formumuz var" dediğinde yapılacak bir şey yoktu, sürüm
-- çıkmak gerekiyordu.
--
-- TEK TABLO, İKİ KAPSAM:
--   "companyId" NULL  → KOBİPO KATALOĞU. /system-admin/belge-sablonlari ekranından
--                       düzenlenir, aktif olanlar her firmaya görünür.
--   "companyId" dolu  → FİRMANIN KENDİ şablonu. Kullanıcı yazar ya da katalogdaki
--                       bir şablonu "kopyala ve düzenle" ile kendine alır.
--
-- KATALOG BAĞ DEĞİL KOPYADIR: firma bir kalıbı kopyaladığında gövde kendi satırına
-- yazılır ve "sourceKey" yalnız izdir. Kobipo katalogda düzeltme yaptığında
-- müşterinin özelleştirdiği metin SESSİZCE DEĞİŞMEZ. Ters kurgunun sonucu ölçüldü:
-- rakip üründe 15 hazır şablon kilitliydi ve içlerindeki hatalar (avans talebinde
-- T.C. alanına telefon basan değişken, fesih ihbarında iki kez yazılmış cümle)
-- kullanıcı tarafından düzeltilemiyordu.

CREATE TABLE IF NOT EXISTS public.document_templates (
  "id"          TEXT PRIMARY KEY,
  -- NULL = katalog satırı. Firma silinince kendi şablonları da gider.
  "companyId"   TEXT,
  "key"         TEXT NOT NULL,
  -- Kopyaysa kaynak katalog şablonunun "key"i. Yabancı anahtar DEĞİL: katalog
  -- satırı silinse de kopya çalışmaya devam etmeli.
  "sourceKey"   TEXT,
  "title"       TEXT NOT NULL,
  "category"    TEXT,
  -- Gövde HTML; `{Alan Adı}` yer tutucuları taşır. Sözlükte karşılığı olan ad
  -- kayıttan doldurulur, olmayan doldurma ekranında sorulur
  -- (lib/personel/belge-alanlari.ts).
  "body"        TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  -- Pasif şablon doldurma ekranında listelenmez; BASILMIŞ belgeler etkilenmez.
  -- Firma katalogdaki bir şablonu istemiyorsa kopyasını pasif yapar; katalog satırı
  -- yerinde kalır ve diğer firmalar görmeye devam eder.
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   TEXT,

  CONSTRAINT "document_templates_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE
);

-- Firma içinde anahtar benzersiz.
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_companyId_key_key"
  ON public.document_templates ("companyId", "key");

-- Katalog satırları için AYRI kısmi indeks şart: Postgres'te NULL'lar birbirine eşit
-- sayılmadığı için yukarıdaki indeks aynı "key" ile iki katalog satırı açılmasını
-- engellemez. Katalog anahtarı kopyanın "sourceKey"i olduğundan ikizlenirse hangi
-- kalıptan türediği belirsizleşir.
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_catalog_key_key"
  ON public.document_templates ("key") WHERE "companyId" IS NULL;

CREATE INDEX IF NOT EXISTS "document_templates_companyId_isActive_sortOrder_idx"
  ON public.document_templates ("companyId", "isActive", "sortOrder");

-- ————— KATALOG TOHUMU —————
--
-- Gövdeler dolar-tırnak ($$) içinde: metinde kesme işareti geçtiğinde SQL kaçışı
-- gerekmesin.
--
-- İMZA BLOĞU GÖVDEDE YOKTUR: PDF çerçevesi antet (firma künyesi) ve imza hücrelerini
-- kendisi çizer (lib/pdf/personel-pdf.ts → header/signatures). Gövdeye "İmza: ____"
-- yazmak, aynı belgede iki imza alanı doğururdu.
--
-- ON CONFLICT DO NOTHING: migrasyon tekrar çalışırsa sistem yöneticisinin panelden
-- yaptığı düzenlemeleri geri almaz.
INSERT INTO public.document_templates ("id", "companyId", "key", "title", "category", "description", "sortOrder", "body")
VALUES
  ('dtpl_yillik_izin_talep', NULL, 'yillik-izin-talep', 'Yıllık İzin Talep Formu', 'İzin',
   'Personelin yıllık ücretli izin talebi. İzin tarihleri elle girilir.', 10,
   $$<p><strong>{Firma Unvan}</strong><br>İnsan Kaynakları Birimine</p>
<p>{Personel İşe Giriş Tarihi} tarihinden bu yana {Personel Görev} görevinde çalışmaktayım. 4857 sayılı İş Kanunu kapsamında hak etmiş olduğum yıllık ücretli iznimin {İzin Başlangıç Tarihi} - {İzin Bitiş Tarihi} tarihleri arasında toplam {İzin Gün Sayısı} gün olarak kullandırılmasını talep ederim.</p>
<p>Gereğini bilgilerinize arz ederim.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>T.C. Kimlik No: {Personel T.C. No}<br>Görevi: {Personel Görev}<br>Yıllık izin hakkı: {Personel Yıllık İzin Hakkı} gün</p>
<p>Talep Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_ucretsiz_izin_talep', NULL, 'ucretsiz-izin-talep', 'Ücretsiz İzin Talep Formu', 'İzin',
   'Mazeret bildirilerek talep edilen ücretsiz izin.', 20,
   $$<p><strong>{Firma Unvan}</strong><br>İnsan Kaynakları Birimine</p>
<p>{Personel Görev} görevinde çalışmaktayım. Aşağıda belirttiğim mazeretim nedeniyle {İzin Başlangıç Tarihi} - {İzin Bitiş Tarihi} tarihleri arasında toplam {İzin Gün Sayısı} gün ücretsiz izin kullanmayı talep ediyorum.</p>
<p>Mazeret: {Mazeret}</p>
<p>Söz konusu sürenin ücretsiz izin olarak değerlendirilmesini ve ücretimden mahsup edilmesini kabul ederim.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>T.C. Kimlik No: {Personel T.C. No}</p>
<p>Talep Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_avans_talep', NULL, 'avans-talep', 'Avans Talep Formu', 'Talep',
   'Ücretten mahsup edilmek üzere avans talebi.', 30,
   $$<p><strong>{Firma Unvan}</strong><br>Muhasebe / İnsan Kaynakları Birimine</p>
<p>{Maaş Ayı} {Maaş Yılı} dönemi ücretimden mahsup edilmek üzere {Avans Tutarı} tutarında avans ödenmesini talep ederim.</p>
<p>Ödemenin aşağıda belirtilen hesabıma yapılmasını arz ederim.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>T.C. Kimlik No: {Personel T.C. No}<br>Görevi: {Personel Görev}<br>Telefon: {Personel Telefon}<br>IBAN: {Personel IBAN}</p>
<p>Talep Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_calisma_belgesi', NULL, 'calisma-belgesi', 'Çalışma Belgesi', 'Belge',
   'Personelin çalıştığı dönemi ve görevini gösteren belge.', 40,
   $$<p>Aşağıda kimlik bilgileri yazılı personel, {Personel İşe Giriş Tarihi} tarihinden {Personel İşten Çıkış Tarihi} tarihine kadar iş yerimizde {Personel Görev} görevinde çalışmıştır.</p>
<p>İşbu belge, ilgilinin talebi üzerine düzenlenerek kendisine verilmiştir.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>T.C. Kimlik No: {Personel T.C. No}<br>Görevi: {Personel Görev}<br>Departman: {Personel Departman}</p>
<p>Düzenleyen: {Firma Unvan}<br>Vergi No: {Firma VKN}<br>Adres: {Firma Adres}</p>
<p>Düzenleme Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_istifa_dilekcesi', NULL, 'istifa-dilekcesi', 'İstifa Dilekçesi', 'Fesih',
   'Personelin kendi isteğiyle ayrılma bildirimi.', 50,
   $$<p><strong>{Firma Unvan}</strong><br>İnsan Kaynakları Birimine</p>
<p>{Personel İşe Giriş Tarihi} tarihinden bu yana {Personel Görev} görevinde çalışmaktayım. Kişisel nedenlerimle iş sözleşmemi {Ayrılış Tarihi} tarihi itibarıyla sonlandırmak istiyorum.</p>
<p>Gereğinin yapılmasını bilgilerinize arz ederim.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>T.C. Kimlik No: {Personel T.C. No}<br>Görevi: {Personel Görev}</p>
<p>Dilekçe Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_fesih_bildirimi', NULL, 'fesih-bildirimi', 'İş Sözleşmesi Fesih Bildirimi', 'Fesih',
   'İşveren tarafından yapılan fesih bildirimi. Gerekçe ve tarih elle girilir.', 60,
   $$<p>Sayın {Personel Ad Soyad},</p>
<p>{Personel İşe Giriş Tarihi} tarihinde başlayan iş sözleşmeniz, aşağıda belirtilen gerekçeyle {Fesih Tarihi} tarihi itibarıyla feshedilmiştir.</p>
<p>Fesih gerekçesi: {Fesih Gerekçesi}</p>
<p>Yasal haklarınıza ilişkin ödemeler, kayıtlarımızda bulunan {Personel IBAN} numaralı hesabınıza yapılacaktır.</p>
<p>Bilgilerinize sunulur.</p>
<p>{Firma Unvan}<br>Vergi No: {Firma VKN}<br>Adres: {Firma Adres}</p>
<p>Bildirim Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_gorev_degisikligi', NULL, 'gorev-degisikligi', 'Görev Değişikliği Bildirimi', 'Belge',
   'Görev, departman veya çalışma yeri değişikliğinin yazılı bildirimi.', 70,
   $$<p>Sayın {Personel Ad Soyad},</p>
<p>Hâlen {Personel Görev} görevinde çalışmaktasınız. {Yeni Görev Başlangıç Tarihi} tarihinden geçerli olmak üzere göreviniz {Yeni Görev} olarak değiştirilmiştir.</p>
<p>Yeni bağlı olacağınız birim: {Yeni Departman}</p>
<p>Özlük haklarınızda bu değişiklik nedeniyle bir eksilme olmayacaktır.</p>
<p>Bilgilerinize sunulur.</p>
<p>{Firma Unvan}<br>Adres: {Firma Adres}</p>
<p>Bildirim Tarihi: {Bugünün Tarihi}</p>$$),

  ('dtpl_isten_ayrilma_gorusme', NULL, 'isten-ayrilma-gorusme', 'İşten Ayrılma Görüşme Formu', 'Tutanak',
   'Ayrılan personelle yapılan çıkış görüşmesinin kaydı.', 80,
   $$<p>Aşağıda bilgileri yazılı personel ile işten ayrılma görüşmesi yapılmıştır.</p>
<p>Ad Soyad: {Personel Ad Soyad}<br>Görevi: {Personel Görev}<br>Departman: {Personel Departman}<br>İşe Giriş: {Personel İşe Giriş Tarihi}<br>Ayrılış: {Personel İşten Çıkış Tarihi}</p>
<p><strong>Ayrılma nedeni:</strong> {Ayrılma Nedeni}</p>
<p><strong>Görevle ilgili değerlendirmesi:</strong> {Görev Değerlendirmesi}</p>
<p><strong>Yönetim ve iletişim hakkında görüşü:</strong> {Yönetim Değerlendirmesi}</p>
<p><strong>Tekrar birlikte çalışmayı düşünür mü:</strong> {Tekrar Çalışma Görüşü}</p>
<p><strong>Teslim edilen zimmetler:</strong> {Teslim Edilen Zimmetler}</p>
<p>Görüşmeyi yapan: {Görüşmeyi Yapan}</p>
<p>Görüşme Tarihi: {Bugünün Tarihi}</p>$$)
ON CONFLICT DO NOTHING;

-- CLAUDE.md kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
