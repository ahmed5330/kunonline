/* Kun Online v106.0 — manual order creation uses the authoritative J&T Egypt address cascade. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  K.openCreateOrder=async()=>{
    const {cid,sid}=await K.scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
    let products=[];try{const data=await K.api(`/api/state?${q}`);products=data.products||[];}catch{}
    const now=new Date(),today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    K.drawer('طلب جديد',`<div class="card"><form class="v27-form" id="v106OrderForm" data-jnt-address-form="1">
      <label>اسم المستلم <span class="meta">مطلوب</span><input class="input" id="v106OrderName" name="name" autocomplete="name" required></label>
      <label>رقم التليفون <span class="meta">مطلوب</span><input class="input" id="v106OrderPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="01xxxxxxxxx" required></label>
      <label>المحافظة — J&T <span class="meta">مطلوب</span><input class="input" name="province" required placeholder="اختر المحافظة"></label>
      <label>المدينة / الحي — J&T <span class="meta">مطلوب</span><input class="input" name="city" required placeholder="اختر المدينة / الحي"></label>
      <label>المنطقة — J&T <span class="meta">مطلوب</span><input class="input" name="area" required placeholder="اختر المنطقة"></label>
      <label class="wide">الشارع والعنوان التفصيلي <span class="meta">مطلوب</span><input class="input" name="street" autocomplete="street-address" required placeholder="الشارع، رقم العقار، علامة مميزة"></label>
      <label>وصل الأوردر منين <span class="meta">مطلوب</span><select class="select" name="source" id="v106OrderSource"><option value="whatsapp">واتساب</option><option value="facebook">فيسبوك</option><option value="instagram">إنستجرام</option><option value="website">الموقع</option><option value="tiktok">تيك توك</option><option value="phone">مكالمة</option><option value="manual">أخرى / يدوي</option></select></label>
      <label>المنتج<select class="select" id="v106OrderProductSelect"><option value="">— اكتب يدوي —</option>${products.map(p=>`<option value="${esc(p.id)}" data-price="${Number(p.price)||0}">${esc(p.name)}${p.sku?` — ${esc(p.sku)}`:''}</option>`).join('')}</select></label>
      <label>أو اكتب اسم المنتج<input class="input" id="v106OrderProductManual" placeholder="لو مش موجود في القائمة"></label>
      <label>الكمية <span class="meta">مطلوب</span><input class="input" id="v106OrderQty" type="number" min="1" step="1" value="1" required></label>
      <label>ملاحظات المنتج (لون / مقاس)<input class="input" id="v106OrderProductNote" placeholder="مثلاً: أحمر — مقاس L"></label>
      <label>إجمالي المطلوب <span class="meta">مطلوب</span><input class="input" id="v106OrderTotal" type="number" min="0" step="0.01" value="0" required><div class="meta">يتحسب تلقائيًا عند اختيار منتج ويمكن تعديله.</div></label>
      <label>كود كوبون (اختياري)<input class="input" id="v106OrderCoupon" autocomplete="off"></label>
      <label>تاريخ الأوردر <span class="meta">مطلوب</span><input class="input" id="v106OrderDate" type="date" value="${today}" required></label>
      <label class="wide">ملاحظة على الأوردر<textarea class="input" id="v106OrderNote" rows="3"></textarea></label>
      <div class="wide meta">المحافظة والمدينة والمنطقة من نفس دليل J&T المستخدم عند إنشاء الشحنة، وسيتم حفظ أكواد J&T مع الأوردر تلقائيًا.</div>
      <button type="submit" class="btn primary wide" id="v106CreateOrder">تسجيل الأوردر</button>
    </form></div>`);
    const form=document.getElementById('v106OrderForm'),productSelect=document.getElementById('v106OrderProductSelect'),manual=document.getElementById('v106OrderProductManual'),qtyInput=document.getElementById('v106OrderQty'),totalInput=document.getElementById('v106OrderTotal');
    window.KunJntAddressesV80?.enhance?.(form);
    const recalc=()=>{const selected=products.find(p=>String(p.id)===productSelect.value),qty=Math.max(1,Number(qtyInput.value)||1);if(selected)totalInput.value=String((Number(selected.price)||0)*qty);};
    productSelect.onchange=()=>{if(productSelect.value)manual.value='';recalc();};qtyInput.oninput=recalc;manual.oninput=()=>{if(manual.value.trim())productSelect.value='';};
    form.onsubmit=async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const button=document.getElementById('v106CreateOrder');
      try{
        const fd=new FormData(form),manualProduct=val('v106OrderProductManual'),productId=val('v106OrderProductSelect'),selected=manualProduct?null:products.find(p=>String(p.id)===productId),product=manualProduct||selected?.name||'',qty=Math.max(1,Number(val('v106OrderQty'))||1),total=Number(val('v106OrderTotal')||0),date=val('v106OrderDate');
        if(!product)throw new Error('اختر المنتج أو اكتب اسمه');if(!date)throw new Error('تاريخ الأوردر مطلوب');if(!Number.isFinite(total)||total<0)throw new Error('إجمالي المطلوب غير صحيح');
        for(const key of ['province','city','area','street'])if(!String(fd.get(key)||'').trim())throw new Error('أكمل المحافظة والمدينة والمنطقة والشارع من دليل J&T');
        button.disabled=true;button.textContent='جاري تسجيل الأوردر...';
        const payload={clientId:cid,storeId:sid||undefined,name:String(fd.get('name')||'').trim(),phone:String(fd.get('phone')||'').trim(),province:String(fd.get('province')||'').trim(),city:String(fd.get('city')||'').trim(),area:String(fd.get('area')||'').trim(),street:String(fd.get('street')||'').trim(),provinceCode:String(fd.get('provinceCode')||'').trim(),cityCode:String(fd.get('cityCode')||'').trim(),districtCode:String(fd.get('districtCode')||'').trim(),addressCountryCode:String(fd.get('addressCountryCode')||'100000').trim(),source:String(fd.get('source')||'manual'),product,productId:selected?.id||undefined,unitPrice:selected?Number(selected.price)||0:undefined,qty,total,productNote:val('v106OrderProductNote'),couponCode:val('v106OrderCoupon'),date,note:val('v106OrderNote'),state:'pending'};
        await K.api('/api/orders/manual-jnt',{method:'POST',body:JSON.stringify(payload)});
        K.notify('تم تسجيل الأوردر بعنوان J&T كامل');K.refresh();
      }catch(error){K.notify(error.message);if(button?.isConnected){button.disabled=false;button.textContent='تسجيل الأوردر';}}
    };
  };
  window.KunManualJntOrderV106={version:'106.0'};
  document.documentElement.dataset.manualJntOrder='v106-ready';
})();
