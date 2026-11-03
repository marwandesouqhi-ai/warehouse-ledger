import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="card-surface" dir="rtl">
      <h2>الصفحة غير موجودة</h2>
      <p>تحقق من الرابط أو عُد إلى الصفحة الرئيسية.</p>
      <Link className="primary-btn" to="/">العودة إلى الرئيسية</Link>
    </section>
  )
}
