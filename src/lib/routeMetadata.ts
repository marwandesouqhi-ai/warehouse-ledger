/**
 * Centralized Route Metadata and Breadcrumb derivation.
 * Fulfills Issue #16: Derive topbar heading, document title, and breadcrumb from route metadata.
 */

export interface BreadcrumbItem {
  label: string
  to?: string
}

export interface RouteMeta {
  path: string
  title: string
  subtitle: string
  breadcrumbs: BreadcrumbItem[]
}

export const ROUTE_METADATA_MAP: Record<string, RouteMeta> = {
  '/': {
    path: '/',
    title: 'لوحة التحكم والمؤشرات',
    subtitle: 'نظرة عامة على حركة المخازن والتوريدات والعهد',
    breadcrumbs: [{ label: 'الرئيسية' }],
  },
  '/purchases': {
    path: '/purchases',
    title: 'المشتريات والتوريدات',
    subtitle: 'سجل حركات الشراء والتوريد ومتابعة الفواتير',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات والتوريدات' }],
  },
  '/purchases/suppliers': {
    path: '/purchases/suppliers',
    title: 'إدارة الموردين والشركات',
    subtitle: 'دليل الموردين المعتمدين وسجل التعاملات والتقييم',
    breadcrumbs: [
      { label: 'الرئيسية', to: '/' },
      { label: 'المشتريات والتوريدات', to: '/purchases' },
      { label: 'الموردين' },
    ],
  },
  '/purchases/quotes': {
    path: '/purchases/quotes',
    title: 'عروض الأسعار وأوامر الشراء',
    subtitle: 'مقارنة عروض الأسعار والبت المالي وإصدار أوامر التوريد',
    breadcrumbs: [
      { label: 'الرئيسية', to: '/' },
      { label: 'المشتريات والتوريدات', to: '/purchases' },
      { label: 'عروض الأسعار' },
    ],
  },
  '/purchases/contracts': {
    path: '/purchases/contracts',
    title: 'عقود الموردين والاتفاقيات',
    subtitle: 'سجل العقود الرسمية والشروط والمستندات المرفقة',
    breadcrumbs: [
      { label: 'الرئيسية', to: '/' },
      { label: 'المشتريات والتوريدات', to: '/purchases' },
      { label: 'عقود الموردين' },
    ],
  },
  '/custody': {
    path: '/custody',
    title: 'عهدة المخازن والكليات',
    subtitle: 'إدارة الأصناف والعهد الموزعة ومحاضر الصرف والتحويل',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'عهدة المخازن' }],
  },
  '/reports': {
    path: '/reports',
    title: 'التقارير وكشوف الجرد الرسمية',
    subtitle: 'إصدار استمارات المخازن المعتمدة وطباعة دفاتر العهدة',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التقارير وكشوف الجرد' }],
  },
  '/imports': {
    path: '/imports',
    title: 'استيراد البيانات من Excel',
    subtitle: 'إدراج فواتير وسجلات المخازن دفعة واحدة مع الفحص والتدقيق',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'استيراد البيانات' }],
  },
  '/quality': {
    path: '/quality',
    title: 'فحص الجودة وتدقيق البيانات',
    subtitle: 'رصد تناقضات الأرصدة والأسعار وتدقيق السجلات',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'فحص الجودة' }],
  },
  '/audit': {
    path: '/audit',
    title: 'سجل العمليات والرقابة الأمنية',
    subtitle: 'سجل التدقيق الرقمي لكافة حركات النظام والتعديلات',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'سجل العمليات والتدقيق' }],
  },
  '/users': {
    path: '/users',
    title: 'المستخدمون والصلاحيات',
    subtitle: 'إدارة حسابات الموظفين والهويات وتحديد الأدوار الإدارية',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المستخدمون والصلاحيات' }],
  },
  '/telegram-bot': {
    path: '/telegram-bot',
    title: 'إدارة بوت تيليجرام',
    subtitle: 'إعدادات ربط الإشعارات والمساعد التفاعلي عبر Telegram',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة بوت تيليجرام' }],
  },
  '/chatbot-admin': {
    path: '/chatbot-admin',
    title: 'إدارة المساعد الذكي',
    subtitle: 'توجيه وتحسين وتدريب نماذج المساعد الآلي للمخازن',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة المساعد الذكي' }],
  },
  '/settings': {
    path: '/settings',
    title: 'إعدادات المؤسسة والنظام',
    subtitle: 'تخصيص بيانات الجامعة أو المؤسسة والمظهر والمظهر الداكن',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إعدادات المؤسسة' }],
  },
  '/requests': {
    path: '/requests',
    title: 'طلبات الصرف الداخلي',
    subtitle: 'استقبال ومراجعة واعتماد طلبات صرف المستلزمات للكليات',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'طلبات الصرف' }],
  },
  '/notifications': {
    path: '/notifications',
    title: 'الإشعارات والتنبيهات',
    subtitle: 'سجل التنبيهات المباشرة والإشعارات الإدارية للمخزن',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الإشعارات والتنبيهات' }],
  },
  '/analytics': {
    path: '/analytics',
    title: 'تحليلات المخزون والعهد',
    subtitle: 'مؤشرات حركة المخزون ومعدلات الصرف وتوزيع العهد',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'تحليلات المخزون' }],
  },
  '/asset-history': {
    path: '/asset-history',
    title: 'سجل حركة الأصول والمعدات',
    subtitle: 'تتبع مسار الأجهزة الطبية والمكتبية ونقل العهد والصيانة',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'سجل حركة الأصول' }],
  },
  '/financial-reports': {
    path: '/financial-reports',
    title: 'التقارير المالية الدورية',
    subtitle: 'المطابقات المالية وإجمالي التوريدات والمصروفات',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التقارير المالية الدورية' }],
  },
  '/budget': {
    path: '/budget',
    title: 'الميزانية والتخطيط',
    subtitle: 'مخصصات الميزانية للأقسام والكليات ومتابعة المنصرف',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الميزانية والتخطيط' }],
  },
  '/support': {
    path: '/support',
    title: 'الدعم الفني والمساعدة',
    subtitle: 'التواصل مع الدعم الفني وتذاكر المساعدة ودليل الاستخدام',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الدعم الفني' }],
  },
}

/**
 * Returns the RouteMeta for a given pathname.
 * Handles subpaths cleanly by matching exact or prefix paths.
 */
export function getRouteMetadata(pathname: string): RouteMeta {
  const cleanPath = pathname.split('?')[0].split('#')[0]

  // Direct match
  if (ROUTE_METADATA_MAP[cleanPath]) {
    return ROUTE_METADATA_MAP[cleanPath]
  }

  // Prefix match (longest matching path first)
  const sortedKeys = Object.keys(ROUTE_METADATA_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (key !== '/' && cleanPath.startsWith(key)) {
      return ROUTE_METADATA_MAP[key]
    }
  }

  return {
    path: cleanPath,
    title: 'إدارة المخازن',
    subtitle: 'نظام إدارة العهد والمخازن',
    breadcrumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'صفحة غير معروفة' }],
  }
}

