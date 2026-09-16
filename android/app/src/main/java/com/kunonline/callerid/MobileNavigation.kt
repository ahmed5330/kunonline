package com.kunonline.callerid

enum class SectionGroup(val label: String) {
    MAIN("الرئيسية"),
    SALES("المبيعات والعملاء"),
    CATALOG("المنتجات والمخزون"),
    SHIPPING("الشحن وما بعد البيع"),
    MARKETING("التسويق والنمو"),
    FINANCE("المالية والتحليلات"),
    OPERATIONS("التشغيل والأتمتة"),
    ADMIN("الإدارة والإعدادات")
}

enum class AppSection(
    val label: String,
    val group: SectionGroup,
    val dataKey: String? = null
) {
    DASHBOARD("الداشبورد", SectionGroup.MAIN),
    INTELLIGENCE("مركز الذكاء", SectionGroup.MAIN),
    ONBOARDING("بدء الاستخدام", SectionGroup.MAIN),
    READINESS("جاهزية النظام", SectionGroup.MAIN),

    ORDERS("الطلبات", SectionGroup.SALES, "orders"),
    CUSTOMER_SERVICE("خدمة العملاء", SectionGroup.SALES, "orders"),
    CUSTOMERS("العملاء CRM", SectionGroup.SALES, "customers"),
    INBOX("صندوق الرسائل", SectionGroup.SALES, "conversations"),
    POS("نقطة البيع POS", SectionGroup.SALES, "posSales"),

    PRODUCTS("المنتجات", SectionGroup.CATALOG, "products"),
    INVENTORY("المخزون", SectionGroup.CATALOG, "products"),
    SUPPLIERS("الموردون", SectionGroup.CATALOG, "suppliers"),
    PROCUREMENT("المشتريات", SectionGroup.CATALOG, "purchaseOrders"),
    SUPPLIER_FINANCE("حسابات الموردين", SectionGroup.CATALOG, "supplierBalances"),

    SHIPPING("الشحن", SectionGroup.SHIPPING, "orders"),
    POST_SHIPPING("خدمات ما بعد الشحن", SectionGroup.SHIPPING, "orders"),
    RETURNS("المرتجعات والاستبدالات", SectionGroup.SHIPPING, "orders"),
    PRINTING("الطباعة", SectionGroup.SHIPPING, "orders"),
    COD("تسويات COD", SectionGroup.SHIPPING, "codReconciliation"),

    CAMPAIGNS("الحملات", SectionGroup.MARKETING, "campaigns"),
    MARKETING("التسويق", SectionGroup.MARKETING),
    AD_STUDIO("AI Ad Studio", SectionGroup.MARKETING),

    FINANCE("المالية", SectionGroup.FINANCE, "finance"),
    PROFIT("Profit Intelligence", SectionGroup.FINANCE, "profitIntelligence"),
    ANALYTICS("التحليلات", SectionGroup.FINANCE),
    WALLET("المحفظة", SectionGroup.FINANCE, "wallet"),

    AUTOMATION("الأتمتة", SectionGroup.OPERATIONS, "workflows"),
    AI("kun AI", SectionGroup.OPERATIONS, "aiInsights"),
    APPROVALS("مركز الموافقات", SectionGroup.OPERATIONS, "approvals"),
    OPS("مركز التشغيل", SectionGroup.OPERATIONS, "executionJobs"),
    AUDIT("سجل النشاط", SectionGroup.OPERATIONS, "auditLog"),

    STORES("المتاجر والفروع", SectionGroup.ADMIN, "stores"),
    STORE_ACCESS("صلاحيات الفروع", SectionGroup.ADMIN, "storeAccess"),
    INTEGRATIONS("مركز التكاملات", SectionGroup.ADMIN, "integrations"),
    TEAM("الفريق والصلاحيات", SectionGroup.ADMIN, "teamMembers"),
    ACCOUNT("الحساب والتكاملات", SectionGroup.ADMIN),
    SETTINGS("الإعدادات", SectionGroup.ADMIN)
}

val bottomSections = listOf(
    AppSection.DASHBOARD,
    AppSection.ORDERS,
    AppSection.CUSTOMER_SERVICE,
    AppSection.PRODUCTS
)
