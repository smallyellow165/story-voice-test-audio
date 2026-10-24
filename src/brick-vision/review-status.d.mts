export type ReviewStatus = 'unconfirmed' | 'confirmed' | 'excluded'
export const reviewStatusLabels: Record<ReviewStatus, string>
export function reviewStatus(excluded: boolean | undefined, confirmed: boolean): ReviewStatus
export function matchesReviewFilter(filter: 'all' | ReviewStatus, status: ReviewStatus): boolean
