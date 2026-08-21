-- Kobipo'nun sunduğu HAZIR ROL KALIPLARI (Rol Yetkileri ekranındaki "Hazır kalıplar").
--
-- NEDEN: kalıplar bugüne kadar kodda gömülüydü (lib/nav/role-templates.ts). Yeni bir
-- kalıp eklemek ya da mevcut birinin sayfa kümesini değiştirmek sürüm çıkmayı
-- gerektiriyordu; müşteriden gelen "şu rolü de hazır verin" isteği deploy'a bağlıydı.
-- Katalog artık veritabanında ve sistem yönetim panelinden (/system-admin/roller)
-- düzenleniyor.
--
-- KALIP BAĞ DEĞİL KOPYADIR: firma kalıptan rol ürettiğinde sayfalar company_roles
-- içine yazılır. Kalıbı sonradan değiştirmek (hatta silmek) üretilmiş rolleri
-- ETKİLEMEZ — aksi halde katalogda yapılan bir düzeltme, müşterinin elleyip
-- özelleştirdiği rolü sessizce genişletir/daraltırdı.
--
-- SINIR: hesap yönetimi sayfaları (Ekip, Şube, Abonelik, Şube Müdürleri) kalıba da
-- yazılamaz; uç `sanitizePagePermissions(..., { custom: true })` ile eler.

CREATE TABLE IF NOT EXISTS public.role_templates (
  "id"            TEXT PRIMARY KEY,
  -- Kararlı anahtar: company_roles."templateKey" bunu taşır. Kart "Oluşturuldu"
  -- rozetini bu eşleşmeden basar, o yüzden ad değişse bile anahtar değişmemeli.
  "key"           TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "allowedPaths"  TEXT[] NOT NULL DEFAULT '{}',
  "writablePaths" TEXT[] NOT NULL DEFAULT '{}',
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  -- Pasif kalıp firma ekranında listelenmez; ondan ÜRETİLMİŞ roller çalışmaya devam
  -- eder. Silmek yerine pasifleştirmek, "artık önermiyoruz" ile "hiç olmamıştı"
  -- arasındaki farkı korur.
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_templates_key_key" ON public.role_templates ("key");
CREATE INDEX IF NOT EXISTS "role_templates_isActive_sortOrder_idx"
  ON public.role_templates ("isActive", "sortOrder");

-- Kodda gömülü olan yedi kalıp aynı anahtarlarla tohumlanır: hâlihazırda bu
-- kalıplardan üretilmiş roller "Oluşturuldu" rozetini kaybetmesin.
-- ON CONFLICT DO NOTHING: migrasyon tekrar çalıştırılırsa yöneticinin panelden
-- yaptığı düzenlemeleri geri almaz.
INSERT INTO public.role_templates ("id", "key", "name", "description", "allowedPaths", "writablePaths", "sortOrder")
VALUES
  ('rtpl_kasiyer', 'kasiyer', 'Kasiyer',
   'Tezgâh satışı ve adisyon kapatma. Menü/reçete ve rakamlar kapalı.',
   ARRAY['/restoran/satis','/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar'],
   ARRAY['/restoran/satis','/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar'],
   10),
  ('rtpl_garson', 'garson', 'Garson',
   'Masa açma ve sipariş girme. Kahveci satış ekranı ve raporlar kapalı.',
   ARRAY['/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar'],
   ARRAY['/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar'],
   20),
  ('rtpl_kasiyer_sef', 'kasiyer-sef', 'Vardiya Sorumlusu',
   'Kasiyerin tüm yetkileri + kontrol listesi ve gün sonu raporları.',
   ARRAY['/restoran/satis','/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar','/restoran/kontrol-listesi','/restoran/raporlar','/personel/vardiya'],
   ARRAY['/restoran/satis','/restoran/masalar','/restoran/masa-listesi','/restoran/adisyonlar','/restoran/kontrol-listesi','/personel/vardiya'],
   30),
  ('rtpl_depo', 'depo', 'Depo Sorumlusu',
   'Ürün, depo ve stok transferi. Fiyat/ciro içeren ekranlar kapalı.',
   ARRAY['/stok/urunler','/stok/hizmetler','/depolar','/stok/transfer','/stok/etiket','/raporlar/stok','/alis/irsaliye','/satis/irsaliye'],
   ARRAY['/stok/urunler','/stok/hizmetler','/depolar','/stok/transfer','/stok/etiket'],
   40),
  ('rtpl_satis_temsilcisi', 'satis-temsilcisi', 'Satış Temsilcisi',
   'Müşteri, teklif ve sipariş. Alış tarafı ve finans kapalı.',
   ARRAY['/cari/musteri','/teklif','/satis/siparis','/satis/fatura','/stok/urunler','/raporlar/satis','/raporlar/cari'],
   ARRAY['/cari/musteri','/teklif','/satis/siparis'],
   50),
  ('rtpl_muhasebe_asistani', 'muhasebe-asistani', 'Muhasebe Asistanı',
   'Fatura ve cari kayıt girişi. Personel/bordro ve abonelik kapalı.',
   ARRAY['/satis/fatura','/alis/fatura','/alis/gelen-e-faturalar','/cari/musteri','/cari/tedarikci','/finans/hareketler','/raporlar/satis','/raporlar/alis','/raporlar/cari','/raporlar/vergi'],
   ARRAY['/satis/fatura','/alis/fatura','/cari/musteri','/cari/tedarikci','/finans/hareketler'],
   60),
  ('rtpl_gozlemci', 'gozlemci', 'Gözlemci',
   'Yalnız rapor okuma; hiçbir ekranda değişiklik yapamaz.',
   ARRAY['/dashboard','/raporlar/satis','/raporlar/alis','/raporlar/cari','/raporlar/stok','/raporlar/nakit-banka'],
   ARRAY[]::TEXT[],
   70)
ON CONFLICT ("key") DO NOTHING;

-- CLAUDE.md kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;
