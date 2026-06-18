'use client';

import { useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useCRM } from '@/lib/store';
import s from './SpanishAssist.module.css';

export const SPANISH_ASSIST_GLOSSARY = [
  ['New Lead', 'Nuevo posible estudiante o cliente. Aún necesita primer contacto.'],
  ['Follow Up', 'Seguimiento. Hay que llamar, escribir o revisar el próximo paso.'],
  ['Enrolled', 'Inscrito/a. La persona ya está activa en el curso o programa.'],
  ['Not Interested', 'No interesado/a. No quiere continuar por ahora.'],
  ['Course Completed', 'Curso completado. Ya terminó el curso o programa anterior.'],
  ['Do Not Contact', 'No contactar. No se debe llamar ni escribir a esta persona.'],
  ['Owner', 'Responsable interno de hacer seguimiento o manejar el registro.'],
  ['Archive', 'Quita el registro de las listas normales, pero conserva el historial.'],
];

export const SPANISH_ASSIST_HINTS = {
  contactsFilters: 'Filtros para encontrar contactos por estado, responsable, fecha o tipo de seguimiento.',
  contactSearch: 'Busca por nombre, teléfono, correo, estado u otra información visible del contacto.',
  status: 'Estado actual del contacto o lead dentro del proceso.',
  owner: 'Empleado responsable de dar seguimiento a este contacto o tarea.',
  division: 'Área o unidad del negocio a la que pertenece el registro.',
  source: 'Origen del contacto: web, Facebook, referido u otra fuente.',
  schoolLocation: 'Sucursal o ubicación de la escuela relacionada con el estudiante.',
  notes: 'Notas internas del equipo. No son mensajes enviados al cliente.',
  followUp: 'Registra qué pasó en el seguimiento y cuál es el próximo paso.',
  taskType: 'Tipo de trabajo pendiente: llamada, seguimiento, cita, pago u otro recordatorio.',
  taskDue: 'Fecha en que la tarea debe atenderse.',
  taskComplete: 'Completar una tarea de seguimiento requiere escribir una nota del resultado.',
  pipeline: 'Vista para organizar leads/contactos por etapa y decidir qué trabajar después.',
  pipelineMove: 'Mover cambia la etapa del contacto. Úsalo solo cuando el estado realmente cambió.',
  bulkAssign: 'Permite seleccionar varias tarjetas y asignarlas a un responsable.',
  archive: 'Archivar oculta el contacto de las vistas normales sin borrar su historial.',
  reopen: 'Usa esta razón cuando un contacto cerrado vuelve a estar activo o hubo un error.',
};

export function useSpanishAssist() {
  const { spanishAssist } = useCRM();
  return Boolean(spanishAssist);
}

export function SpanishHelpHint({ children, label = 'Spanish help', title }) {
  const enabled = useSpanishAssist();
  const [open, setOpen] = useState(false);
  if (!enabled || !children) return null;

  return (
    <span
      className={s.hint}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={s.hintButton}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <HelpCircle size={14} />
      </button>
      <span className={`${s.popover} ${open ? s.open : ''}`} role="tooltip">
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </span>
    </span>
  );
}

export function SpanishFieldHint({ children }) {
  const enabled = useSpanishAssist();
  if (!enabled || !children) return null;
  return <div className={s.fieldHint}>{children}</div>;
}

export function SpanishAssistCallout({ title = 'Spanish Assist', children }) {
  const enabled = useSpanishAssist();
  if (!enabled || !children) return null;
  return (
    <div className={s.callout}>
      <div className={s.calloutTitle}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

export function SpanishGlossary({ terms = SPANISH_ASSIST_GLOSSARY.slice(0, 6), title = 'Spanish quick glossary' }) {
  const enabled = useSpanishAssist();
  const rows = useMemo(() => terms.filter(Boolean), [terms]);
  if (!enabled || rows.length === 0) return null;
  return (
    <div className={s.glossary} aria-label={title}>
      <div className={s.glossaryTitle}>{title}</div>
      <div className={s.glossaryGrid}>
        {rows.map(([term, explanation]) => (
          <div key={term} className={s.glossaryItem}>
            <strong>{term}</strong>
            <span>{explanation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
