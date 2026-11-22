export const DEMO_PASSWORD = 'demo1234';

export const LECTURER = { firstName: 'יעל', lastName: 'אברהם', email: 'lecturer@demo.test' };

export const COURSE_NAME = 'הנדסת תוכנה — קורס הדגמה';

/** 10 students on the roster; the first 7 already have accounts, the last 3 have not signed up yet. */
export const STUDENTS = [
  { firstName: 'דנה', lastName: 'כהן' },
  { firstName: 'רון', lastName: 'לוי' },
  { firstName: 'נועה', lastName: 'מזרחי' },
  { firstName: 'איתי', lastName: 'פרץ' },
  { firstName: 'מאיה', lastName: 'ביטון' },
  { firstName: 'עומר', lastName: 'דהן' },
  { firstName: 'שירה', lastName: 'אזולאי' },
  { firstName: 'יונתן', lastName: 'פרידמן' },
  { firstName: 'תמר', lastName: 'שפירא' },
  { firstName: 'אמיר', lastName: 'חדד' },
].map((s, i) => ({ ...s, email: `student${i + 1}@demo.test` }));

export const REGISTERED_COUNT = 7;
