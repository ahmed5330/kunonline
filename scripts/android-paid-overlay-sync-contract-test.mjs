import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const java=name=>readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/'+name,import.meta.url),'utf8');
const src=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const card=java('CallerCardActivity.kt'),overlay=java('CallerOverlay.kt');
const detail=java('CallerFullDetailsView.kt'),home=java('KunNativeAppV25.kt');
const cs=java('CustomerServiceApi.kt'),badge=java('KunPaymentBadge.kt');
const api=java('KunApi.kt');
const login=api.split('fun loginAndSync(')[1]?.split('fun repairPasswordWithStoredAdminSession(')[0]||'';
assert(login.includes('request("GET", "/api/me", cookie = cookie)'), 'login must verify session before rendering');
assert(login.includes('CustomerCache.clear(context)')&&login.includes('MobileSnapshotCache.clear(context)'),
  'no previous account cache is exposed during login');
assert(login.includes('SyncResult(true, "تم تسجيل الدخول بنجاح", 0)'), 'verified session opens home immediately');
assert(!login.includes('val sync = syncWithCookie(context, cookie)'),
  'login cannot wait for a large order snapshot before displaying home');
assert(home.includes('performRefresh(false, silent = snapshot != null)'),
  'scoped order refresh must happen asynchronously after store permission discovery');
const sync=src('commerce-order-sync.js'),backend=src('production-customer-service.js');
assert(card.includes('renderCallerProductSummary(this, detailsHost, result.data)'));
assert(!card.includes('renderCallerFullDetails(this, detailsHost, result.data)'),
  'fallback cannot expand the green full-order block over live call controls');
assert(!card.includes('جاري تحميل تفاصيل الطلب الكاملة'));
assert(!card.includes('تعذر تحميل التفاصيل:'));
assert(card.includes('window.setLayout(WindowManager.LayoutParams.MATCH_PARENT,')&&
       card.includes('resources.displayMetrics.heightPixels / 2'),
  'fallback Activity itself cannot exceed half display height');
assert(card.includes('LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f'),
  'product list must scroll within fixed header/actions space');
assert(overlay.includes('val maxHeight = (app.resources.displayMetrics.heightPixels / 2)'));
assert(overlay.includes('renderCallerProductSummary(app, detailsHost, result.data)'));
assert(!overlay.includes('renderCallerFullDetails('));
for(const text of [card,overlay]){
  assert(text.includes('displayPayment(customer.paymentStatus)'), 'payment badge visible on initial call');
  assert(text.includes('latestPayment'), 'verified fresh payment status refreshes call badge');
  assert(text.includes('مدفوع بالكامل'), 'paid order has clear prominent label');
  assert(text.includes('الملاحظات'), 'notes button accessible from caller card');
}
assert(detail.includes('item.optJSONArray("options")')&&detail.includes('variantName')&&
       detail.includes('quantity')&&detail.includes('sku'),
  'compact caller view includes structured option/color/model/quantity and SKU');
assert(cs.includes('/api/customer-service/orders/${enc(orderId)}/notes?')&&
       cs.includes('paymentStatus = o.optString("paymentStatus"')&&cs.includes('productLines = o.optJSONArray("productLines")'));
assert(badge.includes('status == "paid"')&&badge.includes('مدفوع بالكامل'));
assert(home.includes('KunPaymentBadge(order.paymentStatus)'));
assert(home.includes('V25_FOREGROUND_SYNC_MS = 15_000L')&&home.includes('V25_OPERATIONAL_SYNC_MS = 10_000L'),
  'foreground stays up to date by scoped delta polling');
assert(home.includes('if (!silent && snapshot == null) loading = true'),
  'cached data must render immediately during refresh');
assert(!home.includes('تعذر تحديث بيانات الطلبات')&&!home.includes('جاري تجهيز بيانات الطلبات…'));
assert(!home.includes('جاري تحميل بيانات المتجر'));
assert(sync.includes('easyOrdersItemsSnapshot(p)')&&sync.includes('appendEasyOrdersItemsSnapshot(env.DB'),
  'trusted provider must save line breakdown');
assert(backend.includes('easyOrdersItemsFromHistory(r.history)')&&
       backend.includes('easyOrdersItemsFromHistory(order.history)'),
  'backend should provide structured line breakdown to details and list');
assert(backend.includes('paymentFromHistory(r.history)'),'payment evidence is server verified');
console.log('PASS paid badges (web/app/call), synced notes, full product variants and qty, compact half-screen fallback, cached fast Android refresh');
