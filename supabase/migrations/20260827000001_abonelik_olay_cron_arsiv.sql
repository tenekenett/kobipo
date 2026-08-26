-- ABONELİK SİSTEMİNİ TAMAMLAMA — Faz 0: şema temeli.
-- Plan: docs/paket-abonelik/ABONELIK-TAMAMLAMA.md
--
-- Abonelik durum makinesi (hoşgörü → kilit) yazılmıştı ama HİÇ ÇALIŞMIYORDU: günlük
-- bakım işini (`/api/billing/cron/daily`) çağıran bir zamanlayıcı yoktu. İşi ayağa
-- kaldırmadan önce dört eksik alan kapatılıyor; sonraki fazların hepsi bunları okuyor.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- ---------------------------------------------------------------------------
-- 1. Arşiv damgası (hesap düzeyi, firma satırına yazılır)
-- ---------------------------------------------------------------------------
-- NULL = normal. Dolu = hesap arşivde: okuma ve DIŞA AKTARMA açık, yazma uçları 403.
--
-- Neden companies üzerinde (subscriptions'ta değil): kapı istek başına çalışıyor ve firma
-- kaydı zaten yükleniyor. Arşiv bilgisini abonelikten okumak her `/api/*` isteğine ikinci
-- bir sorgu eklerdi. "disabledModules" ile AYNI desen: hesabın kök firmasına ve tüm
-- üyelerine (şubeler + ek firmalar) birlikte yazılır.
--
-- Arşiv SİLME DEĞİLDİR: fatura/e-fatura/defter kayıtları VUK gereği saklanır.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Arşiv taraması "arşivde olmayanlar" üzerinden koşar; kısmi indeks tabloyu taramaz.
CREATE INDEX IF NOT EXISTS "companies_archivedAt_idx"
  ON public.companies ("archivedAt") WHERE "archivedAt" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Abonelik: kilit anı, uyarı durumu, saklı kart gösterimi
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  -- Erişimin GERÇEKTEN kapandığı an (reconcile EXPIRED yazarken damgalar).
  -- "periodEnd" ile karıştırmayın: araya hoşgörü süresi girer. Arşiv sayacı buradan
  -- işler — periodEnd'den saymak hoşgörüde geçen günleri iki kez saymak olurdu.
  ADD COLUMN IF NOT EXISTS "lockedAt"            TIMESTAMP(3),
  -- Bitiş uyarısı e-postasının en son hangi EŞİK için (kalan gün) ve ne zaman
  -- gönderildiği. Eşiği yalnız "bugün tam 3 gün kaldı" diye yakalamak, cron'un günde
  -- TAM BİR KEZ koştuğunu varsayar: iki kez koşarsa e-posta ikilenir, bir gün kaçarsa
  -- eşik sessizce atlanır. Karar bu yüzden "bu eşik için daha önce gönderdim mi"ye bağlanır.
  ADD COLUMN IF NOT EXISTS "lastNoticeThreshold" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastNoticeSentAt"    TIMESTAMP(3),
  -- Saklı kartın GÖSTERİM bilgisi (PayTR recurring). Çekimde kullanılan şey
  -- "providerSubscriptionId"deki token'dır. Kart numarası, son kullanma ve CVV
  -- HİÇBİR koşulda tutulmaz — burada yalnız marka ve son dört hane durur.
  ADD COLUMN IF NOT EXISTS "cardBrand"           TEXT,
  ADD COLUMN IF NOT EXISTS "cardLast4"           TEXT;

-- ---------------------------------------------------------------------------
-- 3. subscription_events — abonelikte olan bitenin append-only günlüğü
-- ---------------------------------------------------------------------------
-- Neden: bu projede hesapların modülleri canlıda İKİ KEZ sessizce kapandı
-- (docs/paket-abonelik/ILERLEME.md — 2026-08-15 kota siparişi ve elle grant'ların
-- kalıcı olmaması). Her ikisinde de "ne zaman, neyin sonucu olarak kapandı" sorusunun
-- cevabı hiçbir yerde yoktu: durum alanı yalnız SON hâli tutar, geçişi tutmaz.
--
-- Güncellenmez, silinmez. Yazan yollar: reconcile (hoşgörü/kilit/arşiv), yinelenen ödeme,
-- satın alma callback'i, sistem-admin müdahalesi (süre/modül/kota), müşteri iptali.
CREATE TABLE IF NOT EXISTS public.subscription_events (
  "id"             TEXT PRIMARY KEY,
  -- Abonelik satırı silinebilir (hesap sıfırlama); olay yine de durur → SET NULL.
  "subscriptionId" TEXT,
  -- Hesabın KÖK firması. Abonelik satırı olmasa bile olay bir hesaba aittir; "bu hesapta
  -- ne oldu" sorgusu buradan koşar, bu yüzden zorunlu.
  "companyId"      TEXT NOT NULL,
  -- PERIOD_STARTED | RENEWED | RENEWAL_FAILED | GRACE_STARTED | EXPIRED | ARCHIVED
  -- | CANCELLED | MODULES_CHANGED | QUOTA_CHANGED | MANUAL_GRANT
  "type"           TEXT NOT NULL,
  -- İnsan okuru için tek satır özet ("Yıllık dönem 27.08.2027'ye uzatıldı").
  "summary"        TEXT NOT NULL,
  -- Olaya özel yapılandırılmış ayrıntı: önceki/sonraki durum, tutar, modül farkı…
  "detail"         JSONB,
  -- SYSTEM (cron) | PAYTR (callback) | ADMIN (sistem-admin) | USER (müşteri)
  "actor"          TEXT NOT NULL DEFAULT 'SYSTEM',
  -- Elle müdahalede kullanıcı; SYSTEM/PAYTR olaylarında null.
  "actorUserId"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscription_events_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES public.subscriptions ("id") ON DELETE SET NULL,
  CONSTRAINT "subscription_events_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "subscription_events_companyId_createdAt_idx"
  ON public.subscription_events ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "subscription_events_type_createdAt_idx"
  ON public.subscription_events ("type", "createdAt");

-- ---------------------------------------------------------------------------
-- 4. cron_runs — günlük işin koşum kaydı: gözlem + çift koşum kilidi
-- ---------------------------------------------------------------------------
-- Gözlem: bu iş kilitleme yapıyor. Sessizce üç gün çalışmazsa kimse fark etmez; süresi
-- dolan hesaplar açık kalır, uyarı e-postaları gitmez, yenileme çekilmez.
--
-- Kilit: "jobKey" = '<iş>:<YYYY-MM-DD>' BENZERSİZDİR. Aynı gün ikinci koşum INSERT'te
-- çakışır ve devam etmez — cron'un iki kez tetiklenmesi (yeniden deneme, elle çağırma)
-- uyarı e-postasını ikilemesin, çekimi tekrarlamasın.
CREATE TABLE IF NOT EXISTS public.cron_runs (
  "id"          TEXT PRIMARY KEY,
  "jobKey"      TEXT NOT NULL,
  "job"         TEXT NOT NULL,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  TIMESTAMP(3),
  -- RUNNING | OK | FAILED
  "status"      TEXT NOT NULL DEFAULT 'RUNNING',
  "durationMs"  INTEGER,
  -- Adım adım sonuç gövdesi — hangi adımda ne olduğu.
  "result"      JSONB,
  -- Başarısız adımların adları; boşsa koşum temiz.
  "failedSteps" TEXT[] NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "cron_runs_jobKey_key" ON public.cron_runs ("jobKey");
CREATE INDEX IF NOT EXISTS "cron_runs_job_startedAt_idx" ON public.cron_runs ("job", "startedAt");

-- ---------------------------------------------------------------------------
-- RLS — CLAUDE.md kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_runs           ENABLE ROW LEVEL SECURITY;
