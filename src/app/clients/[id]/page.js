'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ContactDetailPage from '@/app/contacts/[id]/page';
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

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (!canUseClientLanguage) {
    return <div className="empty-state">Opening contacts...</div>;
  }

  return <ContactDetailPage mode="clients" />;
}
