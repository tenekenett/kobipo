import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ESM config'de `__dirname` yok. `fileURLToPath` şart: `new URL(...).pathname`
// Windows'ta "/C:/Users/..." üretir ve yol çözümü sessizce bozulur.
const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest yapılandırması.
 *
 * Kapsam BİLİNÇLİ olarak dar: yalnız `lib/**` altındaki SAF fonksiyonlar. Bu
 * projede hataya en açık mantık orada duruyor (dakika aritmetiği, gece vardiyası,
 * mevzuat sınırları, tatil eşleşmesi) ve hiçbiri tarayıcıya, veritabanına ya da
 * React'e ihtiyaç duymuyor — dolayısıyla jsdom/kurulum dosyası da gerekmiyor.
 * Bileşen testi eklenecekse ortam o zaman genişletilir; şimdiden kurmak, kimsenin
 * çalıştırmadığı bir altyapı bırakırdı.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // `@/` yolu tsconfig'deki ile aynı olmalı; testler üretim kodunun içe aktarma
    // biçimini birebir kullanmalı ki taşınan bir dosya testte de kırılsın.
    alias: { "@": path.resolve(here, ".") },
  },
})
