import { filterContactsByDirectoryFacet } from '../contact-directory-facets.js';
import { isCurrentLeadDateScope } from '../contact-directory-view.js';
import { buildBusinessMovement } from '../team-monitor.js';

function serializeBusinessMovement(movement) {
  return {
    byEmployee: Object.fromEntries(movement.byEmployee.entries()),
    totals: movement.totals,
  };
}

export function summarizeAitUsaDashboardContacts({
  mappedContacts = [],
  currentUserId = '',
  employeeIds = [],
  includeBusinessMovement = false,
  now = new Date(),
} = {}) {
  const currentContacts = mappedContacts.filter((contact) => isCurrentLeadDateScope(contact, now));
  const facetOptions = { currentUserId, now };

  return {
    kpis: {
      activeContacts: currentContacts.length,
      newLeads: mappedContacts.filter((contact) => contact.status === 'New Lead').length,
      myPipeline: currentContacts.filter((contact) => contact.assignedTo === currentUserId).length,
      needsFirstOutreach: currentContacts.filter((contact) => contact.needsFirstOutreach).length,
      usaNewLeads: filterContactsByDirectoryFacet(currentContacts, 'usa_new_lead', facetOptions).length,
      usaFollowUp: filterContactsByDirectoryFacet(currentContacts, 'usa_follow_up', facetOptions).length,
      usaBadContactChannel: filterContactsByDirectoryFacet(currentContacts, 'usa_bad_contact_channel', facetOptions).length,
    },
    websiteLeads: mappedContacts.filter((contact) => /website|web|wix/i.test(`${contact.source || ''} ${contact.sourceLabel || ''}`)).length,
    businessMovement: includeBusinessMovement
      ? serializeBusinessMovement(buildBusinessMovement({ contacts: mappedContacts, employeeIds, now }))
      : null,
  };
}
