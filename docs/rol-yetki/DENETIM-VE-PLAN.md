# Rol / yetki sistemi — denetim ve devir notu

## ▶ DEVAM (başka bilgisayarda buradan başla)

**Durum:** rol/yetki işi **bitti ve tarayıcıda dört rolle sınandı** (ADMIN, STOCK, SALES,
özel rol). `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` açık. Bu oturumda bulunan **sekiz
kusurun sekizi de düzeltildi**; listesi hemen aşağıda.

**Doğrulama:** `npx vitest run` 364 yeşil · `npx tsc --noEmit` 0 hata · `npx next build` temiz.

### Bu oturumda bulunan ve düzeltilen kusurlar

| # | Kusur | Nerede düzeltildi |
|---|---|---|
| 1 | Bayrağı çevirmek yetmiyordu; kapı kısıtsız üyelikte erken dönüyordu | `lib/page-access.ts` → `isPageGateApplicable`, `lib/middleware/company.ts` |
| 2 | Yetkisiz istek **boş gövdeli 500** alıyordu (57 uç) | `lib/api/errors.ts` → `withApiErrors` |
| 3 | Kapı çağrısı `try` dışında olan handler'lar hâlâ 500 dönüyordu | 221 handler sarıldı; nöbetçi `lib/page-api-coverage.test.ts` |
| 4 | Rol etiketi `BRANCH_MANAGER` ve `CUSTOM`'ı tanımıyor, ikisini "Görüntüleyici" gösteriyordu | `components/dashboard/dashboard-header.tsx` |
| 5 | Giriş sonrası yumuşak yönlendirme **önceki oturumun** RSC önbelleğini çiziyordu | `app/(auth)/signin/page.tsx` |
| 6 | Salt-okunur şerit ile düğmeler çelişiyordu | `WriteAction` 5 → 24 sayfa / 79 düğme |
| 7 | Cari sekmesi URL'e yazılmıyordu; müşteri yetkilisi tedarikçi ekranını görüyordu | `app/(dashboard)/cari/page.tsx` |
| 8 | "Kategoriler" düğmesi salt-okunur sayfada duruyordu | `app/(dashboard)/stok/page.tsx` |

### Sırada ne var

1. **ADMIN'de cari sekme geçişi** — sekme artık `router.replace` ile URL değiştiriyor.
   Salt-okunur ve müşteri-yetkili rollerde doğrulandı; iki sekmeye de yetkili bir
   kullanıcıda akıcılığı görülmedi. Tek tıklık kontrol.
2. **Demo veri temizliği** — Kobipo Demo Merkez'de üç test üyeliği (`stokcu@`,
   `satisci@`, `garson@demo.kobipo.test`) ve bir test rolü ("Kasa Sorumlusu Test")
   duruyor. Parolalar bilerek repoya yazılmadı; gerekirse
   `scripts/create-demo-user.js` desenine bakıp yenisi kurulabilir. Rol denemesi
   sürecekse bırakın, sürmeyecekse silin.
3. **WriteAction'ın kapsamadığı yazma yolları** — sarma yalnız `<Button>` öğelerini
   kapsıyor. Yazma satır tıklamasıyla veya sürükle-bırakla yapılıyorsa (restoran kroki
   editörü) düğme gizleme devreye girmez; sunucu kapısı yine reddeder ama arayüz
   uyarmaz.
4. Bu dosyanın altındaki eski bölümler bulguların tam gerekçesini taşıyor — bir şeyi
   "neden böyle" diye sorgulamadan önce oraya bakın.


**Tarih:** 2026-08-19 · **Güncelleme:** 2026-08-20 · **Durum:** **İş bitti.** Üç bulgu
da düzeltildi (Bulgu 3'ün dört deliği dahil) ve son madde
`ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` **açıldı** — planın "staging'de denenmeli" dediği
adım, staging yerine statik ölçümle yapıldı; ayrıntısı en alttaki
"[Bayrak açıldı](#bayrak-açıldı--enforce_role_matrix_for_unrestricted--true-2026-08-20)"
bölümünde. Geriye yalnız canlı duman testi kaldı (aynı bölümün sonu).

**Doğrulama:** `npx vitest run` **363 test yeşil**, `npx next build` temiz,
`npx tsc --noEmit` **0 hata**. (19 Ağustos'taki 15 tip hatası bayat Prisma client'tandı:
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
- [x] `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = true` — **AÇILDI (2026-08-20).** Bayrak
      haritayı TÜM kullanıcılara uygular (kısıtsızlar dahil); tek bir dar satır çalışan
      bir ekranı kırabilirdi. Bu yüzden önce ölçüldü: 194 kapılı uç × 6 rol, ardından
      "rolün gördüğü ekran kapanacak bir ucu çağırıyor mu" taraması. ADMIN,
      BRANCH_MANAGER ve VIEWER'da sıfır etki; STOCK/SALES'teki altı gerçek çağrının
      ikisi haritaya eklendi, biri (cari kartı açma) bilinçle dar bırakılıp arayüzde
      gizlendi. Ayrıntı en altta.
- [x] `lib/page-access.test.ts` genişletildi (+7 test): VIEWER kısıtsız olsa da yazamaz,
      kısıtlı VIEWER'a `writablePaths` verilse de yazamaz, yazma izinsiz özel rol
      salt-okunurdur, kişisel sayfalar istisna, yazabilen enum roller etkilenmedi.
      "Kuralsız uçta yazamaz" testi Delik B-C ile birlikte (aşağıda) gelecek.

---

## Öncelik sırası — hepsi bitti

1. ~~**Bulgu 1**~~ — **BİTTİ**.
2. ~~**Bulgu 3 / Delik A ve `editablePages`**~~ — **BİTTİ**.
3. ~~**Bulgu 2**~~ — **BİTTİ**.
4. ~~**Bulgu 3 / Delik B-C haritası**~~ — **BİTTİ**.
5. ~~**`ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED`**~~ — **BİTTİ (2026-08-20)**, en alttaki
   bölüm. Delik B ("kısıtsız üyelikte kapı hiç çalışmıyor") ancak bununla kapandı.

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

## Bayrak açıldı — `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = true` (2026-08-20)

Planın "staging işi" diye ayırdığı son madde kapandı. Staging yerine **statik ölçüm**
yapıldı; sorulan soru şuydu: *bayrak açılınca, bir rolün GÖRDÜĞÜ ekran, o role kapanacak
bir ucu çağırıyor mu?*

### Ölçüm nasıl yapıldı

İki geçici tarama yazıldı (iş bitince silindi), ikisi de üretim kodunun kendi
fonksiyonlarını çağırdı — kural mantığı kopyalanmadı:

1. **Uç tarafı:** `app/api/**/route.ts` yürünüp kapıyı gerçekten çağıran uçlar
   (`ensureCompanyAccess|ensureCompanyWrite|assertPagePath`) ayıklandı → **252 route
   dosyasının 194'ü**. Her ucun metotları `export function GET|POST|…` ile çıkarıldı,
   her uç × her enum rol için bayrak öncesi/sonrası karar karşılaştırıldı.
2. **Ekran tarafı:** her `NAV_PAGES` sayfasının dosyasından başlanıp importlar
   **isimli** olarak izlendi (bir modülden yalnız gerçekten alınan export'un içindeki
   `/api/...` literalleri sayıldı) ve rolün gördüğü ekranların çağrıları kapı kararıyla
   karşılaştırıldı.

Taramanın üç yanlış pozitif kaynağı vardı, üçü de ayıklandı; not düşülüyor çünkü aynı
tarama tekrar yazılırsa aynı tuzaklara düşülür:

- **Kural tabloları çağrı sanılıyor.** `lib/page-access.ts`, `lib/module-access.ts` ve
  `lib/middleware/authorization.ts` içindeki `/api/...` metinleri kuraldır; bu dosyalar
  her sayfaya transitif olarak girdiği için her uç her ekrana yazılıyordu.
- **Sorgu dizesi yola yapışıyor.** `"/api/company/definitions?companyId="` hiçbir
  kurala uymuyordu. Gerçek kapı bundan etkilenmez: `proxy.ts` header'a
  `request.nextUrl.pathname` yazar, sorgu dizesi yoktur.
- **Derinlik körlüğü.** `/api/companies` (liste) ile `/api/companies/[id]` AYRI
  dosyalardır ve **ilki kapıyı hiç çağırmaz**. Yalnız ön ek eşleştirmek, panelin firma
  seçicisini "VIEWER'da kırılacak" diye raporluyordu.

### Ölçümün sonucu

| Rol | Aday bulgu | Kodda doğrulanan gerçek |
|---|---:|---:|
| ADMIN | 0 | **0** |
| BRANCH_MANAGER | 0 | **0** |
| VIEWER | 0 | **0** |
| ACCOUNTANT | 3 | **0** — üç `/api/personel/*` hook'unu da yalnız `/personel/vardiya` çağırıyor |
| STOCK | 18 | **4** |
| SALES | 5 | **2** |

Panel layout'u ayrıca tarandı (her sayfada koşar): hiçbir rolde bulgu yok.

### Altı gerçek çağrı ve verilen kararlar

| Ne | Kim | Karar |
|---|---|---|
| `GET /api/e-donusum/invoices` — alış irsaliyesini faturaya bağlarken aday listesi | STOCK · `/alis/irsaliye` | **Haritaya eklendi** (yalnız okuma) |
| Satır içi kategori: `POST/PATCH/DELETE /api/company/definitions` | STOCK · `/restoran/menu`, SALES · `/satis/hizli` | **Haritaya eklendi** — `writePages` artık kategoriyi GERÇEKTEN üreten ekranları da sayıyor |
| Hızlı cari ekleme: `POST /api/cari/customers`, `/api/cari/suppliers` | STOCK · irsaliye ekranları, SALES · tedarikçi tarafı | **Harita dar bırakıldı, arayüz gizlendi** |

Üçüncü satırın gerekçesi: cari kartı açmak gerçek bir yetkidir ve sahibi cari
ekranıdır. Haritayı genişletmek, bayrağın kapattığı "çapraz-modül yazma" deliğini geri
açardı. Bunun yerine düğme yetkiye bağlandı — `useCanCreateCari()`
(`components/e-donusum/quick-cari-dialog.tsx`): cari yazma yetkisi olmayan rol "Yeni
cari ekle" seçeneğini hiç görmez, tek türde yetkisi olan rol diyalogda tür seçicisini
görmez, hiçbir türde yetkisi yoksa diyalog hiç render edilmez (çağıranı unutulmuş bir
ekran için ikinci kilit).

### Ne değişti

| Dosya | Değişiklik |
|---|---|
| `lib/page-access.ts` | Bayrak `true`; **`isPageGateApplicable()`** eklendi (kapının kapsamını belirleyen tek yordam); `/api/e-donusum/invoices` okuma listesine `/alis/irsaliye`; `/api/company/definitions` yazma listesi genişledi |
| `lib/middleware/company.ts` | `assertPageAccess` ve `assertPagePath` artık `isPageGateApplicable`e soruyor — **bayrağı çevirmek tek başına yetmiyordu**, bu iki erken dönüş kısıtsız üyelikleri muaf tutuyordu |
| `components/e-donusum/quick-cari-dialog.tsx` | `useCanCreateCari()` + diyalog içi zorlama |
| `components/e-donusum/counterparty-combobox.tsx` | "ekle" seçeneği yetkiye bağlandı |
| 7 belge ekranı (`alis|satis` irsaliye/sipariş/teklif + teklif detay) | `onCreate` yetkisizken `undefined` — `SearchSelect` seçeneği çizmiyor |
| `lib/page-api-coverage.test.ts` | **yeni** — kapsam nöbetçisi (aşağıda) |
| `lib/page-access.test.ts` | "kısıtsızlarda davranış değişmez" bloğu yeni gerçeğe göre yazıldı (+5 test) |

### Nöbetçi: `lib/page-api-coverage.test.ts`

Bayrak açıkken haritadaki bir boşluğun bedeli büyüdü — kuralı unutulmuş bir yazma ucu
artık **ADMIN'e bile** kapalı doğar. Bu yüzden ölçüm elle tekrarlanacak bir iş olarak
bırakılmadı; iki değişmez teste kondu:

1. Kapıyı çağıran hiçbir uç ADMIN'i reddetmez.
2. Yazma kabul eden her kapılı ucun ya kuralı vardır ya da `OWNERLESS_WRITE_ENDPOINTS`
   listesinde **adıyla ve gerekçesiyle** anılır.

Bugün o listede iki uç var: `/api/muhasebe/fisler` ve `/api/muhasebe/hesap-plani`.
Sebebi yukarıdaki "Sıra 4'te ortaya çıkan iki şey" bölümünde: menüde karşılıkları yok.
**Arayüzden bu iki uca hiç POST yapılmıyor** (yevmiye ve kebir ekranları yalnız GET
çağırıyor), yani yazmanın kapanması hiçbir ekranı etkilemiyor. Muhasebe menüye
alınırsa doğru çözüm `NAV_PAGES` + `PAGE_API_RULES`'a satır eklemektir.

### Doğrulama

`npx vitest run` **363 test yeşil** · `npx tsc --noEmit` **0 hata** · `npx next build` temiz.

### Canlı duman testi (2026-08-20, Chrome)

Kısıtsız bir **STOCK** üyeliğiyle (demo firma) gerçek tarayıcıda tur atıldı. Kısıtlı demo
hesabı (`kasiyer@demo.kobipo.test`) bu iş için YETMEZ: o zaten kapıya tabiydi, bayrağın
ölçtüğü profil "kısıtsız enum rol"dür.

| Kontrol | Sonuç |
|---|---|
| Menü | Finans / Personel / E-Dönüşüm / Kontör yok, Stok-Satış-Alış-Restoran-Raporlar var |
| `/cari/musteri` elle | "Müşteri sayfasına yetkiniz yok" (bayrak öncesi açılıyordu) |
| `/alis/irsaliye` | Yüklendi, irsaliye oluşturuldu — STOCK kendi ekranında yazabiliyor |
| Faturaya bağla | Dialog açıldı, liste 200 döndü → haritaya eklenen okuma çalışıyor |
| "Yeni tedarikçi ekle" | Eşleşmeyen ad yazıldı, seçenek ÇIKMADI → `useCanCreateCari` çalışıyor |
| `GET /api/finans/accounts` | 403, "Finans Kanalları yetkisi gerekir" |
| `GET /api/depolar`, `/api/stok/products` | 200 |

## Testin bulduğu kusur: reddediliş 500 dönüyordu

`GET /api/company/users` ve `/api/personel/employees` reddedilirken **boş gövdeli 500**
döndü. Erişim engelleniyordu (veri sızmıyor) ama kullanıcı sebebini göremiyor, arayüz de
"yetkiniz yok" ekranını çizemiyordu.

**Sebep:** kapılar hata FIRLATIR (`Access denied…`); onu 403'e çevirmek route'un işiydi ve
**194 kapılı ucun 57'sinde bu adım yoktu** — 41 dosyada hiç `catch` yoktu. Kusur bayraktan
ÖNCE de vardı ama yalnız kısıtlı çalışanlar tetikleyebiliyordu; bayrak açılınca her rolün
erişebileceği bir yol hâline geldi.

**Çözüm** (`lib/api/errors.ts`):

- `withApiErrors(handler)` — erişim reddini 403'e, oturumsuzluğu 401'e çevirir. Next'in
  akış-kontrolü hatalarını (`redirect()` / `notFound()` → `digest`) yeniden fırlatır;
  yakalasaydı yönlendirmeler sessizce ölürdü.
- `isAccessDeniedError(error)` — kendi `catch`i olan route'lar için. Sarmalayıcı onlarda
  İŞE YARAMAZ: iç `catch` hatayı önce yakalar ve sarmalayıcıya hiç ulaşmaz.

Kapsama **handler bazında** çıkarıldı, dosya bazında değil: aynı dosyanın POST'unda
`catch` varken GET'inde olmayabiliyordu (`/api/company/roles` tam olarak böyleydi ve ilk
turda 500 dönmeye devam etti). Bugün kapıyı çağıran her handler ya sarmalı ya da
`catch`inde erişim dalı taşıyor. Tarayıcıda yeniden ölçüldü: `company/roles`,
`company/users`, `personel/payroll`, `siparis`, `teklif` → **403** (sayfa adını söyleyen
mesajla), `irsaliye` ve `stok/products` → **200**.

Ayrıca yetki ekranındaki metin düzeltildi (`components/dashboard/permission-guard.tsx`):
"Hesabınız yalnızca belirli sayfalar için yetkilendirilmiş" cümlesi kısıtsız bir role
YANLIŞ sebep gösteriyordu. Artık kısıtlı üyelikte o cümle, kısıtsızda "Bu sayfa Stokçu
rolünün yetki alanı dışında" yazıyor.

### SALES turu (aynı gün)

| Kontrol | Sonuç |
|---|---|
| Menü | Alış / Finans / Personel / E-Dönüşüm yok |
| `/cari/tedarikci` elle | "Bu sayfa **Satış** rolünün yetki alanı dışında" |
| `/satis/irsaliye` → müşteri kutusu | **"Yeni müşteri ekle" ÇIKTI** — karşı-kontrol: fazla gizlenmemiş |
| Hızlı cari diyalogu | Müşteri/Tedarikçi geçiş düğmesi YOK — tek türe kilitli |
| Satır içi kategori (`/satis/hizli`) | Hatasız oluştu → `/api/company/definitions` genişletmesi doğru |
| `POST /api/cari/suppliers` · `POST /api/depolar` | İkisi de **403** |

Yan bulgu (bu işle ilgisiz, kayda geçsin): hızlı satış ekranındaki müşteri kutusunda
"yeni cari" seçeneği hiç yok — `components/satis/quick-sale-screen.tsx` içindeki
`CounterpartyCombobox` `onCreated` almadan render ediliyor (`canCreate` false).

## Özel rol (CompanyRole) turu — 2026-08-20

Demo firmadaki **"Garson"** rolüyle (3 restoran sayfası yazma + `/personel/izin` yalnız
okuma) tur atıldı. Doğru çalışanlar: menü rolün 4 sayfasına inmiş; özel rol tavanı
(`assignablePages`) `/personel/izin`'i veriyor — hiçbir enum rol bu kombinasyonu vermez;
`POST /api/personel/leaves` **403** (görünür ama salt-okunur), `POST /api/restoran/masalar`
**201** (yazabildiği sayfa), `POST /api/stok/products` **403**; `/ayarlar/ekip` duvar,
`POST /api/company/users` ve `/api/company/roles` **403**.

Tur **üç kusur** buldu:

**1. Rol etiketi yanlıştı** (`components/dashboard/dashboard-header.tsx`). Elle yazılmış
if zinciri yalnız ADMIN/ACCOUNTANT/STOCK/SALES tanıyordu; **BRANCH_MANAGER ve CUSTOM son
dala düşüp "Görüntüleyici" görünüyordu** — özel rollü kullanıcı kendini salt-okunur
sanıyordu. Artık ortak `roleLabel()` (lib/auth/role-labels.ts) ve özel rolde firmanın
verdiği ad ("Garson") gösteriliyor.

**2. Giriş sonrası önceki oturumun ekranı** (`app/(auth)/signin/page.tsx`). İlk açılışta
"Dashboard'a yetkiniz yok" duvarı çıktı; aynı adres elle açılınca kapı doğru şekilde
`/restoran/masalar`'a yönlendiriyordu. Sebep: giriş `router.push`/`replace` ile YUMUŞAK
geziniyordu ve Next'in istemci route önbelleği **önceki oturumun RSC payload'ını**
tutuyordu. Artık `window.location.assign` — tam sayfa yükleme önbelleği düşürür. Bu
yalnız kozmetik değil: aynı sekmede hesap değiştiren biri bir öncekinin çizimini
görebiliyordu.

**3. `POST /api/company/roles` hâlâ 500 dönüyordu.** Bir önceki turda "kendi catch'i olan
route'a erişim dalı eklemek yeter" varsayılmıştı; yanlışmış. O handler'da
`ensureCompanyAccess` **try bloğunun DIŞINDA** çağrılıyor, iç catch hatayı hiç görmüyor.
Doğru ölçüt: **her handler `withApiErrors` ile sarılı olmalı** — sarmalayıcı handler'dan
kaçan her şeyi yakalar. 221 handler / 151 dosya sarmalandı ve nöbetçi test bu değişmeze
göre yeniden yazıldı (`lib/page-api-coverage.test.ts` → "kapıyı çağıran her handler
withApiErrors ile sarılıdır").

### WriteAction kapsamı genişletildi

Tur ayrıca şunu gösterdi: `/personel/izin`'de şerit "değişiklik yapamazsınız" derken
**"+ Yeni İzin" düğmesi çiziliyordu**. Sunucu reddediyordu (403), yani güvenlik açığı
değildi — ama şerit ile düğme birbirini yalanlıyordu. Önceki oturum `WriteAction`'ı
bilinçli olarak 5 ekranla sınırlı başlatmıştı.

Kapsam, **özel role gerçekten atanabilen operasyonel ekranlara** yayıldı: **24 sayfada
79 düğme** (iki geçiş: önce oluştur/düzenle/sil, sonra onay/gönderim fiilleri —
"Gönder", "Onayla", "Reddet" de yazmadır ve ilk geçiş onları kaçırmıştı). Dışarıda
bırakılanlar ve gerekçesi: hesap yönetimi ekranları (`ACCOUNT_ADMIN_PAGES` — özel role
zaten verilemez), kişisel sayfalar (profil/destek) ve doğası gereği okuma olanlar
(panolar, raporlar).

Seçim ölçütü mekanikti, iki tuzak bilerek atlandı:

- **"Yenile" yazma değildir** — kelime sınırı onu dışarıda tutar (`\bYeni\b` "Yenile"yi
  tutmaz).
- **"İptal" ve "Kapat" sarılmadı** — çoğu yerde dialog kapatma düğmesidir; sarmak
  salt-okunur kullanıcıyı açık bir dialogda kilitlerdi.

**Doğrulandı (her iki yön):** salt-okunur tarafta düğme kayboluyor (garson oturumunda
`/personel/izin`), yetkili tarafta duruyor — ADMIN oturumunda `/personel/izin`
(Yeni İzin, Onayla, Reddet, Sil), `/finans/kanallar`, `/restoran/menu`, ve sahibi
`ROUTE_OWNERS` ile eşlenen üç yol: `/depolar/transfer` → `/stok/transfer`,
`/banka/mutabakat` → `/finans/mutabakat`, `/kasa/devir` → `/finans/kanallar`,
ayrıca `/e-irsaliye` → `/satis/irsaliye`. Yanlış negatif yok.

## Özel rol — ARAYÜZDEN uçtan uca tur (2026-08-20, ikinci tur)

İlk tur hazır duran "Garson" rolüyle yapılmıştı; rolün **arayüzden oluşturulup
düzenlenmesi** hiç denenmemişti — oysa Bulgu 1 tam olarak oydu. Bu tur onu kapatır:
`/ayarlar/roller` ekranından sıfırdan **"Kasa Sorumlusu Test"** rolü kuruldu
(Satış Faturası + Müşteri + Finans Hareketleri **yazma**, Ürün Listesi **salt-okunur**),
demo kullanıcıya atandı ve o rolle girilip zorlama sınandı.

**Doğrulananlar:**

- Rol seçicide hesap yönetimi ekranları (Ekip, Roller, Abonelik, Şube) **hiç yok** —
  ayrıcalık yükseltme sınırı arayüzde de duruyor.
- **Bulgu 1 kapandı:** var olan bir adı yazınca canlı uyarı çıkıyor ("…zaten var.
  Kaydet dediğinizde yeni rol açılmaz, yetkiler o role yazılır") + "Mevcut yetkilerini
  getir" düğmesi diyaloğu düzenleme moduna alıyor, kaydet düğmesi "Değişiklikleri
  kaydet" oluyor. Kayıttan sonra DB'de `updatedAt ≠ createdAt` — **bu veritabanında
  başarıyla düzenlenen ilk rol** (denetimin kanıtı "üç rolde de createdAt == updatedAt"
  idi).
- Kalıp kartı "Oluşturuldu" rozeti + "rolünü düzenle" bağlantısı çalışıyor.
- Rol atandığında üyeliğin kendi `allowedPaths/writablePaths` listeleri temizleniyor
  (yetki rolde durur kuralı).
- Zorlama: giriş yetkili sayfaya düşüyor (duvar yok), menü rolün 4 sayfası;
  `POST /api/stok/products` **403** ama `GET` **200** (salt-okunur sayfa),
  `GET /api/finans/transactions` **200**, `GET /api/personel/employees` **403**,
  `/satis/irsaliye` duvar. `/stok/urunler`'de salt-okunur şeridi + yazma düğmeleri yok,
  `/cari/musteri`'de şerit yok ve düğmeler duruyor.

### Tur iki kusur daha buldu

**1. Cari sayfasının sekmesi URL'e yazılmıyordu** (`app/(dashboard)/cari/page.tsx`).
Bu ekranın menüde İKİ sahibi var (`/cari/musteri`, `/cari/tedarikci`) ve ayrım `?tab=`
ile yapılıyor — ama sekme düğmeleri yalnız yerel state'i değiştiriyordu. Sonuç: yalnız
müşteri yetkisi olan rol "Tedarikçiler"e basınca **tedarikçi listesini ve "Yeni
Tedarikçi" düğmesini görüyordu**. Yazma sunucuda 403 alıyordu (sızıntı yok; okuma zaten
haritada belge ekranlarına açık) ama ekran yanlıştı. Sekme artık URL'den TÜRÜYOR;
`setActiveTab` `router.replace` ile `?tab=` yazıyor, kapı da doğru sahibi görüyor.
Doğrulandı: aynı rol artık "Tedarikçiler"e basınca *"Tedarikçi" sayfasına yetkiniz yok*
ekranını alıyor.

**2. "Kategoriler" düğmesi salt-okunur sayfada duruyordu** (`app/(dashboard)/stok/page.tsx`).
Kategori yöneticisi tanım yazar; düğme fiil taşımadığı için mekanik sarma turunda
atlanmıştı. `WriteAction` ile sarıldı.

### Açık kalan

- **ADMIN'de cari sekme geçişi doğrulanmadı.** Sekme artık `router.replace` ile URL
  değiştiriyor; iki sekmeye de yetkili bir kullanıcıda geçişin sorunsuz olduğu
  görülmeli (salt-okunur rolde ve müşteri-yetkili rolde doğrulandı).
- Test için açılan üç demo üyelik (`stokcu@`, `satisci@`, `garson@demo.kobipo.test` —
  sonuncusu artık "Kasa Sorumlusu Test" rolünde) ve test rolü **Kobipo Demo Merkez**
  firmasında duruyor; ileride rol denemesi için kullanılabilir, gerekmiyorsa silinmeli.
- WriteAction ikinci geçişte de yalnız `<Button>` öğelerini sarıyor; bir ekranda yazma
  işlemi düğme yerine satır tıklaması ya da sürükle-bırakla yapılıyorsa (ör. restoran
  kroki editörü) gizlenmez. Sunucu kapısı orada da reddeder, ama arayüz uyarmaz.

## Doğrulama komutları

```bash
npm run check:rls              # RLS duruşu
npm run check:company-create   # firma yaratma tek kapı
npx vitest run lib/page-access.test.ts lib/page-api-coverage.test.ts
```
