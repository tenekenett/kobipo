import type { ReactNode } from "react"

type LegalSection = {
  id: string
  title: string
  content: ReactNode
}

type LegalContentShellProps = {
  updatedAt: string
  sections: LegalSection[]
}

export function LegalContentShell({ updatedAt, sections }: LegalContentShellProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr] lg:gap-8">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-kobipo-border bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-kobipo-gray">İçindekiler</div>
          <nav className="mt-3 space-y-2">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-md px-2 py-1.5 text-xs text-kobipo-gray transition-colors hover:bg-kobipo-pale hover:text-kobipo-blue"
              >
                {section.title}
              </a>
            ))}
          </nav>
          <div className="mt-4 border-t border-kobipo-border pt-3 text-xs text-kobipo-gray">
            Son güncelleme: <span className="font-semibold text-kobipo-text">{updatedAt}</span>
          </div>
        </div>
      </aside>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="rounded-2xl border border-kobipo-border bg-white p-6">
            <h2 className="text-lg font-bold tracking-tight text-kobipo-navy">{section.title}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-kobipo-text">{section.content}</div>
          </section>
        ))}
      </div>
    </div>
  )
}
