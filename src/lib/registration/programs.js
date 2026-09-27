// Public course codes are an explicit contract with the AIT USA site. Do not
// accept arbitrary browser-supplied course names as billable programs.
export const REGISTRATION_PROGRAMS = Object.freeze({
  english_program: Object.freeze({ code: 'english_program', courseName: 'English Program', usOnly: false, modalities: ['in_person', 'hybrid', 'online'] }),
  'espanol-extranjeros': Object.freeze({ code: 'espanol-extranjeros', courseName: 'Español para extranjeros', usOnly: true, modalities: ['in_person'] }),
  ged: Object.freeze({ code: 'ged', courseName: 'GED', usOnly: true, modalities: ['in_person'] }),
  'tutorias-matematicas': Object.freeze({ code: 'tutorias-matematicas', courseName: 'Tutorías en matemáticas', usOnly: true, modalities: ['in_person'] }),
  'computacion-basica': Object.freeze({ code: 'computacion-basica', courseName: 'Computación básica', usOnly: true, modalities: ['in_person'] }),
  'computacion-oficina': Object.freeze({ code: 'computacion-oficina', courseName: 'Computación para oficina', usOnly: true, modalities: ['in_person'] }),
});
