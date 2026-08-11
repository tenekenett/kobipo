# Hızlı Kurulum Rehberi

## 1. Database Password Alma

Supabase dashboard'unuzda:
1. **Settings** > **Database** bölümüne gidin
2. **Database password** bölümünde password'unuzu görüntüleyin
3. Eğer password'u bilmiyorsanız, **Reset database password** butonuna tıklayın
4. Yeni password'u güvenli bir yere kaydedin

## 2. .env Dosyası Oluşturma

Proje kök dizininde (package.json'un olduğu yerde) `.env` dosyası oluşturun:

```bash
# Windows (PowerShell)
New-Item -Path .env -ItemType File

# Mac/Linux
touch .env
```

## 3. .env Dosyası İçeriği

`.env` dosyasına şu içeriği ekleyin (password'u kendi password'unuzla değiştirin):

```env
# Supabase Database Connection
DATABASE_URL="postgresql://postgres:YOUR_ACTUAL_PASSWORD@db.<proje-ref>.supabase.co:5432/postgres"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here-change-this"

# E-Fatura Integration (opsiyonel)
E_INVOICE_PROVIDER="mock"

# Supabase Public Keys — değerleri Supabase panelinden (Settings → API) alın.
# Bu depo herkese AÇIK: buraya gerçek anahtar yazmayın, `.env` gitignore'ludur.
NEXT_PUBLIC_SUPABASE_URL="https://<proje-ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

**ÖNEMLİ:**
- `YOUR_ACTUAL_PASSWORD` yerine Supabase database password'unuzu yazın
- `NEXTAUTH_SECRET` için güçlü bir secret key oluşturun:
  ```bash
  # Windows PowerShell
  [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.Guid]::NewGuid().ToString() + [System.Guid]::NewGuid().ToString()))
  
  # Mac/Linux
  openssl rand -base64 32
  ```

## 4. Bağımlılıkları Yükleme

```bash
npm install
```

## 5. Prisma Client Generate

```bash
npm run db:generate
```

## 6. Database Migration

```bash
npm run db:migrate
```

Bu komut:
- Veritabanında tüm tabloları oluşturur
- İlişkileri kurar
- İndeksleri ekler

## 7. Development Server Başlatma

```bash
npm run dev
```

Tarayıcıda `http://localhost:3000` adresine gidin.

## 8. İlk Kullanıcı Oluşturma

1. `/auth/signup` sayfasına gidin
2. Yeni bir kullanıcı oluşturun
3. Giriş yapın
4. İlk firmanızı oluşturun

## Sorun Giderme

### Connection Error
- Password'un doğru olduğundan emin olun
- Connection string'deki özel karakterleri URL encode edin
- Supabase dashboard'da database'in aktif olduğunu kontrol edin

### Migration Error
- Database'in boş olduğundan emin olun
- Connection string'in Transaction mode (port 5432) olduğundan emin olun
- `npm run db:generate` komutunu önce çalıştırdığınızdan emin olun

### Prisma Studio (Veritabanını Görüntüleme)

```bash
npm run db:studio
```

Bu komut Prisma Studio'yu açar ve veritabanınızı görsel olarak inceleyebilirsiniz.

