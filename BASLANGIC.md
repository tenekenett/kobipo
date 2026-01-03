# Başlangıç Kontrol Listesi

## ✅ Kurulu Olanlar
- Node.js v22.20.0
- npm 10.9.3
- Prisma 5.22.0
- Proje dosyaları

## ❌ Sorunlar
1. **Connection String:** Port 6543 (pooling) migration için uygun değil
2. **Supabase CLI:** Kurulu değil (opsiyonel)

## 🔧 Çözüm: 3 Seçenek

### Seçenek 1: Supabase Dashboard'dan Transaction Mode Connection String (ÖNERİLEN)

1. Supabase Dashboard > Settings > Database
2. **Connection string** sekmesi
3. **Transaction mode** seçin (Session mode değil!)
4. **URI** formatını seçin
5. Connection string'i kopyalayın
6. `.env` dosyasındaki `DATABASE_URL`'i güncelleyin

Format: `postgresql://postgres:[PASSWORD]@db.swjalhvznztdmdyaspgz.supabase.co:5432/postgres`

### Seçenek 2: Supabase CLI ile Bağlanma

```bash
# Supabase CLI kurulumu
npm install -g supabase

# Supabase'e login
npx supabase login

# Projeyi link et
npx supabase link --project-ref swjalhvznztdmdyaspgz

# Migration'ı çalıştır
npx supabase db push
```

### Seçenek 3: SQL Editor ile Manuel Kurulum

1. `migration.sql` dosyasını Supabase SQL Editor'da çalıştırın
2. `npm run db:generate` çalıştırın
3. `npm run dev` ile başlatın

## Hangi Yöntemi Tercih Edersiniz?

