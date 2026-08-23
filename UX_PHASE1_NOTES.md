# kun online — UX/System Upgrade

هذا الفرع مخصص للتطوير التجريبي بعيدًا عن `main`.

## تم تنفيذه حتى الآن
- App Shell وهوية UX أولية لـ kun online.
- Dashboard / Command Center.
- Orders v2 مع البحث والحالات وOrder drawer.
- Customer 360 وCRM.
- Products وInventory.
- Suppliers / Procurement foundation.
- Shipping dashboard.
- Finance + Profit Intelligence foundation.
- Marketing source analysis وAttribution roadmap.
- Executive Analytics.
- Automation architecture prototype.
- kun AI contextual insight layer.
- Help tooltips لتبسيط المصطلحات للمستخدمين المبتدئين.

## مبدأ UX
Data → Insight → Recommendation → Action → Automation → Result

## قواعد التنفيذ
- التطوير على `develop/ux-system-upgrade` فقط.
- لا يتم دمج `main` قبل اختبار النسخة التجريبية.
- نستخدم الـAPIs الحالية قدر الإمكان بدل إعادة بناء النظام من الصفر.
- أي Action مالي أو حساس مستقبلًا يحتاج Permission + Confirmation + Audit Log.

## التالي
1. Purchase Orders + Receiving.
2. Shipping provider abstraction وCOD reconciliation.
3. Finance drill-down وربح الطلب/المنتج/القناة.
4. Marketing integrations وAttribution.
5. Workflow engine فعلي.
6. kun AI متعدد المستأجرين بصلاحيات واضحة.
7. Team roles / granular permissions / audit log.
