# Supabase Connection String Ayarlama

## Önemli Notlar

1. **Supabase Dashboard'dan Connection String Alın:**
   - Settings > Database > Connection string
   - **Transaction mode** seçin (migrations için)
   - Connection string'i kopyalayın

2. **Password URL Encoding:**
   - Password'ta özel karakterler varsa (+, @, #, vb.) URL encode edilmelidir
   - `+` → `%2B`
   - `@` → `%40`
   - `#` → `%23`

3. **Connection String Formatları:**

   **Transaction Mode (Migrations için - Port 5432):**
   ```
   postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```

   **Session Mode (Uygulama için - Port 6543):**
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

## Şu Anki Durum

Password'unuz: `Mrk159753+Saas`
- `+` karakteri URL'de `%2B` olarak encode edilmelidir
- Encoded: `Mrk159753%2BSaas`

## Önerilen Çözüm

Supabase Dashboard'dan direkt connection string'i alın:
1. Settings > Database
2. Connection string sekmesi
3. **Transaction mode** seçin
4. **URI** formatını seçin
5. Connection string'i kopyalayın ve `.env` dosyasına yapıştırın

Bu şekilde password otomatik olarak doğru encode edilmiş olacaktır.

