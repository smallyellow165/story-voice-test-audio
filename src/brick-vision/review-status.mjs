// Presentation only: callers supply their existing authoritative confirmation predicate.
export const reviewStatusLabels = { unconfirmed: '待确认', confirmed: '已确认', excluded: '已排除' }
export function reviewStatus(excluded, confirmed) { return excluded ? 'excluded' : confirmed ? 'confirmed' : 'unconfirmed' }
export function matchesReviewFilter(filter, status) { return filter === 'all' || filter === status }
