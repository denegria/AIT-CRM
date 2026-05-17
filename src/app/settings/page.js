'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';

const roleOptions = [
  { key: 'admin', label: 'Administrator' },
  { key: 'account_manager', label: 'Account Manager' },
  { key: 'sales_manager', label: 'Sales Manager' },
  { key: 'designer', label: 'Designer' },
];

export default function SettingsPage() {
  const { resetData, loaded, access, dataSource, businessUnits, setBusinessUnits } = useCRM();
  const router = useRouter();
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    roleKey: 'account_manager',
    businessUnitId: '',
  });
  const [businessUnitRows, setBusinessUnitRows] = useState(businessUnits || []);
  const [businessUnitsLoading, setBusinessUnitsLoading] = useState(false);
  const [businessUnitsError, setBusinessUnitsError] = useState('');
  const [savingBusinessUnit, setSavingBusinessUnit] = useState(false);
  const [businessUnitForm, setBusinessUnitForm] = useState({
    id: '',
    name: '',
    label: 'Divisions',
    color: '#2563eb',
    isActive: true,
  });
  const activeBusinessUnitOptions = businessUnitRows.filter((unit) => unit.isActive !== false);

  useEffect(() => {
    if (loaded && !access.canReadSettings) {
      router.push('/');
    }
  }, [access.canReadSettings, loaded, router]);

  useEffect(() => {
    if (!loaded || !access.canWriteSettings || dataSource !== 'postgres') return;
    let cancelled = false;

    async function loadUsers() {
      setUsersLoading(true);
      setUsersError('');
      try {
        const response = await fetch('/api/users');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to load users.');
        if (!cancelled) setUsers(Array.isArray(payload.users) ? payload.users : []);
      } catch (error) {
        if (!cancelled) setUsersError(error.message || 'Failed to load users.');
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    }

    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [access.canWriteSettings, dataSource, loaded]);

  useEffect(() => {
    if (!loaded || !access.canReadSettings || dataSource !== 'postgres') return;
    let cancelled = false;

    async function loadBusinessUnits() {
      setBusinessUnitsLoading(true);
      setBusinessUnitsError('');
      try {
        const response = await fetch('/api/business-units');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to load divisions.');
        const rows = Array.isArray(payload.businessUnits) ? payload.businessUnits : [];
        if (!cancelled) {
          setBusinessUnitRows(rows);
          setBusinessUnits(rows);
        }
      } catch (error) {
        if (!cancelled) setBusinessUnitsError(error.message || 'Failed to load divisions.');
      } finally {
        if (!cancelled) setBusinessUnitsLoading(false);
      }
    }

    loadBusinessUnits();
    return () => {
      cancelled = true;
    };
  }, [access.canReadSettings, dataSource, loaded, setBusinessUnits]);

  async function handleCreateOrUpdateUser(event) {
    event.preventDefault();
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingUser(true);
    setUsersError('');
    try {
      const payload = {
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        password: userForm.password,
        roleKey: userForm.roleKey,
        businessUnitIds: userForm.roleKey === 'admin' ? [] : [userForm.businessUnitId].filter(Boolean),
      };
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to save user.');

      setUsers(Array.isArray(result.users) ? result.users : []);
      setUserForm((prev) => ({ ...prev, name: '', email: '', password: '' }));
      toast('User saved');
    } catch (error) {
      setUsersError(error.message || 'Failed to save user.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleSaveBusinessUnit(event) {
    event.preventDefault();
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingBusinessUnit(true);
    setBusinessUnitsError('');
    try {
      const payload = {
        id: businessUnitForm.id,
        name: businessUnitForm.name.trim(),
        label: businessUnitForm.label.trim() || 'Divisions',
        color: businessUnitForm.color.trim(),
        isActive: Boolean(businessUnitForm.isActive),
      };
      const response = await fetch('/api/business-units', {
        method: payload.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to save division.');

      const rows = Array.isArray(result.businessUnits) ? result.businessUnits : [];
      setBusinessUnitRows(rows);
      setBusinessUnits(rows);
      setBusinessUnitForm({ id: '', name: '', label: 'Divisions', color: '#2563eb', isActive: true });
      toast('Division saved');
    } catch (error) {
      setBusinessUnitsError(error.message || 'Failed to save division.');
    } finally {
      setSavingBusinessUnit(false);
    }
  }

  function editBusinessUnit(unit) {
    setBusinessUnitForm({
      id: unit.id,
      name: unit.name || '',
      label: unit.label || 'Divisions',
      color: unit.color || '#2563eb',
      isActive: unit.isActive !== false,
    });
  }

  function formatRoleLabel(roleKey) {
    return String(roleKey || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unassigned';
  }

  function divisionBadgeLabel(businessUnitId) {
    const unit = businessUnitRows.find((row) => row.id === businessUnitId);
    return unit?.name || 'Unknown division';
  }

  if (!loaded || !access.canReadSettings) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">System configuration & integrations</p>
        </div>
      </div>

      <div className="grid-2" style={{marginBottom:20}}>
        <div className="card">
          <div className="card-title">Webhook Configuration</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Configure inbound webhook listeners for lead capture.</p>
          <div className="form-group">
            <label className="form-label">Facebook Ads Webhook URL</label>
            <div style={{display:'flex',gap:8}}>
              <input className="input" value="https://api.aitcrm.com/api/webhooks/facebook-leads" readOnly style={{opacity:0.7,flex:1}} />
              <button className="btn btn-sm">Copy</button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Google Ads Webhook URL</label>
            <div style={{display:'flex',gap:8}}>
              <input className="input" value="https://api.aitcrm.com/webhooks/google-leads" readOnly style={{opacity:0.7,flex:1}} />
              <button className="btn btn-sm">Copy</button>
            </div>
          </div>
          <div style={{marginTop:8}}>
            <span className="badge badge-won">● Active</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Automation Rules</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Outbound triggers and automated workflows.</p>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {[
              { name: 'New Lead Notification', desc: 'Email alert when a new lead is captured', active: true },
              { name: 'Immediate Outreach', desc: 'Auto-send welcome email to new leads', active: true },
              { name: 'Overdue Invoice Alert', desc: 'Notify admin when invoice becomes overdue', active: false },
              { name: 'Work Order Completion', desc: 'Send confirmation when WO is marked complete', active: true },
            ].map((rule, i) => (
              <div key={i} className="flex-between" style={{padding:'8px 10px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
                <div>
                  <div style={{fontSize:'var(--text-sm)',fontWeight:500}}>{rule.name}</div>
                  <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{rule.desc}</div>
                </div>
                <span className={`badge ${rule.active?'badge-won':'badge-draft'}`}>{rule.active?'On':'Off'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{marginBottom:20}}>
        <div className="card">
          <div className="card-title">API Access</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>REST API for integrations and AI extensions.</p>
          <div className="form-group">
            <label className="form-label">API Key</label>
            <div style={{display:'flex',gap:8}}>
              <input className="input" value="ait_live_sk_••••••••••••••••" readOnly style={{opacity:0.7,flex:1,fontFamily:'monospace'}} />
              <button className="btn btn-sm">Regenerate</button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Base URL</label>
            <input className="input" value="https://api.aitcrm.com/v1" readOnly style={{opacity:0.7}} />
          </div>
          <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:4}}>Rate limit: 1,000 requests/min • Endpoints: /contacts, /work-orders, /financials, /tasks</div>
        </div>

        <div className="card">
          <div className="card-title">Division Management</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Manage business units used by scopes, users, and inbound lead routing.</p>
          {dataSource === 'postgres' && access.canWriteSettings ? (
            <>
              <form onSubmit={handleSaveBusinessUnit} style={{display:'grid',gridTemplateColumns:'minmax(160px,1fr) minmax(120px,0.7fr) 44px auto',gap:8,alignItems:'center',marginBottom:12}}>
                <input
                  className="input"
                  placeholder="Division name"
                  value={businessUnitForm.name}
                  onChange={(event) => setBusinessUnitForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <input
                  className="input"
                  placeholder="Label"
                  value={businessUnitForm.label}
                  onChange={(event) => setBusinessUnitForm((prev) => ({ ...prev, label: event.target.value }))}
                />
                <input
                  className="input"
                  type="color"
                  aria-label="Division color"
                  value={businessUnitForm.color}
                  onChange={(event) => setBusinessUnitForm((prev) => ({ ...prev, color: event.target.value }))}
                  style={{padding:4,minWidth:44}}
                />
                <button className="btn btn-primary" type="submit" disabled={savingBusinessUnit}>
                  {savingBusinessUnit ? 'Saving...' : businessUnitForm.id ? 'Update' : 'Add'}
                </button>
                <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--text-sm)',color:'var(--text-secondary)',gridColumn:'1 / -1'}}>
                  <input
                    type="checkbox"
                    checked={businessUnitForm.isActive}
                    onChange={(event) => setBusinessUnitForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  />
                  Active division
                </label>
              </form>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {businessUnitsLoading && <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Loading divisions...</div>}
                {!businessUnitsLoading && businessUnitRows.map((unit) => (
                  <div key={unit.id} className="flex-between" style={{padding:'8px 10px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)',gap:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                      <span style={{width:10,height:10,borderRadius:999,background:unit.color || 'var(--accent)',flex:'0 0 auto'}} />
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:'var(--text-sm)',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{unit.name}</div>
                        <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{unit.label || 'Divisions'}</div>
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span className={'badge ' + (unit.isActive !== false ? 'badge-won' : 'badge-draft')}>{unit.isActive !== false ? 'Active' : 'Inactive'}</span>
                      <button className="btn btn-sm" type="button" onClick={() => editBusinessUnit(unit)}>Edit</button>
                    </div>
                  </div>
                ))}
                {!businessUnitsLoading && businessUnitRows.length === 0 && (
                  <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>No divisions found yet.</div>
                )}
                {businessUnitsError && <div style={{fontSize:'var(--text-xs)',color:'var(--danger)'}}>{businessUnitsError}</div>}
              </div>
            </>
          ) : (
            <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Division management is available in database-backed admin sessions.</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Role Management</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Employee access is role + division scoped.</p>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{padding:'10px 12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
              <div className="flex-between">
                <span style={{fontSize:'var(--text-sm)',fontWeight:500}}>Administrator</span>
                <span className="badge badge-won">Full Access</span>
              </div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:4}}>All data, reports, employee tracking, financial oversight</div>
            </div>
            <div style={{padding:'10px 12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
              <div className="flex-between">
                <span style={{fontSize:'var(--text-sm)',fontWeight:500}}>Account Manager</span>
                <span className="badge badge-contacted">Limited</span>
              </div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:4}}>CRM write access with division scope; no settings/admin controls</div>
            </div>
            <div style={{padding:'10px 12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
              <div className="flex-between">
                <span style={{fontSize:'var(--text-sm)',fontWeight:500}}>Designer / Sales Manager</span>
                <span className="badge badge-contacted">Limited</span>
              </div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:4}}>Role-specific access and division-scoped visibility</div>
            </div>
            <div style={{padding:'10px 12px',background:'rgba(74,122,255,0.08)',borderRadius:'var(--radius-md)',border:'1px solid rgba(74,122,255,0.2)'}}>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginBottom:6}}>
                Employee accounts are currently provisioned via script:
              </div>
              <code style={{display:'block',fontSize:'var(--text-xs)',lineHeight:1.5,whiteSpace:'pre-wrap'}}>
                AIT_CRM_BOOTSTRAP_EMAIL=employee@aitcrm.com{'\n'}
                AIT_CRM_BOOTSTRAP_PASSWORD=...{'\n'}
                AIT_CRM_BOOTSTRAP_ROLE=account_manager{'\n'}
                AIT_CRM_BOOTSTRAP_BUSINESS_UNIT_IDS=&lt;division-uuid&gt;{'\n'}
                npm run db:bootstrap-auth-user
              </code>
            </div>
            {dataSource === 'postgres' && access.canWriteSettings && (
              <form onSubmit={handleCreateOrUpdateUser} style={{display:'flex',flexDirection:'column',gap:10,padding:'10px 12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
                <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>Create or update employee account</div>
                <input
                  className="input"
                  placeholder="Full name"
                  value={userForm.name}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <input
                  className="input"
                  type="email"
                  placeholder="Email"
                  value={userForm.email}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Password (leave empty to keep current)"
                  value={userForm.password}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <select
                  className="input select"
                  value={userForm.roleKey}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, roleKey: event.target.value }))}
                >
                  {roleOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                {userForm.roleKey !== 'admin' && (
                  <select
                    className="input select"
                    value={userForm.businessUnitId}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, businessUnitId: event.target.value }))}
                    required
                  >
                    <option value="">Select division</option>
                    {activeBusinessUnitOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.name}</option>
                    ))}
                  </select>
                )}
                <button className="btn btn-primary" type="submit" disabled={savingUser}>
                  {savingUser ? 'Saving...' : 'Save User'}
                </button>
              </form>
            )}
            {dataSource === 'postgres' && access.canWriteSettings && (
              <div style={{padding:'10px 12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>
                <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginBottom:8}}>Provisioned users</div>
                {usersLoading && <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Loading users...</div>}
                {!usersLoading && users.length === 0 && <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>No users found yet.</div>}
                {!usersLoading && users.map((user) => (
                  <div key={user.id} className="flex-between" style={{padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                    <div>
                      <div style={{fontSize:'var(--text-sm)',fontWeight:500}}>{user.name}</div>
                      <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{user.email}</div>
                    </div>
                    <div style={{textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,maxWidth:240}}>
                      <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{formatRoleLabel(user.primaryRoleKey)}</div>
                      <div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'flex-end'}}>
                        {user.primaryRoleKey === 'admin' ? (
                          <span className="badge badge-won" style={{fontSize:9,padding:'2px 6px'}}>All divisions</span>
                        ) : user.businessUnitIds?.length ? (
                          user.businessUnitIds.map((businessUnitId) => (
                            <span key={businessUnitId} className="badge" style={{background:'var(--bg-hover)',color:'var(--text-secondary)',border:'1px solid var(--border-subtle)',fontSize:9,padding:'2px 6px'}}>
                              {divisionBadgeLabel(businessUnitId)}
                            </span>
                          ))
                        ) : (
                          <span className="badge badge-draft" style={{fontSize:9,padding:'2px 6px'}}>No divisions</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {usersError && <div style={{fontSize:'var(--text-xs)',color:'var(--danger)',marginTop:8}}>{usersError}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {dataSource !== 'postgres' && (
        <div className="card" style={{borderColor:'var(--danger)',borderColor:'rgba(239,68,68,0.2)'}}>
          <div className="card-title" style={{color:'var(--danger)'}}>Danger Zone</div>
          <div className="flex-between">
            <div>
              <div style={{fontSize:'var(--text-sm)',fontWeight:500}}>Reset All Data</div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Restore mock data to original state. This cannot be undone.</div>
            </div>
            <button className="btn btn-danger" onClick={resetData}>Reset Data</button>
          </div>
        </div>
      )}
    </div>
  );
}
