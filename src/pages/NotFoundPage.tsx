import { NavLink } from 'react-router-dom'
import { FileQuestion, ArrowRight } from 'lucide-react'

export function NotFoundPage() {
  return (
    <section className="page-stack">
      <header className="page-intro">
        <div className="page-intro-icon modal-icon-accent">
          <FileQuestion size={22} />
        </div>
        <div>
          <p className="eyebrow text-accent">خطأ 404</p>
          <h2>الصفحة غير موجودة</h2>
          <p>المسار المطلوب غير موجود في النظام</p>
        </div>
      </header>

      <div className="card-surface restricted-screen-card text-center py-12 px-6">
        <div className="modal-title-icon modal-icon-accent restricted-icon-box mx-auto mb-4">
          <FileQuestion size={36} />
        </div>
        <h3 className="text-xl mb-2 font-bold text-ink">عذراً، الصفحة المطلوبة غير متوفرة</h3>
        <p className="text-muted font-sm leading-normal max-w-md mx-auto mb-6">
          الصفحة أو الرابط الذي تحاول الوصول إليه غير موجود في سجل المخازن، أو ربما تم تغيير مساره أو حذفه.
        </p>
        <NavLink to="/" className="primary-btn inline-flex items-center gap-2 mx-auto">
          <span>العودة إلى لوحة التحكم الرئيسية</span>
          <ArrowRight size={16} />
        </NavLink>
      </div>
    </section>
  )
}

export default NotFoundPage
