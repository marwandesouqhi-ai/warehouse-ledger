import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import NotFoundPage from '../../src/pages/NotFoundPage'

describe('NotFoundPage (Issue #8)', () => {
  it('renders 404 page title and return button', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    expect(screen.getByText('الصفحة غير موجودة')).toBeDefined()
    expect(screen.getByText('خطأ 404')).toBeDefined()
    expect(screen.getByText('العودة إلى لوحة التحكم الرئيسية')).toBeDefined()
  })
})
