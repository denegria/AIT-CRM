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
  const { resetData, loaded, access, dataSource, accessibleBusinessUnits } = useCRM();
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
              <input className="input" value="https://api.aitcrm.com/webhooks/fb-leads" readOnly style={{opacity:0.7,flex:1}} />
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
                    {accessibleBusinessUnits.map((unit) => (
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
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{user.primaryRoleKey}</div>
                      <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{user.businessUnitIds?.length || 0} division(s)</div>
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
