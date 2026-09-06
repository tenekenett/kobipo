-- Otomasyon kartlarının gösterim ve karar günlüğü.
--
-- Kartlar yayına girdiği andan itibaren her gösterim etiketli bir veri
-- noktasıdır; bu tablo tutulmazsa "hangi kart işe yaradı" sorusu geriye dönük
-- cevaplanamaz. Ayrıntı: docs/otomasyonlar/KATALOG.md

CREATE TABLE IF NOT EXISTS public.automation_card_events (
  id            TEXT PRIMARY KEY,
  "companyId"   TEXT NOT NULL,
  "userId"      TEXT,
  "cardKey"     TEXT NOT NULL,
  "cardVersion" INTEGER NOT NULL DEFAULT 1,
  severity      TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId"   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  "shownAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shownDay"    DATE NOT NULL,
  decision      TEXT,
  "decidedAt"   TIMESTAMP(3),
  "actionKey"   TEXT,
  "snoozeUntil" TIMESTAMP(3),
  "outcomeAt"   TIMESTAMP(3),
  "outcomeType" TEXT,
  "outcomeRef"  TEXT
);

-- Aynı kart, aynı özne, aynı gün tek satır: sayfa her açıldığında satır atarsa
-- gösterim sayısı ilgiyle karışır ve yanıt oranı ölçülemez olur.
CREATE UNIQUE INDEX IF NOT EXISTS "automation_card_events_company_key_subject_day_key"
  ON public.automation_card_events ("companyId", "cardKey", "subjectId", "shownDay");

CREATE INDEX IF NOT EXISTS "automation_card_events_company_key_shown_idx"
  ON public.automation_card_events ("companyId", "cardKey", "shownAt");

CREATE INDEX IF NOT EXISTS "automation_card_events_company_decision_idx"
  ON public.automation_card_events ("companyId", decision);

CREATE INDEX IF NOT EXISTS "automation_card_events_subject_idx"
  ON public.automation_card_events ("subjectType", "subjectId");

-- Proje kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.automation_card_events ENABLE ROW LEVEL SECURITY;
