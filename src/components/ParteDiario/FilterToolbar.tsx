interface FilterToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  pagina: number
  totalPaginas: number
  onPaginaChange: (pagina: number) => void
  totalFiltrado: number
}

// Búsqueda por N° de reporte o nombre del creador + paginación, ambas
// client-side sobre los datos ya cargados de la faena activa. Sin pestañas
// de faena aquí: ese control ya vive en el sidebar (selector "Faena
// Activa"), duplicarlo en la página sería confuso.
export const FilterToolbar = ({ query, onQueryChange, pagina, totalPaginas, onPaginaChange, totalFiltrado }: FilterToolbarProps) => (
  <div className="flex items-center justify-between gap-3 flex-wrap">
    <input
      type="text"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder="Buscar por N° de reporte o creador…"
      className="w-full sm:w-72 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
    />
    {totalPaginas > 1 && (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button
          type="button"
          disabled={pagina <= 1}
          onClick={() => onPaginaChange(pagina - 1)}
          className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          Anterior
        </button>
        <span>
          Página {pagina} de {totalPaginas} · {totalFiltrado} reportes
        </span>
        <button
          type="button"
          disabled={pagina >= totalPaginas}
          onClick={() => onPaginaChange(pagina + 1)}
          className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          Siguiente
        </button>
      </div>
    )}
  </div>
)
