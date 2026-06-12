'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, MessageSquare, Pencil, RotateCcw, Shield, ToggleLeft, ToggleRight, UserMinus, UserPlus } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';

const defaultRoleOptions = [
  { key: 'admin', label: 'Administrator' },
  { key: 'account_manager', label: 'Account Coordinator' },
  { key: 'sales_manager', label: 'Sales Manager' },
  { key: 'designer', label: 'Designer' },
];

const followUpChannels = [
  { key: 'messenger', label: 'Messenger' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

const templateChannelOptions = [
  { key: 'all', label: 'All channels' },
  ...followUpChannels,
];

const templatePurposeOptions = [
  { key: 'warmup', label: 'Warmup' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'handoff', label: 'Handoff' },
  { key: 'opt_out', label: 'Opt out' },
  { key: 'manual_follow_up', label: 'Manual follow-up' },
  { key: 'fallback', label: 'Fallback' },
];

const templateStatusOptions = [
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

const providerStatusOptions = [
  { key: 'not_required', label: 'Not required' },
  { key: 'not_submitted', label: 'Not submitted' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function defaultTemplateForm() {
  return {
    id: '',
    businessUnitId: '',
    channel: 'all',
    purpose: 'manual_follow_up',
    displayName: '',
    bodyText: '',
    status: 'draft',
    providerStatus: 'not_required',
    isEnabled: false,
  };
}

export default function SettingsPage() {
  const { resetData, loaded, access, dataSource, businessUnits, setBusinessUnits, currentUser } = useCRM();
  const router = useRouter();
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [userRoleOptions, setUserRoleOptions] = useState(defaultRoleOptions);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState({
    id: '',
    name: '',
    email: '',
    password: '',
    roleKey: 'account_manager',
    businessUnitIds: [],
    isActive: true,
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
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [channelSettings, setChannelSettings] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState(defaultTemplateForm);

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
        if (!cancelled) {
          setUsers(Array.isArray(payload.users) ? payload.users : []);
          if (Array.isArray(payload.roleOptions) && payload.roleOptions.length) {
            setUserRoleOptions(payload.roleOptions);
          }
        }
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

  useEffect(() => {
    if (!loaded || !access.canReadSettings || dataSource !== 'postgres') return;
    let cancelled = false;

    async function loadMessageTemplateRegistry() {
      setTemplatesLoading(true);
      setTemplatesError('');
      try {
        const response = await fetch('/api/message-templates');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to load message templates.');
        if (!cancelled) {
          setMessageTemplates(Array.isArray(payload.templates) ? payload.templates : []);
          setChannelSettings(Array.isArray(payload.channelSettings) ? payload.channelSettings : []);
        }
      } catch (error) {
        if (!cancelled) setTemplatesError(error.message || 'Failed to load message templates.');
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    }

    loadMessageTemplateRegistry();
    return () => {
      cancelled = true;
    };
  }, [access.canReadSettings, dataSource, loaded]);

  function resetUserForm() {
    setUserForm({
      id: '',
      name: '',
      email: '',
      password: '',
      roleKey: 'account_manager',
      businessUnitIds: [],
      isActive: true,
    });
  }

  function resetTemplateForm() {
    setTemplateForm(defaultTemplateForm());
  }

  function setUserRole(roleKey) {
    setUserForm((prev) => ({
      ...prev,
      roleKey,
      businessUnitIds: roleKey === 'admin' ? [] : prev.businessUnitIds,
    }));
  }

  function toggleUserBusinessUnit(businessUnitId, checked) {
    setUserForm((prev) => {
      const selected = new Set(prev.businessUnitIds);
      if (checked) selected.add(businessUnitId);
      else selected.delete(businessUnitId);
      return { ...prev, businessUnitIds: [...selected] };
    });
  }

  async function handleCreateOrUpdateUser(event) {
    event.preventDefault();
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingUser(true);
    setUsersError('');
    try {
      const isEditing = Boolean(userForm.id);
      const payload = {
        id: userForm.id,
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        password: userForm.password,
        roleKey: userForm.roleKey,
        businessUnitIds: userForm.roleKey === 'admin' ? [] : userForm.businessUnitIds,
        isActive: Boolean(userForm.isActive),
      };
      const response = await fetch('/api/users', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to save user.');

      setUsers(Array.isArray(result.users) ? result.users : []);
      if (Array.isArray(result.roleOptions) && result.roleOptions.length) {
        setUserRoleOptions(result.roleOptions);
      }
      resetUserForm();
      toast(isEditing ? 'User updated' : 'User created');
    } catch (error) {
      setUsersError(error.message || 'Failed to save user.');
    } finally {
      setSavingUser(false);
    }
  }

  async function updateUserStatus(user, isActive) {
    if (!access.canWriteSettings || dataSource !== 'postgres') return;
    setSavingUser(true);
    setUsersError('');
    try {
      const payload = isActive
        ? {
            id: user.id,
            name: user.name,
            roleKey: user.primaryRoleKey,
            businessUnitIds: user.primaryRoleKey === 'admin' ? [] : user.businessUnitIds || [],
            isActive: true,
          }
        : { id: user.id, isActive: false };
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to update user.');
      setUsers(Array.isArray(result.users) ? result.users : []);
      resetUserForm();
      toast(isActive ? 'User reactivated' : 'User deactivated');
    } catch (error) {
      setUsersError(error.message || 'Failed to update user.');
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

  async function handleSaveTemplate(event) {
    event.preventDefault();
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingTemplate(true);
    setTemplatesError('');
    try {
      const payload = {
        ...templateForm,
        businessUnitId: templateForm.businessUnitId || null,
        displayName: templateForm.displayName.trim(),
        bodyText: templateForm.bodyText.trim(),
        isEnabled: Boolean(templateForm.isEnabled),
      };
      const response = await fetch('/api/message-templates', {
        method: payload.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to save template.');

      setMessageTemplates(Array.isArray(result.templates) ? result.templates : []);
      setChannelSettings(Array.isArray(result.channelSettings) ? result.channelSettings : []);
      resetTemplateForm();
      toast(payload.id ? 'Template updated' : 'Template created');
    } catch (error) {
      setTemplatesError(error.message || 'Failed to save template.');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function toggleChannelSetting(channel, nextEnabled) {
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingTemplate(true);
    setTemplatesError('');
    try {
      const response = await fetch('/api/message-templates', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'channel_setting',
          channel,
          businessUnitId: null,
          intakeRouteKey: 'default',
          isEnabled: nextEnabled,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to update channel setting.');
      setMessageTemplates(Array.isArray(result.templates) ? result.templates : []);
      setChannelSettings(Array.isArray(result.channelSettings) ? result.channelSettings : []);
      toast(`${channel === 'whatsapp' ? 'WhatsApp' : 'Messenger'} follow-up ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setTemplatesError(error.message || 'Failed to update channel setting.');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function toggleTemplateEnabled(template, nextEnabled) {
    if (!access.canWriteSettings || dataSource !== 'postgres') return;

    setSavingTemplate(true);
    setTemplatesError('');
    try {
      const response = await fetch('/api/message-templates', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: template.id,
          businessUnitId: template.businessUnitId || null,
          channel: template.channel,
          purpose: template.purpose,
          displayName: template.displayName,
          bodyText: template.bodyText,
          status: template.status,
          providerStatus: template.providerStatus,
          isEnabled: nextEnabled,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to update template.');
      setMessageTemplates(Array.isArray(result.templates) ? result.templates : []);
      setChannelSettings(Array.isArray(result.channelSettings) ? result.channelSettings : []);
      toast(`Template ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setTemplatesError(error.message || 'Failed to update template.');
    } finally {
      setSavingTemplate(false);
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

  function editTemplate(template) {
    setTemplateForm({
      id: template.id,
      businessUnitId: template.businessUnitId || '',
      channel: template.channel || 'all',
      purpose: template.purpose || 'manual_follow_up',
      displayName: template.displayName || '',
      bodyText: template.bodyText || '',
      status: template.status || 'draft',
      providerStatus: template.providerStatus || 'not_required',
      isEnabled: Boolean(template.isEnabled),
    });
  }

  function editUser(user) {
    setUserForm({
      id: user.id,
      name: user.name || '',
      email: user.email || '',
      password: '',
      roleKey: user.primaryRoleKey || 'account_manager',
      businessUnitIds: user.primaryRoleKey === 'admin' ? [] : user.businessUnitIds || [],
      isActive: user.isActive !== false,
    });
  }

  function formatRoleLabel(roleKey) {
    const option = userRoleOptions.find((row) => row.key === roleKey);
    if (option) return option.label;
    return String(roleKey || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unassigned';
  }

  function divisionBadgeLabel(businessUnitId) {
    const unit = businessUnitRows.find((row) => row.id === businessUnitId);
    return unit?.name || 'Unknown division';
  }

  function membershipOptionsForForm() {
    const selectedIds = new Set(userForm.businessUnitIds);
    return businessUnitRows.filter((unit) => unit.isActive !== false || selectedIds.has(unit.id));
  }

  function businessUnitLabel(businessUnitId) {
    if (!businessUnitId) return 'Organization-wide';
    const unit = businessUnitRows.find((row) => row.id === businessUnitId);
    return unit?.name || 'Unknown division';
  }

  function channelSettingFor(channel) {
    return channelSettings.find((setting) => setting.channel === channel && !setting.businessUnitId) || null;
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

      <div className="card" style={{marginBottom:20}}>
        <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:12}}>
          <div>
            <div className="card-title" style={{display:'flex',alignItems:'center',gap:8}}>
              <MessageSquare size={16} /> Message Template Registry
            </div>
            <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',margin:0}}>Warm-lead follow-up controls for Messenger and WhatsApp. Channels and templates start disabled.</p>
          </div>
          {templatesLoading && <span className="badge badge-draft">Loading</span>}
        </div>

        {dataSource === 'postgres' && access.canWriteSettings ? (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:14,alignItems:'start'}}>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{padding:'12px',background:'var(--bg-tertiary)',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)'}}>
                <div style={{fontSize:'var(--text-sm)',fontWeight:700,marginBottom:8}}>Channel Controls</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {followUpChannels.map((channel) => {
                    const setting = channelSettingFor(channel.key);
                    const enabled = Boolean(setting?.isEnabled);
                    return (
                      <div key={channel.key} className="flex-between" style={{gap:10,padding:'8px 10px',background:'var(--bg-secondary)',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)'}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:'var(--text-sm)',fontWeight:650}}>{channel.label}</div>
                          <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Organization route</div>
                        </div>
                        <button
                          className={`btn btn-sm ${enabled ? '' : 'btn-secondary'}`}
                          type="button"
                          disabled={savingTemplate}
                          onClick={() => toggleChannelSetting(channel.key, !enabled)}
                        >
                          {enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                          {enabled ? 'On' : 'Off'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleSaveTemplate} style={{display:'flex',flexDirection:'column',gap:8,padding:'12px',background:'var(--bg-tertiary)',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)'}}>
                <div className="flex-between" style={{gap:10}}>
                  <div>
                    <div style={{fontSize:'var(--text-sm)',fontWeight:700}}>{templateForm.id ? 'Edit template' : 'Create template'}</div>
                    <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Draft-safe registry entry</div>
                  </div>
                  {templateForm.id && (
                    <button className="btn btn-sm" type="button" onClick={resetTemplateForm}>
                      <RotateCcw size={13} /> New
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  placeholder="Display name"
                  value={templateForm.displayName}
                  onChange={(event) => setTemplateForm((prev) => ({ ...prev, displayName: event.target.value }))}
                  required
                />
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8}}>
                  <select
                    className="input select"
                    value={templateForm.channel}
                    onChange={(event) => setTemplateForm((prev) => ({
                      ...prev,
                      channel: event.target.value,
                      providerStatus: event.target.value === 'whatsapp' ? 'not_submitted' : 'not_required',
                      isEnabled: false,
                    }))}
                  >
                    {templateChannelOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    className="input select"
                    value={templateForm.purpose}
                    onChange={(event) => setTemplateForm((prev) => ({ ...prev, purpose: event.target.value }))}
                  >
                    {templatePurposeOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    className="input select"
                    value={templateForm.businessUnitId}
                    onChange={(event) => setTemplateForm((prev) => ({ ...prev, businessUnitId: event.target.value }))}
                  >
                    <option value="">Organization-wide</option>
                    {businessUnitRows.map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.name}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="input"
                  placeholder="Message body"
                  value={templateForm.bodyText}
                  onChange={(event) => setTemplateForm((prev) => ({ ...prev, bodyText: event.target.value }))}
                  required
                  rows={4}
                  style={{resize:'vertical',minHeight:88}}
                />
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8}}>
                  <select
                    className="input select"
                    value={templateForm.status}
                    onChange={(event) => setTemplateForm((prev) => ({ ...prev, status: event.target.value, isEnabled: false }))}
                  >
                    {templateStatusOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    className="input select"
                    value={templateForm.providerStatus}
                    onChange={(event) => setTemplateForm((prev) => ({ ...prev, providerStatus: event.target.value, isEnabled: false }))}
                  >
                    {providerStatusOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>
                  <input
                    type="checkbox"
                    checked={templateForm.isEnabled}
                    onChange={(event) => setTemplateForm((prev) => ({ ...prev, isEnabled: event.target.checked }))}
                  />
                  Enabled template
                </label>
                <button className="btn btn-primary" type="submit" disabled={savingTemplate}>
                  {savingTemplate ? 'Saving...' : templateForm.id ? 'Save Template' : 'Add Template'}
                </button>
              </form>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div className="flex-between" style={{gap:12}}>
                <div style={{fontSize:'var(--text-sm)',fontWeight:700}}>Templates</div>
                <span className="badge badge-draft">{messageTemplates.length} total</span>
              </div>
              {!templatesLoading && messageTemplates.length === 0 && (
                <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',padding:'10px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>No templates registered yet.</div>
              )}
              {messageTemplates.map((template) => (
                <div key={template.id} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:10,alignItems:'start',padding:'10px',background:'var(--bg-tertiary)',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)'}}>
                  <div style={{minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:4}}>
                      <span style={{fontSize:'var(--text-sm)',fontWeight:700}}>{template.displayName}</span>
                      <span className={`badge ${template.status === 'active' ? 'badge-contacted' : template.status === 'archived' ? 'badge-draft' : 'badge-new'}`} style={{fontSize:9,padding:'2px 6px'}}>{template.statusLabel}</span>
                      <span className={`badge ${template.isEnabled ? 'badge-won' : 'badge-draft'}`} style={{fontSize:9,padding:'2px 6px'}}>{template.isEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginBottom:6}}>
                      {template.channelLabel} / {template.purposeLabel} / {businessUnitLabel(template.businessUnitId)}
                    </div>
                    <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',whiteSpace:'pre-wrap',lineHeight:1.35}}>{template.bodyText}</div>
                    <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:6}}>Provider: {template.providerStatusLabel}</div>
                  </div>
                  <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
                    <button className="btn btn-sm" type="button" onClick={() => editTemplate(template)}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={savingTemplate || (!template.isEnabled && !template.canEnable)}
                      onClick={() => toggleTemplateEnabled(template, !template.isEnabled)}
                    >
                      {template.isEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {template.isEnabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
              {templatesError && <div style={{fontSize:'var(--text-xs)',color:'var(--danger)'}}>{templatesError}</div>}
            </div>
          </div>
        ) : (
          <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Message template controls are available in database-backed admin sessions.</div>
        )}
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
              <form onSubmit={handleSaveBusinessUnit} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,140px),1fr))',gap:8,alignItems:'center',marginBottom:12}}>
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

        <div className="card" style={{gridColumn:'1 / -1'}}>
          <div className="card-title">Product Admin</div>
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Manage employee access, managed roles, and division memberships.</p>
          {dataSource === 'postgres' && access.canWriteSettings ? (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:14,alignItems:'start'}}>
              <form onSubmit={handleCreateOrUpdateUser} style={{display:'flex',flexDirection:'column',gap:10,padding:'12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-subtle)'}}>
                <div className="flex-between" style={{gap:10}}>
                  <div>
                    <div style={{fontSize:'var(--text-sm)',fontWeight:700}}>{userForm.id ? 'Edit user' : 'Create user'}</div>
                    <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{userForm.id ? userForm.email : 'New employee account'}</div>
                  </div>
                  {userForm.id && (
                    <button className="btn btn-sm" type="button" onClick={resetUserForm}>
                      <RotateCcw size={13} /> New
                    </button>
                  )}
                </div>
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
                  disabled={Boolean(userForm.id)}
                  required={!userForm.id}
                />
                <input
                  className="input"
                  type="password"
                  placeholder={userForm.id ? 'New password (optional)' : 'Initial password'}
                  value={userForm.password}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                  required={!userForm.id}
                  minLength={8}
                />
                <select
                  className="input select"
                  value={userForm.roleKey}
                  onChange={(event) => setUserRole(event.target.value)}
                >
                  {userRoleOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                {userForm.roleKey !== 'admin' ? (
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    <div style={{fontSize:'var(--text-xs)',fontWeight:650,color:'var(--text-secondary)',textTransform:'uppercase'}}>Division Memberships</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:6}}>
                      {membershipOptionsForForm().map((unit) => (
                        <label key={unit.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--bg-secondary)',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)',fontSize:'var(--text-sm)'}}>
                          <input
                            type="checkbox"
                            checked={userForm.businessUnitIds.includes(unit.id)}
                            onChange={(event) => toggleUserBusinessUnit(unit.id, event.target.checked)}
                            disabled={unit.isActive === false}
                          />
                          <span style={{width:9,height:9,borderRadius:999,background:unit.color || 'var(--accent)',flex:'0 0 auto'}} />
                          <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{unit.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--accent-muted)',borderRadius:'var(--radius-md)',fontSize:'var(--text-xs)',color:'var(--accent)'}}>
                    <Shield size={14} /> Full division access
                  </div>
                )}
                {userForm.id && (
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>
                    <input
                      type="checkbox"
                      checked={userForm.isActive}
                      onChange={(event) => setUserForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                    />
                    Active user
                  </label>
                )}
                <button className="btn btn-primary" type="submit" disabled={savingUser}>
                  {userForm.id ? <Check size={14} /> : <UserPlus size={14} />}
                  {savingUser ? 'Saving...' : userForm.id ? 'Save Changes' : 'Create User'}
                </button>
              </form>

              <div style={{display:'flex',flexDirection:'column',gap:10,padding:'12px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-subtle)'}}>
                <div className="flex-between" style={{gap:12}}>
                  <div>
                    <div style={{fontSize:'var(--text-sm)',fontWeight:700}}>Users</div>
                    <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{users.length} provisioned account{users.length === 1 ? '' : 's'}</div>
                  </div>
                  {usersLoading && <span className="badge badge-draft">Loading</span>}
                </div>
                {!usersLoading && users.length === 0 && <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>No users found yet.</div>}
                {!usersLoading && users.map((user) => {
                  const isCurrentUser = user.id === currentUser?.id;
                  return (
                    <div key={user.id} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,180px),1fr))',gap:12,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border-subtle)'}}>
                      <div style={{minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                          <div style={{fontSize:'var(--text-sm)',fontWeight:650,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.name}</div>
                          <span className={'badge ' + (user.isActive !== false ? 'badge-won' : 'badge-draft')} style={{fontSize:9,padding:'2px 6px'}}>
                            {user.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                          {isCurrentUser && <span className="badge badge-contacted" style={{fontSize:9,padding:'2px 6px'}}>You</span>}
                        </div>
                        <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.email}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:5,minWidth:0}}>
                        <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{formatRoleLabel(user.primaryRoleKey)}</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
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
                      <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
                        <button className="btn btn-sm" type="button" onClick={() => editUser(user)}>
                          <Pencil size={13} /> Edit
                        </button>
                        {user.isActive !== false ? (
                          <button className="btn btn-sm btn-danger" type="button" disabled={savingUser || isCurrentUser} onClick={() => updateUserStatus(user, false)}>
                            <UserMinus size={13} /> Deactivate
                          </button>
                        ) : (
                          <button className="btn btn-sm" type="button" disabled={savingUser} onClick={() => updateUserStatus(user, true)}>
                            <UserPlus size={13} /> Reactivate
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {usersError && <div style={{fontSize:'var(--text-xs)',color:'var(--danger)',marginTop:2}}>{usersError}</div>}
              </div>
            </div>
          ) : (
            <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>Product admin controls are available in database-backed admin sessions.</div>
          )}
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
