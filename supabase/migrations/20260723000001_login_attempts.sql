-- Brute-force koruması: IP bazlı başarısız giriş sayacı + geçici kilit (login_attempts).
-- Additive/güvenli: yalnızca yeni tablo. authorize() bu tabloyu fail-open kullanır.
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "id" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastEmail" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "login_attempts_ip_key" ON "login_attempts" ("ip");
CREATE INDEX IF NOT EXISTS "login_attempts_lockedUntil_idx" ON "login_attempts" ("lockedUntil");
