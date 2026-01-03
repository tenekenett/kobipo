# Supabase Bağlantı Sorunu Giderme

## Sorun
Veritabanına bağlanılamıyor: `Can't reach database server`

## Olası Nedenler ve Çözümler

### 1. Network Restrictions (IP Whitelist)

Supabase dashboard'da:
1. **Settings** > **Database**
2. **Network restrictions** bölümüne gidin
3. **Allow all IPs** seçeneğini aktif edin (development için)
   VEYA
4. Local IP adresinizi whitelist'e ekleyin

### 2. Supabase Projesi Durumu

- Supabase dashboard'da projenizin **aktif** olduğundan emin olun
- Database'in **paused** olmadığını kontrol edin

### 3. Connection String Formatı

Doğru format:
```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

Password URL encode edilmiş olmalı:
- `+` → `%2B`
- `@` → `%40`
- `#` → `%23`

### 4. Alternatif: Supabase SQL Editor Kullanımı

Eğer Prisma migration çalışmazsa, Supabase SQL Editor'ı kullanarak tabloları manuel oluşturabilirsiniz:

1. Supabase Dashboard > **SQL Editor**
2. `prisma/migrations` klasöründeki SQL dosyalarını çalıştırın
3. VEYA Prisma schema'dan SQL generate edin: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`

### 5. Test Bağlantısı

Supabase dashboard'da:
- **Settings** > **Database** > **Connection string**
- **Test connection** butonunu kullanarak bağlantıyı test edin

## Hızlı Çözüm

1. Supabase Dashboard > Settings > Database > Network restrictions
2. **Allow all IPs** seçeneğini aktif edin
3. Migration'ı tekrar deneyin

