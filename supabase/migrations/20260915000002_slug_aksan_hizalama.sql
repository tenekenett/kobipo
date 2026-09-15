-- SLUG ÜRETİMİ: SQL trigger'ını JS `slugify` ile AYNI harf tablosuna getirir.
--
-- NEDEN: slug iki yerde üretiliyor —
--   • JS   `lib/slug.ts` → slugify (blog yazısı, rol kalıbı anahtarı,
--          issue-sales-invoice'ın müşteri açma yolu)
--   • SQL  `set_entity_slug()` BEFORE INSERT trigger'ı (cari, ürün, personel,
--          finansal hesap — app slug göndermediğinde)
-- İkisi ayrışırsa aynı ad iki farklı adres üretir ve bu SESSİZ bir hatadır.
--
-- JS tarafındaki Türkçe "İ" hatası düzeltilirken (bkz. lib/slug.ts yorumu) katlama
-- `trFold`a bağlandı; o tablo â/î/û'yu da sadeleştiriyor. SQL tarafı ise yalnız
-- ğüşıöç ve İ'yi çeviriyordu, aksanlı harf `[^a-z0-9]` süzgecine takılıp TİREYE
-- dönüşüyordu. Ölçüldü (bu migrasyondan önce):
--
--     'Âlim Ticaret'   → JS: alim-ticaret     SQL: lim-ticaret     ← baş harf DÜŞÜYOR
--     'Kâğıthane Ltd.' → JS: kagithane-ltd    SQL: k-githane-ltd
--     'Nûri Bey'       → JS: nuri-bey         SQL: n-ri-bey
--
-- SQL çıktısı yalnız farklı değil, bozuk: "Âlim" adlı cari `lim-...` adresine
-- düşüyordu. Harf tablosu artık TR_FOLD_FROM/TR_FOLD_TO ile aynı kümedir.
--
-- MEVCUT SLUG'LAR DEĞİŞMEZ: trigger yalnız INSERT'te ve slug boşken çalışır.
-- Geriye dönük düzeltme BİLEREK yapılmıyor — yayımlanmış bir adresi değiştirmek,
-- yanlış ama çalışan bir adresi kırmaktan daha kötü.

CREATE OR REPLACE FUNCTION set_entity_slug() RETURNS trigger AS $$
DECLARE
  base text;
  cand text;
  n int := 1;
  taken boolean;
BEGIN
  IF NEW."slug" IS NOT NULL AND NEW."slug" <> '' THEN
    RETURN NEW;
  END IF;
  base := NULLIF(
    LEFT(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(
          -- TRANSLATE, LOWER'dan ÖNCE gelir ve öyle kalmalı: Postgres'in LOWER'ı
          -- veritabanının lc_ctype'ına bağlıdır, 'İ' için Türkçe olmayan bir
          -- yerelde iki kod birimi üretebilir. Aynı sıra hatası JS tarafında
          -- yıllarca sessizce durdu.
          LOWER(TRANSLATE(NEW."name",
            'ğĞüÜşŞıİöÖçÇâÂîÎûÛ',
            'gGuUsSiIoOcCaAiIuU')),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      80
    ),
  '');
  IF base IS NULL THEN base := 'kayit'; END IF;
  cand := base;
  LOOP
    EXECUTE format(
      'SELECT EXISTS(SELECT 1 FROM %I WHERE "companyId" = $1 AND "slug" = $2)',
      TG_TABLE_NAME
    ) INTO taken USING NEW."companyId", cand;
    EXIT WHEN NOT taken;
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  NEW."slug" := cand;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
