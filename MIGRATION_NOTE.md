# Migration İçin Önemli Not

## Sorun
Connection pooling (port 6543) migrations için uygun değil. Migration'lar için **Transaction mode** (port 5432) gerekiyor.

## Çözüm

Supabase Dashboard'dan **Transaction mode** connection string'i alın:

1. Supabase Dashboard > Settings > Database
2. Connection string sekmesi
3. **Transaction mode** seçin (Session mode değil!)
4. **URI** formatını seçin
5. Connection string'i kopyalayın

Format şöyle olacak:
```
postgresql://postgres:[PASSWORD]@db.swjalhvznztdmdyaspgz.supabase.co:5432/postgres
```

## İki Farklı Connection String Kullanımı

- **Migration için:** Transaction mode (port 5432) - `.env` dosyasında
- **Uygulama için:** Session mode/Pooling (port 6543) - Production'da kullanılabilir

Şu an migration yapacağımız için Transaction mode kullanmalıyız.

