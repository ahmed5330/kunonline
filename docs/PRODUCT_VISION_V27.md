# Kun Online v27 — Product Source of Truth

## المنتج
Kun Online هو Commerce Operating System لأصحاب المتاجر الإلكترونية، وليس مجرد CRM أو ERP منفصل. الهدف أن تكون العمليات، التواصل، المخزون، المالية، التسويق، الإعلانات، الشحن، الفريق والذكاء الاصطناعي في Data/Workflow واحد.

## الواجهتان
### 1) Client Workspace
واجهة صاحب المتجر وفريقه. تشمل Dashboard، Orders، CRM، Unified Inbox، Catalog، Inventory، Suppliers/Procurement، Shipping/COD، Finance/Profit، Campaigns/Marketing، Ad Studio، Automation/Approvals، Kun AI، Integrations، Team/Permissions، Wallet وAudit.

### 2) Kun Admin Control Center
واجهة إدارة المنصة. تعرض كل عميل، حجم الطلبات وGMV، الفريق والمتاجر، التكاملات، الرصيد، طلبات شحن الرصيد، الوحدات المفعلة، رسوم الأوردر، التحديات والملاحظات. الإدارة هي التي تتحكم في Tenant Feature Entitlements؛ صاحب المتجر يتحكم بعد ذلك في صلاحيات فريقه داخل الوحدات المتاحة له.

## Order Engine
الأوردر هو المحور المركزي. الحالات الحالية المتوافقة مع النظام: pending → confirmed → preparing → shipped → signed → collected، إضافة إلى deferred / returned / cancelled. كل تعديل مهم يجب أن يترك Audit/Event قابلًا للتتبع، وليس استبدال التاريخ السابق. v27 يضيف Default Stage Routing: خدمة العملاء → التنفيذ → المخزن → الشحن → متابعة التحصيل → المالية، مع مسارات للمرتجعات/الإلغاء/التأجيل.

كل Order Command Center يجب أن يحتوي على:
- تغيير الحالة.
- WhatsApp.
- اتصال هاتفي.
- ملاحظات داخلية.
- AWB/Shipping data من النظام الحالي.
- Timeline لكل حركة: ماذا حدث، متى، ومن قام به، ومصدر الحدث.

## Unified Communications
طبقة المحادثات تجمع WhatsApp Business، Facebook Messenger، Instagram Messaging وTikTok Messaging عند تفعيل API الفعلي لكل مزود. الهوية متعددة القنوات ترتبط بـCustomer 360، ويمكن تحويل المحادثة إلى Order داخل نفس Tenant/Store.

## Finance & Profit
المالية مرتبطة بالطلبات والموردين وCOD والمخزون والإعلانات. الهدف النهائي هو حساب الربحية من مستوى الشركة إلى Store → Channel → Campaign → Product → Order.

## Marketing Intelligence
لا يعتمد Kun Online على Purchase count الذي ترسله منصة الإعلان فقط. Order Attribution يربط الطلبات التي دخلت من الموقع أو WhatsApp/Messenger وغيرها بالحملة عندما تتوافر attribution keys. مؤشرات v27 تشمل Spend, Impressions, Reach, CPM, CTR, CPC, Leads, Platform Purchases, Real Orders, Confirmed Orders, Delivered Orders, Platform CPP, Real Order Cost, Confirmed Order Cost, Delivered Order Cost, CAC, Delivered Revenue, Real ROAS, Cancellation Rate وReturn Rate.

## AI Ad Studio
العميل يضع Product brief: المنتج، المواصفات، العرض، الجمهور، الزوايا، Reviews/FAQ وCreative asset metadata. AI يولد Angles/Hooks/Copy/Campaign plan. أي Action يؤثر على حساب إعلاني يمر Approval → Execution Queue. Meta Ads لديه adapter للتعامل مع campaign create/pause/resume/budget عندما يكون الاتصال الحقيقي Connected. Google/TikTok write execution يبقى Fail-closed حتى OAuth/API activation للحساب بدل إظهار نجاح وهمي.

## Kun AI Intelligence
الـAI ليس Chatbot منفصلًا. Business Brief يجمع Marketing + Orders + Finance + Inventory + Wallet ويعطي Recommendations. إذا لم يوجد OpenAI API key، يستمر Rule Engine بدون تعطيل المنصة. إذا وجد المفتاح، يتم enrichment server-side ولا يرسل أي integration secret إلى النموذج أو المتصفح.

## Wallet / Billing
- العميل يرسل Amount + sender phone + transfer method + proof screenshot.
- الطلب يصبح Pending ولا يغير الرصيد.
- Kun Admin يعتمد أو يرفض.
- الاعتماد يضيف الرصيد مرة واحدة باستخدام Idempotency.
- كل Order جديد بعد تفعيل Billing v27 يخصم رسومًا محسوبة من Base Fee + رسوم الوحدات المفعلة، مع Min/Max افتراضي 2–5 EGP.
- لا يوجد خصم بأثر رجعي على الطلبات التاريخية عند الانتقال من Legacy إلى v27.
- لا يسمح الـledger بتكرار خصم نفس Order أو اعتماد نفس Top-up مرتين.
- عند عدم كفاية الرصيد، المعاملة تتراجع بالكامل ويصبح Order Billing pending_insufficient بدل إنشاء رصيد خاطئ.

## Security model
1. Tenant isolation.
2. Store isolation.
3. Tenant Feature Entitlements.
4. User/Role permissions.
5. Human Approval للإجراءات الحساسة.
6. Audit trail.
7. Encrypted integration secrets.
8. External integrations fail closed عندما لا يكون الحساب Connected فعليًا.

## External activation boundary
وجود Provider في Registry أو إدخال Fake credentials لا يعني اتصالًا حقيقيًا. WhatsApp/Meta/Google/TikTok/Shipping providers تحتاج OAuth/API credentials/webhooks/vendor permissions الخاصة بحساب العميل. لا يتم وضع أي Secret في GitHub.
