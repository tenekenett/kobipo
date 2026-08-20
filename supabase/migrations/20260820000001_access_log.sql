-- Erişim (trafik) kaydı: giriş/çıkış/kayıt denemeleri, IP ve varsa kaynak portuyla.
--
-- Neden: 5651 kapsamında erişim kayıtlarının tutulması ve bir uyuşmazlıkta
-- "şu işlemi kim, nereden yaptı" sorusuna cevap verilebilmesi gerekiyor. Uygulama
-- bugüne kadar hiçbir giriş kaydı tutmuyordu (SystemLog yalnız yönetici işlemlerini
-- yazıyor ve LOGIN hiç yazılmıyordu).

CREATE TABLE IF NOT EXISTS public.access_logs (
  id             TEXT PRIMARY KEY,
  "userId"       TEXT,
  email          TEXT,
  action         TEXT NOT NULL,
  reason         TEXT,
  ip             TEXT,
  port           INTEGER,
  "forwardedFor" TEXT,
  "userAgent"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT access_logs_userId_fkey FOREIGN KEY ("userId")
    REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Sorgu deseni: tarih aralığı, kullanıcı, IP, eylem türü, e-posta.
CREATE INDEX IF NOT EXISTS "access_logs_createdAt_idx" ON public.access_logs("createdAt");
CREATE INDEX IF NOT EXISTS "access_logs_userId_idx"    ON public.access_logs("userId");
CREATE INDEX IF NOT EXISTS "access_logs_ip_idx"        ON public.access_logs(ip);
CREATE INDEX IF NOT EXISTS "access_logs_action_idx"    ON public.access_logs(action);
CREATE INDEX IF NOT EXISTS "access_logs_email_idx"     ON public.access_logs(email);

-- CLAUDE.md kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
