import type { HTMLAttributes } from 'react'
const icon=(text:string)=>(props:HTMLAttributes<HTMLSpanElement>)=><span {...props} aria-hidden="true">{text}</span>
export const Camera=icon('◉'), Sparkles=icon('✦'), AlertCircle=icon('!'), CheckCircle=icon('✓'), AlertTriangle=icon('⚠'), Plus=icon('+'), ChevronLeft=icon('←'), ChevronRight=icon('→'), Trash2=icon('×'), Eye=icon('◎'), Video=icon('▸'), X=icon('×'), Package=icon('▣'), Zap=icon('ϟ'), MessageSquare=icon('…'), Settings2=icon('⋮')
