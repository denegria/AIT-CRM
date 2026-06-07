# MIS-124 AIT Signs Client Account Layer

## Decision

AIT Signs should move to an accounts-first model, but the migration should be
additive and division-scoped. AIT USA Institute should remain contacts/leads-first
until its workflows need a real account layer.

The first implementation should not rename the current `contacts` table or move
all operational records in one pass. Current production behavior is contact-linked:
leads, work orders, estimates, payments, notes, tasks, activity, and conversations
all still depend on `contact_id`. The account layer should sit above that model,
provide account rollups for AIT Signs, and let existing contact detail routes keep
working during migration.

## Product Problem

AIT Signs customers are often businesses with multiple people, phone numbers,
locations, aliases, workbook spellings, and long work history. A single contact row
cannot cleanly represent that shape.

The cleanup work in MIS-97 and MIS-125 fixed many bad rows, but it also exposed a
new rule: the CRM must preserve source/provenance evidence without turning old
typos back into employee-facing customer names.

## Scope Boundaries

In scope:

- AIT Signs client/account identity and rollup model.
- Account aliases/provenance with visibility and search controls.
- People/contact methods under an account.
- Locations/sites under an account.
- Search behavior across canonical account names, aliases, people, phones,
  locations, and work history.
- Migration rules from current AIT Signs contact rows to accounts.
- Compatibility rules for current contact-linked operational records.

Out of scope for the first account layer:

- Changing AIT USA Institute lead workflows.
- Replacing all current `contact_id` foreign keys in one migration.
- Blindly re-merging no-phone or fake-phone duplicate candidates.
- Showing every historical misspelling as a normal visible alias.
- Building a franchise/parent-company layer unless a concrete account group needs
  it later.

## Proposed Data Model

### `client_accounts`

Canonical customer/business record for AIT Signs.

- `id`
- `organization_id`
- `business_unit_id`
- `display_name`
- `normalized_name`
- `status`
- `tags`
- `primary_contact_method_id`
- `primary_person_id`
- `primary_location_id`
- `metadata_json`
- `created_at`
- `updated_at`

Rules:

- First release should restrict account creation to AIT Signs business units.
- `display_name` should be the cleaned, employee-facing name, not a raw workbook
  value.
- Rollup counts can initially be derived from linked contacts and later
  denormalized if needed.

### `client_account_aliases`

Searchable names and source/provenance variants for an account.

- `id`
- `client_account_id`
- `value`
- `normalized_value`
- `type`
- `visibility`
- `searchable`
- `source_label`
- `source_sheet`
- `source_row`
- `confidence`
- `verified_by_user_id`
- `verified_at`
- `metadata_json`
- `created_at`
- `updated_at`

Recommended `type` values:

- `display_alias`: useful employee-facing alternate name, DBA, abbreviation, or
  common business label.
- `former_name`: prior legitimate name.
- `source_alias`: source/workbook name that should be searchable but not
  prominent.
- `misspelling`: known typo or cleaned spelling variant.
- `contact_person_hint`: source text that is probably a person, not the account.
- `location_hint`: source text that indicates a branch/site/location.

Recommended `visibility` values:

- `visible`: shown in normal account UI.
- `collapsed`: visible behind an "other source names" or "source context" affordance.
- `hidden`: searchable/auditable, but not normally shown to employees.

Important rule:

Do not re-add cleaned misspellings as normal visible variants. Historical typos
should default to `type = misspelling`, `visibility = hidden`, and
`searchable = true` only when they help users find the cleaned account. Visible
aliases should be human-promoted.

### `client_people`

People known under an account.

- `id`
- `client_account_id`
- `name`
- `role`
- `notes`
- `is_primary`
- `source_label`
- `source_sheet`
- `source_row`
- `metadata_json`
- `created_at`
- `updated_at`

People should represent real people or strong person hints. Do not turn every
workbook name token into a person without evidence.

### `client_contact_methods`

Phones, emails, WhatsApp numbers, and other contact methods for an account or
person.

- `id`
- `client_account_id`
- `client_person_id`
- `method_type`
- `value`
- `normalized_value`
- `label`
- `status`
- `is_primary`
- `source_label`
- `source_sheet`
- `source_row`
- `metadata_json`
- `created_at`
- `updated_at`

Recommended `status` values:

- `active`
- `do_not_call`
- `wrong_number`
- `historical`
- `unverified`

### `client_locations`

Locations, branches, sites, or delivery/install contexts under an account.

- `id`
- `client_account_id`
- `label`
- `address`
- `city`
- `state`
- `postal_code`
- `is_primary`
- `source_label`
- `source_sheet`
- `source_row`
- `metadata_json`
- `created_at`
- `updated_at`

Locations should be used for Plainfield/Bound Brook-style context when the source
indicates the same customer has meaningful site differences.

### Compatibility Linkage

First implementation options, in preferred order:

1. Add nullable `client_account_id` to `contacts` for the current compatibility
   bridge.
2. If multiple account/contact relationships become necessary, use a
   `client_account_contacts` link table instead.
3. Add nullable `client_account_id` to work orders, estimates, payments, tasks,
   notes, activity, and conversations only after account rollups are proven and a
   dry-run shows no link loss.

Routes/actions should continue to authorize by organization and business unit.
Services can provide account lookup and rollup mechanics, but routes should own
permission and state-transition decisions.

## Search Behavior

AIT Signs search should return account-first results.

Search inputs should match:

- Canonical account display name.
- Visible aliases.
- Collapsed or hidden source/provenance aliases.
- People names.
- Normalized phone numbers and emails.
- Location labels/cities.
- Work order or estimate numbers when available.

Search output should show match reasons without promoting bad source values:

- "Matched account name"
- "Matched visible alias"
- "Matched historical source name"
- "Matched person"
- "Matched phone"
- "Matched location"
- "Matched work order"

Hidden misspellings can match search, but the result title must remain the cleaned
account name. The UI should not make old typos look current again.

For all-division search, use a deliberately minimal cross-division directory or
force explicit division selection. Do not render AIT USA and AIT Signs in one full
Contacts table with division-specific columns.

## UI Direction

### Contacts Directory

When AIT Signs is selected, the directory should become account-oriented:

- Primary row title: account display name.
- Secondary context: primary person or best contact method.
- Operational summary: active work, estimate, payment/balance, last touch.
- Signals: missing primary phone, invalid phone, hidden source aliases on file,
  multiple people, multiple locations, active work, balance/payment.
- Division label: AIT Signs.

When AIT USA Institute is selected, keep the current contact/lead-oriented view:

- Lead/contact name.
- enrollment/follow-up/contactability signals.
- assigned owner.
- lead status and next action.

### Account Detail

Add an AIT Signs account workspace when the account model exists:

- Header: account display name, primary contact method, status, tags.
- People panel.
- Contact methods panel.
- Locations panel.
- Work/estimate/payment rollup.
- Timeline across linked contacts and operational records.
- Source/provenance panel with collapsed historical names and misspellings.
- Alias management for employees with permission.

Alias management should support:

- Add visible alias.
- Promote a source alias to visible.
- Demote a visible alias to collapsed/hidden.
- Mark a source value as not useful.
- Preserve audit trail for changes.

## Import And Promotion Rules

Strong same-account evidence:

- Same normalized real phone.
- Same business name plus matching work-order/source context.
- Same work order or estimate lineage.
- Human-approved prior merge/provenance.

Review-required evidence:

- Same or similar name with no phone.
- Same phone but workbook/source context indicates different customer/person.
- Generic business words only, such as restaurant, landscaping, roofing, iglesia.
- One row appears to be a person while another is a business.
- Location text suggests branches rather than duplicates.

Never auto-merge on:

- No-phone markers.
- Fake/date-derived phone tails.
- Overlong digit strings produced by multi-number cells.
- Placeholder names.
- Generic source headings.
- Typos alone without phone/workbook support.

Import behavior:

- Promote clean canonical account names conservatively.
- Store raw source names as source aliases/provenance, not as visible aliases.
- Parse multiple valid phone chunks from source cells.
- Preserve source sheet/row on aliases, people, contact methods, locations, and
  events when known.
- Route ambiguous identity cases to review rather than forcing an account.

## Migration Strategy

### Phase 0: Contacts Scope Stabilization

Make `/contacts` boot into a stable explicit division scope. This prevents the
old combined-divisions table from flashing or becoming the default after login.

### Phase 1: Schema Add

Add account, alias, people, contact-method, and location tables. Keep existing
contact-linked records untouched.

### Phase 2: One-To-One Account Backfill

Create one `client_account` per current AIT Signs contact.

- `display_name` from cleaned current contact name.
- Link the current contact to the account.
- Copy primary phone/email/address into contact methods/locations when clean.
- Do not merge accounts in this phase.

Validation:

- AIT Signs contact count equals initial account count.
- Every AIT Signs contact has exactly one account link.
- AIT USA contacts remain unchanged.

### Phase 3: Provenance Backfill

Parse MIS-97/MIS-125 cleanup notes and import source context into
`client_account_aliases`, `client_people`, and `client_locations`.

Defaults:

- Cleanup misspellings -> hidden searchable misspelling aliases.
- Workbook/source names -> collapsed or hidden source aliases.
- Real person names -> people when evidence is strong.
- Location names -> locations or location hints.

Validation:

- Hidden/collapsed aliases are searchable.
- Hidden misspellings are not displayed as normal account names.
- Existing cleanup/audit notes remain intact.

### Phase 4: Reviewed Account Consolidation

Generate a dry-run report for candidate account consolidations. Apply only after
approval.

Dry-run must list:

- Source account.
- Target account.
- Evidence class.
- Contacts linked.
- Operational rows affected.
- Aliases/people/contact methods/locations that would move or be created.
- Rollback/export packet.

### Phase 5: Account Rollups And Direct Links

After account views prove useful, add direct `client_account_id` links to
operational tables where needed for performance and reporting. Backfill through a
dry-run/apply process and keep contact links for compatibility.

## Example Walkthroughs

### Blue Mountain

Target:

- Account: `BLUE MOUNTAIN`
- Visible aliases: only useful human-promoted business labels, if any.
- Hidden searchable misspellings/source aliases: `BLEU MOUNTAIN`,
  `BLUE MONTAIN`, `BLUE MONTAINE`, `BLUE MONTANI`, and similar cleaned source
  variants.
- People/context: Mark or Mark Carrillo only if source evidence supports person
  context.
- Separate account: `BLUE OCEAN POOL LLC`.

UI behavior:

- Search for an old typo can still find `BLUE MOUNTAIN`.
- Result title stays `BLUE MOUNTAIN`.
- Match reason can say "matched historical source name."
- Employee-facing UI does not reintroduce typo variants as normal customer names.

### G&R Tree Service vs RG Tree Service

Target:

- Account: `G&R TREE SERVICE`.
- Collapsed/source aliases: `GR TREE SERVICE`, `G & R FREE SERVICE`,
  `GR TREEE SERVICE`.
- People/context: Gerard/Gerardo/Geraldo as person/source hints if supported.
- Contact methods: phone tails 2509 and 4942 as account/contact methods.
- Separate account: `RG TREE SERVICE` with Raul Garcia and phone tail 4057.

Decision rule:

RG stays separate because workbook/phone/person evidence conflicts with the G&R
cluster. The model should make that separation easy instead of encouraging another
flat merge.

### World Supermarket / World Market

Target:

- Account: likely `WORLD SUPERMARKET`, pending human confirmation for any visible
  DBA/name aliases.
- People: Sra Edy, Rudy/Ruddy, Felix/Rudy, Don Jesus/Mr Jesus, Gloria as
  person/source context where evidence supports it.
- Locations: Plainfield and Bound Brook as location/site context, not just name
  suffixes.
- Source aliases: World Market, World Supermaarket, World Supermartket, Bound
  Brook variants, and other workbook/source names should default to collapsed or
  hidden provenance until promoted.

UI behavior:

- The account page should show that multiple people/locations exist.
- The search experience should still find the account through old names or
  locations.
- The normal customer profile should not become a long list of typos.

## Acceptance Criteria For MIS-124

- Schema proposal defines account, alias/provenance, people, contact methods,
  locations, and compatibility linkage.
- API proposal separates AIT Signs account search from AIT USA lead/contact search.
- UI proposal explains AIT Signs account directory/detail behavior and preserves
  AIT USA workflows.
- Search rules include aliases, hidden provenance, people, phones, locations, and
  work history with match reasons.
- Import rules prevent fake/no-phone/date-derived merges.
- Migration plan is dry-run gated and preserves audit/provenance.
- Blue Mountain, G&R/RG Tree Service, and World Supermarket examples are covered.

## Recommended Follow-Up Implementation Issues

- Contacts scope/default stabilization.
- Account schema and compatibility links.
- AIT Signs account search/read model.
- Account detail workspace.
- Provenance/alias backfill dry-run.
- Reviewed consolidation dry-run and approval-gated apply.
