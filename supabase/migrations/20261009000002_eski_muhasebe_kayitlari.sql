-- Eski muhasebe modeli (`accounting_entries`: kayıt başına tek borç–tek alacak) kaldırılır
-- (docs/muhasebe/MOTOR-PLAN.md §2.8, karar 2026-10-09).
--
-- Yerini 2026-10-04'te çok satırlı yevmiye fişi aldı (journal_vouchers); hiçbir ekran bu
-- tabloyu okumuyor. Canlıda tek firmada (Reypo Medya, test) 3 kayıt vardı — aynı
-- faturaların fişleri yeni defterde zaten üretiliyor, taşınmadı.
--
-- SIRA: DEPLOY'DAN SONRA uygulanır. Bugün canlıdaki kod fatura silerken bu tablodan
-- satır siliyor; tablo önce düşerse fatura silme hata verir. Yeni kod tabloyu hiç anmaz.
DROP TABLE IF EXISTS public.accounting_entries;
