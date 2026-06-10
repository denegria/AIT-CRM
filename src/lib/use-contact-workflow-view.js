'use client';

import { useMemo } from 'react';
import {
  PIPELINE_STATUSES,
  isWorkflowStatusClosed,
  isPipelineEligibleContact,
  workflowColumnsForBusinessUnit,
  workflowForBusinessUnit,
  workflowFromContact,
} from '@/lib/sales-workflow';

function moneyLabel(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildOperationalSummary({ workOrders = [], financials = [] } = {}) {
  const workOrder = workOrders[0];
  if (workOrder) {
    return [
      workOrder.number || 'Work order',
      workOrder.status || workOrder.title,
      workOrder.dueDate ? `Due ${workOrder.dueDate}` : '',
    ].filter(Boolean).join(' · ');
  }

  const estimate = financials.find((record) => record.type === 'Estimate');
  if (estimate) {
    return [
      estimate.number || 'Estimate',
      moneyLabel(estimate.amount),
      estimate.status,
    ].filter(Boolean).join(' · ');
  }

  const receipt = financials.find((record) => ['Receipt', 'Invoice'].includes(record.type));
  if (receipt) {
    return [
      receipt.type || 'Payment',
      moneyLabel(receipt.amount),
      receipt.date,
    ].filter(Boolean).join(' · ');
  }

  return '';
}

export function useContactWorkflowView({
  contacts = [],
  workOrders = [],
  financials = [],
  employees = [],
  accessibleBusinessUnits = [],
  currentBusinessUnitId = 'all',
  currentBusinessUnit = null,
  pipelineBusinessUnitId = '',
} = {}) {
  const businessUnitById = useMemo(
    () => new Map((accessibleBusinessUnits || []).map((unit) => [unit.id, unit])),
    [accessibleBusinessUnits],
  );

  const contactCountByBusinessUnitId = useMemo(() => {
    const counts = new Map();
    for (const contact of contacts || []) {
      const businessUnitId = contact.businessUnitId || contact.primaryBusinessUnitId;
      if (!businessUnitId) continue;
      counts.set(businessUnitId, (counts.get(businessUnitId) || 0) + 1);
    }
    return counts;
  }, [contacts]);

  const defaultPipelineBusinessUnitId = useMemo(() => {
    let bestUnitId = accessibleBusinessUnits[0]?.id || '';
    let bestCount = -1;
    for (const unit of accessibleBusinessUnits || []) {
      const count = contactCountByBusinessUnitId.get(unit.id) || 0;
      if (count > bestCount) {
        bestCount = count;
        bestUnitId = unit.id;
      }
    }
    return bestUnitId;
  }, [accessibleBusinessUnits, contactCountByBusinessUnitId]);

  const currentScopedBusinessUnitId =
    currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned' ? currentBusinessUnitId : '';
  const resolvedPipelineBusinessUnitId = currentScopedBusinessUnitId ||
    (businessUnitById.has(pipelineBusinessUnitId) ? pipelineBusinessUnitId : defaultPipelineBusinessUnitId);
  const pipelineBusinessUnit = businessUnitById.get(resolvedPipelineBusinessUnitId) || currentBusinessUnit || null;
  const activeWorkflow = workflowForBusinessUnit(pipelineBusinessUnit);
  const pipelineColumns = workflowColumnsForBusinessUnit(pipelineBusinessUnit);
  const defaultBusinessUnitId =
    currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned'
      ? currentBusinessUnitId
      : accessibleBusinessUnits[0]?.id || '';

  const statusOptionsForBusinessUnitId = (businessUnitId) => {
    const workflow = workflowForBusinessUnit(businessUnitById.get(businessUnitId) || null);
    return workflow.statuses;
  };

  const workOrdersByContactId = useMemo(() => {
    const lookup = new Map();
    for (const order of workOrders || []) {
      if (!order.contactId) continue;
      const rows = lookup.get(order.contactId) || [];
      rows.push(order);
      lookup.set(order.contactId, rows);
    }
    return lookup;
  }, [workOrders]);

  const financialsByContactId = useMemo(() => {
    const lookup = new Map();
    for (const record of financials || []) {
      if (!record.contactId) continue;
      const rows = lookup.get(record.contactId) || [];
      rows.push(record);
      lookup.set(record.contactId, rows);
    }
    return lookup;
  }, [financials]);

  const contactsWithWorkflow = useMemo(() => contacts.map((contact) => {
    const businessUnit = businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
    const relatedFinancials = financialsByContactId.get(contact.id) || [];
    const relatedWorkOrders = workOrdersByContactId.get(contact.id) || [];
    const relatedPaymentSnapshots = relatedFinancials.filter((record) => ['Receipt', 'Invoice'].includes(record.type));
    const workflow = workflowFromContact(contact, {
      businessUnit,
      workOrders: relatedWorkOrders,
      financials: relatedFinancials,
      paymentSnapshots: relatedPaymentSnapshots,
    });
    const isPipelineEligible = typeof contact.isPipelineEligible === 'boolean'
      ? contact.isPipelineEligible
      : isPipelineEligibleContact(contact, {
        businessUnit,
        workOrders: relatedWorkOrders,
        financials: relatedFinancials,
        paymentSnapshots: relatedPaymentSnapshots,
        lastTouch: contact.lastTouch || contact.lastContact,
        lastFollowUpTouch: contact.lastFollowUpTouch,
      });
    return {
      ...contact,
      workflowKey: workflow.workflowKey,
      workflowLabel: workflow.workflowLabel,
      status: workflow.status,
      currentStage: workflow.currentStage,
      tags: workflow.tags?.length ? workflow.tags : contact.tags,
      nextAction: workflow.nextAction || contact.nextAction,
      priority: workflow.priority || contact.priority,
      outreachState: workflow.outreachState || contact.outreachState,
      needsFirstOutreach: workflow.needsFirstOutreach || contact.needsFirstOutreach,
      operationalSummary: buildOperationalSummary({
        workOrders: relatedWorkOrders,
        financials: relatedFinancials,
      }),
      relatedWorkOrderCount: relatedWorkOrders.length,
      relatedEstimateCount: relatedFinancials.filter((record) => record.type === 'Estimate').length,
      relatedPaymentCount: relatedPaymentSnapshots.length,
      isPipelineEligible,
    };
  }), [businessUnitById, contacts, financialsByContactId, workOrdersByContactId]);

  const contactRows = useMemo(() => contactsWithWorkflow.map((contact) => ({
    ...contact,
    assignedLabel:
      employees.find((employee) => employee.id === contact.assignedTo)?.name ||
      (contact.assignedTo ? contact.assignedTo : 'Unassigned'),
    divisionLabel:
      accessibleBusinessUnits.find((unit) => unit.id === (contact.businessUnitId || contact.primaryBusinessUnitId))?.name ||
      'Unassigned',
  })), [contactsWithWorkflow, employees, accessibleBusinessUnits]);

  const workflowStats = useMemo(() => ({
    needsFirstOutreach: contactsWithWorkflow.filter((contact) => contact.needsFirstOutreach).length,
    unassigned: contactsWithWorkflow.filter((contact) => !contact.assignedTo).length,
    active: contactsWithWorkflow.filter((contact) => {
      const businessUnit = businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
      return !isWorkflowStatusClosed(contact.status, businessUnit);
    }).length,
  }), [businessUnitById, contactsWithWorkflow]);

  const statusOptions = useMemo(() => {
    if (currentScopedBusinessUnitId) return activeWorkflow.statuses;
    const statuses = [...new Set(contactsWithWorkflow.map((contact) => contact.status).filter(Boolean))];
    return statuses.length ? statuses : PIPELINE_STATUSES;
  }, [activeWorkflow.statuses, contactsWithWorkflow, currentScopedBusinessUnitId]);

  return {
    activeWorkflow,
    businessUnitById,
    contactRows,
    contactsWithWorkflow,
    currentScopedBusinessUnitId,
    defaultBusinessUnitId,
    pipelineBusinessUnit,
    pipelineColumns,
    resolvedPipelineBusinessUnitId,
    statusOptions,
    statusOptionsForBusinessUnitId,
    workflowStats,
  };
}
