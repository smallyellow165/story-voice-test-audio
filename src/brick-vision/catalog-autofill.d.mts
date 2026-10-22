export type AutofillResult = { status: 'none' | 'multiple' } | { status: 'filled'; part: string; color: string }
export function uniqueCatalogIdentity(result: unknown, colorId: number | null): AutofillResult
export function hasConfirmedIdentity(row: { confirmation: unknown; part: string; color: string }): boolean
