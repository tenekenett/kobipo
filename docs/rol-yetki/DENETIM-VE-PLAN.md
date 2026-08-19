# Rol / yetki sistemi — denetim ve devir notu

**Tarih:** 2026-08-19 · **Durum:** **Üç bulgu da düzeltildi** (Bulgu 3'ün dört deliği
dahil). Açık kalan tek madde `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` denemesidir; planın
kendisi onu "ayrı bir iş, staging'de" diye ayırmıştı.

**Doğrulama:** `npx vitest run` **355 test yeşil**, `npx next build` temiz,
`npx tsc --noEmit` **0 hata**. (Baştaki 15 tip hatası bayat Prisma client'tandı:
`npx prisma generate` 14'ünü, `.next/types` temizliği kalanını çözdü.)

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

### Yapılacaklar — **BİTTİ (2026-08-19)**

- [x] `GET /api/company/roles` sonucundan **kalıp kartlarını işaretle**: o `templateKey`
      ile üretilmiş rol varsa kart "Oluşturuldu · Düzenle" olsun ve `openEdit(role)`
      çağırsın.
- [x] `POST /api/company/roles` 409 gövdesine çakışan rolün `id`'sini ekle
      (`{ error, existingRoleId }`), diyalog "Bu isimde bir rol var — onu düzenlemek
      ister misiniz?" diyerek düzenleme moduna geçsin.
- [x] Diyalogda ad alanı için canlı çakışma uyarısı (mevcut roller listesiyle, kendi
      id'si hariç).
- [x] `/ayarlar/ekip` rol seçicisinin yanına "Rolü düzenle" (seçili özel rol için)
      düğmesi; diyaloğa `role` prop'u geçsin.
- [x] `onClose` içinde `setEditingRole(null)` + `setTemplateKey(null)`.
- [x] Regresyon testi — API testi değil: vitest kapsamı bilinçli olarak `lib/**` saf
      fonksiyonlarla sınırlı (bkz. `vitest.config.ts`), route testi için altyapı yok.
      Bunun yerine POST/PATCH kararı `lib/nav/role-conflict.ts`'e çıkarıldı ve
      `lib/nav/role-conflict.test.ts` ile kapatıldı: çakışan ad → POST atılmaz.

### Ne değişti

| Dosya | Değişiklik |
|---|---|
| `lib/nav/role-conflict.ts` | **yeni** — `findRoleNameConflict` / `roleWriteTarget`: POST mu PATCH mi kararının tek kaynağı, test edilebilir |
| `lib/nav/role-conflict.test.ts` | **yeni** — 11 test; Türkçe I/İ normalizasyonu dâhil |
| `app/api/company/roles/route.ts` | 409 gövdesine `existingRoleId` |
| `app/api/company/roles/[id]/route.ts` | PATCH artık **dolu** `templateKey` yazar (boşsa mevcut bağı silmez) |
| `components/dashboard/role-editor-dialog.tsx` | `existingRoles` prop'u, iç `editingId` state'i, canlı çakışma kutusu ("Mevcut yetkilerini getir"), düğme etiketi duruma göre, 409'da düzenlemeye geçiş |
| `app/(dashboard)/ayarlar/roller/page.tsx` | kalıp kartında "Oluşturuldu" rozeti → `openEdit`; `onClose` state sıfırlar |
| `app/(dashboard)/ayarlar/ekip/page.tsx` | seçili özel rol için "… rolünü düzenle" düğmesi; `role`/`existingRoles` prop'ları; `CompanyRole` tipine `description` (yoksa PATCH açıklamayı siliyordu) |

Davranış: aynı ada kaydetmek artık **hiçbir yolda** yeni rol açmayı denemez — hedef
mevcut roldür ve düğme bunu yazar (`"Garson" rolünü güncelle`). 409 yalnız liste
bayatsa (başka sekme) çıkar; o durumda da düzenleme moduna geçilip ikinci onay istenir.

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

### Yapılacaklar — **BİTTİ (2026-08-19)**

- [x] Süzgeç `lib/nav/pages.ts`'te tek kaynak: `PageAvailability` tipi +
      `isPageAvailable` / `filterAvailablePages`; `assignablePages(availability?)` ve
      `pagesForRole(role, availability?)` opsiyonel parametre aldı (verilmezse davranış
      birebir eskisi). Modül çözümü **mevcut** `moduleKeyForPath`'e bağlandı — ikinci
      bir harita kurulmadı; o fonksiyon artık `NavPageDef.module` açık bağını da
      onurlandırıyor.
- [x] `role-editor-dialog` ve `member-permissions-dialog` seçiciyi süzüyor
      (`usePageAvailability()` → seçili firmanın `disabledModules` + `isEDonusumEnabled`).
- [x] **Karar: süzgeç OKUMA/TEKLİF tarafında, `sanitizePagePermissions`'ta DEĞİL.**
      Modül durumu değişkendir (abonelik yenilenir/düşer), izin ise kalıcı yapılandırma;
      yazarken elemek, modül geri açıldığında rolü sessizce budardı. Seçiciler bu yüzden
      **birleşim** kullanıyor: açık modüllerin sayfaları + rolün/üyenin ZATEN sahip
      olduğu sayfalar. Aksi halde kapalı modüllü bir firmada rolü açıp kaydetmek o
      sayfaları rolden silerdi (`pathsFromAccess` yalnız listedekini döndürüyor).
- [x] `nav.tsx`: `standaloneItems` artık modül süzgecinden geçiyor.
- [x] E-Dönüşüm sayfaları `isEDonusumEnabled`'a bağlandı. Eski kontrol
      `item.href === "/e-donusum"` idi ve **o href `NAV_PAGES`'te yok** — yani hiçbir
      zaman bir şey elemiyordu. Artık `E_DONUSUM_PAGES` (grup href'leri + düz link
      `/e-donusum/kontor`) tek kaynak.
- [x] `landingPathFor(permissions, availability?)` kapalı modül sayfasına düşürmüyor;
      üç çağıran da (nav, permission-guard, server page-guard) durumu geçiyor.
- [x] Testler (+5): kapalı modül atanabilir listeden düşer, rol matrisi de süzülür,
      süzgeçsiz çağrı davranışı değiştirmez, e-Dönüşüm ayrı eksen, landing kapalı
      modüle düşmez.

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

### Yapılacaklar — Delik A ve `editablePages` **BİTTİ (2026-08-19)**, B-C açık

- [x] **Arayüz:** `useCanEdit` artık gerçekten kullanılıyor —
      `components/dashboard/write-guard.tsx`: `useCanEditHere()` (sayfa href'ini
      `navHrefsForPath` ile adresten çözer, elle sabit tutmak gerekmez), `<WriteAction>`
      (salt-okunurda hiç render etmez) ve `<ReadOnlyBanner>`. Banner **layout'a tek
      yerde** kondu → her panel sayfası kapsanır; rapor/dashboard'da (doğası gereği
      okuma) bastırılır. `<WriteAction>` uygulandı: fatura listesi (satış+alış ortak
      bileşen: Yeni Fatura, Düzenle, Sil/İptal), cari (Yeni, Düzenle, Sil), stok (Yeni
      Ürün/Hizmet, Düzenle, Sil), finans hareketler (Yeni Hareket), restoran adisyon
      (Yeni adisyon).
- [x] **`editablePages`:** salt-okunur rol için her zaman boş küme
      (`isReadOnlyRole`). Kişisel sayfalar (profil, destek) `canEditPage` düzeyinde
      istisna — yoksa VIEWER kendi şifresini değiştiremeyeceğini sanırdı.
- [x] **`ensureCompanyWrite`:** artık `isReadOnlyMembership()` ile kapatıyor — enum
      VIEWER **ve** hiçbir sayfada yazma izni olmayan özel rol (Gözlemci kalıbı) aynı
      cevabı alıyor. Karar arayüzle ORTAK yordamdan geliyor, ayrışamazlar.
- [x] **`PAGE_API_RULES`:** **76 kuralın tamamında** `writePages` var (52'sine eklendi).
      Kararlar tahminle değil kanıtla verildi: her ucun gerçek HTTP metotları route
      dosyalarından, her yazmanın hangi ekrandan yapıldığı istemci `fetch` çağrılarından
      çıkarıldı. Bir test artık alanı **zorunlu** tutuyor ("her kural yazma sözleşmesini
      AÇIKÇA taşır") — `writePages ?? pages` yedeğinin sessiz genişletmesi bitti.
- [x] **Kuralı olmayan uç:** varsayılan çevrildi — `if (!rule) return !isWriteRequest(method)`.
      Okuma serbest, yazma reddedilir. Sıra korundu: önce harita dolduruldu, sonra çevrildi.
- [ ] `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = true` — **AÇIK BIRAKILDI, bilinçli.** Bu
      bayrak haritayı BUGÜNKÜ TÜM kullanıcılara uygular (kısıtsızlar dahil); tek bir dar
      satır üretimde çalışan bir ekranı kırar. Planın kendi notu: "ayrı bir iş olarak,
      harita tamamlandıktan sonra **staging'de**." Harita artık tamam, yani bu deneme
      yapılabilir — ama staging gerektirir, burada doğrulanamaz.
- [x] `lib/page-access.test.ts` genişletildi (+7 test): VIEWER kısıtsız olsa da yazamaz,
      kısıtlı VIEWER'a `writablePaths` verilse de yazamaz, yazma izinsiz özel rol
      salt-okunurdur, kişisel sayfalar istisna, yazabilen enum roller etkilenmedi.
      "Kuralsız uçta yazamaz" testi Delik B-C ile birlikte (aşağıda) gelecek.

---

## Öncelik sırası — hepsi bitti

1. ~~**Bulgu 1**~~ — **BİTTİ**.
2. ~~**Bulgu 3 / Delik A ve `editablePages`**~~ — **BİTTİ**.
3. ~~**Bulgu 2**~~ — **BİTTİ**.
4. ~~**Bulgu 3 / Delik B-C haritası**~~ — **BİTTİ**. Geriye yalnız
   `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` denemesi kaldı (staging işi, yukarıda).

## Sıra 4'te ortaya çıkan iki şey (kayda geçsin)

**1. Sayfa kapısı yalnız `ensureCompanyAccess` çağıran uçlarda çalışır.** Kapıyı hiç
çağırmayan bir uç (ör. `POST /api/companies`) harita ne derse desin etkilenmez —
koruması başka yerdedir (`createCompany` içindeki erişim/rol/kota denetimi). Bu yüzden
"kuralsız uçta yazmayı reddet" değişikliğinin gerçek yüzeyi, kapıyı çağıran uçlarla
sınırlıdır ve ilk sanılandan dardır.

**2. Muhasebe uçları bilerek kuralsız bırakıldı → kısıtlı üyelikte artık YAZAMAZ.**
`/api/muhasebe/fisler`, `/api/muhasebe/hesap-plani`, `/api/muhasebe/kebir` kapıyı
çağırıyor ama menüde karşılığı olan bir sayfaları yok (`/muhasebe/yevmiye`, `/kebir`
`NAV_PAGES`'te değil). Onlara bir sahip uydurmak yanlış olurdu: rapor sayfasına
bağlamak "raporu gören yevmiye fişi keser" demekti. Sonuç:

- **okuma** kısıtlı üyelikte de serbest (davranış değişmedi),
- **yazma** kısıtlı üyelikte reddedilir (**davranış değişti**).

Menüsüz oldukları için hiçbir özel role atanamıyorlar zaten; etkilenebilecek tek
profil, `allowedPaths` ile kısıtlanmış bir enum rolün URL'yi elle yazarak fiş
kesmesidir. Bu gerekiyorsa doğru çözüm `NAV_PAGES`'e bir muhasebe sayfası eklemek ve
kuralı ona bağlamaktır — kapıyı geri açmak değil.

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
