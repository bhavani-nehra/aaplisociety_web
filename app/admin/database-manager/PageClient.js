'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styles from '@/styles/DatabaseManager.module.css';
import notify from '@/lib/notify';
export default function DatabaseManagerPage() {
  const [selectedEntity, setSelectedEntity] = useState('society');
  const [filters, setFilters] = useState({});
  const [exportFormat, setExportFormat] = useState('excel');
  const [importFile, setImportFile] = useState(null);
  const [viewMode, setViewMode] = useState('table'); // table, json
  const [selectedIds, setSelectedIds] = useState([]);
  const queryClient = useQueryClient();
  // Fetch data based on selected entity
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dbData', selectedEntity, filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await fetch(`/api/db-manager/${selectedEntity}?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch data');
      return response.json();
    }
  });
  // Export mutation
  const exportMutation = useMutation({
    mutationFn: async ({ entity, format, filters }) => {
      const params = new URLSearchParams({ format, ...filters });
      const response = await fetch(`/api/db-manager/${entity}/export?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}_${new Date().toISOString()}.${format === 'pdf' ? 'pdf' : format === 'json' ? 'json' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  });
  // Import mutation
  const importMutation = useMutation({
    mutationFn: async ({ entity, file }) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/db-manager/${entity}/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Import failed');
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries(['dbData']);
      notify.success(`Import successful! ${result.imported || 0} records imported.`);
      setImportFile(null);
    },
    onError: (error) => {
      notify.error(`Import failed: ${error.message}`);
    }
  });
  const deleteMutation = useMutation({
  mutationFn: async ({ entity, ids }) => {
    if (!ids || ids.length === 0) {
      throw new Error('No IDs selected');
    }
    const response = await fetch(`/api/db-manager/${entity}/delete?ids=${ids.join(',')}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.details || 'Delete failed');
    }
    return data;
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries(['db-data']);
setSelectedIds([]);
    notify.success(`Successfully deleted ${data.deletedCount} records`);
  },
  onError: (error) => {
    console.error('Delete error:', error);
    notify.error(`Delete failed: ${error.message}`);
  }
});
  // Reset/Clear all mutation
  const resetMutation = useMutation({
    mutationFn: async ({ entity }) => {
      if (!(await notify.confirm(`ARE YOU ABSOLUTELY SURE?\n\nThis will PERMANENTLY DELETE ALL ${entity.toUpperCase()} data!\n\nType "DELETE ALL" to confirm.`, { tone: "danger" }))) {
        throw new Error('Cancelled');
      }
      const userConfirmation = await notify.prompt('Type "DELETE ALL" to confirm:');
      if (userConfirmation !== 'DELETE ALL') {
        throw new Error('Confirmation failed');
      }
      const response = await fetch(`/api/db-manager/${entity}/reset`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Reset failed');
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries(['dbData']);
      notify.success(`Reset successful! ${result.deleted || 0} records deleted.`);
    }
  });
  const entities = [
    { value: 'society', label: 'Society Data' },
    { value: 'members', label: 'Members' },
    { value: 'transactions', label: 'Transactions' },
    { value: 'bills', label: 'Bills' },
    { value: 'receipts', label: 'Receipts' },
    { value: 'users', label: 'Users' },
    { value: 'auditlogs', label: 'Audit Logs' },
    { value: 'billingheads', label: 'Billing Heads' }
  ];
  const handleSelectAll = (checked) => {
    if (checked && data?.data) {
      setSelectedIds(data.data.map(row => row._id));
    } else {
      setSelectedIds([]);
    }
  };
  const handleSelectRow = (id, checked) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id));
    }
  };
  const renderTableView = () => {
    if (!data?.data || data.data.length === 0) {
      return <div className={styles.emptyState}>No data found</div>;
    }
    const columns = Object.keys(data.data[0]).filter(col => col !== '__v');
    return (
      <div className={styles.tableWrapper}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>
                <input 
                  type="checkbox" 
                  checked={selectedIds.length === data.data.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </th>
              {columns.map(col => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((row, idx) => (
              <tr key={idx}>
                <td>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(row._id)}
                    onChange={(e) => handleSelectRow(row._id, e.target.checked)}
                  />
                </td>
                {columns.map(col => (
                  <td key={col} title={String(row[col])}>
                    {typeof row[col] === 'object' && row[col] !== null
                      ? JSON.stringify(row[col]).substring(0, 50) + '...' 
                      : String(row[col] || '').substring(0, 100)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  const renderJsonView = () => {
    return (
      <pre className={styles.jsonView}>
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };
  return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Database Manager</h1>
          <p className={styles.subtitle}>Complete database access - View, Import, Export, and Manage all data</p>
        </div>
        <div className={styles.toolbar}>
          {/* Entity Selector */}
          <div className={styles.toolbarSection}>
            <label>Entity:</label>
            <select 
              value={selectedEntity} 
              onChange={(e) => {
                setSelectedEntity(e.target.value);
                setSelectedIds([]);
                setFilters({});
              }}
              className={styles.select}
            >
              {entities.map(ent => (
                <option key={ent.value} value={ent.value}>{ent.label}</option>
              ))}
            </select>
          </div>
          {/* View Mode */}
          <div className={styles.toolbarSection}>
            <label>View:</label>
            <div className={styles.btnGroup}>
              <button 
                className={`${styles.btn} ${viewMode === 'table' ? styles.btnActive : styles.btnSecondary}`}
                onClick={() => setViewMode('table')}
              >
                Table
              </button>
              <button 
                className={`${styles.btn} ${viewMode === 'json' ? styles.btnActive : styles.btnSecondary}`}
                onClick={() => setViewMode('json')}
              >
                JSON
              </button>
            </div>
          </div>
          {/* Export */}
          <div className={styles.toolbarSection}>
            <label>Export:</label>
            <select 
              value={exportFormat} 
              onChange={(e) => setExportFormat(e.target.value)}
              className={styles.select}
            >
              <option value="excel">Excel (.xlsx)</option>
              <option value="pdf">PDF</option>
              <option value="json">JSON</option>
            </select>
            <button 
              className={`${styles.btn} ${styles.btnSuccess}`}
              onClick={() => exportMutation.mutate({ entity: selectedEntity, format: exportFormat, filters })}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? 'Exporting...' : '⬇ Export'}
            </button>
          </div>
          {/* Import */}
          <div className={styles.toolbarSection}>
            <label>Import:</label>
            <input 
              type="file" 
              accept=".xlsx,.json"
              onChange={(e) => setImportFile(e.target.files[0])}
              className={styles.fileInput}
            />
            <button 
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => importFile && importMutation.mutate({ entity: selectedEntity, file: importFile })}
              disabled={!importFile || importMutation.isPending}
            >
              {importMutation.isPending ? 'Importing...' : '⬆ Import'}
            </button>
          </div>
          {/* After Import button, add: */}
<div className={styles.toolbarSection}>
  <button 
    className={`${styles.btn} ${styles.btnWarning}`}
  onClick={async () => {
  if (!(await notify.confirm('Check and fix duplicate membership numbers?', { tone: "warning" }))) return;
  try {
    const response = await fetch('/api/members/fix-duplicates', {
      method: 'POST',
      credentials: 'include'
    });
    const result = await response.json();
    if (result.success) {
  const fixedCount = typeof result.fixed === 'number' ? result.fixed : result.fixed?.length || 0;
  if (fixedCount > 0) {
    const fixedList = Array.isArray(result.fixed)
      ? result.fixed.map(f => `${f.flatNo}: ${f.oldNumber} → ${f.newNumber}`).join('\n')
      : 'Check console for details';
    notify.success(`Fixed ${fixedCount} duplicates!\n\n${fixedList}`);
  } else {
    notify.success('No duplicates found - all membership numbers are unique!');
  }
  refetch();
}
 else {
      notify.error(`Error: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Fix duplicates error:', error);
    notify.error(`Error: ${error.message}`);
  }
}}
  >
    Fix Duplicates
  </button>
</div>
        </div>
          {/* Filters Section */}
        <div className={styles.filtersSection}>
          <h3>Filters</h3>
          <div className={styles.filterGrid}>
            {selectedEntity === 'members' && (
              <>
                <input 
                  type="text" 
                  placeholder="Search by name..." 
                  onChange={(e) => setFilters({...filters, name: e.target.value})}
                  className={styles.input}
                />
                <select 
                  onChange={(e) => setFilters({...filters, status: e.target.value})}
                  className={styles.select}
                >
                  <option value="">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </>
            )}
            {selectedEntity === 'transactions' && (
              <>
                <input 
                  type="date" 
                  placeholder="From Date" 
                  onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                  className={styles.input}
                />
                <input 
                  type="date" 
                  placeholder="To Date" 
                  onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                  className={styles.input}
                />
                <select 
                  onChange={(e) => setFilters({...filters, category: e.target.value})}
                  className={styles.select}
                >
                  <option value="">All Categories</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Payment">Payment</option>
                  <option value="Interest">Interest</option>
                  <option value="Arrears">Arrears</option>
                </select>
              </>
            )}
            {selectedEntity === 'bills' && (
              <>
                <select 
                  onChange={(e) => setFilters({...filters, status: e.target.value})}
                  className={styles.select}
                >
                  <option value="">All Status</option>
                  <option value="Paid">Paid</option>
                  <option value="Unpaid">Unpaid</option>
                  <option value="Partial">Partial</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </>
            )}
            <button 
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => { setFilters({}); refetch(); }}
            >
              Clear Filters
            </button>
          </div>
        </div>
        {/* Data Display */}
        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>
            <h3>Data ({data?.total || 0} records)</h3>
            <div className={styles.dataHeaderActions}>
              {selectedIds.length > 0 && (
                <span className={styles.selectedCount}>
                  {selectedIds.length} selected
                </span>
              )}
              <button 
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => refetch()}
              >
                Refresh
              </button>
            </div>
          </div>
          {isLoading ? (
            <div className={styles.loader}>
              <div className={styles.spinner}></div>
              <p>Loading data...</p>
            </div>
          ) : (
            <>
              {viewMode === 'table' ? renderTableView() : renderJsonView()}
            </>
          )}
        </div>
        {/* Danger Zone */}
        <div className={styles.dangerZone}>
          <h3>Danger Zone</h3>
          <p>These actions are irreversible. Use with extreme caution!</p>
                <div className={styles.dangerActions}>
            <button 
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={async () => {
  if (selectedIds.length === 0) {
    notify.warning('No rows selected');
    return;
  }
  if (await notify.confirm(`Delete ${selectedIds.length} ${selectedEntity}?`, { tone: "danger" })) {
    deleteMutation.mutate({
      entity: selectedEntity, 
      ids: selectedIds.map(id => String(id))  // ✅ Ensure IDs are strings
    });
  }
}}
              disabled={deleteMutation.isPending || selectedIds.length === 0}
            >
              {deleteMutation.isPending ? 'Deleting...' : `Delete Selected (${selectedIds.length})`}
            </button>
            <button 
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => resetMutation.mutate({ entity: selectedEntity })}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? 'Resetting...' : `RESET ALL ${selectedEntity.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
  );
}
