import { and, eq } from 'drizzle-orm';
import { businessUnits } from '@/db/schema.js';
import {
  countContactDirectoryRows,
  loadContactDirectoryPage,
} from '@/lib/contact-directory/service.js';
import { scopedOrgWhere } from '@/lib/crm/access.js';
import { workflowColumnsForBusinessUnit } from '@/lib/sales-workflow.js';

const PIPELINE_MAX_ROWS = 5000;

function clean(value = '') {
  return String(value || '').trim();
}

function scopedParams(businessUnitId, values = {}) {
  const params = new URLSearchParams({ businessUnitId });
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params;
}

export async function loadPipelineSummary({ db, session, searchParams }) {
  const businessUnitId = clean(searchParams.get('businessUnitId'));
  const [businessUnit] = await db
    .select()
    .from(businessUnits)
    .where(and(scopedOrgWhere(businessUnits, session), eq(businessUnits.id, businessUnitId)))
    .limit(1);
  const allowed = businessUnit && (
    session.user.canAccessAllBusinessUnits || session.user.businessUnitIds.includes(businessUnit.id)
  );
  if (!allowed) {
    const error = new Error('Insufficient business-unit access.');
    error.status = 403;
    throw error;
  }

  const leadDateScope = clean(searchParams.get('leadDateScope')) || 'current';
  const leadDateFrom = clean(searchParams.get('leadDateFrom'));
  const leadDateTo = clean(searchParams.get('leadDateTo'));
  const query = scopedParams(businessUnitId, {
    leadDateScope,
    leadDateFrom,
    leadDateTo,
    page: 1,
    pageSize: PIPELINE_MAX_ROWS,
  });
  const countFor = (values, options = {}) => countContactDirectoryRows({
    db,
    session,
    searchParams: scopedParams(businessUnitId, values),
    businessUnitRows: [businessUnit],
    ...options,
  });
  const closedColumns = workflowColumnsForBusinessUnit(businessUnit)
    .filter((column) => typeof column !== 'string' && column.isTerminal && !column.isOperational);
  const selectedDateValues = { leadDateScope, leadDateFrom, leadDateTo };

  const [payload, allCount, currentCount, quarterCount, customCount, closedCounts] = await Promise.all([
    loadContactDirectoryPage({ db, session, searchParams: query, pageSizeLimit: PIPELINE_MAX_ROWS }),
    countFor({ leadDateScope: 'all' }),
    countFor({ leadDateScope: 'current' }),
    countFor({ leadDateScope: 'quarter' }),
    leadDateFrom || leadDateTo
      ? countFor({ leadDateScope: 'custom', leadDateFrom, leadDateTo })
      : Promise.resolve(0),
    Promise.all(closedColumns.map(async (column) => [
      column.id,
      await countFor({ ...selectedDateValues, status: column.id }, { excludeClosedCurrent: false }),
    ])),
  ]);

  return {
    ...payload,
    businessUnitId,
    leadDateScope,
    leadDateFrom,
    leadDateTo,
    timeframeCounts: {
      all: allCount,
      current: currentCount,
      quarter: quarterCount,
      custom: customCount,
    },
    closedOutcomeCounts: Object.fromEntries(closedCounts),
  };
}
