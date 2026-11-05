import React from 'react'

export const PageLoadingFallback: React.FC = () => {
  return (
    <div className="page-loading-skeleton p-8 flex flex-col items-center justify-center min-h-[320px] gap-3 text-muted">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      <span className="text-sm font-medium">جارٍ تحميل محتوى الصفحة...</span>
    </div>
  )
}

