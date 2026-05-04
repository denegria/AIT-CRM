'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';

export default function SettingsPage() {
  const { resetData, loaded, role } = useCRM();
  const router = useRouter();

  useEffect(() => {
    if (loaded && role === 'employee') {
      router.push('/');
    }
  }, [loaded, role, router]);

  if (!loaded || role === 'employee') return <div className="empty-state">Loading...</div>;

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
          <p style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>Configure role-based access control.</p>
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
                <span style={{fontSize:'var(--text-sm)',fontWeight:500}}>Employee</span>
                <span className="badge badge-contacted">Limited</span>
              </div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:4}}>Personal tasks, assigned leads, document generation</div>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
