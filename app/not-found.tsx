export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">404 - Sayfa Bulunamadı</h1>
      <p className="text-muted-foreground mb-4">
        Aradığınız sayfa mevcut değil.
      </p>
      <a href="/" className="text-blue-500 hover:underline">
        Ana sayfaya dön
      </a>
    </div>
  )
}

