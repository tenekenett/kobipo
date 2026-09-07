import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * CANLI takım — `npm run test:canli`.
 *
 * `vitest.config.mts`teki "veritabanına dokunma" kararını delmez, ondan AYRI
 * durur: varsayılan takım `*.canli.test.ts` dosyalarını dışlıyor, bu
 * yapılandırma da yalnız onları alıyor. Sebebi kapsam: kartların bazı süzgeçleri
 * SQL'in içinde ve saf testle görülemiyor (mahsup sayacı, "ikinci alış" alt
 * sorgusu, `BEKLEMEDE` tanımı).
 *
 * GERÇEK VERİTABANINA YAZAR: fixture'lar `OTO-TEST` ön ekiyle açılır ve testler
 * patlasa bile `afterAll` içinde silinir. Hedef firma `OTOMASYON_CANLI_FIRMA`
 * ile seçilir (varsayılan `reypo`). Bu yüzden `npm test`in parçası DEĞİL.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.canli.test.ts"],
    environment: "node",
    // Fixture'lar aynı firmada; paralel dosyalar birbirinin verisini silerdi.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(here, ".") },
  },
})
