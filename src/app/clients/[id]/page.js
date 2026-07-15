'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ContactDetailPage from '@/app/contacts/[id]/page';
import PageState from '@/components/PageState';
import { useCRM } from '@/lib/store';
import { isClientAccountBusinessUnit } from '@/lib/crm/lifecycle';

export default function ClientDetailPage() {
  const router = useRouter();
  const { currentBusinessUnit, loaded } = useCRM();
  const canUseClientLanguage = isClientAccountBusinessUnit(currentBusinessUnit);

  useEffect(() => {
    if (loaded && !canUseClientLanguage) {
      router.replace('/contacts');
    }
  }, [canUseClientLanguage, loaded, router]);

  if (!loaded) {
    return <PageState tone="loading" title="Loading client" copy="Checking whether this division uses client account language." />;
  }
  if (!canUseClientLanguage) {
    return <PageState tone="loading" title="Opening contact profile" copy="This division uses the contacts workflow. Redirecting now." />;
  }

  return <ContactDetailPage mode="clients" />;
}
