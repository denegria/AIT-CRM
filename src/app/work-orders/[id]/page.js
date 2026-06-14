'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, ClipboardList, DollarSign, Edit3, FileText, Printer, User } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { generateWorkOrderPDF } from '@/lib/pdf';
import { buildAitSignsDocument, formatAitSignsMoney } from '@/lib/ait-signs-document';
import s from './WorkOrderDetail.module.css';

function badgeKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const {
    workOrders,
    financials,
    contacts,
    employees,
    accessibleBusinessUnits,
    updateWorkOrder,
    recordPayment,
    loaded,
    access,
    scopeLabel,
  } = useCRM();
  const [activeTab, setActiveTab] = useState('overview');
  const [editForm, setEditForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const canWriteWorkOrders = Boolean(access?.canWriteWorkOrders);
  const canWriteFinancials = Boolean(access?.canWriteFinancials);

  const workOrder = useMemo(
    () => workOrders.find((row) => row.id === params.id),
    [params.id, workOrders]
  );
  const relatedContact = useMemo(
    () => contacts.find((contact) => contact.id === workOrder?.contactId),
    [contacts, workOrder?.contactId]
  );
  const assignedEmployee = useMemo(
    () => employees.find((employee) => employee.id === workOrder?.assignedTo),
    [employees, workOrder?.assignedTo]
  );
  const assignedDivision = useMemo(
    () => accessibleBusinessUnits.find((unit) => unit.id === workOrder?.businessUnitId),
    [accessibleBusinessUnits, workOrder?.businessUnitId]
  );
  const documentContext = useMemo(
    () => ({
      contact: relatedContact,
      assignedEmployee,
      businessUnit: assignedDivision,
    }),
    [assignedDivision, assignedEmployee, relatedContact]
  );
  const workOrderPayments = useMemo(
    () => financials.filter((record) => record.type === 'Receipt' && record.workOrderId === workOrder?.id),
    [financials, workOrder?.id]
  );
  const paymentTotal = useMemo(
    () => workOrderPayments.reduce((sum, record) => sum + Number(record.amount || 0), 0),
    [workOrderPayments]
  );
  const documentRecord = useMemo(
    () => workOrder ? {
      ...workOrder,
      paidAmount: paymentTotal,
      paymentMethod: workOrderPayments[0]?.paymentMethod || workOrder.paymentMethod || '',
    } : null,
    [paymentTotal, workOrder, workOrderPayments]
  );
  const documentPreview = useMemo(
    () => documentRecord ? buildAitSignsDocument(documentRecord, documentContext) : null,
    [documentContext, documentRecord]
  );
  const paymentPreview = useMemo(() => {
    if (!paymentForm || !documentPreview?.amounts) return null;
    const amount = Number(paymentForm.amount);
    const currentBalance = Number(documentPreview.amounts.balanceDue || 0);
    const balanceAfter = Number.isFinite(amount) && amount > 0 ? Math.max(currentBalance - amount, 0) : currentBalance;
    return {
      currentBalance,
      balanceAfter,
      isPartial: Number.isFinite(amount) && amount > 0 && balanceAfter > 0,
    };
  }, [documentPreview, paymentForm]);

  function openEditModal() {
    if (!canWriteWorkOrders || !workOrder) return;
    setEditForm({ ...workOrder });
  }

  async function handleEditSave() {
    if (!editForm || !workOrder) return;
    try {
      await updateWorkOrder(workOrder.id, editForm);
      toast('Work order updated');
      setEditForm(null);
    } catch (error) {
      toast(error?.message || 'Work order update failed.', 'error');
    }
  }

  function openPaymentModal() {
    if (!canWriteFinancials || !workOrder) return;
    const balanceDue = documentPreview?.amounts?.balanceDue;
    setPaymentForm({
      amount: balanceDue && balanceDue > 0 ? String(balanceDue) : '',
      paymentMethod: 'Cash',
      paidAt: new Date().toISOString().slice(0, 10),
      checkNumber: '',
      note: '',
    });
  }

  async function handlePaymentSave() {
    if (!paymentForm || !workOrder) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Payment amount must be greater than zero.', 'error');
      return;
    }
    try {
      await recordPayment({
        workOrderId: workOrder.id,
        contactId: workOrder.contactId,
        businessUnitId: workOrder.businessUnitId,
        client: workOrder.client || relatedContact?.name || '',
        amount,
        paymentMethod: paymentForm.paymentMethod,
        paidAt: paymentForm.paidAt,
        checkNumber: paymentForm.checkNumber,
        note: paymentForm.note,
      });
      toast('Payment recorded');
      setPaymentForm(null);
    } catch (error) {
      toast(error?.message || 'Payment save failed.', 'error');
    }
  }

  function handlePrintDocument() {
    setActiveTab('document');
    requestAnimationFrame(() => window.print());
  }

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (!workOrder) return <div className="empty-state">Work order not found</div>;

  return (
    <div className={s.detailPage + ' fade-in'}>
      <div className="page-header">
        <button className={s.btnBack} onClick={() => router.push('/work-orders')}>
          <ArrowLeft size={18} /> Back to Work Orders
        </button>
        <div className={s.headerActions}>
          <button className="btn" onClick={handlePrintDocument}>
            <Printer size={16} /> Print Form
          </button>
          <button className="btn" onClick={() => { generateWorkOrderPDF(documentRecord || workOrder, documentContext); toast('PDF generated'); }}>
            <FileText size={16} /> Download Work Order PDF
          </button>
          {canWriteFinancials && (
            <button className="btn" onClick={openPaymentModal}>
              <DollarSign size={16} /> Record Payment
            </button>
          )}
          {canWriteWorkOrders && (
            <button className="btn btn-primary" onClick={openEditModal}>
              <Edit3 size={16} /> Edit Order
            </button>
          )}
        </div>
      </div>

      <div className={s.detailLayout}>
        <aside className={s.profileCard}>
          <div className={s.profileHeader}>
            <div className={s.profileIcon}><ClipboardList size={32} /></div>
            <h1 className={s.profileName}>{workOrder.title}</h1>
            <div className={s.badgeStack}>
              <span className={`badge badge-${badgeKey(workOrder.status)}`}>{workOrder.status}</span>
              <span className={`badge badge-${badgeKey(workOrder.priority)}`}>{workOrder.priority} Priority</span>
            </div>
          </div>

          <div className={s.profileInfo}>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Number</span>
              <span>{workOrder.number || 'Unassigned'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Client</span>
              <span>{workOrder.client || relatedContact?.name || 'Unassigned'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Due</span>
              <span>{workOrder.dueDate || 'No date'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Cost</span>
              <span>{formatAitSignsMoney(workOrder.estimatedCost, '$0.00')}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>{scopeLabel}</span>
              <span>{assignedDivision?.name || 'Unassigned'}</span>
            </div>
          </div>

          <div className={s.assignment}>
            <div className={s.assignmentLabel}>Assigned Technician</div>
            <div className={s.assignmentUser}>
              <div className={s.userAvatar}>{assignedEmployee?.name?.charAt(0) || '?'}</div>
              <span>{assignedEmployee?.name || 'Unassigned'}</span>
            </div>
          </div>
        </aside>

        <main className={s.contentSection}>
          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${activeTab === 'overview' ? s.active : ''}`} onClick={() => setActiveTab('overview')}>
              Overview
            </button>
            <button className={`${s.contentTab} ${activeTab === 'description' ? s.active : ''}`} onClick={() => setActiveTab('description')}>
              Description
            </button>
            <button className={`${s.contentTab} ${activeTab === 'document' ? s.active : ''}`} onClick={() => setActiveTab('document')}>
              Document
            </button>
          </div>

          <section className={s.contentPanel}>
            {activeTab === 'overview' && (
              <>
                <div className={s.detailGrid}>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Status</div>
                    <div className={s.detailValue}>{workOrder.status}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Priority</div>
                    <div className={s.detailValue}>{workOrder.priority}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Due date</div>
                    <div className={s.detailValue}><Calendar size={14} /> {workOrder.dueDate || 'No date'}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Estimated cost</div>
                    <div className={s.detailValue}>{formatAitSignsMoney(workOrder.estimatedCost, '$0.00')}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Paid / Deposit</div>
                    <div className={s.detailValue}>{formatAitSignsMoney(paymentTotal, '$0.00')}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Balance due</div>
                    <div className={s.detailValue}>{documentPreview?.amounts?.balanceDueDisplay || 'Not captured'}</div>
                  </div>
                </div>
                {relatedContact && (
                  <Link className={s.linkedContact} href={`/contacts/${relatedContact.id}`}>
                    <User size={16} /> Open linked contact: {relatedContact.name}
                  </Link>
                )}
              </>
            )}

            {activeTab === 'description' && (
              <div className={s.description}>
                {workOrder.description || 'No description captured yet.'}
              </div>
            )}

            {activeTab === 'document' && documentPreview && (
              <div className={s.documentShell}>
                <div className={s.documentActions}>
                  <button className="btn btn-sm" onClick={handlePrintDocument}>
                    <Printer size={14} /> Print
                  </button>
                </div>
                <section className={s.documentForm}>
                  <header className={s.documentHeader}>
                    <div className={s.documentBrand}>
                      <div className={s.documentLogo} aria-label="AIT logo">
                        <span className={s.documentLogoA}>A</span><span>IT</span>
                      </div>
                      <div>
                        <div className={s.documentCompany}>{documentPreview.company.name}</div>
                        <div className={s.documentTagline}>{documentPreview.company.tagline}</div>
                        <div className={s.documentCompanyContact}>
                          {documentPreview.company.address} | {documentPreview.company.phone} | {documentPreview.company.email}
                        </div>
                      </div>
                    </div>
                    <div className={s.documentTitleBlock}>
                      <div className={s.documentTitle}>{documentPreview.title}</div>
                      <div className={s.documentNumberBox}>
                        <div><span>{documentPreview.numberLabel}</span><strong>{documentPreview.number}</strong></div>
                        <div><span>{documentPreview.dateLabel}</span><strong>{documentPreview.dateDisplay}</strong></div>
                      </div>
                    </div>
                  </header>

                  <div className={s.documentServiceStrip}>
                    {documentPreview.services.map((service) => (
                      <div key={service.label}>
                        <strong>{service.label}</strong>
                        <span>{service.detail}</span>
                      </div>
                    ))}
                  </div>

                  <div className={s.documentFormMeta}>
                    <div className={s.documentInfoBox}>
                      <div className={s.documentInfoTitle}>Billing Info</div>
                      <dl>
                        <div><dt>Name</dt><dd>{documentPreview.billingInfo.name}</dd></div>
                        <div><dt>Contact Name</dt><dd>{documentPreview.billingInfo.contactName}</dd></div>
                        <div><dt>Address</dt><dd>{documentPreview.billingInfo.address}</dd></div>
                        <div><dt>Phone</dt><dd>{documentPreview.billingInfo.phone}</dd></div>
                      </dl>
                    </div>
                    <div className={s.documentInfoBox}>
                      <div className={s.documentInfoTitle}>Work Address (if different)</div>
                      <dl>
                        <div><dt>Name</dt><dd>{documentPreview.workAddress.name}</dd></div>
                        <div><dt>Contact Name</dt><dd>{documentPreview.workAddress.contactName}</dd></div>
                        <div><dt>Address</dt><dd>{documentPreview.workAddress.address}</dd></div>
                        <div><dt>Phone</dt><dd>{documentPreview.workAddress.phone}</dd></div>
                      </dl>
                    </div>
                    <div className={s.documentSummaryBox}>
                      <div><span>Status</span><strong>{documentPreview.status}</strong></div>
                      <div><span>{scopeLabel}</span><strong>{documentPreview.division}</strong></div>
                      <div><span>Assigned</span><strong>{documentPreview.assignedName}</strong></div>
                      <div><span>Due</span><strong>{documentPreview.dueDateDisplay}</strong></div>
                    </div>
                  </div>

                  <div className={s.documentItems}>
                    <div className={s.documentItemsHead}>
                      <span>ITM</span>
                      <span>Description</span>
                      <span>Unit Price</span>
                      <span>Qt</span>
                      <span>Total</span>
                    </div>
                    {documentPreview.items.map((item, index) => (
                      <div className={s.documentItemRow} key={`${item.description}-${index}`}>
                        <span>{index + 1}</span>
                        <span className={s.documentItemDescription}>
                          <strong>{item.description}</strong>
                          {item.detail && <small>{item.detail}</small>}
                        </span>
                        <span>{formatAitSignsMoney(item.rate, '')}</span>
                        <span>{item.qty}</span>
                        <span>{formatAitSignsMoney(item.amount, '')}</span>
                      </div>
                    ))}
                  </div>

                  <div className={s.documentTotals}>
                    <div><span>Subtotal</span><strong>{documentPreview.amounts.subtotalDisplay}</strong></div>
                    <div><span>Tax ({documentPreview.amounts.taxRateLabel})</span><strong>{documentPreview.amounts.taxDisplay}</strong></div>
                    <div><span>Paid / Deposit</span><strong>{documentPreview.amounts.paidAmountDisplay}</strong></div>
                    <div><span>Balance Due</span><strong>{documentPreview.amounts.balanceDueDisplay}</strong></div>
                    <div className={s.documentTotalFinal}><span>Total</span><strong>{documentPreview.amounts.totalDisplay}</strong></div>
                  </div>

                  <section className={s.documentTerms}>
                    <strong>{documentPreview.termsTitle}</strong>
                    <span>{documentPreview.terms}</span>
                  </section>

                  <footer className={s.documentFooter}>
                    <strong>Thank You for Your Business</strong>
                    <span>{documentPreview.footerNote}</span>
                  </footer>
                </section>
              </div>
            )}
          </section>
        </main>
      </div>

      {editForm && (
        <Modal
          open={!!editForm}
          onClose={() => setEditForm(null)}
          title="Edit Work Order"
          footer={<><button className="btn" onClick={() => setEditForm(null)}>Cancel</button><button className="btn btn-primary" onClick={handleEditSave}>Save</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">WO Number</label>
              <input className="input" value={editForm.number || ''} onChange={(event) => setEditForm((form) => ({ ...form, number: event.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="input" type="date" value={editForm.dueDate || ''} onChange={(event) => setEditForm((form) => ({ ...form, dueDate: event.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="input" value={editForm.title || ''} onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Client</label>
            <select className="input select" value={editForm.contactId || ''} onChange={(event) => {
              const contact = contacts.find((row) => row.id === event.target.value);
              setEditForm((form) => ({
                ...form,
                contactId: event.target.value,
                client: contact?.name || '',
                businessUnitId: contact?.businessUnitId || contact?.primaryBusinessUnitId || form.businessUnitId || '',
              }));
            }}>
              <option value="">Select client</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
            </select>
          </div>
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">{scopeLabel}</label>
              <select className="input select" value={editForm.businessUnitId || ''} onChange={(event) => setEditForm((form) => ({ ...form, businessUnitId: event.target.value }))}>
                {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="input select" value={editForm.priority || 'Medium'} onChange={(event) => setEditForm((form) => ({ ...form, priority: event.target.value }))}>
                {['Low', 'Medium', 'High'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="input select" value={editForm.status || 'Pending'} onChange={(event) => setEditForm((form) => ({ ...form, status: event.target.value }))}>
                {['Pending', 'In Progress', 'Completed', 'On Hold'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Assigned To</label>
              <select className="input select" value={editForm.assignedTo || ''} onChange={(event) => setEditForm((form) => ({ ...form, assignedTo: event.target.value }))}>
                <option value="">Unassigned</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Estimated Cost ($)</label>
            <input className="input" type="number" value={editForm.estimatedCost || 0} onChange={(event) => setEditForm((form) => ({ ...form, estimatedCost: Number(event.target.value) }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="input" rows={4} value={editForm.description || ''} onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))} style={{resize:'vertical'}} />
          </div>
        </Modal>
      )}
      {paymentForm && (
        <Modal
          open={!!paymentForm}
          onClose={() => setPaymentForm(null)}
          title="Record Payment"
          footer={<><button className="btn" onClick={() => setPaymentForm(null)}>Cancel</button><button className="btn btn-primary" onClick={handlePaymentSave}>Save Payment</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Amount Paid ($)</label>
              <input className="input" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Payment Date</label>
              <input className="input" type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm((form) => ({ ...form, paidAt: event.target.value }))} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Payment Method</label>
              <select className="input select" value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm((form) => ({ ...form, paymentMethod: event.target.value }))}>
                {['Cash', 'Check', 'Card', 'Zelle', 'Cash App', 'Venmo', 'PayPal', 'Bank Transfer', 'Other'].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Check / Reference</label>
              <input className="input" value={paymentForm.checkNumber} onChange={(event) => setPaymentForm((form) => ({ ...form, checkNumber: event.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Payment Note / Partial Payment Memo</label>
            <textarea
              className="input"
              rows={3}
              value={paymentForm.note}
              onChange={(event) => setPaymentForm((form) => ({ ...form, note: event.target.value }))}
              placeholder="Example: partial payment for deposit, check memo, or remaining balance context."
              style={{resize:'vertical'}}
            />
          </div>
          {paymentPreview && (
            <div
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: 12,
                display: 'grid',
                gap: 8,
                background: 'var(--bg-tertiary)',
              }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
                <span style={{color: 'var(--text-muted)'}}>Current balance</span>
                <strong>{formatAitSignsMoney(paymentPreview.currentBalance, '$0.00')}</strong>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
                <span style={{color: 'var(--text-muted)'}}>Balance after payment</span>
                <strong>{formatAitSignsMoney(paymentPreview.balanceAfter, '$0.00')}</strong>
              </div>
              {paymentPreview.isPartial && (
                <div style={{fontSize: 'var(--text-sm)', color: 'var(--text-muted)'}}>
                  This will be saved as a partial payment event and linked to this work order.
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
