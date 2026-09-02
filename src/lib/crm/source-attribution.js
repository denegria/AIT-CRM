export const FACEBOOK_LEAD_ADS_SOURCE_LABEL = 'Facebook Lead Ads';
export const FACEBOOK_MESSENGER_SOURCE_LABEL = 'Facebook Messenger';
export const FACEBOOK_LEAD_ADS_DETAIL_LABEL = 'Lead form ad';

function clean(value = '') {
  return String(value || '').trim();
}

function normalized(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function canonicalLeadSourceChannel({ sourceName = '', sourceType = '', sourceKey = '' } = {}) {
  const values = [sourceName, sourceType, sourceKey].map(clean).filter(Boolean);
  const source = normalized(values.join(' '));
  if (
    source.includes('facebook lead ads') ||
    source.includes('facebook ads') ||
    source.includes('facebook lead') ||
    source.includes('leadgen')
  ) return FACEBOOK_LEAD_ADS_SOURCE_LABEL;
  if (source.includes('facebook messenger') || source.includes('messenger')) {
    return FACEBOOK_MESSENGER_SOURCE_LABEL;
  }
  if (source.includes('facebook webhook')) return FACEBOOK_LEAD_ADS_SOURCE_LABEL;
  if (source.includes('wix historical') || source.includes('wix history')) return 'Wix Historical Import';
  if (source.includes('wix')) return 'Wix Website Form';
  if (source.includes('wordpress')) return 'WordPress Website Form';
  if (source.includes('website')) return 'Website Form';
  return values[0] || '';
}

export function leadSourceDetail(channel = '') {
  return channel === FACEBOOK_LEAD_ADS_SOURCE_LABEL ? FACEBOOK_LEAD_ADS_DETAIL_LABEL : '';
}
