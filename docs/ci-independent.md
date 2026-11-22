# CI خارج GitHub Actions
التشغيل من Linux أو WSL مع Node 24.15+ وPython وGit. هذا مسار تحقق مستقل عن حصة GitHub Actions؛ يحتاج اتصال npm وGitHub، ولا يعمل تلقائيًا لمجرد وجود الملفات.

```sh
git clone https://github.com/ahmed5330/kunonline.git
cd kunonline
node scripts/ci/verify.mjs quick
node scripts/ci/verify.mjs full
node scripts/ci/status.mjs
```

المستودعات الخاصة تستخدم تسجيل الدخول المعتاد لـGit. لا تضع مفاتيح في عنوان التنزيل. يقرأ status المتغير CI_GITHUB_TOKEN عند الحاجة، ولا يطبعه.

- full يثبت الاعتماديات ويشغّل اختبارات المشروع وبناءً فعليًا/تجميع Worker، ويتوقف عند أول فشل.
- quick فحص أولي فقط؛ لا يُجيز الدمج أو النشر.
- النتائج المحلية في .ci-status/verification.json مرتبطة بـSHA وتذكر التعديلات غير المحفوظة. فشل الأوامر أو تغيير SHA يمنع نجاح التحقق.
- status يجمع آخر Actions وطلبات الدمج وسجلات النشر المتاحة. عدم توفر معلومة يُسجّل صراحة. لا يستنتج استهلاك الفوترة من عدد التشغيلات.
- لا ينشر هذا المشغّل، ولا يجري migrations، ولا يغيّر بيانات إنتاج. إصدار منشور أو rollback ناجح يحتاج دليلًا مستقلًا من مزوّد النشر.
- حافظ على بوابات النشر الحالية. خصوصًا kunonline: Preview مرتبط بالإنتاج؛ لا تتجاوز سكربت provisioning والعزل وبوابة الإصدار الموجودة في preview.yml/production.yml.
- للأكاديمية: npm test يشمل Build كاملًا عبر scripts/build-verified.sh، ويتطلب Bash وGNU timeout. لا تستخدم نجاح اختبارات Node وحده بديلًا عنه.
- موقع كن أونلاين يحتاج Pillow==12.3.0 وarabic-reshaper وpython-bidi وخطوط Noto. Build الموقع الثابت هو توليد الصور وHTML عبر السكربتات الأصلية، ثم اختبار المتصفح.
- متجر العم زاهر: تحقق الاندماج الكامل المحلي باستخدام scripts/ci/storefront-integration.sh إن وُجد، إضافة إلى Build. الحالات المعزولة تستخدم D1/R2 محليين فقط.
- Cloudflare Workers Builds بديل مناسب للبناء على الخادم عند توفر ربط المستودع بالـWorker الحالي؛ استخدم أمر تحقق full قبل رفع نسخة غير مفعّلة. لا تضبط auto-deploy إلى الإنتاج قبل مرور الاختبارات المعزولة، وتأكيد Worker وD1/R2 الحاليين، وحفظ version ID السابق.
- الرجوع يعيد نسخة Worker السابقة عبر آلية النشر الحالية؛ لا يعيد بيانات D1. أي migration غير متوافق يحتاج خطة مستقلة ولا يُشغّل هنا.
- هذه التعديلات لا تثبت Runner دائمًا ولا تغيّر الميزانيات أو وسائل الدفع، ولا تنشر Google Play.
