const RECOVERY_QUEUE_SQL = `
with latest_leads as (
  select distinct on (l.contact_id)
    l.id as lead_id,
    l.business_unit_id,
    l.contact_id,
    l.status as lead_status,
    coalesce(nullif(l.source_name, ''), nullif(l.source_type, ''), 'Unknown source') as lead_source,
    l.assigned_user_id,
    owner.name as assigned_user_name,
    l.created_at as lead_created_at,
    l.updated_at as lead_updated_at,
    c.name as contact_name,
    c.phone as contact_phone,
    c.email as contact_email,
    c.is_do_not_call,
    c.is_wrong_number
  from leads l
  join contacts c
    on c.id = l.contact_id
   and c.organization_id = l.organization_id
   and c.archived_at is null
  join business_units bu
    on bu.id = l.business_unit_id
   and bu.organization_id = l.organization_id
  left join users owner on owner.id = l.assigned_user_id
  where l.organization_id = $1
    and bu.name ~* 'ait\\s*usa'
    and ($3::uuid[] is null or l.business_unit_id = any($3::uuid[]))
  order by l.contact_id, l.updated_at desc nulls last, l.created_at desc, l.id desc
),
eligible_leads as (
  select *
  from latest_leads
  where lower(trim(lead_status)) in ('new', 'new lead', 'needs first outreach', 'follow up')
    and not is_do_not_call
    and not is_wrong_number
    and (nullif(trim(contact_phone), '') is not null or nullif(trim(contact_email), '') is not null)
    and ($2::uuid is null or assigned_user_id = $2::uuid)
    and ($4::boolean or assigned_user_id is not null)
),
all_active_tasks as (
  select
    t.id as task_id,
    t.business_unit_id,
    t.contact_id,
    t.lead_id,
    t.title as task_title,
    t.status as task_status,
    t.task_type,
    t.due_at as task_due_at,
    t.snoozed_until,
    t.owner_user_id as task_owner_user_id,
    task_owner.name as task_owner_user_name,
    t.created_at as task_created_at
  from tasks t
  join business_units bu
    on bu.id = t.business_unit_id
   and bu.organization_id = t.organization_id
  left join users task_owner on task_owner.id = t.owner_user_id
  where t.organization_id = $1
    and bu.name ~* 'ait\\s*usa'
    and ($3::uuid[] is null or t.business_unit_id = any($3::uuid[]))
    and lower(t.status) in ('open', 'in_progress', 'snoozed')
),
visible_tasks as (
  select * from all_active_tasks
  where ($2::uuid is null or task_owner_user_id = $2::uuid)
    and ($4::boolean or task_owner_user_id is not null)
),
human_touches as (
  select distinct a.contact_id
  from activity_events a
  join eligible_leads e on e.contact_id = a.contact_id
  where a.organization_id = $1
    and a.actor_user_id is not null
    and lower(coalesce(a.event_type, '')) ~ '(^follow_up\\.[a-z_]+$|manual.*outbound|(^|[._])(call|sms|whatsapp|message)([._]|$))'
),
primary_follow_ups as (
  select distinct on (contact_id)
    contact_id,
    task_id,
    task_title,
    task_status,
    task_due_at,
    task_owner_user_id,
    task_owner_user_name
  from visible_tasks
  where task_type = 'follow_up' and contact_id is not null
  order by contact_id, task_due_at asc nulls last, task_created_at asc, task_id
),
queue_rows as (
  select
    'first_contact'::text as lane,
    'first_contact:' || e.lead_id::text as item_key,
    'No employee outreach is recorded for this new Opportunity.'::text as reason,
    e.contact_id,
    e.contact_name,
    e.contact_phone,
    e.contact_email,
    e.lead_id,
    e.lead_status,
    e.lead_source,
    e.assigned_user_id,
    e.assigned_user_name,
    e.lead_created_at,
    pf.task_id,
    pf.task_title,
    pf.task_status,
    pf.task_due_at,
    pf.task_owner_user_id,
    pf.task_owner_user_name,
    greatest(0, floor(extract(epoch from (now() - e.lead_created_at)) / 86400))::int as age_days,
    case when e.lead_created_at < now() - interval '7 days' then 'high' else 'standard' end::text as urgency,
    1::int as urgency_rank,
    case when pf.task_id is null then 0 else 1 end::int as related_task_count
  from eligible_leads e
  left join human_touches ht on ht.contact_id = e.contact_id
  left join primary_follow_ups pf on pf.contact_id = e.contact_id
  where lower(trim(e.lead_status)) in ('new', 'new lead', 'needs first outreach')
    and ht.contact_id is null

  union all

  select
    'unassigned',
    'unassigned:' || e.lead_id::text,
    'This contactable Opportunity has no owner; a Senior Coordinator or administrator must assign it.',
    e.contact_id, e.contact_name, e.contact_phone, e.contact_email,
    e.lead_id, e.lead_status, e.lead_source, e.assigned_user_id, e.assigned_user_name, e.lead_created_at,
    pf.task_id, pf.task_title, pf.task_status, pf.task_due_at, pf.task_owner_user_id, pf.task_owner_user_name,
    greatest(0, floor(extract(epoch from (now() - e.lead_created_at)) / 86400))::int,
    case when e.lead_created_at < now() - interval '30 days' then 'high' else 'standard' end,
    2,
    case when pf.task_id is null then 0 else 1 end
  from eligible_leads e
  left join primary_follow_ups pf on pf.contact_id = e.contact_id
  where e.assigned_user_id is null
    and $4::boolean

  union all

  select
    'overdue',
    'overdue:' || vt.task_id::text,
    'This exact open commitment is past due.',
    c.id, c.name, c.phone, c.email,
    ll.lead_id, ll.lead_status, ll.lead_source, ll.assigned_user_id, ll.assigned_user_name, ll.lead_created_at,
    vt.task_id, vt.task_title, vt.task_status, vt.task_due_at, vt.task_owner_user_id, vt.task_owner_user_name,
    greatest(0, floor(extract(epoch from (now() - vt.task_due_at)) / 86400))::int,
    case
      when vt.task_due_at < now() - interval '30 days' then 'critical'
      when vt.task_due_at < now() - interval '7 days' then 'high'
      else 'standard'
    end,
    case
      when vt.task_due_at < now() - interval '30 days' then 4
      when vt.task_due_at < now() - interval '7 days' then 3
      else 2
    end,
    1
  from visible_tasks vt
  join contacts c
    on c.id = vt.contact_id
   and c.organization_id = $1
   and c.archived_at is null
  left join latest_leads ll on ll.contact_id = c.id
  where vt.task_due_at < now()
    and (vt.task_status <> 'snoozed' or vt.snoozed_until is null or vt.snoozed_until <= now())

  union all

  select
    'no_commitment',
    'no_commitment:' || e.lead_id::text,
    'This active Opportunity has no open task with a due date.',
    e.contact_id, e.contact_name, e.contact_phone, e.contact_email,
    e.lead_id, e.lead_status, e.lead_source, e.assigned_user_id, e.assigned_user_name, e.lead_created_at,
    null::uuid, null::text, null::text, null::timestamptz, null::uuid, null::text,
    greatest(0, floor(extract(epoch from (now() - e.lead_created_at)) / 86400))::int,
    case when e.lead_created_at < now() - interval '30 days' then 'high' else 'standard' end,
    2,
    0
  from eligible_leads e
  where not exists (
    select 1
    from all_active_tasks active_task
    where active_task.contact_id = e.contact_id
      and active_task.task_due_at is not null
  )

  union all

  select
    'duplicate_follow_up',
    'duplicate_follow_up:' || vt.contact_id::text,
    'This Contact has multiple open follow-up tasks. Review each exact task before completing or canceling anything.',
    c.id, c.name, c.phone, c.email,
    ll.lead_id, ll.lead_status, ll.lead_source, ll.assigned_user_id, ll.assigned_user_name, ll.lead_created_at,
    null::uuid, null::text, null::text, null::timestamptz, null::uuid, null::text,
    greatest(0, floor(extract(epoch from (now() - min(vt.task_created_at))) / 86400))::int,
    'high',
    3,
    count(*)::int
  from visible_tasks vt
  join contacts c
    on c.id = vt.contact_id
   and c.organization_id = $1
   and c.archived_at is null
  left join latest_leads ll on ll.contact_id = c.id
  where vt.task_type = 'follow_up'
    and vt.contact_id is not null
  group by
    vt.contact_id, c.id, c.name, c.phone, c.email,
    ll.lead_id, ll.lead_status, ll.lead_source, ll.assigned_user_id, ll.assigned_user_name, ll.lead_created_at
  having count(*) > 1
)
select
  coalesce(
    (
      select jsonb_object_agg(lane_counts.lane, lane_counts.total)
      from (
        select lane, count(*)::int as total
        from queue_rows
        group by lane
      ) lane_counts
    ),
    '{}'::jsonb
  ) as lane_counts,
  coalesce(
    (
      select jsonb_agg(to_jsonb(page_rows))
      from (
        select *
        from queue_rows
        where lane = $5
        order by
          urgency_rank desc,
          age_days desc,
          coalesce(task_due_at, lead_created_at) asc nulls last,
          item_key asc
        limit $6
        offset $7
      ) page_rows
    ),
    '[]'::jsonb
  ) as rows
`;

export async function loadRecoveryQueue(client, {
  organizationId,
  regularCoordinatorUserId = null,
  businessUnitIds = null,
  canViewUnassigned = false,
  lane = 'first_contact',
  page = 1,
  pageSize = 25,
} = {}) {
  if (!organizationId) throw new Error('organizationId is required');
  const scopedBusinessUnitIds = Array.isArray(businessUnitIds) ? businessUnitIds : null;
  if (scopedBusinessUnitIds && !scopedBusinessUnitIds.length) return { rows: [], counts: {} };
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 25));
  const result = await client.query(RECOVERY_QUEUE_SQL, [
    organizationId,
    regularCoordinatorUserId || null,
    scopedBusinessUnitIds,
    Boolean(canViewUnassigned),
    lane,
    safePageSize,
    (safePage - 1) * safePageSize,
  ]);
  return {
    rows: result.rows?.[0]?.rows || [],
    counts: result.rows?.[0]?.lane_counts || {},
  };
}

export { RECOVERY_QUEUE_SQL };
