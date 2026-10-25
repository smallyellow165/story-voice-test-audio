// Search hints only, never a Catalog identity or a Review confirmation.
// These stems cover singular/plural wording in the existing RB names. No IDs.
const motifs = [['eye','眼睛'],['mouth','嘴巴'],['face','脸部'],['number','数字']]
export function observationPrintHints(observation) {
  const evidence=observation?.evidence
  if(typeof evidence!=='string'||!evidence.trim())return []
  // Fail closed for negative/qualified statements. Other evidence fields and IDs
  // are deliberately not mined: a dimension/occlusion claim is not a print claim.
  if(/\b(no|not|without|uncertain|unknown|possibly|possible|maybe|might|could|hypothetical|unreadable)\b|(?:无法|可能|未知|没有|不确定)/i.test(evidence))return []
  return motifs.flatMap(([term,label])=>{
    const motif=term==='eye'?'eyes?':term==='mouth'?'mouths?':term==='face'?'faces?':'numbers?'
    const decoration='(?:print(?:ed)?|graphic|pattern|decoration|图案|印花)'
    const pattern=new RegExp(`(?:\\b${motif}\\b[^.!?;\\n]{0,48}${decoration}|${decoration}[^.!?;\\n]{0,48}\\b${motif}\\b)`,'i')
    return pattern.test(evidence)?[{term,label,sourcePath:'evidence',evidence,status:'ungraded-text',policy:'retrieval-only'}]:[]
  })
}
export function applyPrintHint(fields,hint) {
  // Preserve an explicit human no-print filter: expose the conflict, never undo it.
  return hint?{...fields,search:hint.term,printed:fields.printed==='unknown'?'yes':fields.printed}:fields
}
