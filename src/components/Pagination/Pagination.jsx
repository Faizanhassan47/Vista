import './Pagination.css';

export default function Pagination({ page, pageSize, total, onPageChange, disabled = false, label = 'Pagination' }) {
  const safeTotal = Number(total) || 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const start = safeTotal ? page * pageSize + 1 : 0;
  const end = Math.min(safeTotal, (page + 1) * pageSize);
  return <nav className="pagination" aria-label={label}>
    <span className="pagination__count">{start}–{end} of {safeTotal}</span>
    <button type="button" disabled={disabled || page <= 0} onClick={() => onPageChange(page - 1)}>Previous</button>
    <span className="pagination__page">Page {page + 1} of {totalPages}</span>
    <button type="button" disabled={disabled || page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>Next</button>
  </nav>;
}
