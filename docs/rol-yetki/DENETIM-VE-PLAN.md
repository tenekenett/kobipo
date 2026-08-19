# Rol / yetki sistemi — denetim ve devir notu

**Tarih:** 2026-08-19 · **Durum:** analiz bitti, kod DEĞİŞMEDİ (bu dosya hariç).
**Devir sebebi:** başka bilgisayarda devam edilecek.

Şikâyet (kullanıcı, birebir):

1. "Yeni bir rol tanımlayıp düzenlediğimde *bu rol zaten kayıtlı* hatası alıyorum."
2. "Harici olarak modüller gizlense de gözüküyor."
3. "Görüntüleyici olması işlem yapmasını engellemiyor."

Üçü de doğrulandı. Aşağıda sebepler, kanıtlar ve yapılacak iş listesi var.

---

## Sistemin bugünkü haritası (okurken lazım)

| Katman | Dosya | Ne yapar |
|---|---|---|
| Sayfa kataloğu | `lib/nav/pages.ts` | `NAV_PAGES` (sayfa + rol matrisi + modül), `pagesForRole`, `assignablePages`, `ACCOUNT_ADMIN_PAGES` |
| İzin motoru | `lib/page-access.ts` | `visiblePages` / `editablePages` / `canAccessRoute` / `isApiPathAllowedForUser` / `sanitizePagePermissions` + `PAGE_API_RULES` (uç → sayfa haritası) |
| Modül motoru | `lib/modules.ts`, `lib/module-access.ts` | `disabledModules` RED listesi, uç → modül haritası |
| Sunucu kapısı | `lib/middleware/company.ts` | `ensureCompanyAccess` (modül kapısı → sayfa kapısı), `ensureCompanyWrite` (yalnız enum `VIEWER`'ı reddeder) |
| Sunucu sayfa kapısı | `lib/middleware/page-guard.ts` | server component'ler için `assertRouteAccessOrRedirect` |
| İstemci | `components/dashboard/dashboard-company-provider.tsx` | `useVisiblePages` / `useCanView` / `useCanEdit` |
| Ekranlar | `app/(dashboard)/ayarlar/roller/page.tsx`, `.../ekip/page.tsx`, `components/dashboard/role-editor-dialog.tsx`, `member-permissions-dialog.tsx`, `page-permission-picker.tsx`, `permission-guard.tsx`, `module-guard.tsx` | |
| API | `app/api/company/roles/route.ts`, `app/api/company/roles/[id]/route.ts`, `app/api/company/users/[id]/route.ts` | |

İki ayrı yetki dünyası var, karıştırmayın:

- **Hazır enum rol** (`Role`: ADMIN/…/VIEWER) → tavan `pagesForRole(role)`. `allowedPaths` boşsa "kısıt yok".
- **Özel rol** (`CompanyRole`) → üyelikte `role = CUSTOM`, `customRoleId` dolu; yetki **rolde** durur, üyelikteki `allowedPaths/writablePaths` **temizlenir**. Tavan `assignablePages()`.

---

## Bulgu 1 — Rol düzenlerken "Bu isimde bir rol zaten var" (409)

### Kanıt

Canlı DB okundu (salt-okunur):

```
ROLE COUNT 3
Garson            co=kobipo-demo-merkez   tpl=garson              created==updated
argon kaynakcısı  co=reypo                tpl=null                created==updated
Satış Temsilcisi  co=eren-vinc-…          tpl=satis-temsilcisi    created==updated
```

**Üç rolde de `createdAt == updatedAt`** → bugüne kadar hiçbir rol başarıyla
**düzenlenmemiş**. Yani PATCH ya hiç çağrılmıyor ya hep hata veriyor.

`(companyId, name)` UNIQUE index'i doğru kurulu:

```
company_roles_companyId_name_key  UNIQUE ("companyId", name)
```

Ve **aynı isimle PATCH P2002 ÜRETMİYOR** — geri alınan bir transaction içinde test edildi:

```
UPDATE OK (same name): Satış Temsilcisi
rolled back, no P2002
```

**Sonuç: 409 PATCH'ten değil, POST'tan geliyor.** Kullanıcı "düzenliyorum" sanırken
arayüz **yeni rol oluşturuyor**.

### Sebep — oluşturma ve düzenleme yolları ayırt edilemiyor

`components/dashboard/role-editor-dialog.tsx` doğru davranıyor
(`role?.id ? PATCH : POST`). Sorun onu **hangi buton nasıl açıyor**:

1. `app/(dashboard)/ayarlar/roller/page.tsx` → "Hazır kalıplar" kartları
   `openNew(template.key)` çağırır: `editingRole = null`, ad kalıptan **ön-doldurulur**
   ("Satış Temsilcisi"). O kalıptan zaten bir rol üretilmişse kart bunu **hiçbir şekilde
   belirtmiyor** — kullanıcı "rolüm burada" diye karta basıp Kaydet deyince POST gidiyor
   ve 409 dönüyor. DB'deki `templateKey` alanları bu senaryoyla birebir uyuşuyor.
2. `app/(dashboard)/ayarlar/ekip/page.tsx` → "Yeni rol tanımla" düğmesi diyalogu
   `role` prop'u OLMADAN açar; o ekranda mevcut bir rolü **düzenlemenin yolu yok**.
   Rolü oradan tanımlayan kişi düzeltmek için aynı düğmeye basıyor → POST → 409.
3. 409 çıkmaz sokak: mesaj "Bu isimde bir rol zaten var" deyip bırakıyor; "mevcut rolü
   aç/düzenle" seçeneği sunulmuyor. Ad benzersizliği yazarken de kontrol edilmiyor.

Yan kusur (sebep değil, ama düzeltilecek): `roller/page.tsx` içindeki
`onClose={() => setOpen(false)}` `editingRole` ve `templateKey` state'lerini
sıfırlamıyor.

### Yapılacaklar

- [ ] `GET /api/company/roles` sonucundan **kalıp kartlarını işaretle**: o `templateKey`
      ile üretilmiş rol varsa kart "Oluşturuldu · Düzenle" olsun ve `openEdit(role)`
      çağırsın.
- [ ] `POST /api/company/roles` 409 gövdesine çakışan rolün `id`'sini ekle
      (`{ error, existingRoleId }`), diyalog "Bu isimde bir rol var — onu düzenlemek
      ister misiniz?" diyerek düzenleme moduna geçsin.
- [ ] Diyalogda ad alanı için canlı çakışma uyarısı (mevcut roller listesiyle, kendi
      id'si hariç).
- [ ] `/ayarlar/ekip` rol seçicisinin yanına "Rolü düzenle" (seçili özel rol için)
      düğmesi; diyaloğa `role` prop'u geçsin.
- [ ] `onClose` içinde `setEditingRole(null)` + `setTemplateKey(null)`.
- [ ] Regresyon testi: create → edit (aynı ad) → 200 beklenir; create → create (aynı ad)
      → 409 + `existingRoleId` beklenir.

---

## Bulgu 2 — Kapalı modüllerin sayfaları hâlâ görünüyor

### Sebep A — yetki seçicileri modüle tamamen kör

`lib/nav/pages.ts:392`:

```ts
export function assignablePages(): string[] {
  return NAV_PAGES.filter((p) => !ACCOUNT_ADMIN_PAGES.includes(p.href)).map((p) => p.href)
}
```

`company.disabledModules` hiç okunmuyor. Zinciri:

- `role-editor-dialog.tsx` → `selectable = assignablePages()` → **Restoran & Kafe,
  Personel, e-Dönüşüm… satın alınmamışken bile listede.**
- `member-permissions-dialog.tsx` → `pagesForRole(member.role)` → aynı körlük.
- `lib/page-access.ts → sanitizePagePermissions` → tavanı yine `ceilingPages` ile alıyor,
  yani kapalı modülün sayfası **DB'ye yazılıyor**; sunucu da elemiyor.
- `visiblePages` / `canAccessRoute` / `landingPathFor` modüle bakmaz → kısıtlı çalışan
  açılışta "modül kapalı" ekranına düşebilir.

### Sebep B — menüde modül filtresi dışında kalan öğeler

`components/dashboard/nav.tsx` grupları `disabledModules` ile süzüyor, **ama**:

- `MODULE_GROUP_TO_KEY` yalnız 7 modül grubunu tanıyor (sales, purchase, stock, finance,
  reports, hr, restaurant). **"E-Dönüşüm" ve "Ayarlar" gruplarının modül anahtarı yok →
  hiçbir zaman gizlenmiyor.** `isEDonusumEnabled` kontrolü yalnız `/e-donusum` href'ine
  bakıyor, o href ise `NAV_PAGES`'te yok; gerçek öğeler `/ayarlar/e-donusum`,
  `/e-donusum/seri-no`, `/e-donusum/sablon`.
- `standaloneItems` (`/e-donusum/kontor`, `/ayarlar/destek`, `/ayarlar/profil`) modül
  filtresinden **hiç geçmiyor** → e-Dönüşüm kapalıyken "Kontör" menüde duruyor.

### Yapılacaklar

- [ ] `ceilingPages` / `assignablePages` / `pagesForRole` çağrılarına opsiyonel
      `disabledModules` parametresi ekle (`moduleKeyForPath` + `NavPageDef.module` ile
      elemek). Tek kaynak `lib/nav/pages.ts` kalsın.
- [ ] `role-editor-dialog` ve `member-permissions-dialog` seçiciyi
      `selectedCompany.disabledModules` ile süzsün.
- [ ] `sanitizePagePermissions`'a firmanın kapalı modüllerini geçir → kapalı modül
      sayfası DB'ye **yazılmasın**. (Modül sonradan açılırsa rol o sayfayı kaybetmesin
      diye alternatif: yazmaya izin ver ama `visiblePages` çıkışında ele — hangisi
      seçilirse seçilsin **bir** yerde olsun, ikisinde birden değil.)
- [ ] `nav.tsx`: `standaloneItems` için de modül/`isEDonusumEnabled` filtresi.
- [ ] E-Dönüşüm nav grubunu `isEDonusumEnabled`'a bağla (grup düzeyinde).
- [ ] `landingPathFor` kapalı modül sayfasına düşürmesin.

---

## Bulgu 3 — "Görüntüleyici" yazmayı engellemiyor

Bu en ciddi bulgu; **üç ayrı delik** var.

### Delik A — salt-okunur izninin ARAYÜZDE hiçbir karşılığı yok

`useCanEdit` / `canEditPage` yazılmış ama **hiçbir ekranda kullanılmıyor** (tüm
`app/` + `components/` taraması: yalnız tanım ve test dosyası). Yani izin seçicide bir
sayfayı "yalnız görüntüle" yapmak **hiçbir düğmeyi gizlemiyor**; Yeni / Kaydet / Sil
düğmeleri herkese çizilmeye devam ediyor. Kullanıcının gördüğü davranış birebir bu.

### Delik B — kısıtsız üyelikte kapı hiç çalışmıyor

```ts
// lib/page-access.ts
export const ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = false

export function isApiPathAllowedForUser(pathname, method, permissions) {
  if (!isRestrictedMembership(permissions) && !ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED) return true
  …
}

export function editablePages(permissions) {
  const visible = visiblePages(permissions)
  if (!isRestrictedMembership(permissions)) return visible   // ← VIEWER dahil "her şey yazılabilir"
  …
}
```

Enum `VIEWER` kısıtsız sayıldığı için hem sayfa kapısı hem `editablePages` onu serbest
bırakıyor. Geriye tek koruma `ensureCompanyWrite` kalıyor (`role === "VIEWER"` → reddet).
Tarama: 116 route dosyası `ensureCompanyWrite` kullanıyor; **22 mutasyon handler'ı yalnız
`ensureCompanyAccess` ile korunuyor** (çoğu billing/system-admin/support — meşru; ama
içlerinde `company/definitions` POST/PATCH/DELETE, `companies/[id]` PUT, `notifications`
POST/PATCH da var).

### Delik C — özel rol `ensureCompanyWrite`'a hiç takılmıyor

Özel rollü üyeliğin enum'u `CUSTOM`'dur, `VIEWER` değil → `ensureCompanyWrite` onu asla
durdurmaz. Salt-okunurluğu tamamen `PAGE_API_RULES`'a kalıyor ve orada iki boşluk var:

1. **Kuralı olmayan uç serbest** (`if (!rule) return true`). Firma kapsamlı, veri yazan
   ama hiçbir kurala girmeyen 19 uç grubu:

   ```
   /api/attachments                 /api/muhasebe/fisler
   /api/notifications               /api/muhasebe/hesap-plani
   /api/support/tickets             /api/companies/[id]
   /api/support/tickets/[id]/messages
   /api/e-donusum/onboarding        /api/e-donusum/discover-inbox
   /api/e-donusum/verify-tenant-vkn /api/e-donusum/discover-mysoft-config
   /api/e-donusum/discover-tenant-vkn
   /api/kontor/orders (+ paytr-token, receipt)
   /api/billing/orders (+ paytr-token) /api/billing/subscription/cancel
   /api/test-mysoft
   ```

2. **`writePages` tanımlamayan 52 kural** → `writePages ?? pages`, yani o ucu
   *görebilen* herkes *yazabiliyor*. Aralarında ciddi olanlar:
   `/api/restoran/adisyonlar`, `/api/restoran/masalar`, `/api/restoran/ikram`,
   `/api/siparis`, `/api/teklif`, `/api/irsaliye`, `/api/e-irsaliye`, `/api/finans`,
   `/api/kasa`, `/api/banka`, `/api/personel`, `/api/depolar/transfer`,
   `/api/stok/movements`, `/api/import`, `/api/cari` (genel), `/api/export/*`.

### Yapılacaklar

- [ ] **Arayüz:** `useCanEdit`'i gerçekten kullan. En ucuz yol: sayfa başına tek bir
      `ReadOnlyBanner` + `useCanEdit(navHref)` ile yazma düğmelerini `disabled` yapan
      ortak bir sarmalayıcı (`<WriteAction>` gibi). Önce yüksek riskli ekranlar:
      satış/alış fatura, cari, stok, finans, restoran adisyon.
- [ ] **`editablePages`:** enum `VIEWER` için her zaman boş küme dön (kısıtsız olsa bile).
      Bugün `VIEWER` "her sayfada yazabilir" görünüyor.
- [ ] **`ensureCompanyWrite`:** `VIEWER`'a ek olarak "yazılabilir sayfası olmayan"
      üyelikleri de reddet (özel rolde `writablePaths` boşsa).
- [ ] **`PAGE_API_RULES`:** yukarıdaki 52 kurala `writePages` yaz; en azından
      restoran/finans/personel/stok gruplarına.
- [ ] **Kuralı olmayan uç:** kısıtlı üyelikler için yazma isteklerinde varsayılanı
      *deny*'a çevir (`if (!rule) return !isWriteRequest(method)`), sonra 19 ucun
      gerçek sahibini haritaya ekle. Bu tek satır, en büyük deliği kapatır — ama önce
      haritayı doldurmadan açılırsa ekran kırar; sırayı bozmayın.
- [ ] `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = true` denemesi **en son**; ayrı bir iş
      olarak, harita tamamlandıktan sonra staging'de.
- [ ] `lib/page-access.test.ts` genişlet: VIEWER yazamaz, özel rol salt-okunur sayfada
      yazamaz, kuralsız uçta yazamaz.

---

## Öncelik sırası (önerilen)

1. **Bulgu 1** — kullanıcıyı bugün bloke eden tek şey, küçük ve izole (UI + 409 gövdesi).
2. **Bulgu 3 / Delik A ve `editablePages`** — güvenlik etkisi en yüksek, kod değişimi orta.
3. **Bulgu 2** — kafa karışıklığı ve yanlış rol tanımı üretiyor.
4. **Bulgu 3 / Delik B-C haritası** — en geniş yüzey, kademeli ve testli gitmeli.

## Doğrulama komutları

```bash
npm run check:rls              # RLS duruşu
npm run check:company-create   # firma yaratma tek kapı
npx vitest run lib/page-access.test.ts
```

## Bu oturumda ne yapıldı / yapılmadı

- **Yapıldı:** yalnız okuma ve analiz. Canlı DB'den `company_roles` + kısıtlı üyelikler
  okundu; "aynı isimle PATCH P2002 üretir mi" testi **geri alınan** bir transaction
  içinde çalıştırıldı (veri değişmedi). Geçici script'ler (`scripts/_tmp-*.js`) silindi.
- **Yapılmadı:** hiçbir uygulama dosyası değiştirilmedi. Bu dosya tek yeni dosyadır.
