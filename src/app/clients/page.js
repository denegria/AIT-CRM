'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ContactsPage from '@/app/contacts/page';
import { useCRM } from '@/lib/store';

function isClientWorkflowScope(unit) {
  return unit?.name === 'AIT Signs';
}

export default function ClientsPage() {
  const router = useRouter();
  const { currentBusinessUnit, loaded } = useCRM();
  const canUseClientLanguage = isClientWorkflowScope(currentBusinessUnit);

  useEffect(() => {
    if (loaded && !canUseClientLanguage) {
      router.replace('/contacts');
    }
  }, [canUseClientLanguage, loaded, router]);

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (!canUseClientLanguage) {
    return <div className="empty-state">Opening contacts...</div>;
  }

  return <ContactsPage mode="clients" />;
}
