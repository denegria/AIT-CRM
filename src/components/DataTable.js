'use client';
import { useState, useMemo } from 'react';
import ConfirmDialog from './ConfirmDialog';
import s from './DataTable.module.css';

import { Search, ArrowUp, ArrowDown, FileQuestion } from 'lucide-react';

function badgeClass(val) {
  if (!val) return '';
  const v = val.toLowerCase().replace(/\s+/g, '');
  const map = { newlead:'badge-new',contacted:'badge-contacted',qualified:'badge-qualified',proposalsent:'badge-proposal',won:'badge-won',lost:'badge-lost',pending:'badge-pending',paid:'badge-paid',overdue:'badge-overdue',draft:'badge-draft',inprogress:'badge-inprogress',completed:'badge-completed',onhold:'badge-onhold',high:'badge-high',medium:'badge-medium',low:'badge-low' };
  return map[v] || 'badge-new';
}

export default function DataTable({ columns, data, actions, onEdit, searchPlaceholder, toolbarExtra, selectable, selectedIds = [], onSelect }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [editCell, setEditCell] = useState(null); // {rowId, key}
  const [editVal, setEditVal] = useState('');
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm }

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

  const renderCell = (column, row, allowInlineEdit = true) => {
    if (editCell?.rowId === row.id && editCell?.key === column.key && allowInlineEdit) {
      return (
        <input className={s.editInput} value={editVal} autoFocus
          onChange={e=>setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e=>e.key==='Enter'&&commitEdit()} />
      );
    }
    if (column.render) return column.render(row);
    if (column.type === 'badge') return <span className={'badge ' + badgeClass(row[column.key])}>{row[column.key]}</span>;
    if (column.type === 'currency') return <span>{'$' + (row[column.key]||0).toLocaleString()}</span>;
    if (column.editable && onEdit && allowInlineEdit) {
      return <span style={{cursor:'pointer'}} onDoubleClick={()=>startEdit(row.id,column.key,row[column.key])}>{row[column.key]||'—'}</span>;
    }
    return <span>{row[column.key]||'—'}</span>;
  };

  const mobilePrimary = columns[0];
  const mobileSecondary = columns[1];
  const mobileBadge = columns.find((column) => column.type === 'badge');

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} size={16} />
          <input className={s.search} placeholder={searchPlaceholder||'Search...'} value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {toolbarExtra}
      </div>
      {filtered.length === 0 ? (
        <div className={s.empty}>
          <FileQuestion size={32} style={{opacity:0.5, marginBottom: 8}} />
          <div>No records found</div>
        </div>
      ) : (
        <>
        <table className={s.table}>
          <thead><tr>
            {selectable && (
              <th style={{ width: 40, textAlign: 'center' }}>
                <input type="checkbox"
                  checked={filtered.length > 0 && selectedIds.length === filtered.length}
                  onChange={(e) => onSelect(e.target.checked ? filtered.map(r => r.id) : [])}
                />
              </th>
            )}
            {columns.map(c => (
              <th key={c.key} onClick={() => c.sortable !== false && toggleSort(c.key)}>
                <div style={{display:'flex', alignItems:'center', gap:4}}>
                  {c.label}
                  {sortKey === c.key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
            ))}
            {actions && <th className={s.actionHeader}>Actions</th>}
          </tr></thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id}>
                {selectable && (
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={(e) => {
                        if (e.target.checked) onSelect([...selectedIds, row.id]);
                        else onSelect(selectedIds.filter(id => id !== row.id));
                      }}
                    />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key}>{renderCell(c, row)}</td>
                ))}
                {actions && (
                  <td className={s.actionCell}><div className={s.actions}>
                    {actions.map((a,i) => (
                      <button key={i} className={`${s.actBtn} ${a.danger?s.actBtnDanger:''}`} onClick={()=>{
                        if (a.danger) {
                          setConfirm({
                            title: `${a.label} Record`,
                            message: `Are you sure you want to ${a.label.toLowerCase()} this record? This action cannot be undone.`,
                            onConfirm: () => a.onClick(row)
                          });
                        } else {
                          a.onClick(row);
                        }
                      }}>{a.label}</button>
                    ))}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={s.mobileCards}>
          {filtered.map((row) => (
            <div key={row.id} className={s.mobileCard}>
              <div className={s.mobileCardMain}>
                <div className={s.mobileTitle}>{mobilePrimary ? renderCell(mobilePrimary, row, false) : row.id}</div>
                {mobileSecondary && <div className={s.mobileSubtitle}>{renderCell(mobileSecondary, row, false)}</div>}
              </div>
              {mobileBadge && <div className={s.mobileBadge}>{renderCell(mobileBadge, row, false)}</div>}
              {actions && (
                <div className={s.mobileActions}>
                  {actions.map((a, i) => (
                    <button key={i} className={`${s.actBtn} ${a.danger?s.actBtnDanger:''}`} onClick={() => {
                      if (a.danger) {
                        setConfirm({
                          title: `${a.label} Record`,
                          message: `Are you sure you want to ${a.label.toLowerCase()} this record? This action cannot be undone.`,
                          onConfirm: () => a.onClick(row)
                        });
                      } else {
                        a.onClick(row);
                      }
                    }}>{a.label}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        </>
      )}
      <ConfirmDialog 
        open={!!confirm} 
        onClose={() => setConfirm(null)} 
        onConfirm={confirm?.onConfirm || (() => {})}
        title={confirm?.title}
        message={confirm?.message}
      />
    </div>
  );
}
