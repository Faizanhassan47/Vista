import { ChevronRight } from 'lucide-react';
import './ReferenceTable.css';

export default function ReferenceTable({ columns, rows, loading = false, empty, onRowClick, rowKey, showOpen = true }) {
  const columnCount = columns.length + (showOpen ? 1 : 0);
  return <div className="reference-table-wrap">
    <table className="reference-table">
      <thead>
        <tr>
          {columns.map((column) => <th key={column.key || column} style={column.width ? { width: column.width } : undefined}>{column.label || column}</th>)}
          {showOpen && <th className="reference-table__open"><span className="sr-only">Open</span></th>}
        </tr>
      </thead>
      <tbody>
        {loading && Array.from({ length: 5 }, (_, index) => <tr key={index}><td colSpan={columnCount}><div className="reference-table__skeleton" aria-hidden="true" /></td></tr>)}
        {!loading && rows.map((row, index) => <tr key={rowKey ? rowKey(row, index) : index} onClick={onRowClick ? () => onRowClick(row) : undefined}>
          {columns.map((column) => <td key={column.key || column} className={column.fit ? 'reference-table__fit' : undefined}>{column.render ? column.render(row, index) : row[column.key]}</td>)}
          {showOpen && <td className="reference-table__open"><ChevronRight size={16} aria-hidden="true" /></td>}
        </tr>)}
        {!loading && !rows.length && <tr className="reference-table__empty-row"><td colSpan={columnCount}>{empty || 'No records found.'}</td></tr>}
      </tbody>
    </table>
  </div>;
}
