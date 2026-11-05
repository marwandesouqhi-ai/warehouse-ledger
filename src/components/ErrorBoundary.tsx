import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled page error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="error-boundary-card card-surface p-6 m-4 text-center rounded-xl border border-red-200 bg-red-50/40">
          <div className="inline-flex p-3 bg-red-100 text-red-700 rounded-full mb-3">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-lg font-bold text-ink mb-1">تعذر تحميل جزء من الصفحة</h3>
          <p className="text-sm text-muted mb-4 max-w-md mx-auto">
            {this.state.error?.message || 'حدث خطأ غير متوقع أثناء عرض هذه الواجهة. يمكنك إعادة المحاولة.'}
          </p>
          <button
            type="button"
            className="primary-btn inline-flex items-center gap-2"
            onClick={this.handleReset}
          >
            <RotateCcw size={16} /> إعادة تحميل الواجهة
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
