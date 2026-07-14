'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ContactsPage from '@/app/contacts/page';
import PageState from '@/components/PageState';
import { useCRM } from '@/lib/store';
import { isClientAccountBusinessUnit } from '@/lib/crm/lifecycle';

export default function ClientsPage() {
  const router = useRouter();
  const { currentBusinessUnit, loaded } = useCRM();
  const canUseClientLanguage = isClientAccountBusinessUnit(currentBusinessUnit);

  useEffect(() => {
    if (loaded && !canUseClientLanguage) {
      router.replace('/contacts');
    }
  }, [canUseClientLanguage, loaded, router]);

  if (!loaded) {
    return <PageState tone="loading" title="Loading clients" copy="Checking whether this division uses client account language." />;
  }
  if (!canUseClientLanguage) {
    return <PageState tone="loading" title="Opening contacts" copy="This division uses the contacts workflow. Redirecting now." />;
  }

  return <ContactsPage mode="clients" />;
}
