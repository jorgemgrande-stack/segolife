// Credenciales de las cuentas fixture COM-02 creadas SOLO en la BD local
// (Docker) vía scripts/_scratch-register-com02-fixtures.cjs +
// scripts/_scratch-seed-com02-local.cjs — nunca existen en producción.
export const PASSWORD = "Com02QaFixture!234";

export const ieA = { email: "com02-ie-a@segolife.local", password: PASSWORD, community: "ie", userId: 468 };
export const ieB = { email: "com02-ie-b@segolife.local", password: PASSWORD, community: "ie", userId: 469 };
export const uvaA = { email: "com02-uva-a@segolife.local", password: PASSWORD, community: "uva", userId: 470 };

export const admin = { email: "com02-admin-qa@segolife.local", password: "Com02AdminQa!234" };

export const proposalIds = {
  singleChoice: 25,
  yesNo: 26,
  percentageScale: 27,
  scale15: 28,
  multiselect: 29,
  ranking: 30,
  attendanceIntention: 31,
  meApunto: 32,
  openText: 33,
  uvaCrossCommunity: 34,
};
