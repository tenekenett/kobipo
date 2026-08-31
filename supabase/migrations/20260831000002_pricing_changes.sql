-- KATALOĞUN GEÇMİŞİ — fiyat değişikliklerinin append-only günlüğü.
--
-- Neden: `pricing_items` ve `plans` yalnız SON hâli tutuyor. Bir fiyat değiştiğinde eski
-- değer kalıcı olarak kayboluyordu.
--
-- Somut olay (31.08.2026): sabah 03:08'de 95,00 TL'lik bir yıllık paket satın alındı;
-- 13:44'te katalog güncellendi (Restoran & Kafe 4.950/yıl, ek şube 99, ek firma 199 oldu,
-- altı modül ücretsize çekildi). Siparişin hangi kaleme ne yazıldığı bir daha
-- bulunamadı — aynı sepet yeni fiyatlarla ~5.446 TL tutuyor. Ölü satır sürümleri diskte
-- duruyordu ama `pageinspect` superuser istediği için okunamadı.
--
-- İki ayrı koruma var, ikisi de gerekli:
--   1. `package_orders.priceLines` — SİPARİŞİN kendi kalem dökümü (satın alma anı).
--   2. bu tablo — KATALOĞUN geçmişi; sipariş olmasa da "o tarihte fiyat neydi" cevabı.
--
-- Güncellenmez, silinmez.
CREATE TABLE IF NOT EXISTS public.pricing_changes (
  "id"          TEXT PRIMARY KEY,
  -- PRICING_ITEM | PLAN
  "targetKind"  TEXT NOT NULL,
  -- pricing_items.key ya da plans.id
  "targetKey"   TEXT NOT NULL,
  -- Okunur ad, değişiklik anı snapshot'ı: kalem sonradan silinse de satır anlamlı kalır.
  "targetLabel" TEXT NOT NULL,
  -- monthlyPrice | yearlyPrice | isFree | isActive | includedModules …
  "field"       TEXT NOT NULL,
  -- Alanlar sayı, bool ve dizi karışık olduğu için değerler metin tutulur.
  "oldValue"    TEXT,
  "newValue"    TEXT,
  -- Değişikliği yapan süper admin; sistem tohumlamasında null.
  "changedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pricing_changes_target_idx"
  ON public.pricing_changes ("targetKind", "targetKey", "createdAt");
CREATE INDEX IF NOT EXISTS "pricing_changes_createdAt_idx"
  ON public.pricing_changes ("createdAt");

-- RLS — CLAUDE.md kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.pricing_changes ENABLE ROW LEVEL SECURITY;
