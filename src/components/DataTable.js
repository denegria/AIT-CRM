'use client';
import { useState, useMemo } from 'react';
import s from './DataTable.module.css';

function badgeClass(val) {
  if (!val) return '';
  const v = val.toLowerCase().replace(/\s+/g, '');
  const map = { newlead:'badge-new',contacted:'badge-contacted',qualified:'badge-qualified',proposalsent:'badge-proposal',won:'badge-won',lost:'badge-lost',pending:'badge-pending',paid:'badge-paid',overdue:'badge-overdue',draft:'badge-draft',inprogress:'badge-inprogress',completed:'badge-completed',onhold:'badge-onhold',high:'badge-high',medium:'badge-medium',low:'badge-low' };
  return map[v] || 'badge-new';
}

export default function DataTable({ columns, data, actions, onEdit, searchPlaceholder, toolbarExtra }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [editCell, setEditCell] = useState(null); // {rowId, key}
  const [editVal, setEditVal] = useState('');

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => columns.some(c => String(r[c.key] || '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey] || '', bv = b[sortKey] || '';
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, search, sortKey, sortDir, columns]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const startEdit = (rowId, key, val) => { setEditCell({ rowId, key }); setEditVal(val || ''); };
  const commitEdit = () => {
    if (editCell && onEdit) onEdit(editCell.rowId, { [editCell.key]: editVal });
    setEditCell(null);
  };

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input className={s.search} placeholder={searchPlaceholder||'Search...'} value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {toolbarExtra}
      </div>
      {filtered.length === 0 ? (
        <div className={s.empty}>No records found</div>
      ) : (
        <table className={s.table}>
          <thead><tr>
            {columns.map(c => (
              <th key={c.key} onClick={() => c.sortable !== false && toggleSort(c.key)}>
                {c.label}
                {sortKey === c.key && <span className={s.sortIcon}>{sortDir==='asc'?'↑':'↓'}</span>}
              </th>
            ))}
            {actions && <th>Actions</th>}
          </tr></thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id}>
                {columns.map(c => (
                  <td key={c.key}>
                    {editCell?.rowId===row.id && editCell?.key===c.key ? (
                      <input className={s.editInput} value={editVal} autoFocus
                        onChange={e=>setEditVal(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e=>e.key==='Enter'&&commitEdit()} />
                    ) : c.type === 'badge' ? (
                      <span className={`badge ${badgeClass(row[c.key])}`}>{row[c.key]}</span>
                    ) : c.type === 'currency' ? (
                      <span>${(row[c.key]||0).toLocaleString()}</span>
                    ) : c.editable && onEdit ? (
                      <span style={{cursor:'pointer'}} onDoubleClick={()=>startEdit(row.id,c.key,row[c.key])}>{row[c.key]||'—'}</span>
                    ) : (
                      <span>{row[c.key]||'—'}</span>
                    )}
                  </td>
                ))}
                {actions && (
                  <td><div className={s.actions}>
                    {actions.map((a,i) => (
                      <button key={i} className={`${s.actBtn} ${a.danger?s.actBtnDanger:''}`} onClick={()=>a.onClick(row)}>{a.label}</button>
                    ))}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
