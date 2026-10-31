/** Authentication roles shared by both applications. */
export const Role = { ADMIN: 'ADMIN', STAFF: 'STAFF', CUSTOMER: 'CUSTOMER' } as const;
export type Role = typeof Role[keyof typeof Role];
