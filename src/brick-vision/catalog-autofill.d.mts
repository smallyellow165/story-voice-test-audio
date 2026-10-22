export type AutofillResult = { status: 'none' | 'multiple' } | { status: 'filled'; part: string; color: string }
export function uniqueCatalogIdentity(result: unknown, colorId: number | null): AutofillResult
export function hasConfirmedIdentity(row: { part: string; color: string }): boolean
export function completeCatalogIdentity(row: { part: string; color: string }, identity: { part: string; color: string }): { part: string; color: string }
